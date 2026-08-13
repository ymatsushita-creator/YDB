import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canOpen, TIERS, TIER_HOME } from '../src/auth/tiers.ts'

/**
 * ホームとタブ（実行⑫。依頼者の指示）。
 *
 * 依頼者が決めたこと ――
 *   「既存のタブの上にホーム（サマリーをビジュアライズ、
 *     ピックアップ候補者を3人みたいな感じの画面）」
 *   「層ごとに出すものを変える」
 *   「ヘッドハンティング → 特別選考。**画面に出る語だけ**変える」
 *
 * ここで固定したいのは5つ ――
 *   ① ホームは**画面を持つ**（redirect だけに戻さない）
 *   ② 全層がホームを開ける（開けないタブを先頭に置かない）
 *   ③ ホームは**層ごとに出すものを変える**が、判定は `canOpen` を見る
 *      ―― ホーム専用の層判定を書かない（2箇所に分かれると必ず食い違う）
 *   ④ ホームは**新しい集計を作らない**（既にあるクエリを呼ぶだけ）
 *   ⑤ 「特別選考」は**画面の語だけ。** URL と識別子は `headhunting` のまま
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/**
 * コメントを落とした本文。
 *
 * ★ **コメントは履歴である。** 「これは出さない」と書いた注記まで
 *   「出している」と数えると、理由を書くほど検査が落ちる。
 */
const body = async (p: string) => (await read(p)).split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
    && !l.trimStart().startsWith('/*') && !l.includes('{/*'))
  .join('\n')

