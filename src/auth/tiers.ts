/**
 * 層（依頼者の指示。実行⑪）。
 *
 * 合言葉1つで「入口を閉じる」だけだったものを、**3つに分ける。**
 *
 *   all       ヘッドハンティングまで全部見られる
 *   personal  個人アプローチ・面接まで。ヘッドハンティングは出さない
 *   input     入力だけ（候補者を追加・連携団体を追加）
 *
 * ★★ **これは依然として「誰が」を記録しない。** ★★
 *   層ごとに合言葉を分けるだけなので、同じ層の中では誰が入ったか分からない。
 *   だからメモの書き手は**手入力**である（依頼者の判断。実行⑪）。
 *
 * ★ 入れる場所を決めるのはここ1箇所だけ。
 *   **画面のタブもここを見る**（`app/_components/shell.tsx`）。
 *   別々に書くと「押せるのに開かないタブ」か「開くのに出ないタブ」ができる。
 *   CLAUDE.md「操作可能な母集団と画面に出す母集団を一致させる」。
 *
 * ★ Edge でも動く。ここには DB も next/headers も持ち込まない
 *   （`proxy.ts` から呼ぶ）。
 */

export type Tier = 'all' | 'personal' | 'input'

/** 上から順に強い。並びは合言葉の突き合わせ順ではない（全部見る）。 */
export const TIERS = ['all', 'personal', 'input'] as const

export const isTier = (v: string): v is Tier =>
  (TIERS as readonly string[]).includes(v)

/**
 * その層の入口。
 *
 * ★ 権限の足りない要求を `/login` へ送ると**輪になる** ――
 *   入れる → 開けない → 合言葉を聞かれる → 入れる … と回り続ける。
 *   入れているのに開けないだけなので、**その層の入口へ送る。**
 */
export const TIER_HOME: Record<Tier, string> = {
  // ★ 実行⑫でホームを作った（依頼者の指示）。**全層がホームを開く** ――
  //   タブの先頭に開けない画面を置くと、入った直後に弾かれる。
  //   中身は層ごとに変える（`app/page.tsx`）。
  all: '/',
  personal: '/',
  input: '/',
}

/**
 * 入力層に開く画面。**増やすときはここだけを増やす。**
 *
 * 操作柱の「追加」に並んでいる3つと同じである（`ADD_LINKS`）。
 * メモと参加者の記録は個人アプローチの画面の中にあるので、ここには無い。
 *
 * ★ 「入力者を追加」は実行⑫で足した。表の「記録した人」の選択肢を
 *   増やす道が取り込みしか無かった（C-75）。
 */
const INPUT_PATHS = ['/people/new', '/approach/new', '/staff/new', '/events/new']

/** ヘッドハンティングだけが `all` の持ち物。ここが3層を分ける唯一の線。 */
const ALL_ONLY_PATHS = ['/headhunting']

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/**
 * その層はその画面を開けるか。
 *
 * `personal` は**ヘッドハンティング以外は全部**開ける。
 * 「見せない画面」を数え上げる形にしてあるのは、画面が増えたときに
 * 既定で閉じるより既定で開くほうが事故が小さいためではなく、
 * **依頼者が引いた線が1本だけ**だからである（ヘッドハンティングか否か）。
 * 線を増やすときは、増やした線をここに足す。
 */
export const canOpen = (tier: Tier, pathname: string): boolean => {
  // ★ ホームは全層が開く。**`under(pathname, '/')` は全部に当たる**ので、
  //   ホームを一覧に混ぜず、完全一致で見る ―― 混ぜた瞬間に入力層が全画面を開ける。
  if (pathname === '/') return true
  if (tier === 'input') return INPUT_PATHS.some((p) => under(pathname, p))
  if (tier === 'personal') return !ALL_ONLY_PATHS.some((p) => under(pathname, p))
  return true
}
