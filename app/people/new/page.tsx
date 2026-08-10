import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import {
  getIntakeOptions, listUnmatchedResponses, getFormResponse, listCandidateNumbers,
} from '../../../src/queries/intake.ts'
import { nextCandidateNumber, ADD_CANDIDATE_MESSAGE } from '../../../src/commands/intake.ts'
import { addCandidateAction } from './actions.ts'
import { Card, Empty, num, jstDateTime } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import { Avatar } from '../../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * 候補者追加（依頼者の指示。実行⑩）。
 *
 * ★ 保存すると、**5つの事実が同時に立つ**（`src/commands/intake.ts`）――
 *   人・候補者番号・接点・アプローチ状態・フォーム回答との接合。
 *   1つでも欠けると、その人は一覧に出ないか、番号の無い候補者になる。
 *
 * ★ 番号は**自動**。期ごとに1から振り、欠番は詰めない。
 *   画面には「次はこの番号」と出すが、**確定するのは保存のとき**である
 *   （出した番号を予約すると、書きかけで閉じた人のぶんが欠番になる）。
 *
 * ★ フォーム回答から始められる。まだ誰にも結び付いていない回答を並べ、
 *   選ぶと氏名やメールが**初期値として入る**（上書きは自由）。
 *   Google フォームはまだ無い ―― **受け皿と接合の規則だけを先に置いてある。**
 */
export default async function NewCandidatePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season))
    ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="headhunting">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const [options, unmatched, picked, nextNumber, numbers] = await Promise.all([
    getIntakeOptions(db),
    listUnmatchedResponses(db),
    getFormResponse(db, one(sp.from)),
    nextCandidateNumber(db, season.id),
    listCandidateNumbers(db, season.id),
  ])

  const code = one(sp.add)
  const message = code
    ? ADD_CANDIDATE_MESSAGE[code as keyof typeof ADD_CANDIDATE_MESSAGE] ?? '登録できなかった。'
    : null

  // フォーム回答を選んでいれば、その値を初期値にする。**上書きは自由。**
  const from = picked && !picked.person_id ? picked : null

  return (
    <Shell
      active="headhunting"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/people/new" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: 'ヘッドハンティング', href: `/headhunting?season=${season.id}` },
          { label: '候補者追加' },
        ]}
      />

      {message && (
        <p className={`callout${code === 'saved' ? ' ok' : ''}`}>{message}</p>
      )}

      <div className="page-head">
        <div>
          <h1 className="page-title">候補者追加</h1>
          <p className="page-sub">{seasonLabel(season)} ・ 次の番号 {num(nextNumber)}</p>
        </div>
      </div>

      {/* --- フォーム回答から始める --- */}
      <div className="section">
        <Card title="フォームの回答から">
          {unmatched.length === 0 ? (
            <Empty>まだ誰にも結び付いていない回答は無い</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>届いた日時</th>
                    <th>名乗った名前</th>
                    <th>連絡先</th>
                    <th>どこで知ったか</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((r) => (
                    <tr key={r.form_response_id}>
                      <td className="nowrap">{jstDateTime(r.submitted_at)}</td>
                      <td className="cell-name">{r.respondent_name ?? '—'}</td>
                      <td>{r.respondent_email ?? r.respondent_line ?? '—'}</td>
                      <td>
                        {r.channel_name ?? (
                          // 写せなかった回答も落とさない。生の文字列を出す。
                          <span className="section-note">{r.channel_answer ?? '—'}</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/people/new?season=${season.id}&from=${r.form_response_id}`}
                        >
                          この回答から
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* --- 登録 --- */}
      <form action={addCandidateAction} className="editable-region">
        <input type="hidden" name="seasonId" value={season.id} />
        {from && <input type="hidden" name="formResponseId" value={from.form_response_id} />}

        <div className="section">
          <Card title="この人のこと">
            {from && (
              <p className="callout ok">
                フォームの回答から入れている。保存すると、この回答がこの人へ結び付く
              </p>
            )}
            <div className="iv-grid">
              <label className="iv-field">姓
                <input name="familyName" required
                       defaultValue={from?.respondent_name ?? ''} />
              </label>
              <label className="iv-field">名<input name="givenName" /></label>
              <label className="iv-field">姓（かな）<input name="familyNameKana" /></label>
              <label className="iv-field">名（かな）<input name="givenNameKana" /></label>
              {/* 0023 で「無いこともある」になった。必須にしない。 */}
              <label className="iv-field">生年月日<input name="birthDate" type="date" /></label>
              <label className="iv-field">学校
                <select name="schoolId" required defaultValue="">
                  <option value="" disabled>選ぶ…</option>
                  {options.schools.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="iv-field">学部・学科<input name="faculty" /></label>
              <label className="iv-field">メール
                <input name="email" type="email" defaultValue={from?.respondent_email ?? ''} />
              </label>
              <label className="iv-field">電話番号<input name="phone" /></label>
              <label className="iv-field">LINE ID
                <input name="lineUserId" defaultValue={from?.respondent_line ?? ''} />
              </label>
              <label className="iv-field">顔写真
                <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
                <small>JPEG / PNG / WebP、2MB以下</small>
              </label>
            </div>
            <label className="iv-field iv-field-wide">担当者メモ
              <textarea name="note" rows={3} />
            </label>
          </Card>
        </div>

        <div className="section">
          <Card title="どこで知ったか">
            <div className="iv-grid">
              <label className="iv-field">流入元
                <select name="channelId" required defaultValue="">
                  <option value="" disabled>選ぶ…</option>
                  {options.channels.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.category === 'sns' ? `SNS ・ ${o.label}` : o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="iv-field">接点の日
                <input name="contactedOn" type="date" />
              </label>
              <label className="iv-field">記録した人
                <select name="staffId" required defaultValue="">
                  <option value="" disabled>選ぶ…</option>
                  {options.staffs.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="button-primary" type="submit">
              登録する（{num(nextNumber)} 番）
            </button>
          </Card>
        </div>
      </form>

      <div className="section">
        <Card title="この期の番号">
          {numbers.length === 0 ? <Empty>まだ1人も登録されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th className="num">番号</th><th>氏名</th><th>登録</th></tr>
                </thead>
                <tbody>
                  {numbers.slice(0, 20).map((n) => (
                    <tr key={n.person_id}>
                      <td className="num strong">{num(n.number)}</td>
                      <td className="cell-name">
                        <Link href={`/people/${n.person_id}?season=${season.id}`}>
                          <span className="bl-person">
                            <Avatar src={n.photo_data_url} name={n.person_name} />
                            {n.person_name}
                          </span>
                        </Link>
                      </td>
                      <td className="nowrap">{jstDateTime(n.assigned_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  )
}