describe('ホーム', () => {
  test('① ホームは画面を持つ（redirect だけではない）', async () => {
    const src = await body('app/page.tsx')
    assert.match(src, /<Shell active="home"/, 'ホームは共通シェルを被る')
    assert.match(src, /Card title="推移"/)
    assert.match(src, /Card title="ピックアップ候補者"/)
    assert.equal((src.match(/<HomeKpi /g) ?? []).length, 4)
    // 依頼者が選ばなかったものを勝手に足していないこと。
    assert.doesNotMatch(src, /いま止まっているもの/)
    // ★ 依頼者の指示は「**サマリーをビジュアライズ**」である。
    //   最初は表（`<table>`）と数字のカードで作って突き返された。
    //   **ホームに表を置かない。** 図の部品で読ませる。
    assert.doesNotMatch(src, /<table/, 'ホームに表を置かない')
    assert.match(src, /TimeSeries/, '推移を折れ線で出す')
  })

  test('② 全層がホームを開け、行き先もホームである', () => {
    for (const tier of TIERS) {
      assert.equal(canOpen(tier, '/'), true, tier)
      assert.equal(TIER_HOME[tier], '/', tier)
    }
  })

  test('③ 入力層には数字を出さない', async () => {
    const src = await body('app/page.tsx')
    assert.match(src, /tier === 'input'/)
  })

  test('④ ホームの集計はクエリ層から呼ぶ', async () => {
    const src = await body('app/page.tsx')
    for (const fn of ['getHomeTrends', 'listConfidence']) {
      assert.match(src, new RegExp(fn), fn)
    }
    // 画面の中で SQL を書いていない（集計の定義が2箇所になる）。
    assert.doesNotMatch(src, /SELECT /)
  })

  test('④ ピックアップは確度の上位3人（依頼者の指示）', async () => {
    const src = await read('app/page.tsx')
    assert.match(src, /listConfidence\(db, season\.id, 3\)/)
  })

  test('⑥ 各セクションから詳細タブへ飛べる（依頼者の指示）', async () => {
    const src = await body('app/page.tsx')
    // 4つのサマリーと2つのカードが、それぞれの詳細へ行き先を持つ。
    assert.match(src, /label="候補者"[^>]*href=\{to\('\/people'\)\}/)
    assert.match(src, /label="連携団体"[^>]*href=\{to\('\/approach'\)\}/)
    assert.match(src, /label="通常選考 A以上"[^>]*href=\{to\('\/borderline'\)\}/)
    assert.match(src, /label="特別選考"[^>]*href=\{to\('\/headhunting'\)\}/)
    assert.match(src, /Card title="推移" titleHref=\{to\('\/funnel'\)\}/)
    assert.match(src, /Card title="ピックアップ候補者" titleHref=\{to\('\/headhunting'\)\}/)
  })

  test('⑥ 行き先は canOpen で守る（タブと同じ線。2箇所に書かない）', async () => {
    const src = await body('app/page.tsx')
    // 開ける層にだけリンクを渡す判定は canOpen を通す。
    assert.match(src, /canOpen\(/, '行き先の判定は canOpen を見る')
    // ホーム専用の層判定（'personal' などのべた書き分岐）を新設していない。
    assert.doesNotMatch(src, /tier === 'personal'/, 'ホーム専用の層判定を書かない')
  })
})

describe('タブの名称と構造', () => {
  test('⑤ タブは5本。名前は依頼者の語で、URL と識別子は据え置き', async () => {
    const src = await body('app/_components/shell.tsx')
    assert.match(src, /id: 'home', href: '\/', label: 'ホーム'/)
    // ★ 画面の語だけ変える。URL・識別子は `headhunting` / `borderline` / `approach` のまま。
    assert.match(src, /id: 'headhunting', href: '\/headhunting', label: '特別選考'/)
    assert.match(src, /id: 'borderline', href: '\/borderline', label: '通常選考'/)
    assert.match(src, /id: 'approach', href: '\/approach', label: '連携団体'/)
  })

  test('⑤ 画面から旧い呼び名が消えている', async () => {
    // 依頼者の指示は「画面に出る語だけ変える」。**見出しとパンくずも画面である。**
    //   ヘッドハンティング → 特別選考（実行⑫前半）
    //   個人アプローチ     → 通常選考（実行⑫後半）
    //   団体アプローチ     → アプローチ（実行⑫後半）
    const OLD = /'(ヘッドハンティング|個人アプローチ|団体アプローチ)'|"(ヘッドハンティング|個人アプローチ|団体アプローチ)"|>(ヘッドハンティング|個人アプローチ|団体アプローチ)|(ヘッドハンティング|個人アプローチ|団体アプローチ)(リスト|へ)/
    const pages: string[] = []
    const walk = async (dir: string) => {
      for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name))
        else if (e.name.endsWith('.tsx')) pages.push(join(dir, e.name))
      }
    }
    await walk('app')

    const found: string[] = []
    for (const p of pages) {
      const src = await read(p)
      // 文字列リテラルとして画面に出ているものだけを見る（コメントは履歴である）。
      for (const line of src.split('\n')) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
        if (OLD.test(line)) found.push(`${p}: ${line.trim()}`)
      }
    }
    assert.deepEqual(found, [], `画面の語が残っている:\n${found.join('\n')}`)
  })

  test('⑤ 「入力者を追加」を操作柱に出さない', async () => {
    const src = await read('app/_components/shell.tsx')
    assert.doesNotMatch(src, /href: '\/staff\/new', label: '入力者を追加'/)
    assert.equal(canOpen('input', '/staff/new'), true)
  })

  test('ホームと特別選考の間に横罫線がある', async () => {
    const src = await body('app/_components/shell.tsx')
    assert.match(src, /t\.id === 'home'.*hh-nav-divider/)
    const css = await read('app/base.css')
    const rule = /\.hh-nav-divider \{([^}]*)\}/.exec(css)
    assert.match(rule![1]!, /height:\s*1px/)
  })
})

describe('表（スプシ形式）', () => {
  test('★ クライアントに置いたのは表と追従光だけである', async () => {
    // 実行⑪まで `'use client'` は 0 件だった。**増やしたのは2つだけ** ――
    //   表（行の状態を持つ。C-95）
    //   追従光（ポインタの座標を持つ。C-104。仕様書 §6）
    // どちらも**判定と見た目を持たない。** 増えたらここで気づく。
    const found: string[] = []
    const walk = async (dir: string) => {
      for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name))
        else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
          const src = await read(join(dir, e.name))
          if (/^'use client'/m.test(src)) found.push(join(dir, e.name))
        }
      }
    }
    await walk('app')
    assert.deepEqual(found.sort(),
      ['app/_components/glass.tsx', 'app/_components/sheet.tsx'])
  })

  test('★ 表は判定を持たない（コマンドを呼ぶだけ）', async () => {
    const src = await body('app/_components/sheet.tsx')
    // 必須・形式・参照先の判定を画面に書いていないこと。
    assert.doesNotMatch(src, /必須です|@.*\\\.|SELECT |INSERT /)
    assert.match(src, /src\/commands\/sheet\.ts/, '結果の型はコマンド側から借りる')
  })
})

