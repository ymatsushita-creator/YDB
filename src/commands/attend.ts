import { all, maybeOne, one, type Db } from '../db/client.ts'

/**
 * 予定の参加者を記録する（依頼者の指示。実行⑪）。
 *
 * 記録層は 0028。**参加した事実は接点（touchpoints）が持つ。**
 * この関数はチェックの集合を受け取り、記録層をその集合に合わせる。
 *
 * ★ 「参加者個々人の属性に追加」＝接点を積むこと。
 *   接点を積めば、確度（0017）の `touchpoint_count` と `last_touchpoint_on`
 *   に**そのまま効く。** 語彙は1つも足していない。
 *
 * ★ 母集団を画面と一致させる。
 *   チェックできるのは、その期の一覧（`v_headhunting_list`）に載っている人だけ。
 *   一覧に出していない人を ID で押し込める道を残さない（CLAUDE.md）。
 *
 * ★ チェックを外したら接点を消す。**残すと確度が数え続ける**（0028 の理由）。
 */

export type SetAttendanceResult =
  | { ok: true; added: number; removed: number }
  | { ok: false; reason: SetAttendanceFailure }

export type SetAttendanceFailure =
  /** その期にその予定が無い。 */
  | 'appointment_not_found'
  /** 取り消された予定。参加者を足さない。 */
  | 'appointment_cancelled'
  /** 流入チャネル「イベント」がマスタに無い。勝手に作らない。 */
  | 'event_channel_missing'
  /** 一覧に載っていない人が混ざっている。 */
  | 'person_not_listed'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 参加として積む接点のチャネル。
 *
 * ★ 無ければ**作らずに失敗させる。** チャネルは集計マスタで、
 *   追加と非活性化で運用する（原則3）。コマンドが黙って足すと、
 *   運営が決めていない分類が流入元の集計に現れる。
 */
const EVENT_CHANNEL = 'イベント'

export async function setEventAttendance(
  db: Db,
  input: { appointmentId: string; seasonId: string; personIds: string[] },
): Promise<SetAttendanceResult> {
  if (!UUID.test(input.appointmentId) || !UUID.test(input.seasonId)) {
    return { ok: false, reason: 'appointment_not_found' }
  }

  const appointment = await maybeOne<{ starts_at: Date; cancelled_at: Date | null }>(db, `
    SELECT a.starts_at, a.cancelled_at
      FROM appointments a
     WHERE a.id = $1 AND a.season_id = $2`, [input.appointmentId, input.seasonId])
  if (appointment === null) return { ok: false, reason: 'appointment_not_found' }
  if (appointment.cancelled_at !== null) {
    return { ok: false, reason: 'appointment_cancelled' }
  }

  const channel = await maybeOne<{ id: string }>(db,
    `SELECT id FROM channels WHERE name = $1 AND is_active`, [EVENT_CHANNEL])
  if (channel === null) return { ok: false, reason: 'event_channel_missing' }

  // 同じ人が2回送られてきても1人として扱う（チェック欄は1つしかないが、
  // 送られてくるものを信じない）。
  const wanted = [...new Set(input.personIds)]
  if (wanted.some((id) => !UUID.test(id))) {
    return { ok: false, reason: 'person_not_listed' }
  }

  const listed = new Set((await all<{ person_id: string }>(db,
    `SELECT h.person_id FROM v_headhunting_list h WHERE h.season_id = $1`,
    [input.seasonId])).map((r) => r.person_id))
  if (wanted.some((id) => !listed.has(id))) {
    return { ok: false, reason: 'person_not_listed' }
  }

  const current = await all<{ person_id: string; touchpoint_id: string }>(db, `
    SELECT person_id, touchpoint_id FROM event_attendances
     WHERE appointment_id = $1`, [input.appointmentId])
  const currentIds = new Set(current.map((r) => r.person_id))

  const toAdd = wanted.filter((id) => !currentIds.has(id))
  // ★ 外すのは**画面に出ていた人だけ。** 一覧から外れた人（見送りなど）は
  //   チェック欄に並ばないので、送られてこないのは「外した」ではなく
  //   「出ていなかった」である。ここを区別しないと、
  //   一覧から外れた瞬間にその人の参加記録が黙って消える。
  const toRemove = current.filter(
    (r) => listed.has(r.person_id) && !wanted.includes(r.person_id))

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, added: 0, removed: 0 }
  }

  try {
    await db.exec('BEGIN')

    for (const personId of toAdd) {
      // 接点の時刻は**予定の開始時刻**。記録した時刻ではない
      // （年度の帰属は接点の日付から決まる。押した日で決めない）。
      const tp = await one<{ id: string }>(db, `
        INSERT INTO touchpoints
            (person_id, channel_id, occurred_at, attended_at, note)
        SELECT $1, $2, a.starts_at, a.starts_at, a.title
          FROM appointments a WHERE a.id = $3
        RETURNING id`, [personId, channel.id, input.appointmentId])

      await db.query(`
        INSERT INTO event_attendances (appointment_id, person_id, touchpoint_id)
        VALUES ($1, $2, $3)`, [input.appointmentId, personId, tp.id])
    }

    if (toRemove.length > 0) {
      // 接点を消せば対応づけも消える（ON DELETE CASCADE）。
      // **消すのはこの表が指している接点だけ。** 手で入れた接点は巻き込まない。
      await db.query(`DELETE FROM touchpoints WHERE id = ANY($1::uuid[])`,
        [toRemove.map((r) => r.touchpoint_id)])
    }

    await db.exec('COMMIT')
    return { ok: true, added: toAdd.length, removed: toRemove.length }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    throw e
  }
}

/** 画面に出す言葉。**ここ1箇所**に置く。 */
export const ATTENDANCE_MESSAGE: Record<SetAttendanceFailure | 'saved', string> = {
  saved: '参加者を記録した。',
  appointment_not_found: 'その予定が見つからない。',
  appointment_cancelled: '取り消された予定には参加者を記録できない。',
  event_channel_missing: '流入チャネル「イベント」がマスタに無い。',
  person_not_listed: '一覧に無い候補者が混ざっている。',
}

const CODES = new Set<string>([...Object.keys(ATTENDANCE_MESSAGE)])

/** URL に載って戻ってくる結果コード。知らない値は「何も起きていない」。 */
export const parseAttendanceCode = (
  v: string | string[] | undefined,
): SetAttendanceFailure | 'saved' | null => {
  const first = Array.isArray(v) ? v[0] : v
  return first && CODES.has(first)
    ? first as SetAttendanceFailure | 'saved'
    : null
}
