import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import {
  getIntakeOptions, listUnmatchedResponses, getFormResponse,
} from '../../../src/queries/intake.ts'
import { listCandidateSheetRows } from '../../../src/queries/sheet.ts'
import { nextCandidateNumber } from '../../../src/commands/intake.ts'
import { saveCandidateSheetAction } from './sheet-actions.ts'
import { Card, Empty, num, jstDateTime } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import { Sheet, type SheetColumn, type SheetRowData } from '../../_components/sheet.tsx'
import { all } from '../../../src/db/client.ts'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * 候補者追加 ―― **表（スプシ形式）**（依頼者の指示。実行⑫）。
 *
 * 実行⑩からの縦長フォームを、依頼者の指示で表に置き換えた。
 *   1行＝1人。**その期の既存行も同じ表に並ぶ**（追加と編集が1つの場所になる）
 *   セルを直接直し、まとめて保存する。**通る行だけ入り、不正行は残る**
 *
 * ★ 保存すると、新規行では**5つの事実が同時に立つ**（`src/commands/intake.ts`）――
 *   人・候補者番号・接点・アプローチ状態・フォーム回答との接合。
 *   だから「どこで知ったか」も同じ行の列に置いてある（依頼者の判断）。
 *
 * ★ 表で直せないもの ――
 *   番号     欠番を詰めない規則があるので、振り直しをここに置かない
 *   接点     積む記録で、書き換えの置き場所が無い（既存行では読み取り）
 *   顔写真   行から開いて入れる（依頼者の判断。表は文字と選択だけ）
 *
 * ★ フォーム回答から始める道は残してある。「この回答から」を押すと、
 *   表の先頭に**その回答の値を入れた行**が1つ増える。保存すると回答が結び付く。
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

  const [options, unmatched, picked, nextNumber, rows, states] = await Promise.all([
    getIntakeOptions(db),
    listUnmatchedResponses(db),
    getFormResponse(db, one(sp.from)),
    nextCandidateNumber(db, season.id),
    listCandidateSheetRows(db, season.id),
    all<{ id: string; label: string }>(db,
      `SELECT id, label FROM approach_states WHERE is_active ORDER BY sort_order`),
  ])

  // フォーム回答を選んでいれば、その値を初期値にする。**上書きは自由。**
  const from = picked && !picked.person_id ? picked : null

  const columns: SheetColumn[] = [
    { key: 'familyName', label: '姓', type: 'text' },
    { key: 'givenName', label: '名', type: 'text' },
    { key: 'familyNameKana', label: '姓（かな）', type: 'text' },
    { key: 'givenNameKana', label: '名（かな）', type: 'text' },
    { key: 'birthDate', label: '生年月日', type: 'date' },
    { key: 'schoolId', label: '学校', type: 'select', options: options.schools, width: 140 },
    { key: 'faculty', label: '学部・学科', type: 'text', width: 140 },
    { key: 'email', label: 'メール', type: 'email', width: 180 },
    { key: 'phone', label: '電話番号', type: 'text', width: 130 },
    { key: 'lineUserId', label: 'LINE ID', type: 'text' },
    // ★ 接点は既存行でも入れられる（依頼者の指示。実行⑰。C-183）。
    //   **書き換えではなく、接点を1件積む。** 2つ揃って初めて足す。
    {
      key: 'channelId', label: '流入元', type: 'select', width: 130,
      options: options.channels.map((c) => ({ id: c.id, label: c.label })),
    },
    { key: 'contactedOn', label: '接点の日', type: 'date' },
    // アプローチ状態は既存行だけ。新規行は登録時に「未アプローチ」が入る。
    {
      key: 'approachStateId', label: 'アプローチ状態', type: 'select',
      options: states, existingOnly: true, width: 150,
    },
    { key: 'note', label: '担当者メモ', type: 'text', width: 220 },
    // 入力者は行ごと（依頼者の指示）。名簿は「入力者を追加」から増やす。
    { key: 'staffId', label: '入力者', type: 'select', options: options.staffs, width: 130 },
    // ★ アーカイブ（依頼者の指示。実行⑰。C-184）。**一番右**に置く。
    //   ★ 記録は消えない ―― 一覧から外れるだけで、応募も面接も点も残る。
    //   ★ 新規行では選ばせない（作る前にしまうものが無い）。
    {
      key: 'archive', label: 'アーカイブ', type: 'select', width: 120,
      existingOnly: true,
      options: [{ id: 'archive', label: 'アーカイブする' }],
    },
  ]

  const sheetRows: SheetRowData[] = [
    ...(from
      ? [{
        id: '',
        lead: '回答から',
        values: {
          familyName: from.respondent_name ?? '',
          givenName: '', familyNameKana: '', givenNameKana: '', birthDate: '',
          schoolId: '', faculty: '',
          email: from.respondent_email ?? '',
          phone: '', lineUserId: from.respondent_line ?? '',
          channelId: '', contactedOn: '', approachStateId: '', note: '', staffId: '',
          archive: '',
        },
        // 列にはしないが、この行と一緒に送る。保存で回答が結び付く。
        extra: { formResponseId: from.form_response_id },
      }]
      : []),
    ...rows.map((r) => ({
      id: r.person_id,
      lead: r.number === null ? '' : String(r.number),
      values: {
        familyName: r.family_name,
        givenName: r.given_name,
        familyNameKana: r.family_name_kana ?? '',
        givenNameKana: r.given_name_kana ?? '',
        birthDate: r.birth_date ?? '',
        schoolId: r.school_id,
        faculty: r.faculty ?? '',
        email: r.email ?? '',
        phone: r.phone ?? '',
        lineUserId: r.line_user_id ?? '',
        // ★ 既存行は**空で出す**（C-183）。ここは「最初の流入元」を映す欄では
        //   なくなり、**接点を1件足す欄**になった。前の値を置くと、
        //   保存のたび同じ接点を足そうとしているように読める。
        //   （最初の流入元は詳細画面の接点の一覧で読む。）
        channelId: '',
        contactedOn: '',
        approachStateId: r.approach_state_id ?? '',
        note: r.note ?? '',
        staffId: '',
        archive: '',
      },
    })),
  ]

  return (
    <Shell
      active="headhunting"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/people/new" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '特別選考', href: `/headhunting?season=${season.id}` },
          { label: '候補者追加' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">候補者追加</h1>
          <p className="page-sub">{seasonLabel(season)} ・ 次の番号 {num(nextNumber)}</p>
        </div>
      </div>

      <div className="section">
        <Card title="候補者">
          <Sheet
            columns={columns}
            rows={sheetRows}
            action={saveCandidateSheetAction}
            hidden={{ seasonId: season.id }}
            leadLabel="番号"
            detail={{ href: `/people/{id}/edit?season=${season.id}`, label: '写真・詳細' }}
          />
        </Card>
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

      <div className="section">
        <Link href={`/staff/new?season=${season.id}`} className="hh-more">
          入力者を追加 ›
        </Link>
      </div>
    </Shell>
  )
}
