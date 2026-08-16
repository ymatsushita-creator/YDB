/**
 * 旧 NEO-Youth から 2期（2026年度）を取り込む（実行⑩。依頼者の指示）。
 *
 * 原本は `db/private/legacy-youthdb-2026-08-07/`（gitignore 済み）。
 * **ここには実データを1行も書かない。** 形の変換と、足りないものの数え上げだけを置く。
 *
 * ★ このモジュールは DB に触らない。
 *   触るのは `scripts/import-legacy-2026.ts` である。分けているのは、
 *   **入る／入らないの判定を、本番へ繋がずにテストできるようにする**ため。
 *   実データはテストに使えない（CLAUDE.md）ので、判定だけを架空の行で固定する。
 *
 * ★ 足りない値をこちらで埋めない。
 *   埋めた瞬間、記録は「運営が言ったこと」ではなくなる。
 *   足りない行は**入れずに、何が足りないかを名前で返す。**
 */

/** 旧 `youth_candidates` のうち、取り込みに使う列だけ。 */
export interface LegacyCandidate {
  id: number
  /** 姓名が1つの文字列に入っている。**区切りがある保証は無い。** */
  name: string
  kana: string | null
  email: string | null
  school: string | null
  /** 応募日。無い行がある（応募前など）。 */
  applied_at: string | null
  status: string
  /** 旧システムに登録された時刻。**その人を識別した日**である。 */
  created_at: string
}

/**
 * 旧データに無い値を、依頼者が外から与えるための表。
 *
 * 旧 `youth_candidates.id` を鍵にする。氏名を鍵にすると同姓同名で崩れる。
 */
export interface Supplement {
  familyName?: string
  givenName?: string
  /** `YYYY-MM-DD`。旧データには**1件も無い**。 */
  birthDate?: string
  email?: string
  school?: string
}

/** 足りない値の名前。記録層の列名と揃える。 */
export type MissingField =
  | 'given_name' | 'birth_date' | 'email' | 'school'

export interface ImportablePerson {
  legacyId: number
  /** 区切りが無ければ、**受け取った氏名まるごと**がここに入る。 */
  familyName: string
  /** 区切りが無ければ空文字。**切れないものを切らない。** */
  givenName: string
  familyNameKana: string | null
  givenNameKana: string | null
  /** 受け取っていなければ null。 */
  birthDate: string | null
  email: string | null
  /** 受け取っていなければ null（取り込み側が「学校未記録」へ寄せる）。 */
  school: string | null
  /** 応募日。無ければ応募は作らない。 */
  submittedAt: string | null
  /**
   * 識別した日（旧システムの `created_at`）。
   *
   * ★ **「いま」で埋めない。** 年度の母集団は「選考終了日までに識別されたか」で
   *   決まるので、取り込んだ時刻を入れると**全員がその期の外へ落ちる。**
   *   実際それで、2期の一覧に1人も出なかった。
   */
  createdAt: string | null
  /** この人について**受け取れなかった**もの。画面に出すために持つ。 */
  missing: MissingField[]
}

export interface BlockedPerson {
  legacyId: number
  missing: MissingField[]
}

