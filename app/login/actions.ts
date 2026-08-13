'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, issueSession, matchTier,
} from '../../src/auth/session.ts'
import { canOpen, TIER_HOME, type Tier } from '../../src/auth/tiers.ts'
import { getDb } from '../../src/db/server.ts'
import { signInAsStaff, recordSignIn } from '../../src/commands/staff_auth.ts'

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
 * ★★ 職員ごとの合言葉を足した（0038。依頼者の許可。実行⑮）。
 *   名前を打てば**その人として**入り、空なら従来の共有の合言葉で入る。
 *   どちらで入ったかは `sign_in_events` に残る ―― 共有なら
 *   **「誰か分からない」という記録**が残る（空欄で濁さない）。
 *
 * ★ 名前は**打たせる。選択肢にしない。** 一覧にすると、入口を開いた誰にでも
 *   職員の氏名が並ぶ（共用の端末で開いたままにもなる）。
 *
 * ★ 失敗の扱いは職員でも共有でも**同じ**（同じ待ち・同じ文言）。
 *   分けると、名前が実在するか・層が設定済みかが外から分かる。
 */
const SAFE_NEXT = /^\/[A-Za-z0-9\-._~/?&=%[\]]*$/

export async function signInAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const displayName = String(formData.get('displayName') ?? '')
  const raw = String(formData.get('next') ?? '')
  // 外部へ飛ばす踏み台にしない。**自分のパスだけ**を許す。
  const next = SAFE_NEXT.test(raw) && !raw.startsWith('//') ? raw : ''

  const secret = process.env.YOUTHDB_SESSION_SECRET

  // ① 名前が打たれていれば、その職員として確かめる（0038）。
  let tier: Tier | null = null
  let staffId: string | null = null
  if (displayName.trim() !== '') {
    const db = await getDb()
    const asStaff = await signInAsStaff(db, { displayName, passphrase: password })
    if (asStaff.ok) {
      tier = asStaff.tier
      staffId = asStaff.staffId
    }
  } else {
    // ② 名前が空なら、従来の共有の合言葉。
    // 未設定の層は `checkPassword` が誰も通さない（既定値を持たない）。
    // 普通の層は YOUTHDB_PASSWORD2 でも設定できる（依頼者が本番でこの名前を使った）。
    // 明示された PASSWORD2 を優先する。
    tier = matchTier({
      all: process.env.YOUTHDB_PASSWORD,
      personal: process.env.YOUTHDB_PASSWORD2 ?? process.env.YOUTHDB_PASSWORD_PERSONAL,
      input: process.env.YOUTHDB_PASSWORD_INPUT,
    }, password)
  }

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
    await recordSignIn(db, { tier, staffId })
  } catch { /* 記録できなくても入れる。穴は帳簿ではなく入口である */ }

  // ★ **入れ替わったら控えを捨てる**（C-141 の30秒の控えに対して）。
  //   捨てないと、前に入っていた人の画面が最大30秒そのまま出る ――
  //   層が違えば**見えてはいけないものが見える。**
  //   （0038 で入口が記録を書くようになったので、見張りもここを見る）
  revalidatePath('/', 'layout')

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(secret, tier, Date.now(), staffId), {
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
