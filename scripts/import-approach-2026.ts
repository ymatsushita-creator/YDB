import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import {
  planApproach, planInterviews, nameKey, JUDGEMENT_AXES,
  IMPORT_ACTOR, IMPORT_INVOLVEMENT,
} from '../src/import/approach_2026.ts'
import { setConfidence } from '../src/commands/confidence.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 応募管理表（`2期応募管理.xlsx`）を本番へ取り込む（依頼者の指示。実行⑫）。
 *
 *   node scripts/import-approach-2026.ts            突き合わせだけ（既定。書かない）
 *   node scripts/import-approach-2026.ts --apply    実際に入れる
 *
 * ★ **既定は書かない**（C-61 と同じ）。取り込みは一度きりではなく、
 *   表が更新されるたびに走る。走らせるたびに書かれると、
 *   そろっていない段階で中途半端に入る。
 *
 * ★ **出力に氏名・メールを出さない。** 出すのは件数と行番号だけ。
 *   受け取った表は実在の応募者のもので、この出力は端末にもログにも残る。
 *
 * ★ **書き込み先を毎回名乗る**（C-74 で `.pgdata` へ入れて引き上げた）。
 *   入れるのは `DATABASE_URL`（本番）だけで、デモにもテストにも入れない。
 *
 * ★ 冪等。2回流しても人もメモも二重にならない
 *   （取り込みのメモが既にある人は飛ばす）。
 */

const XLSX = join(process.cwd(), '2期応募管理.xlsx')
const apply = process.argv.includes('--apply')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}
// ★ 名乗る。接続文字列そのものは出さない（合言葉と同じ扱い）。
const host = /@([^/:]+)/.exec(url)?.[1] ?? '(不明)'
console.log(`書き込み先: ${host}${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}`)
console.log('')

const book = new Workbook(XLSX)
const plan = planApproach(book)
const interviews = planInterviews(book)

console.log(`アプローチリスト  ${plan.people.length} 人（値はあるが氏名が空の行 ${plan.skipped}）`)
console.log(`  去年（2期）  ${plan.byCohort[2]} 人 ―― 一番左の欄が FALSE`)
console.log(`  今年（3期）  ${plan.byCohort[3]} 人 ―― 一番左の欄が TRUE`)
console.log(`  ★ 決まらない ${plan.byCohort.unknown} 人 ―― 左端が空で、`
  + `ステータス欄にも手掛かりが無い（期にぶら下がる行を書かない）`)
console.log(`  うちステータス欄で決めた ${plan.people.filter((p) => p.cohortSource === 'status').length} 人`
  + `（左端が空。表が「3期生候補」「合格/不合格」と書いている。C-157）`)
console.log(`確度の格付け     ${plan.people.filter((p) => p.grade).length} 人`
  + `（表の「3期生候補（S/A/B/C）」。**3期の確度として入れる**。C-158）`)
console.log(`面談シート       ${interviews.length} 件`
  + `（面談日が読めた ${interviews.filter((i) => i.metOn).length} 件）`)
console.log(`判断軸           ${JUDGEMENT_AXES.length} 軸`)
console.log('')

const db: Db = await openPostgres(url)
const one = async <T>(sql: string, params?: unknown[]): Promise<T | null> =>
  ((await db.query<T>(sql, params)).rows[0] ?? null)

// --- いま入っている人と突き合わせる（氏名の完全一致だけ。C-74 の鍵は使えない）---
const existing = new Map<string, string>()
for (const r of (await db.query<{ id: string; family_name: string; given_name: string }>(
  `SELECT id, family_name, given_name FROM persons WHERE deleted_at IS NULL`)).rows) {
  existing.set(nameKey(`${r.family_name}${r.given_name}`), r.id)
}
const already = plan.people.filter((p) => existing.has(nameKey(p.fullName))).length
console.log(`本番に既に居る人  ${existing.size} 人 / 表と氏名が一致 ${already} 人`)
console.log(`新しく作る人      ${plan.people.length - already} 人`)
console.log('')