export interface ImportPlan {
  ready: ImportablePerson[]
  /**
   * 入れられない行。
   *
   * ★ 0023 で生年月日とメールを「無いこともある」に変えたので、
   *   **ここに落ちるのは氏名が無い行だけ**になった。
   *   氏名が無ければ、その人を指す手段が1つも無い。
   */
  blocked: BlockedPerson[]
  /** 応募日が無く、人は入るが応募は作れない件数。 */
  readyWithoutApplication: number
  /** 足りない値ごとの件数。**どれを集めれば何件動くかを、これで示す。** */
  missingCounts: Record<MissingField, number>
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const SPACE = /[\s　]+/

const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/**
 * 姓名を分ける。
 *
 * ★ **区切りが無い氏名を勝手に切らない。**
 *   日本語の氏名は、区切りが無ければ姓と名の境目が決まらない
 *   （「田中真理子」は 田中/真理子 とも 田中真/理子 とも読める）。
 *   ここで当てにいくと、名寄せの材料
 *   `(family_name, given_name, birth_date, school_id)` が
 *   **人によって違う切り方で並ぶ。**
 *
 *   切れないときは**氏名まるごとを姓に置き、名は空にする。**
 *   表示は `姓 + ' ' + 名` なので、氏名はそのまま出る。
 *   「切れなかった」という事実は `missing` に `given_name` として残る。
 */
export const splitName = (
  name: string | null, supplement: Supplement,
): { familyName: string | null; givenName: string | null } => {
  const family = trimmed(supplement.familyName)
  const given = trimmed(supplement.givenName)
  if (family && given) return { familyName: family, givenName: given }

  const whole = trimmed(name)
  if (whole) {
    const parts = whole.split(SPACE).filter((p) => p !== '')
    if (parts.length >= 2) {
      // 3つ以上に割れたら、先頭を姓、残りを名にする。
      // ミドルネームや複合名を落とさない。
      return {
        familyName: family ?? parts[0]!,
        givenName: given ?? parts.slice(1).join(' '),
      }
    }
    // ★ 切れないときは、**氏名まるごとを姓に置く。**
    //   境目を当てにいかない。名は「受け取っていない」として空のままにする。
    //   表示は `姓 + ' ' + 名` なので、これで氏名がそのまま出る。
    return { familyName: family ?? whole, givenName: given }
  }
  return { familyName: family, givenName: given }
}

/**
 * 取り込めるかどうかを、1行ずつ判定する。
 *
 * 返すのは**判定だけ**で、DB には触らない。
 */
export const planImport = (
  rows: LegacyCandidate[],
  supplements: Record<string, Supplement> = {},
): ImportPlan => {
  const ready: ImportablePerson[] = []
  const blocked: BlockedPerson[] = []
  const missingCounts: Record<MissingField, number> = {
    given_name: 0, birth_date: 0, email: 0, school: 0,
  }

  for (const row of rows) {
    const s = supplements[String(row.id)] ?? {}
    const { familyName, givenName } = splitName(row.name, s)
    const birthDate = trimmed(s.birthDate)
    const email = trimmed(row.email) ?? trimmed(s.email)
    const school = trimmed(row.school) ?? trimmed(s.school)

    // ★ 受け取っていないものを数える。**入れない理由ではなく、
    //   その人について何が欠けているかの記録**である（0023）。
    const missing: MissingField[] = []
    if (!givenName) missing.push('given_name')
    // 形が違うものは「有る」と数えない。`date` に入らない値は入らない。
    if (!birthDate || !DAY.test(birthDate)) missing.push('birth_date')
    if (!email) missing.push('email')
    if (!school) missing.push('school')

    for (const m of missing) missingCounts[m] += 1

    // ★ 氏名だけは要る。無ければその人を指す手段が1つも無い。
    if (!familyName) {
      blocked.push({ legacyId: row.id, missing })
      continue
    }

    const kana = splitKana(row.kana)
    ready.push({
      legacyId: row.id,
      familyName,
      // 切れないものを切らない。区切りが無ければ、姓に氏名まるごとが入る。
      givenName: givenName ?? '',
      familyNameKana: kana.familyNameKana,
      givenNameKana: kana.givenNameKana,
      birthDate: birthDate && DAY.test(birthDate) ? birthDate : null,
      email,
      school,
      // 応募日が無い行に日付を作らない。応募は作らず、人だけ入れる。
      submittedAt: trimmed(row.applied_at),
      createdAt: trimmed(row.created_at),
      missing,
    })
  }

  return {
    ready,
    blocked,
    readyWithoutApplication: ready.filter((r) => r.submittedAt === null).length,
    missingCounts,
  }
}

/**
 * ふりがなを分ける。
 *
 * 照合には使わない列なので（`persons` のコメント）、切れなければ両方 null にする。
 * 姓名と違い、**切れないふりがなを姓側へ丸ごと入れない** ―― 苗字のふりがなとして
 * 読める場所に、氏名まるごとが入ってしまう。
 */
const splitKana = (
  kana: string | null,
): { familyNameKana: string | null; givenNameKana: string | null } => {
  const whole = trimmed(kana)
  if (!whole) return { familyNameKana: null, givenNameKana: null }
  const parts = whole.split(SPACE).filter((p) => p !== '')
  if (parts.length < 2) return { familyNameKana: null, givenNameKana: null }
  return { familyNameKana: parts[0]!, givenNameKana: parts.slice(1).join(' ') }
}

/**
 * 応募の取り込み鍵。
 *
 * `applications.form_response_id` は取り込みの冪等性のための列（0001）。
 * 旧テーブル名と旧IDを入れておくと、**2回流しても応募が二重にならない**し、
 * どの行から来たのかが後から辿れる。
 */
export const legacyFormResponseId = (legacyId: number): string =>
  `legacy:youth_candidates:${legacyId}`

/** 人の取り込み鍵（0023 で `persons.source_ref` を足した）。 */
export const legacyPersonRef = (legacyId: number): string =>
  `legacy:youth_candidates:${legacyId}`

/** 学校が分からない人の置き場所（0023）。**非活性の行**である。 */
export const SCHOOL_UNKNOWN = '学校未記録'


/**
 * 取り込みそのものを表す職員（0024）。
 *
 * ★ **実在の担当者に付け替えない。** 誰が記録したかは旧データに無い。
 *   取り込みが作った行だと分かる名前を1つ置き、非活性にしておく
 *   （非活性なので、担当を選ぶ画面には出ない）。
 */
export const IMPORT_ACTOR = '旧システム取り込み'

/** アプローチ状態の初期値。**「まだ声を掛けていない」ではなく「記録が無い」。** */
export const INITIAL_APPROACH_CODE = 'not_approached'

/**
 * 旧データに出てくる担当者の氏名を集める。
 *
 * ★ 氏名だけを取る。**メールも役割も作らない。**
 *   空欄・記号だけの値は職員ではないので落とす。
 */
export const collectStaffNames = (rows: Array<Record<string, unknown>>,
  fields: string[]): string[] => {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const f of fields) {
      const v = trimmed(row[f] as string | null | undefined)
      if (!v) continue
      // 「ー」「-」など、担当者ではない印だけの値を職員にしない。
      if (/^[-ー―–—・．.\s]+$/.test(v)) continue
      if (v.length > 20) continue
      seen.add(v)
    }
  }
  return [...seen].sort()
}

