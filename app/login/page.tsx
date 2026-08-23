import { signInAction } from './actions.ts'

export const dynamic = 'force-dynamic'

/**
 * 合言葉を聞く画面（依頼者の指示。実行⑩）。
 *
 * ★ 外枠（`Shell`）を被らない。**入る前に中身の形を見せない。**
 * ★ `'use client'` は増やしていない。素の `<form action={...}>` である。
 * ★ `editable-region` を付けない ―― あれは**記録を編集できる場所**の印（C-47）で、
 *   付けると「記入できます」の札が出る。合言葉は記録ではない（C-82）。
 */
export default async function LoginPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = props?.searchParams ? (await props.searchParams) ?? {} : {}

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const failed = one(sp.e) === '1'
  const next = one(sp.next) ?? ''

  return (
    <main className="login-frame">
      <form action={signInAction} className="login-card">
        <img className="login-logo" src="/brand/logo_gradient_720.png"
             width={720} height={171} alt="NEO ACADEMIA" />

        <input type="hidden" name="next" value={next} />
        {/* ★ 欄は**合言葉1つだけ**（依頼者の判断。C-146）――
            「経営層と平社員の2個あればいい」。名前を聞かない。
            誰が入ったかは記録できない（C-84 の穴は開いたまま）。 */}
        <label className="login-label" htmlFor="password">合言葉</label>
        {/* biome-ignore lint/a11y/noAutofocus: 入力欄が1つだけの専用ログイン画面である。
            autofocus が読み上げ利用者を迷わせるのは「他にも読む物がある画面」の話で、
            ここは合言葉を入れる以外にすることが無い。外すと毎回クリックが1回増える。 */}
        <input id="password" name="password" type="password" required autoFocus
               autoComplete="current-password" className="login-input" />
        <button className="button-primary login-button" type="submit">入る</button>

        {/* 失敗の理由を分けない。設定の有無まで外へ漏らさない。 */}
        {failed && <p className="login-error">合言葉が違う</p>}
      </form>

    </main>
  )
}

