import { one, maybeOne, scalar, type Db } from '../../src/db/client.ts'

/**
 * テスト用のデータ組み立て。
 *
 * 時刻はすべて JST のリテラルで書く。集計の日付境界が運用タイムゾーンで
 * 定義されている以上、テストも同じ言葉で書かないと、何を検証したのか
 * 読んで分からなくなる。
 */
export const jst = (s: string) => `${s}+09:00`

export interface Fixture {
  db: Db
  schoolId: string
  staffId: string
}

export async function baseFixture(db: Db): Promise<Fixture> {
  const schoolId = await scalar<string>(
    db,
    `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`,
  )
  const staffId = await scalar<string>(
    db,
    `INSERT INTO staffs (display_name, email) VALUES ('運営 太郎', 'ops@example.test') RETURNING id`,
  )
  return { db, schoolId, staffId }
}

export interface SeasonSpec {
  year: number
  outreachStart?: string
  applicationOpen?: string
  applicationClose?: string
  selectionEnd?: string
  capacity?: number
  steps?: string[]
}

export interface Season {
  id: string
  year: number
  stepIds: string[]
  finalStepId: string
}

export async function makeSeason(db: Db, spec: SeasonSpec): Promise<Season> {
  const y = spec.year
  const outreach = spec.outreachStart ?? `${y - 1}-09-01`
  const open = spec.applicationOpen ?? `${y - 1}-11-01`
  const close = spec.applicationClose ?? `${y - 1}-12-15`
  const end = spec.selectionEnd ?? `${y}-02-28`

  const id = await scalar<string>(
    db,
    `INSERT INTO seasons
       (enrollment_year, outreach_start_date, application_open_date,
        application_close_date, selection_end_date, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [y, outreach, open, close, end, spec.capacity ?? 30],
  )

  const names = spec.steps ?? ['書類選考', '一次面接', '最終面接']
  const stepIds: string[] = []
  for (const [i, name] of names.entries()) {
    stepIds.push(
      await scalar<string>(
        db,
        `INSERT INTO selection_steps (season_id, sort_order, name, sla_days)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, i + 1, name, 7],
      ),
    )
  }

  return { id, year: y, stepIds, finalStepId: stepIds[stepIds.length - 1]! }
}

export interface PersonSpec {
  familyName?: string
  givenName?: string
  birthDate?: string
  email?: string
  createdAt?: string
  referrerPersonId?: string
}

let personSeq = 0

export async function makePerson(
  db: Db,
  schoolId: string,
  spec: PersonSpec = {},
): Promise<string> {
  const n = ++personSeq
  return scalar<string>(
    db,
    `INSERT INTO persons
       (family_name, given_name, birth_date, school_id, email, created_at, referrer_person_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7) RETURNING id`,
    [
      spec.familyName ?? '山田',
      spec.givenName ?? `太郎${n}`,
      spec.birthDate ?? '2007-05-05',
      schoolId,
      spec.email ?? `p${n}@example.test`,
      spec.createdAt ?? null,
      spec.referrerPersonId ?? null,
    ],
  )
}

export async function makeChannel(db: Db, name: string): Promise<string> {
  return scalar<string>(db, `INSERT INTO channels (name) VALUES ($1) RETURNING id`, [name])
}

export async function makeTouchpoint(
  db: Db,
  personId: string,
  channelId: string,
  occurredAt: string,
  partnerId?: string,
): Promise<string> {
  return scalar<string>(
    db,
    `INSERT INTO touchpoints (person_id, channel_id, occurred_at, partner_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [personId, channelId, occurredAt, partnerId ?? null],
  )
}

export async function makeApplication(
  db: Db,
  personId: string,
  seasonId: string,
  submittedAt: string,
  opts: { isReapplication?: boolean } = {},
): Promise<string> {
  return scalar<string>(
    db,
    `INSERT INTO applications (person_id, season_id, submitted_at, is_reapplication)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [personId, seasonId, submittedAt, opts.isReapplication ?? false],
  )
}

