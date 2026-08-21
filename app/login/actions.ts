'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, issueSession, matchTier,
} from '../../src/auth/session.ts'
import { canOpen, TIER_HOME } from '../../src/auth/tiers.ts'
import { getDb } from '../../src/db/server.ts'
import { recordSignIn } from '../../src/commands/staff_auth.ts'

/**
 * 合言葉を確かめて、引換券を渡す。
 *
 * ★ 合言葉そのものは Cookie に入れない。**署名した引換券**を入れる。
 * ★ 失敗の理由を分けない ―― 「合言葉が違う」以外を返すと、
 *   設定の有無まで外から分かる。**どの層が設定済みかも漏らさない。**
 *
 * ★ 層ごとに合言葉が違う（実行⑪）。**画面は1つのまま。**
 *   「あなたはどの層ですか」と聞くと、層の一覧が入る前に見える。
 *   打たれた合言葉がどの層のものかは、こちらで決める。
 *
 * ★★ 職員ごとの合言葉は**外した**（C-146）。依頼者の判断 ――
 *   「経営層と平社員の2個パスワードがあればいい」。
 *   したがって入口は**合言葉1つ**で、名前を聞かない。
 *
 * ★ **誰が入ったかは記録できない**（C-84 の穴は開いたまま）。
 *   入った記録（`sign_in_events`）には「共有で入った＝誰か分からない」が残る ――
 *   **分からないことを、分からないと記録する。**
 */
const SAFE_NEXT = /^\/[A-Za-z0-9\-._~/?&=%[\]]*$/

export async function signInAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const raw = String(formData.get('next') ?? '')
  // 外部へ飛ばす踏み台にしない。**自分のパスだけ**を許す。
  const next = SAFE_NEXT.test(raw) && !raw.startsWith('//') ? raw : ''

  const secret = process.env.YOUTHDB_SESSION_SECRET

  // 未設定の層は `checkPassword` が誰も通さない（既定値を持たない）。
  // 普通の層は YOUTHDB_PASSWORD2 でも設定できる（依頼者が本番でこの名前を使った）。
  // 明示された PASSWORD2 を優先する。
  // ★ 配るのは2つでよい（依頼者の判断。C-146）―― 経営層と平社員。
  //   入力層を設定しなければ、その層では誰も入れない（**既定で閉じている**）。
  const tier = matchTier({
    all: process.env.YOUTHDB_PASSWORD,
    personal: process.env.YOUTHDB_PASSWORD2 ?? process.env.YOUTHDB_PASSWORD_PERSONAL,
    input: process.env.YOUTHDB_PASSWORD_INPUT,
  }, password)

  if (!secret || !tier) {
    // ★ 失敗のたびに少し待つ。合言葉は層ごとに1つで、総当たりが効く。
    //   回数を数える置き場所がサーバレスに無いので、**時間で削る。**
    //   0.5 秒でも、1秒あたりの試行が 2 回に落ちる。
    await new Promise((r) => { setTimeout(r, 500) })
    redirect(`/login?e=1${raw ? `&next=${encodeURIComponent(raw)}` : ''}`)
  }

  // ★ 見ようとしていた場所が**その層に開いていなければ、層の入口へ送る。**
  //   そのまま送ると proxy に弾かれ、入った直後に別の画面へ飛ばされる。
  const to = next && canOpen(tier, next) ? next : TIER_HOME[tier]

  // ★ 入った記録を積む（追記専用。0038）。**入れた後にだけ積む** ――
  //   失敗まで積むと、総当たりで記録が埋まって「誰が入ったか」が読めなくなる。
  //   ここで落ちても入場は妨げない（記録の失敗で入口を閉じない）。
  try {
    const db = await getDb()
    // ★ 誰かは分からない。**分からないと記録する**（staff_id は NULL）。
    await recordSignIn(db, { tier })
  } catch { /* 記録できなくても入れる。穴は帳簿ではなく入口である */ }

  // ★ **入れ替わったら控えを捨てる**（C-141 の30秒の控えに対して）。
  //   捨てないと、前に入っていた人の画面が最大30秒そのまま出る ――
  //   層が違えば**見えてはいけないものが見える。**
  //   （0038 で入口が記録を書くようになったので、見張りもここを見る）
  revalidatePath('/', 'layout')

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(secret, tier, Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  redirect(to)
}

/**
 * 出る。引換券を捨てる。
 *
 * ★ 券だけ捨てても、**ブラウザ側の控え（30秒。C-141）は残る。**
 *   共用の端末では、出たあとに戻るを押した次の人へ前の画面が出る。
 *   券と一緒に控えも捨てる。
 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  revalidatePath('/', 'layout')
  redirect('/login')
}
