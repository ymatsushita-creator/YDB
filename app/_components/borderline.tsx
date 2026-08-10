import type { ReactNode } from 'react'
import Link from 'next/link'
import type {
  Appointment, AppointmentDetail, AttendanceCandidate, PersonNote,
} from '../../src/queries/borderline.ts'
import { AUTHOR_MAX, BODY_MAX } from '../../src/commands/note.ts'
import { addNoteAction, saveAttendanceAction } from '../borderline/actions.ts'

/**
 * 個人アプローチ画面の部品（実行⑨。表示名は実行⑪で変えた。URL は `/borderline`）。
 *
 * ここに SQL は書かない。数の加工もしない。
 * 渡された事実を、単位と母集団を添えて置くだけにする。
 */

/**
 * 暦日の足し算。
 *
 * ★ `YYYY-MM-DD` を**そのまま暦日として**扱う。時刻を付けて Date にすると、
 *   `T00:00:00+09:00` は UTC では前日15時なので、`toISOString()` で
 *   1日戻る。最初これで週の見出しと格子が1日ずれた。
 *   **暦日の計算にタイムゾーンを往復させない。**
 */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** その週の月曜。週の始まりを画面ごとに決めない。 */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return addDays(day, -back)
}

const WEEKDAY = ['月', '火', '水', '木', '金', '土', '日']

const HOUR_FROM = 9
const HOUR_TO = 18

const KIND_CLASS: Record<string, string> = {
  first_contact: 'appt-first',
  document_check: 'appt-doc',
  scheduling: 'appt-sched',
  casual: 'appt-casual',
  interview: 'appt-interview',
  internal: 'appt-internal',
}

const jstParts = (d: Date) => {
  const t = new Date(new Date(d).getTime() + 9 * 3600_000)
  return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours(), minute: t.getUTCMinutes() }
}