describe('横バー（現在地の帯）', () => {
  /**
   * 依頼者の指示（実行⑫）――
   * 「横バーは縦バーと同じ階層かつ位置固定で。スクロールで動かないように」
   *
   * ★★ **後ろの層が `position` を戻すと、固定が黙って消える。** ★★
   *   `brand.css`（4枚目の層のひとつ前）がグラデーション線の土台として
   *   `.zoom-bar { position: relative }` を持っており、`base.css` の
   *   `sticky` を上書きしていた ―― 画面では「送ると帯が流れる」形で出た。
   *   **層をまたいで同じ性質を2箇所で決めない。**
   */
  test('★ 帯は sticky で、後ろの層が position を戻していない', async () => {
    const base = await read('app/base.css')
    assert.match(base, /\.zoom-bar \{[^}]*position: sticky/,
      'base.css で固定する')

    // 後ろに読む層（白黒・ブランド・ガラス）が position を戻していないこと。
    // ★ 見るのは**帯そのもの**の規則だけ。擬似要素（`::after`）は
    //   グラデーション線で、`absolute` を持つのが正しい。
    for (const layer of ['app/monochrome.css', 'app/brand.css', 'app/glass.css']) {
      const css = await read(layer)
      for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selectors = rule[1]!.split(',').map((s) => s.trim())
        const touchesBar = selectors.some((s) => /(^|\s)\.zoom-bar$/.test(s))
        if (!touchesBar) continue
        assert.doesNotMatch(rule[2]!, /position\s*:/,
          `${layer} が帯の position を上書きしている: ${rule[1]!.trim()}`)
      }
    }
  })

  test('帯は全画面にある（いま何を開いているかが、どこでも見える）', async () => {
    const shell = await read('app/_components/shell.tsx')
    assert.match(shell, /className="zoom-bar"/)
  })

  test('虹色の波は長い波長で、切り替え時間は最初の0.8倍', async () => {
    const css = await read('app/brand.css')
    assert.match(css, /--wave-len:\s*1600px/)
    assert.match(css, /animation:\s*brand-wave 40s linear infinite/)
  })
})