export type TransitionType = 'advance' | 'reject' | 'withdraw' | 'revert'

/**
 * 「未確認」の辞退理由を用意して返す。
 *
 * 辞退には理由が必須（0008）。理由そのものを検証したいテスト以外では
 * どの理由でもよいので、本番の参照データと同じ 'unconfirmed' を使う。
 * テストごとに理由マスタを作らせると、辞退を1件作るたびに
 * 検証と関係のない準備が3行増える。
 */
export async function unconfirmedWithdrawReason(db: Db): Promise<string> {
  const existing = await maybeOne<{ id: string }>(
    db, `SELECT id FROM withdraw_reasons WHERE code = 'unconfirmed'`)
  if (existing) return existing.id
  return scalar<string>(
    db,
    `INSERT INTO withdraw_reasons (code, label) VALUES ('unconfirmed', '未確認') RETURNING id`,
  )
}

/** 状態遷移を1行追記する。訂正行を作るときは correctsHistoryId を渡す。 */
export async function addHistory(
  db: Db,
  args: {
    applicationId: string
    type: TransitionType
    staffId: string
    occurredAt: string
    stepId?: string
    withdrawReasonId?: string
    correctsHistoryId?: string
  },
): Promise<string> {
  // 辞退には理由が要る。指定が無ければ「未確認」を充てる。
  const withdrawReasonId =
    args.type === 'withdraw'
      ? args.withdrawReasonId ?? (await unconfirmedWithdrawReason(db))
      : args.withdrawReasonId ?? null

  return scalar<string>(
    db,
    `INSERT INTO status_histories
       (application_id, transition_type, selection_step_id, occurred_at,
        changed_by_staff_id, withdraw_reason_id, corrects_history_id, is_correction)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $7::uuid IS NOT NULL) RETURNING id`,
    [
      args.applicationId,
      args.type,
      args.stepId ?? null,
      args.occurredAt,
      args.staffId,
      withdrawReasonId,
      args.correctsHistoryId ?? null,
    ],
  )
}

/** 最終ステップへの advance。「幹になった」ことを表す。 */
export async function accept(
  db: Db,
  args: { applicationId: string; season: Season; staffId: string; occurredAt: string },
): Promise<string> {
  return addHistory(db, {
    applicationId: args.applicationId,
    type: 'advance',
    stepId: args.season.finalStepId,
    staffId: args.staffId,
    occurredAt: args.occurredAt,
  })
}

export async function makeVoidReason(
  db: Db,
  code: string,
  countsAsApplication: boolean,
): Promise<string> {
  return scalar<string>(
    db,
    `INSERT INTO void_reasons (code, label, counts_as_application)
     VALUES ($1, $1, $2) RETURNING id`,
    [code, countsAsApplication],
  )
}

export async function voidApplication(
  db: Db,
  applicationId: string,
  voidReasonId: string,
  at: string,
): Promise<void> {
  await db.query(
    `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
    [applicationId, at, voidReasonId],
  )
}

/** ある日のファネル1行を取り出す。 */
export async function funnelOn(
  db: Db,
  seasonId: string,
  day: string,
  activeWindowDays = 90,
): Promise<{
  identified_person_cum: number
  applicant_cum: number
  accepted_cum: number
  net_accepted_cum: number
  rejected_cum: number
  withdrawn_cum: number
}> {
  const row = await one<Record<string, string | number>>(
    db,
    `SELECT identified_person_cum, applicant_cum, accepted_cum,
            net_accepted_cum, rejected_cum, withdrawn_cum
       FROM f_funnel_daily($3)
      WHERE season_id = $1 AND as_of = $2::date`,
    [seasonId, day, activeWindowDays],
  )
  // PGlite は bigint を文字列で返す。比較の前に数値へ寄せる。
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as never
}