export const jstTime = (d: Date) => {
  const { hour, minute } = jstParts(d)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * 週の日程。
 *
 * ★ 格子は**位置で時刻を表す**もので、名前を読む場所ではない
 *   （1升 44px しかなく、氏名は必ず切れる）。名前と種別は下の一覧で読む。
 *
 * ★ 9時〜18時の外にある予定は格子に置かない。
 *   格子の外へはみ出させると、位置が時刻を表さなくなる
 *   （置き場所が無いものを、近い場所へ寄せてはいけない）。
 *   一覧には出し、「格子外」と印を付ける。**落とさない。**
 */
export function WeekCalendar({
  monday, appointments, today, hrefFor,
}: {
  monday: string
  appointments: Appointment[]
  today: string
  /**
   * 予定を押したときの行き先（実行⑪）。参加者のポップアップを開く。
   * **格子の升と下の一覧の両方を押せるようにする** ―― 升は狭く、
   * 押せるものが片方だけだと「押せない予定」ができる。
   */
  hrefFor: (appointmentId: string) => string
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const hours = Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => HOUR_FROM + i)

  const placed = appointments.filter((a) => {
    const { hour } = jstParts(a.starts_at)
    return hour >= HOUR_FROM && hour < HOUR_TO
  })

  return (
    /* 格子と一覧を1つの器に入れる。**縮む先には必ず送る器を対にする**（C-52）。 */
    <div className="cal-wrap">
      {/*
        行の高さは固定（24px）。可変にすると、狭い画面で行が潰れて
        升の文字が読めなくなる ―― **読めない格子は、無いのと同じ。**
        36px から詰めたのは、**格子の下の一覧を、送る前に見えるところまで上げる**ため。
        格子は位置だけを表すので、1行の高さは目盛りが読めれば足りる。
      */}
      <div className="cal"
           style={{ gridTemplateRows: `auto repeat(${hours.length}, 24px)` }}>
        <div className="cal-corner" />
        {days.map((d) => (
          <div key={d} className={`cal-head${d === today ? ' is-today' : ''}`}>
            {d.slice(5).replace('-', '/')}（{WEEKDAY[days.indexOf(d)]}）
          </div>
        ))}
        {hours.map((h) => (
          <div key={h} className="cal-hour" style={{ gridRow: hours.indexOf(h) + 2 }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
        {days.map((d, di) => hours.map((h, hi) => (
          <div
            key={`${d}-${h}`}
            className={`cal-cell${d === today ? ' is-today' : ''}`}
            style={{ gridColumn: di + 2, gridRow: hi + 2 }}
          />
        )))}
        {placed.map((a) => {
          const { day, hour } = jstParts(a.starts_at)
          const di = days.indexOf(day)
          if (di < 0) return null
          const span = Math.max(1, Math.min(
            HOUR_TO - hour,
            Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3600_000),
          ))
          return (
            <Link
              key={a.appointment_id}
              href={hrefFor(a.appointment_id)}
              className={`cal-event ${KIND_CLASS[a.kind_code] ?? 'appt-internal'}`}
              style={{ gridColumn: di + 2, gridRow: `${hour - HOUR_FROM + 2} / span ${span}` }}
              title={`${jstTime(a.starts_at)} ${a.kind_label}${a.person_name ? ` ・ ${a.person_name}` : ''}`}
            >
              {/*
                升は狭い（7列で右の縦長パネルを割る）。2行入れると
                1文字ずつ折り返して**縦に潰れた文字列**になる。
                升には1行だけ置き、種別と時刻は title で補う。
              */}
              <strong>{a.person_name ?? a.title}</strong>
            </Link>
          )
        })}
      </div>

      {/*
        ★ 升の中の氏名は必ず切れる（7列で右の縦長パネルを割るので1升 44px）。
          升は**位置で時刻を表す**ためのもので、名前を読む場所ではない。
          そこで週の予定を、格子の下に読める形で並べる。**切らない。**

          格子に置けなかった予定（9時前・18時以降）もここに混ぜ、
          置けなかったことだけを印で示す ―― 別の場所へ追いやると、
          「その週に何があるか」を2箇所読まないと分からなくなる。
      */}
      {appointments.length > 0 && (
        <ul className="cal-list">
          {[...appointments]
            // 文字列で並べない ―― `starts_at` は Date なので、
            // 文字列化すると "Fri Aug 14" のような曜日始まりで並ぶ。
            .sort((a, b) =>
              new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
            .map((a) => (
              <li key={a.appointment_id}>
                <Link href={hrefFor(a.appointment_id)} className="cal-list-link">
                  <span className={`cal-dot ${KIND_CLASS[a.kind_code] ?? 'appt-internal'}`} />
                  <span className="cal-list-when">
                    {jstParts(a.starts_at).day.slice(5).replace('-', '/')}{' '}
                    {jstTime(a.starts_at)}
                  </span>
                  <span className="cal-list-who">{a.person_name ?? a.title}</span>
                  <span className="cal-list-kind">{a.kind_label}</span>
                  {!placed.includes(a) && <span className="cal-list-out">格子外</span>}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/** 順位。上位3位だけ王冠。色に依らず順位が読めるよう数字を必ず出す。 */
export function Rank({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="rank-number dim">—</span>
  return (
    <span className="rank-mark">
      {rank <= 3 && <span className={`rank-crest rank-crest-${rank}`} aria-hidden>♛</span>}
      <span className="rank-number">{rank}</span>
    </span>
  )
}

/** 顔写真。無いときは名前の頭文字を置く（空欄を架空の画像で埋めない）。 */
export function Avatar({ src, name }: { src: string | null; name: string }) {
  const initial = name.replace(/\s/g, '').slice(0, 2)
  return src
    ? <img className="avatar" src={src} alt="" width={36} height={36} />
    : <span className="avatar avatar-fallback" aria-hidden>{initial}</span>
}

/**
 * ポップアップの器（実行⑪。依頼者の指示）。
 *
 * ★ `'use client'` を増やしていない。**URL で開いて URL で閉じる。**
 *   JS で開閉すると、開いた状態が戻る・進むで消え、再読み込みで閉じる。
 *   開いていることは画面の状態ではなく、**いまどこを見ているか**である。
 *
 * ★ `aria-modal` は付けない。焦点を閉じ込める仕組みが無いのに付けると、
 *   支援技術に「外は読めない」と嘘をつくことになる。
 */
export function Popup({
  title, subtitle, closeHref, children,
}: {
  title: string
  subtitle?: ReactNode
  closeHref: string
  children: ReactNode
}) {
  return (
    <div className="popup-layer">
      {/* 外を押しても閉じる。JS を使わずに済ませるため、
          覆いそのものを戻り先へのリンクにする。 */}
      <Link href={closeHref} className="popup-scrim" aria-label="閉じる" />
      <div className="popup-card" role="dialog" aria-label={title}>
        <header className="popup-head">
          <div>
            <h2 className="popup-title">{title}</h2>
            {subtitle && <p className="popup-sub">{subtitle}</p>}
          </div>
          <Link href={closeHref} className="popup-close btn-physical">閉じる</Link>
        </header>
        {children}
      </div>
    </div>
  )
}

/**
 * メモ（実行⑪。依頼者の指示）。
 *
 * ★ 書いた人・日時・内容は**すべて記入必須。**
 *   日時は既定値を入れない ―― いま時刻を入れておくと、
 *   3日前の面談が「今日」として積まれる。**打った人が決める。**
 *
 * ★ 書いた人は手入力の自己申告である（0027）。名簿から選ばせない。
 */
export function MemoPopup({
  personName, notes, closeHref, message, ok, context,
}: {
  personName: string
  notes: PersonNote[]
  closeHref: string
  message: string | null
  ok: boolean
  context: { personId: string; seasonId: string; tab: string; week: string }
}) {
  return (
    <Popup title={`${personName} のメモ`} closeHref={closeHref}
           subtitle={`${notes.length} 件`}>
      {message && <p className={`callout${ok ? ' ok' : ''}`}>{message}</p>}

      <form action={addNoteAction} className="memo-form editable-region">
        <input type="hidden" name="personId" value={context.personId} />
        <input type="hidden" name="seasonId" value={context.seasonId} />
        <input type="hidden" name="tab" value={context.tab} />
        <input type="hidden" name="week" value={context.week} />

        <div className="memo-fields">
          <label className="memo-field">
            <span>書いた人</span>
            <input name="authorName" type="text" required maxLength={AUTHOR_MAX}
                   autoComplete="off" placeholder="氏名" />
          </label>
          <label className="memo-field">
            <span>日時</span>
            <input name="notedAt" type="datetime-local" required />
          </label>
        </div>
        <label className="memo-field">
          <span>内容</span>
          <textarea name="body" required rows={4} maxLength={BODY_MAX} />
        </label>
        <button type="submit" className="button-primary">メモを追加</button>
      </form>

      <div className="scroll-pane popup-body">
        {notes.length === 0 ? (
          <p className="hh-empty">メモはまだ1件も無い。</p>
        ) : (
          <ul className="memo-list">
            {notes.map((n) => (
              <li key={n.note_id} className="memo-item">
                <p className="memo-meta">
                  <strong>{n.author_name}</strong>
                  <span className="dim">{jstStamp(n.noted_at)}</span>
                </p>
                {/* 改行を残す。面談のメモは箇条書きで書かれる。 */}
                <p className="memo-body">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popup>
  )
}

/** 日時の表示。**手入力された日時**をそのまま JST で出す。 */
export const jstStamp = (d: Date) => {
  const t = new Date(new Date(d).getTime() + 9 * 3600_000)
  return `${t.toISOString().slice(0, 10).replace(/-/g, '/')} ${jstTime(d)}`
}

/**
 * 予定の参加者（実行⑪。依頼者の指示）。
 *
 * ★ チェックを入れて保存すると、その人に**接点が1件積まれる。**
 *   接点は確度（0017）が数える事実なので、ここが確度に効く。
 *   外して保存すると、その接点は消える（残すと数え続けるため）。
 *
 * ★ 並ぶのは**その期の一覧に居る人だけ。** 画面とコマンドで同じ母集団を見る。
 */
export function AttendancePopup({
  appointment, candidates, closeHref, message, ok, context,
}: {
  appointment: AppointmentDetail
  candidates: AttendanceCandidate[]
  closeHref: string
  message: string | null
  ok: boolean
  context: { seasonId: string; tab: string; week: string }
}) {
  const recorded = candidates.filter((c) => c.attended).length
  return (
    <Popup
      title={appointment.title}
      closeHref={closeHref}
      subtitle={
        <>
          {jstStamp(appointment.starts_at)} 〜 {jstTime(appointment.ends_at)}
          {' ・ '}{appointment.kind_label}
          {' ・ '}担当 {appointment.owner_name}
          {' ・ '}参加 {recorded} 人
        </>
      }
    >
      {message && <p className={`callout${ok ? ' ok' : ''}`}>{message}</p>}
      {appointment.cancelled && <p className="callout">この予定は取り消されている。</p>}

      <form action={saveAttendanceAction} className="attend-form editable-region">
        <input type="hidden" name="appointmentId" value={appointment.appointment_id} />
        <input type="hidden" name="seasonId" value={context.seasonId} />
        <input type="hidden" name="tab" value={context.tab} />
        <input type="hidden" name="week" value={context.week} />

        {candidates.length === 0 ? (
          <p className="hh-empty">この期の一覧に候補者が1人も居ない。</p>
        ) : (
          <>
            <div className="scroll-pane popup-body">
              <ul className="attend-list">
                {candidates.map((c) => (
                  <li key={c.person_id} className="attend-item">
                    <label>
                      <input type="checkbox" name="person" value={c.person_id}
                             defaultChecked={c.attended} />
                      <Avatar src={c.photo_data_url} name={c.person_name} />
                      <span className="attend-name">{c.person_name}</span>
                      <span className="dim">{c.school}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <button type="submit" className="button-primary">参加者を保存</button>
          </>
        )}
      </form>
    </Popup>
  )
}
