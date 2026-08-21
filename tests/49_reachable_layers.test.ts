import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIERS, canOpen } from '../src/auth/tiers.ts'

/**
 * 詰めていない階層を作らない（依頼者の指示。実行⑬）。
 *
 * 「詰めていない階層」＝ **画面はあるのに、そこへ入る道が無い**もの。
 * URL を手で打てば開くので、動かして触っている限り気づけない ――
 * 実際 `/reach-zones/{id}` は「連携団体 › 団体名」というパンくずを出しながら、
 * **どこからもリンクされていなかった。**
 *
 * ここで見張るのは3つ ――
 *   ① どの画面にも入り口がある（タブ・追加・他画面のリンクのいずれか）
 *   ② リンクの行き先が実在する（消した画面へのリンクを残さない）
 *   ③ 層ごとに、入り口のある画面だけが押せる（押すと弾かれる窓を残さない）
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/** `app/` の下の `page.tsx` から、ルートの一覧を作る。 */
async function routes(dir = join(ROOT, 'app'), base = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue
    if (e.isDirectory()) out.push(...await routes(join(dir, e.name), `${base}/${e.name}`))
    else if (e.name === 'page.tsx') out.push(base === '' ? '/' : base)
  }
  return out.sort()
}

/** `public/` に置いた素材（画像など）。ルートではない。 */
async function assetPrefixes(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const e of await readdir(join(ROOT, 'public'), { withFileTypes: true })) {
    out.add(`/${e.name.replace(/\.[^.]+$/, '')}`)
    if (e.isDirectory()) out.add(`/${e.name}`)
  }
  return out
}

/**
 * 画面の中に書かれた行き先を、**どの画面から張られたか**とともに集める。
 *
 * ★ 自分から自分へのリンクは入り口ではない。数えると、**孤立した画面が
 *   自分で自分を指しているだけで「繋がっている」ことになる**
 *   （実際 `/pilot` がそれで通り抜けた）。
 */
async function linkTargets(): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>()
  const walk = async (dir: string): Promise<string[]> => {
    const files: string[] = []
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) files.push(...await walk(join(dir, e.name)))
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) files.push(join(dir, e.name))
    }
    return files
  }
  for (const f of await walk(join(ROOT, 'app'))) {
    const src = await readFile(f, 'utf8')
    const from = `/${(f.slice(join(ROOT, 'app').length + 1).split('/')[0] ?? '')}`
      .replace(/\/page\.tsx$/, '')
    // ★ 行き先の書き方は1つではない ―― `href="/x"` / `href={`/x/${id}`}` /
    //   `href={to('/x')}` / `redirect('/x')` / `basePath="/x"`。
    //   **書き方で拾い漏らすと、繋がっているものを「孤立」と数える**
    //   （実際 `to('/funnel')` を数え落とした）。文字列そのものを見る。
    for (const m of src.matchAll(/['"`](\/[a-z0-9-]*)(?:[/?'"`]|$)/gim)) {
      const t = m[1]!
      if (!found.has(t)) found.set(t, new Set())
      found.get(t)!.add(from)
    }
  }
  return found
}

/** 動的な段（`[id]`）を、その親のルートへ畳む。 */
const parentOf = (route: string) => {
  const parts = route.split('/').filter(Boolean)
  const head = parts.filter((p) => !p.startsWith('['))
  return `/${head[0] ?? ''}`
}

describe('詰めていない階層を作らない', () => {
  test('① どの画面にも入り口がある', async () => {
    const all = await routes()
    const shell = await read('app/_components/shell.tsx')
    const targets = await linkTargets()

    // タブと「追加」は操作柱が持つ入り口。
    const fromShell = [...shell.matchAll(/href: '([^']+)'/g)].map((m) => m[1]!)

    /** その行き先が、**自分以外の画面**から張られているか。 */
    const enteredFromElsewhere = (route: string) => {
      if (fromShell.includes(route)) return true
      const from = targets.get(route)
      if (!from) return false
      return [...from].some((f) => f !== route)
    }

    const orphans = all.filter((r) => {
      if (r === '/') return false          // 根。層の入口そのもの（TIER_HOME）
      if (r === '/login') return false     // 合言葉。proxy が送る先で、リンクは張らない
      return !enteredFromElsewhere(r) && !enteredFromElsewhere(parentOf(r))
    })

    // ★ 実行⑬で `/pilot` を繋いだ（依頼者に判断を委ねられた）。**消さずに繋いだ** ――
    //   Pilot は HOLD のままで手順はまだ走っておらず、消すのは観測を取る足場を
    //   先に捨てることになる。画面が「通常選考 › 試運転」と名乗っていたので、
    //   名乗った親（`/borderline`）から入れるようにした。
    assert.deepEqual(orphans, [],
      '入る道の無い画面がある（URL を手で打つ以外に開けない）')
  })

  test('② リンクの行き先が実在する', async () => {
    const all = new Set(await routes())
    const targets = await linkTargets()
    const assets = await assetPrefixes()
    const dead = [...targets.keys()].filter((t) => {
      if (t === '/') return false
      if (assets.has(t)) return false      // `public/` の素材。ルートではない
      // 動的な段は親で見る（`/people/{id}` は `/people/[id]` が受ける）。
      return !all.has(t) && ![...all].some((r) => parentOf(r) === t)
    })
    assert.deepEqual(dead.sort(), [], '消した画面へのリンクが残っている')
  })

  test('③ 層ごとに、開ける画面だけを出す', async () => {
    // `canOpen` は入口（proxy）とタブと、ホームの行き先が共有する唯一の判定。
    // ここが層ごとに矛盾すると「押せるのに開かない」窓ができる。
    const all = await routes()
    for (const tier of TIERS) {
      for (const r of all) {
        const opens = canOpen(tier, r)
        assert.equal(typeof opens, 'boolean', `${tier} ${r}`)
      }
      // ホームはどの層も開ける（開けないタブを先頭に置かない）。
      assert.equal(canOpen(tier, '/'), true, tier)
    }
    // 入力層に見る画面を開かせない（線は1本＝特別選考だけ、ではない側の確認）。
    assert.equal(canOpen('input', '/headhunting'), false)
    assert.equal(canOpen('input', '/people/new'), true)
    // 個人層は特別選考だけ開けない。
    assert.equal(canOpen('personal', '/headhunting'), false)
    assert.equal(canOpen('personal', '/borderline'), true)
  })
})