// -------------------------------------------------------------
// 最終面接（旧 candidates。実行⑩）
// -------------------------------------------------------------

/** 旧 `candidates`（＝最終面接シート）のうち、取り込みに使う列だけ。 */
export interface LegacyFinalInterview {
  id: number
  name: string
  sec2_evaluator: string | null
  sec2_score_smile: number | null
  sec2_score_respect: number | null
  sec2_score_premise: number | null
  sec2_score_passion: number | null
  sec2_score_thinking: number | null
  sec2_score_honest: number | null
  sec2_comment: string | null
  check_points: string | null
  strengths: string | null
  concerns: string | null
  overall: string | null
  overall_comment: string | null
  created_at: string
}

/**
 * 6軸の対応。
 *
 * ★ **ここで決めたのではない。** `db/seeds/0002_season_2026.production.sql` が
 *   「6軸は最終面接の軸である。旧 DB では candidates.sec2_* に入っていた」と
 *   書き、その順で登録している。同じ順を写しているだけ。
 *   軸の呼び名は運営の日本語をそのまま使う（英語の列名へ寄せない）。
 */
export const FINAL_CRITERIA: Array<{ column: keyof LegacyFinalInterview; name: string }> = [
  { column: 'sec2_score_smile', name: '笑顔' },
  { column: 'sec2_score_respect', name: 'リスペクト' },
  { column: 'sec2_score_premise', name: '前提超越' },
  { column: 'sec2_score_passion', name: '熱量' },
  { column: 'sec2_score_thinking', name: '地頭力' },
  { column: 'sec2_score_honest', name: '素直さ' },
]

/**
 * 旧 `overall` を、面接シートの最終判定へ。
 *
 * 依頼者の様式は 合格 / ボーダー / 不合格 の3つ。旧データは 採用 / ボーダー /
 * 不採用 で、**1対1で対応する。** 知らない値は写さない（null にする）。
 */
export const toRecommendation = (overall: string | null): string => {
  const v = (overall ?? '').trim()
  if (v === '採用') return 'pass'
  if (v === 'ボーダー') return 'border'
  if (v === '不採用') return 'fail'
  return ''
}

/**
 * 軸ごとの根拠。
 *
 * ★ 旧データに**軸ごとの根拠は無い。** 総評やコメントはあるが、
 *   それは軸に紐づいていない。記録層は根拠を必須にしている
 *   （`evaluation_scores_rationale_not_blank`）ので、
 *   **無いことをそのまま書く。** 評価の文言を作らない。
 */
export { NO_RATIONALE } from '../records/placeholder.ts'