describe('一覧', () => {
  /**
   * 依頼者の指摘（実行⑫）――「一覧できないと意味ねぇだろ」。
   *
   * 本番に 512 人入った日、**人を探すが 50 人しか出していなかった。**
   * 一覧は全件出す（C-62）。上限は残すが、**それは暴走を止める数**であって
   * 表示を切るための数ではない。切ったときは画面に言う。
   */
  test('★ 一覧を小さい数で黙って切っていない', async () => {
    const pages = ['app/people/page.tsx', 'app/headhunting/page.tsx',
      'app/borderline/page.tsx', 'app/operations/page.tsx']
    for (const p of pages) {
      const src = await body(p)
      // 一覧を `slice(0, n).map(...)` で削っていないこと。
      // ★ 見るのは**描画に渡す直前の slice** だけ ―― 日付を作る
      //   `toISOString().slice(0, 10)` まで数えると、一覧と無関係な行で落ちる。
      // ★ 「上位n件」の抜粋（ホームのピックアップなど。n ≦ 5）は別物なので通す。
      const slices = [...src.matchAll(/\.slice\(0,\s*(\d+)\)\s*\.map\(/g)]
        .map((m) => Number(m[1]!))
      for (const n of slices) {
        assert.ok(n <= 5 || n >= 1000,
          `${p}: ${n} 件で切って描いている（一覧は全件出す。抜粋なら5件以下）`)
      }
      // 上限そのものが小さすぎないこと。
      for (const m of src.matchAll(/const (LIMIT|LIST_LIMIT) = (\d+)/g)) {
        assert.ok(Number(m[2]) >= 1000,
          `${p}: ${m[1]} = ${m[2]} は小さすぎる（実データは数百人ある）`)
      }
    }
  })

  test('★ 切ったときは、切ったと画面に言う', async () => {
    const src = await read('app/people/page.tsx')
    assert.match(src, /truncated/, '上限に達したかを持っている')
    assert.match(src, /まで出している/, '切ったことを画面に出す')
    // 1件多く取って判定する（件数を別に数えると2つの答えがずれる）。
    assert.match(src, /LIMIT \+ 1/)
  })
})

describe('特別選考', () => {
  test('やることの画面を出さず、問い合わせも行わない', async () => {
    const page = await read('app/borderline/page.tsx')
    assert.doesNotMatch(page, /<h2>やること<\/h2>/)
    assert.doesNotMatch(page, /listManualTasks|listDerivedTasks/)
  })
})

describe('評価基準（横バー）', () => {
  /**
   * 依頼者の指示（実行⑫）――
   * 「期の項目の上に、エクセルから評価基準を持ってきて、参考にできるように貼って」。
   *
   * ★ 出すのは**記録層の値**（`evaluation_criteria`）。応募管理表から
   *   取り込んである（C-105）。**画面に文字で写し書きしない** ――
   *   写すと、表を直しても画面が古いまま残り、基準が2箇所に増える。
   */
  test('★ 評価基準を画面に写し書きしていない（記録層から引く）', async () => {
    const shell = await body('app/_components/shell.tsx')
    assert.match(shell, /listSeasonCriteria/, '記録層から引く')
    // 軸の名前をコードに直接書いていないこと。
    assert.doesNotMatch(shell, /Be Playful|使い倒せる|賭けたい/,
      '軸の文字を画面に埋め込まない')
  })

  test('横バーと同じ主領域に置く', async () => {
    const shell = await read('app/_components/shell.tsx')
    const criteria = shell.indexOf('hh-criteria-ref')
    const main = shell.indexOf('<div className="hh-main">')
    assert.ok(criteria > main, '評価基準は左柱ではなく横バーのある主領域に描く')
  })

  test('★ 見出しを出さず、基準は動かさずに全件を出す（依頼者の指示）', async () => {
    // ★ 実行⑬で「流す」をやめた ―― 依頼者の指示は
    //   「評価軸は動かさなくていいので全部入るように」。
    //   流れているものは狙って読めない。**全件を同時に出す。**
    const shell = await read('app/_components/shell.tsx')
    const ref = shell.slice(shell.indexOf('<div className="hh-criteria-ref"'), shell.indexOf('{children}'))
    assert.doesNotMatch(ref, />評価基準</)
    assert.doesNotMatch(ref, /hh-criteria-step-name/)
    // 流していた頃は同じ並びを2組出してつないでいた。止めた以上、重複は出さない。
    assert.doesNotMatch(ref, /\[false, true\]/, '止めたので並びは1組だけ')

    const css = await read('app/base.css')
    const rule = /\.hh-criteria-ref \{([^}]*)\}/.exec(css)
    assert.ok(rule, '規則がある')
    assert.match(rule![1]!, /height:\s*var\(--logo-h\)/)
    // 動かさない ―― 動きの指定も、その残骸も残さない。
    assert.doesNotMatch(css, /criteria-marquee/, '流す指定を残さない')
    const group = /\.hh-criteria-group \{([^}]*)\}/.exec(css)
    assert.match(group![1]!, /flex-wrap:\s*wrap/, '入らないぶんは折り返して全件出す')
  })

  test('★ 縦タブと横タブは同じ層（天端・厚みをそろえる。依頼者の指示）', async () => {
    const css = await read('app/base.css')
    // 帯の厚みは両方 `--logo-h`。ロゴ枠は**縮ませない**（縮むと厚みが食い違う）。
    const brand = /\.hh-brand \{([^}]*)\}/.exec(css)
    assert.match(brand![1]!, /height:\s*var\(--logo-h\)/)
    assert.match(brand![1]!, /flex:\s*0 0 auto/, 'ロゴ枠を縮ませない（67→24 に潰れていた）')
    const zoom = /\.zoom-bar \{([^}]*)\}/.exec(css)
    assert.match(zoom![1]!, /height:\s*var\(--logo-h\)/)
    // 天端をそろえる。`top` に余白を入れると縦バーだけ 16px 下がる。
    // （`.hh-sidebar` は面を塗るだけの規則が先にあるので、位置を持つほうを見る）
    const sidebar = /\.hh-sidebar \{[^}]*position:\s*sticky;\s*top:\s*([^;]+);/.exec(css)
    assert.ok(sidebar, '位置を決める規則がある')
    assert.equal(sidebar![1]!.trim(), '0', '天端は横バーと同じ（余白ぶん下げない）')
  })

  test('★ 縦バーの足元を切らない（出る手段を画面から消さない）', async () => {
    // 足元（期の切り替え・デモ札・出る）が 60px はみ出して届かなかった。
    // 送るのは**タブの並びだけ** ―― ロゴ（帯）と足元は動かさない。
    const css = await read('app/base.css')
    const nav = /\.hh-nav \{ flex: 1 1 auto;([^}]*)\}/.exec(css)
    assert.ok(nav, 'タブの並びが伸縮して中で送る')
    assert.match(nav![1]!, /overflow-y:\s*auto/)
    assert.match(css, /\.hh-sidebar-foot \{ flex: 0 0 auto; \}/, '足元は縮ませない')
  })
})