if (!apply) {
  console.log('書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

// -------------------------------------------------------------
// ここから書く。**1つの取引にする** ―― 途中で落ちたら何も残さない。
// -------------------------------------------------------------
try {
  await db.exec('BEGIN')

  // ① 取り込みの記録者。実在の担当者に付け替えていない（C-75 と同じ）。
  //    ★ `staffs.display_name` に一意制約は無い（同姓同名を許す。C-96）。
  //      `ON CONFLICT` は使えないので、**探してから作る。**
  const actor = await one<{ id: string }>(
    `SELECT id FROM staffs WHERE display_name = $1 LIMIT 1`, [IMPORT_ACTOR])
    ?? await one<{ id: string }>(`
      INSERT INTO staffs (display_name, email, is_active)
      VALUES ($1, NULL, false) RETURNING id`, [IMPORT_ACTOR])

  // ② 判断軸を置く段。**3期の先頭**に「特別選考」を挿す。
  //    ★ 末尾に足すと `v_final_selection_step`（最大の sort_order）が
  //      特別選考になり、**最終面接が最終でなくなる。** 既存を後ろへずらす。
  //    ★ 3期に応募が1件でもあれば、段の並べ替えはしない（集計が動く）。
  const season3 = await one<{ id: string }>(
    `SELECT id FROM seasons WHERE cohort_number = 3`)
  if (!season3) throw new Error('3期が無い')
  const apps3 = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM applications WHERE season_id = $1`, [season3.id])
  let stepId: string
  const found = await one<{ id: string }>(
    `SELECT id FROM selection_steps WHERE season_id = $1 AND name = '特別選考'`, [season3.id])
  if (found) {
    stepId = found.id
  } else {
    if ((apps3?.n ?? 0) > 0) throw new Error('3期に応募がある。段の並べ替えを黙って行わない')
    // 一意制約に当たらないよう、いったん大きい値へ逃がしてから詰め直す。
    await db.query(
      `UPDATE selection_steps SET sort_order = sort_order + 100 WHERE season_id = $1`,
      [season3.id])
    await db.query(
      `UPDATE selection_steps SET sort_order = sort_order - 99 WHERE season_id = $1`,
      [season3.id])
    stepId = (await one<{ id: string }>(`
      INSERT INTO selection_steps (season_id, sort_order, name, pass_criteria)
      VALUES ($1, 1, '特別選考', $2) RETURNING id`,
    [season3.id,
      '通常選考では取りこぼしやすい「突出した個」を確実に獲得する枠。'
      + '判断軸は応募管理表の「特別選考」シートから取り込んだ。']))!.id
  }

  // ③ 判断軸9つ。**運営の語をそのまま**（こちらで言い換えない）。
  //    点の幅は既存の面接軸と同じ4段。表に点の定義が無いので、
  //    **点そのものは取り込まない**（面談の所見は文章のままメモへ）。
  //    重み付け（A〜C=必須 / D〜I=加点）は kind として保存する（0033）。
  let axesAdded = 0
  for (const [i, axis] of JUDGEMENT_AXES.entries()) {
    const r = await db.query<{ id: string }>(`
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order, kind)
      VALUES ($1, $2, 4, $3, $4)
      ON CONFLICT (selection_step_id, sort_order) DO NOTHING
      RETURNING id`,
    [stepId, axis.name, i + 1, axis.kind])
    axesAdded += r.rows.length
  }

  // ④ 人。**姓に氏名まるごと、名は空**（区切りが無い。C-74 と同じ）。
  const school = await one<{ id: string }>(
    `SELECT id FROM schools WHERE name = '学校未記録'`)
  if (!school) throw new Error('「学校未記録」が無い')
  const notApproached = await one<{ id: string }>(
    `SELECT id FROM approach_states WHERE code = 'not_approached'`)
  if (!notApproached) throw new Error('未アプローチの状態が無い')
  const notInSeason = await one<{ id: string }>(
    `SELECT id FROM approach_states WHERE code = 'not_in_season'`)
  if (!notInSeason) throw new Error('「この期の対象ではない」が無い（0041 が未適用）')
  const seasonOf = new Map<2 | 3, string>()
  for (const c of [2, 3] as const) {
    const s = await one<{ id: string }>(`SELECT id FROM seasons WHERE cohort_number = $1`, [c])
    if (!s) throw new Error(`${c}期が無い`)
    seasonOf.set(c, s.id)
  }

  const personOf = new Map<string, string>(existing)
  let created = 0
  let noted = 0
  let numbered = 0
  let cohortCorrections = 0
  let undecided = 0
  let graded = 0
  let movedOut = 0
  let restored = 0
  /**
   * 表がその氏名で主張している期。**同じ人が2行に出ることがある。**
   * 表が主張している側の取り込み記録は打ち消さない（打ち消し合いになる）。
   */
  const claimed = new Map<string, Set<2 | 3>>()
  for (const p of plan.people) {
    if (p.cohort === null) continue
    const k = nameKey(p.fullName)
    if (!claimed.has(k)) claimed.set(k, new Set())
    claimed.get(k)!.add(p.cohort)
  }

  for (const p of plan.people) {
    const key = nameKey(p.fullName)
    let personId = personOf.get(key)

    if (!personId) {
      personId = (await one<{ id: string }>(`
        INSERT INTO persons
          (family_name, given_name, family_name_kana, given_name_kana,
           school_id, email, is_demo)
        VALUES ($1, '', $2, NULL, $3, $4, false)
        RETURNING id`,
      [p.fullName, p.kana, school.id, p.email]))!.id
      personOf.set(key, personId)
      created++
    }

    // 応募は「その期の選考へ実際に出した」一次記録なので、チェック欄より強い。
    // 2期応募がある人を3期候補へ重複計上しない。
    const season2Id = seasonOf.get(2)!
    const season3Id = seasonOf.get(3)!
    const hasSeason2Application = Boolean(await one(
      `SELECT 1 FROM applications WHERE person_id = $1 AND season_id = $2`,
      [personId, season2Id]))
    const effectiveCohort: 2 | 3 | null = hasSeason2Application ? 2 : p.cohort

    // ★ 一番左の欄が空で、2期の応募記録も無い人。**期を決めない。**
    //   期にぶら下がる行（候補者番号・アプローチ状態）は1つも書かない。
    //   人とメモは人にぶら下がるので、下で書く。
    if (effectiveCohort === null) {
      undecided++
    } else {
    const seasonId = seasonOf.get(effectiveCohort)!

    // 誤った側の取り込みイベントを打ち消し、候補者番号も片側へ寄せる。
    // 2期応募があれば2期、それ以外は**一番左の欄**の判定を使う（C-149）。
    const wrongCohort: 2 | 3 = effectiveCohort === 3 ? 2 : 3
    const wrongSeasonId = effectiveCohort === 3 ? season2Id : season3Id
    if (!claimed.get(key)?.has(wrongCohort) || hasSeason2Application) {
      const wrong = await one<{ id: string; approach_state_id: string; occurred_at: Date }>(`
        SELECT e.id, e.approach_state_id, e.occurred_at
          FROM approach_events e
         WHERE e.person_id = $1 AND e.season_id = $2
           AND e.note = '応募管理表から取り込んだ'
           AND NOT EXISTS (SELECT 1 FROM approach_events c WHERE c.corrects_event_id = e.id)
         LIMIT 1`, [personId, wrongSeasonId])
      if (wrong) {
        // ★ 打ち消し行に**元の状態をコピーしない**（0041）。
        //   コピーすると、打ち消したのに同じ期の一覧に残り続ける
        //   ―― 実測で256人が残っていた。終端状態を載せて母集団から外す。
        await db.query(`
          INSERT INTO approach_events
            (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id,
             is_correction, corrects_event_id, note)
          VALUES ($1, $2, $3, now(), $4, true, $5, $6)`,
        [personId, wrongSeasonId, notInSeason.id, actor!.id, wrong.id,
          hasSeason2Application
            ? '期判定を訂正：2期応募記録があるため2期'
            : `期判定を訂正：一番左の欄が ${p.referral ?? '空'} のため${effectiveCohort}期`])
        cohortCorrections++
      }

      // ★ 既に打ち消してあるのに、**一覧からは消えていない**人を直す。
      //   実行⑯の前の訂正は元の状態をコピーしていたので、打ち消し行が
      //   有効な出来事として同じ期に残り続けていた（実測256人）。
      //   ここは打ち消しではなく**状態の追記**である ―― 打ち消し行はもう
      //   1つしか置けない（一意制約）ので、状態を置き直して母集団から外す。
      //
      //   ★ 運営が手で置いた状態には触らない。取り込みが書いた記録
      //     （下の3つの言い回し）が最後のときだけ直す。
      const stale = await one<{ is_terminal: boolean; note: string | null }>(`
        SELECT s.is_terminal, v.last_note AS note
          FROM v_person_approach_state v
          JOIN approach_states s ON s.id = v.approach_state_id
         WHERE v.person_id = $1 AND v.season_id = $2`, [personId, wrongSeasonId])
      if (stale && !stale.is_terminal
        && (stale.note === '応募管理表から取り込んだ'
          || (stale.note ?? '').startsWith('期判定を訂正'))) {
        await db.query(`
          INSERT INTO approach_events
            (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
          VALUES ($1, $2, $3, now(), $4, $5)`,
        [personId, wrongSeasonId, notInSeason.id, actor!.id,
          `取り込みが別の期に付けていたため外す（${effectiveCohort}期が正）`])
        movedOut++
      }

      await db.query(`
        DELETE FROM candidate_numbers n
         WHERE n.person_id = $1 AND n.season_id = $2
           AND NOT EXISTS (SELECT 1 FROM applications a
                            WHERE a.person_id = $1 AND a.season_id = $2)`,
      [personId, wrongSeasonId])
    }

    // 候補者番号。期ごとに1から、欠番は詰めない（C-79）。
    const hasNumber = await one(
      `SELECT 1 FROM candidate_numbers WHERE person_id = $1 AND season_id = $2`,
      [personId, seasonId])
    if (!hasNumber) {
      await db.query(`
        INSERT INTO candidate_numbers (season_id, person_id, number)
        SELECT $1, $2, coalesce(max(number), 0) + 1
          FROM candidate_numbers WHERE season_id = $1`, [seasonId, personId])
      numbered++
    }

    // ★ 正しい期の側で終端になっている人を、表に従って戻す（実行⑯）。
    //   8/13 に「依頼により3期候補から一旦解除」で見送りにされた70人が居た。
    //   表は同じ人を「3期生候補」と書いている。**依頼者の最新の指示は
    //   「エクセルの内容にすべて従い」**なので、表の側へ揃える。
    //
    //   ★ 戻すのは**その言い回しの見送りだけ。** 運営が別の理由で見送った人、
    //     自分で「この期の対象ではない」と置いた人には触らない。
    //   ★ 打ち消しではなく**追記**である。間違っていれば、もう1行で戻せる。
    const parked = await one<{ label: string; note: string | null }>(`
      SELECT st.label, v.last_note AS note
        FROM v_person_approach_state v
        JOIN approach_states st ON st.id = v.approach_state_id
       WHERE v.person_id = $1 AND v.season_id = $2 AND st.is_terminal`,
    [personId, seasonId])
    if (parked && (parked.note ?? '').includes('一旦解除')) {
      await db.query(`
        INSERT INTO approach_events
          (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
        VALUES ($1, $2, $3, now(), $4, $5)`,
      [personId, seasonId, notApproached.id, actor!.id,
        '応募管理表が3期生候補と書いているため戻す（依頼者の指示。実行⑯）'])
      restored++
    }

    // アプローチ状態。**運営のステータスを翻訳しない**ので、全員「未アプローチ」。
    // 実際その人について、この製品には声掛けの記録が1つも無い（C-75 と同じ）。
    const hasState = await one(
      `SELECT 1 FROM approach_events WHERE person_id = $1 AND season_id = $2`,
      [personId, seasonId])
    if (!hasState) {
      await db.query(`
        INSERT INTO approach_events
          (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
        VALUES ($1, $2, $3, now(), $4, $5)`,
      [personId, seasonId, notApproached.id, actor!.id, '応募管理表から取り込んだ'])
    }
    }

    // 表の値は**そのままの語で**メモへ。翻訳できないものを捨てない。
    // ★ ここは人にぶら下がる。期が決まらない人にも残す。
    const hasNote = await one(
      `SELECT 1 FROM person_notes WHERE person_id = $1 AND involvement = $2`,
      [personId, IMPORT_INVOLVEMENT])
    if (!hasNote && p.facts.length > 0) {
      const body = p.facts.map((f) => `${f.label}: ${f.value}`).join('\n')
      await db.query(`
        INSERT INTO person_notes (person_id, author_name, noted_at, body, involvement)
        VALUES ($1, $2, now(), $3, $4)`,
      [personId, IMPORT_ACTOR, body.slice(0, 2000), IMPORT_INVOLVEMENT])
      noted++
    }
  }

  // ④' 確度（S/A/B/C）。**表が書いている格付けを、3期の確度として写す**（C-158）。
  //     ★ こちらで判定し直さない。運営が付けた格付けをそのまま入れる。
  //     ★ 既に誰かが画面から記入していたら**触らない** ―― 人が入れた見立てを
  //       取り込みで上書きしない（人の判断のほうが新しい）。
  for (const p of plan.people) {
    if (!p.grade) continue
    const personId = personOf.get(nameKey(p.fullName))
    if (!personId) continue
    const already = await one(
      `SELECT 1 FROM v_person_confidence WHERE person_id = $1 AND season_id = $2`,
      [personId, season3.id])
    if (already) continue
    const r = await setConfidence(db, {
      personId,
      seasonId: season3.id,
      gradeCode: p.grade,
      recordedBy: IMPORT_ACTOR,
      note: '応募管理表の「2026年8月時点ステータス」から取り込んだ',
    })
    if (r.ok) graded++
  }

  // ⑤ 面談。**軸ごとの所見を、軸の名前とともに**残す。
  //    点は入っていないので作らない（`evaluation_scores` へ入れない）。
  let interviewNotes = 0
  for (const iv of interviews) {
    const key = nameKey(iv.fullName)
    let personId = personOf.get(key)
    if (!personId) {
      // 面談だけあってリストに居ない人。**落とさずに作る。**
      personId = (await one<{ id: string }>(`
        INSERT INTO persons (family_name, given_name, family_name_kana, school_id, is_demo)
        VALUES ($1, '', $2, $3, false) RETURNING id`,
      [iv.fullName, iv.kana, school.id]))!.id
      personOf.set(key, personId)
      created++
    }
    const label = `特別選考の面談${iv.metOn ? `（${iv.metOn}）` : ''}`
    const hasNote = await one(
      `SELECT 1 FROM person_notes WHERE person_id = $1 AND involvement = $2`,
      [personId, label])
    if (hasNote) continue

    const lines: string[] = []
    if (iv.owner) lines.push(`対応者: ${iv.owner}`)
    if (iv.result) lines.push(`結果: ${iv.result}`)
    if (iv.confidence) lines.push(`応募確度: ${iv.confidence}`)
    for (const a of iv.axisComments) lines.push(`【${a.axis}】${a.comment}`)
    if (lines.length === 0) continue

    await db.query(`
      INSERT INTO person_notes (person_id, author_name, noted_at, body, involvement)
      VALUES ($1, $2, $3::timestamptz, $4, $5)`,
    [personId, IMPORT_ACTOR,
      iv.metOn ? `${iv.metOn}T12:00:00+09:00` : new Date().toISOString(),
      lines.join('\n').slice(0, 2000), label])
    interviewNotes++
  }

  await db.exec('COMMIT')

  console.log('入れた ――')
  console.log(`  人           ${created} 人（既にいた人は作り直していない）`)
  console.log(`  候補者番号     ${numbered} 件`)
  console.log(`  取り込みメモ   ${noted} 件`)
  console.log(`  面談のメモ     ${interviewNotes} 件`)
  console.log(`  判断軸        ${axesAdded} 軸（3期「特別選考」）`)
  console.log(`  期の訂正       ${cohortCorrections} 人（応募記録を優先し、`
    + `残りは一番左の欄 FALSE=2期 / TRUE=3期）`)
  console.log(`  期を決めなかった ${undecided} 人（手掛かりが無い。期の行は書いていない）`)
  console.log(`  期へ戻した     ${restored} 人（表が候補と書いているのに見送りだった分）`)
  console.log(`  期から外した   ${movedOut} 人（取り込みが別の期に付けていた分。0041）`)
  console.log(`  確度の記入     ${graded} 人（表の格付けを3期の確度として。既にあれば飛ばす）`)
} catch (e) {
  await db.exec('ROLLBACK')
  console.error('入れられなかった。**何も書いていない。**')
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await db.close()
}
