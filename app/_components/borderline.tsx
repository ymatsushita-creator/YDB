import type { Appointment } from '../../src/queries/borderline.ts'

/**
 * ボーダーライン画面の部品（実行⑨）。
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
  monday, appointments, today,
}: { monday: string; appointments: Appointment[]; today: string }) {
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
            <div
              key={a.appointment_id}
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
            </div>
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
                <span className={`cal-dot ${KIND_CLASS[a.kind_code] ?? 'appt-internal'}`} />
                <span className="cal-list-when">
                  {jstParts(a.starts_at).day.slice(5).replace('-', '/')}{' '}
                  {jstTime(a.starts_at)}
                </span>
                <span className="cal-list-who">{a.person_name ?? a.title}</span>
                <span className="cal-list-kind">{a.kind_label}</span>
                {!placed.includes(a) && <span className="cal-list-out">格子外</span>}
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
