import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 掘っていっても、行き着かない画面が無いこと（依頼者の指示。実行⑭）。
 *
 * ★ `tests/49` は**1段しか見ていない。** 行き先を拾う正規表現が
 *   `(\/[a-z0-9-]*)` で、`/people/{id}/edit` を `/people` として数える。
 *   つまり**深いリンクの行き先は誰も見張っていなかった** ――
 *   `/borderline/{person}/notes` のような存在しない先を書いても通り抜ける。
 *
 * ここで見張るのは3つ ――
 *   ① 多段のリンクの行き先が実在する（最後の段まで突き合わせる）
 *   ② パンくずが指す親が実在する（**掘った道を戻る道**が切れていない）
 *   ③ 途中の段が無いルートには、その段へのリンクが1本も無い
 *      （`/staff/new` はあるが `/staff` は無い。押せなければ 404 に落ちない）
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP = join(ROOT, 'app')

/** `app/` の下のルート（`page.tsx` と `route.ts` の両方）。 */
async function routes(dir = APP, base = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue
    if (e.isDirectory()) out.push(...await routes(join(dir, e.name), `${base}/${e.name}`))
    else if (e.name === 'page.tsx' || e.name === 'route.ts') out.push(base === '' ? '/' : base)
  }
  return [...new Set(out)].sort()
}

async function sources(dir = APP): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) out.push(...await sources(join(dir, e.name)))
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(join(dir, e.name))
  }
  return out
}

/** テンプレートの `${...}` は「値が入る段」なので `*` に畳む。問い合わせは落とす。 */
const normalize = (raw: string) =>
  raw.replace(/\$\{[^}]*\}/g, '*').replace(/[?#].*$/, '').replace(/\/$/, '')

/** その行き先を受けるルートがあるか。`[id]` はどんな段にも当たる。 */
function resolves(target: string, all: string[]): boolean {
  const t = target.split('/').filter(Boolean)
  return all.some((r) => {
    const p = r.split('/').filter(Boolean)
    if (p.length !== t.length) return false
    return p.every((seg, i) => seg.startsWith('[') || seg === t[i])
  })
}

/** 画面に書かれた行き先を、**どのファイルから**とともに集める。 */
async function links(): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>()
  for (const f of await sources()) {
    const src = await readFile(f, 'utf8')
    // 1段だけの `/people` から、多段の `/people/${id}/edit` まで拾う。
    for (const m of src.matchAll(
      /['"`](\/[a-z0-9-]+(?:\/(?:\$\{[^}]*\}|[a-z0-9-]+))*)(?:[?#][^'"`]*)?['"`]/gim)) {
      const t = normalize(m[1]!)
      if (t === '') continue
      if (!found.has(t)) found.set(t, new Set())
      found.get(t)!.add(f.slice(ROOT.length))
    }
  }
  return found
}

/** パンくずが指す親（`{ label: '…', href: '…' }` の href）。 */
async function breadcrumbHrefs(): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>()
  for (const f of await sources()) {
    const src = await readFile(f, 'utf8')
    for (const m of src.matchAll(/href:\s*[`'"]([^`'"]+)[`'"]/g)) {
      const t = normalize(m[1]!)
      if (!t.startsWith('/')) continue
      if (!found.has(t)) found.set(t, new Set())
      found.get(t)!.add(f.slice(ROOT.length))
    }
  }
  return found
}

/** そのソースが**押せる形**で指している行き先（`href=` と `href:` だけ）。 */
export const hrefTargets = (src: string): string[] =>
  [...src.matchAll(/href[=:]\s*\{?\s*[`'"]([^`'"]+)[`'"]/g)]
    .map((m) => normalize(m[1]!))
    .filter((t) => t.startsWith('/'))

describe('掘っていっても行き着かない画面が無い（実行⑭）', () => {
  test('① 多段のリンクの行き先が実在する', async () => {
    const all = await routes()
    const ls = await links()
    // 素材（public/）とアプリ外は対象にしない。
    const assets = new Set(
      (await readdir(join(ROOT, 'public'), { withFileTypes: true }))
        .flatMap((e) => [`/${e.name}`, `/${e.name.replace(/\.[^.]+$/, '')}`]))

    const deep = [...ls.keys()].filter((t) => t.split('/').filter(Boolean).length >= 2)
    assert.ok(deep.length > 5, `多段のリンクが ${deep.length} 本しか拾えていない（拾い方が壊れている）`)

    const dead = deep.filter((t) => !assets.has(t) && !resolves(t, all))
    assert.deepEqual(dead.map((t) => `${t} ← ${[...ls.get(t)!].join(', ')}`), [],
      '存在しない画面への深いリンクがある')
  })

  test('② パンくずが指す親が実在する（戻る道が切れていない）', async () => {
    const all = await routes()
    const crumbs = await breadcrumbHrefs()
    assert.ok(crumbs.size > 3, `パンくずの行き先が ${crumbs.size} 件しか拾えていない`)

    const dead = [...crumbs.keys()].filter((t) => !resolves(t, all))
    assert.deepEqual(dead.map((t) => `${t} ← ${[...crumbs.get(t)!].join(', ')}`), [],
      'パンくずが存在しない親を指している（掘った先から戻れない）')
  })

  test('③ 途中の段が無いルートには、その段へのリンクが1本も無い', async () => {
    // ★ いま途中が無いのは4本 ―― `/applications/[id]` ・ `/reach-zones/[id]` ・
    //   `/staff/new` ・ `/events/new`（C-155）。
    //   **一覧の画面を持たないのは形の判断**（依頼者が決める）で、
    //   こちらで勝手に作らない。**押せる形で出さない**ことだけを見張る。
    //   イベントの一覧は「イベントを追加」の下段に置いてある（同じ画面の中）。
    const all = await routes()
    const ls = await links()
    const missing: string[] = []
    for (const r of all) {
      const parts = r.split('/').filter(Boolean)
      for (let i = 1; i < parts.length; i++) {
        const parent = `/${parts.slice(0, i).join('/')}`.replace(/\[[^\]]+\]/g, '*')
        if (!resolves(parent, all)) missing.push(parent)
      }
    }
    assert.deepEqual([...new Set(missing)].sort(),
      ['/applications', '/events', '/reach-zones', '/staff'],
      '途中の段が無いルートの顔ぶれが変わった。押せる形になっていないか見直すこと')

    // ★ 押せる形＝`href` である。`revalidatePath('/reach-zones', 'layout')` は
    //   **リンクではない**（子の layout を作り直す指示で、導線ではない）。
    const offenders: string[] = []
    for (const f of await sources()) {
      const src = await readFile(f, 'utf8')
      for (const t of hrefTargets(src)) {
        if (new Set(missing).has(t)) offenders.push(`${f.slice(ROOT.length)} → ${t}`)
      }
    }
    assert.deepEqual(offenders, [],
      '無い画面へ href が張られている（押すと 404 に落ちる）')
  })

  test('★ ③の数え方そのものを確かめる（href だけを拾い、他を拾わない）', () => {
    // 検査を2度間違えた前例がある（C-119・C-125）。**数え方を先に疑う。**
    const bad = `<Link href="/staff">入力者</Link>`
    const crumb = `crumbs={[{ label: '入力者', href: '/staff' }]}`
    const notLink = `revalidatePath('/staff', 'layout')`
    assert.deepEqual(hrefTargets(bad), ['/staff'], 'href= を拾えていない')
    assert.deepEqual(hrefTargets(crumb), ['/staff'], 'href: を拾えていない')
    assert.deepEqual(hrefTargets(notLink), [], 'リンクでないものを拾っている')
  })
})
