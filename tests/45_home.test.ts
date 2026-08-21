import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canOpen, TIERS, TIER_HOME } from '../src/auth/tiers.ts'
import { appCss } from './support/css.ts'

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
    assert.match(src, /Card title="KPI" titleHref=\{to\('\/kpis'\)\}/)
    assert.match(src, /Card title="ピックアップ候補者"/)
    // ★ C-162 で5枚目（応募・目標比）を足した。目標が無い期では出ない
    //   （条件付き JSX の1本）ので、書かれている `<HomeKpi` は5箇所。
    assert.equal((src.match(/<HomeKpi /g) ?? []).length, 5)
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
    // ★ 「通常選考 A以上」を固定していたが、**A は記録に無い格付け**だった
    //   （応募管理表では A〜C・D〜I が特別選考の軸の記号。C-127）。
    //   ラベルを直したので、見張りも一緒に直す ―― **見張りが誤りを固定していた。**
    assert.match(src, /label="確度の高い候補者"[\s\S]{0,80}href=\{to\('\/borderline'\)\}/)
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
    const css = await appCss()
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
      ['app/_components/sheet.tsx'])
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
    const base = await appCss()
    assert.match(base, /\.zoom-bar \{[^}]*position: sticky/,
      'base.css で固定する')

    // ★ 2026-08-20 の意匠刷新（C-236）で、後ろに読む層（白黒・ブランド・
    //   ガラス）は**無くなった。** 意匠は `tokens.css` と `base.css` の2枚だけ。
    //   同じ性質を2箇所で決める余地そのものを消したので、
    //   ここでは**層が増えていないこと**を見張る。
    const layout = await read('app/layout.tsx')
    const layers = [...layout.matchAll(/^import '\.\/([^']+\.css)'/gm)].map((m) => m[1]!)
    assert.deepEqual(layers, ['tokens.css', 'base.css'],
      '意匠の層が増えている（同じ性質を2箇所で決められるようになる）')

    // 合成した1本の中で、`.zoom-bar` の position を後から戻していないこと。
    // ★ 見るのは**帯そのもの**の規則だけ。擬似要素（`::after`）は
    //   現在地の印で、`absolute` を持つのが正しい。
    for (const rule of base.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1]!.split(',').map((x) => x.trim())
      if (!selectors.some((x) => /(^|\s)\.zoom-bar$/.test(x))) continue
      const decls = rule[2]!
      if (/position:\s*sticky/.test(decls)) continue
      assert.doesNotMatch(decls, /position\s*:/,
        `帯の position を上書きしている: ${rule[1]!.trim()}`)
    }
  })

  test('帯は全画面にある（いま何を開いているかが、どこでも見える）', async () => {
    const shell = await read('app/_components/shell.tsx')
    assert.match(shell, /className="zoom-bar"/)
  })

  /**
   * ★ ロゴから伸びる虹色の波（実行⑩〜⑫）は **2026-08-20 に退役した**（C-236。
   *   依頼者の指示 ――「今のフロントエンドから何も引き継ぐ必要はない。
   *   DESIGN.md に従って」）。DESIGN.md は
   *     ・「Avoid: equal-width rainbow stripes / hard colour boundaries」
   *     ・「面をスペクトラムで塗らない。線と細い印に落とす」
   *   と定めており、幅いっぱいを走る帯はこれに正面から反する。
   *
   *   代わりに **いま居る場所（`.zoom-crumb-current`）の下に細線1本**だけを引く。
   *   ここでは「波が戻っていない」ことと「印が線であること」を見張る。
   */
  test('現在地の印は、面ではなく細い線である（虹の帯は戻っていない）', async () => {
    const css = await appCss()
    assert.doesNotMatch(css, /brand-wave|--wave-len/,
      'ロゴから伸びる虹色の波が戻っている（DESIGN.md が禁じる等幅の帯）')

    const rule = /\.zoom-crumb-current::after \{([^}]*)\}/.exec(css)
    assert.ok(rule, '現在地の印が無い')
    assert.match(rule![1]!, /height:\s*2px/, '印が線ではなく面になっている')
    assert.match(rule![1]!, /var\(--spectrum-line\)/, '印がスペクトラムを使っていない')
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

describe('やることを出さない画面', () => {
  /**
   * 依頼者の指示（実行⑬）――「**特別選考の最新やること、はいらない**」。
   *
   * ★★ 実行⑬は**外す先を間違えた。** 特別選考は `/headhunting` で、
   *   実際に外したのは `/borderline`（通常選考）だった。見張りまで
   *   `borderline` を見ていたので、**間違いを見張りが追認していた**（C-136）。
   *   タブの名前は `app/_components/shell.tsx` の `TABS` にある ――
   *   画面のファイル名から日本語の呼び名を推測しない。
   */
  test('★ 特別選考（/headhunting）に「やること」が無い ―― 問い合わせもしない', async () => {
    const page = await read('app/headhunting/page.tsx')
    assert.doesNotMatch(page, /<h2>最新やること<\/h2>/, '特別選考にやることが戻っている')
    assert.doesNotMatch(page, /listHeadhuntingTasks\(/, '出さないものを問い合わせている')
    assert.doesNotMatch(page, /taskSentence/, 'やることの一文を組み立てている')
  })

  test('特別選考というタブが指すのは /headhunting である（名前と画面の対応）', async () => {
    const shell = await read('app/_components/shell.tsx')
    assert.match(shell, /href: '\/headhunting', label: '特別選考'/)
    assert.match(shell, /href: '\/borderline', label: '通常選考'/)
  })
})

describe('画面の切り替え（速さ）', () => {
  /**
   * 依頼者の問い（実行⑮）――「**画面切り替えはなぜこんなに遅いの**」。
   *
   * 測った内訳（C-141）――
   *   本番 /login の応答      0.39〜0.72 秒（DB に触らない画面でこれ）
   *   デモDBの組み立て        1,244 ms（PGlite 621 / migrate 99 / 架空データ 522）
   *   画面ごとの問い合わせ     10本ぜんぶ足して 219 ms ―― **SQL は遅くない**
   *
   * ★ ここで固定するのは、**読むだけの往復を減らす指定が消えないこと**である。
   */
  test('タブを押し直したとき、サーバへ聞き直さない（30秒の控え）', async () => {
    const config = await read('next.config.ts')
    assert.match(config, /staleTimes:\s*\{\s*dynamic:\s*30\s*\}/,
      'ブラウザ側の控えが無いと、戻るたびに往復する')
  })

  test('★ 書き込みのあとは控えを捨てている（古い値を見せない）', async () => {
    // 控えを効かせてよいのは、書いたら捨てているからである。
    // 書き込みのアクションはすべて `revalidatePath` を呼ぶ。
    const files: string[] = []
    const walk = async (dir: string) => {
      for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name))
        else if (e.name === 'actions.ts' || e.name === 'sheet-actions.ts') {
          files.push(join(dir, e.name))
        }
      }
    }
    await walk('app')
    assert.ok(files.length > 0, '書き込みのアクションが見つからない')
    let checked = 0
    for (const f of files) {
      const src = await read(f)
      // 記録を書くものだけを見る。
      // ★ 入口（`app/login/actions.ts`）も 0038 から**記録を書く**
      //   （入った記録）。しかもそこは**人が入れ替わる場所**なので、
      //   控えを捨てないと前の人の画面が最大30秒出る ―― この見張りが捕まえた。
      if (!/src\/commands\//.test(src)) continue
      checked++
      assert.match(src, /revalidatePath\(/, `${f} が控えを捨てていない`)
    }
    assert.ok(checked >= 5, `記録を書くアクションが少なすぎる（${checked}）`)
  })
})

describe('画面に出る語', () => {
  /**
   * 依頼者の指示（実行⑮）――「**応募者成績ランキングを欲しい人ランキングに戻して**」。
   *
   * ★ **画面に出る語は依頼者が決める**（「特別選考」と同じ扱い。実行⑫）。
   *   変えたのは見出しだけで、並べ方も問い合わせも変えていない ――
   *   語を変えたついでに中身を変えると、**同じ名前で別の数字**が出る。
   */
  test('★ ランキングの見出しは依頼者の語（中身は変えない）', async () => {
    const page = await read('app/headhunting/page.tsx')
    assert.match(page, /<h2>欲しい人ランキング<\/h2>/, '見出しが依頼者の語でない')
    assert.doesNotMatch(page, /<h2>応募者成績ランキング<\/h2>/, '古い語が残っている')
    // 中身（提出済みの評価の点で並べる問い合わせ）はそのまま。
    assert.match(page, /listApplicantScores\(/, '語だけ変える。並べ方は変えない')
  })
})

describe('残った面積の使い方', () => {
  /**
   * 依頼者の指示（実行⑮）――「**ランキング表で使って残り面積使って**」。
   *
   * 特別選考から「やること」を外した（C-136）ら、列の割り付け（0.6 / 1.4）が
   * 上下2枚を前提にしたままで、**下の 1.4 が灰色の余白として残った。**
   * 枚数を数えるのは CSS の仕事にする ―― 画面ごとに別のクラスを足すと、
   * 次に1枚減ったときにまた余白が出る。
   */
  test('★ 1枚しか無い列は、その1枚に高さを全部渡す', async () => {
    const css = await appCss()
    const rule = /\.hh-col-main:has\(> :only-child\)[^{]*\{([^}]*)\}/.exec(css)
    assert.ok(rule, '1枚のときの割り付けが無い')
    assert.match(rule![1]!, /grid-template-rows:\s*minmax\(0, 1fr\)/)
  })

  test('★ ランキングの行は中身なりにしない（片方が空でも余白を残さない）', async () => {
    const css = await appCss()
    const rule = /\.hh-rankings \{([^}]*)\}/.exec(css)
    assert.match(rule![1]!, /grid-auto-rows:\s*minmax\(0, 1fr\)/,
      '中身なりだと、片方が空のときに下へ余りが出る')
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

  /**
   * 依頼者の指示（実行⑮）――「**高さを真ん中に揃えて**」。
   *
   * ★★ 帯は `position: absolute` だが、**基準点を持つ祖先が無かった。**
   *   `top: 0` は画面そのものの上端を指し、黒バーは `.hh-frame` の余白ぶん
   *   下から始まるので、**文字は黒バーの中心より余白ぶん上**に出ていた。
   *   （測定では 32px ずれていた。`--space-md` と同じ幅である。）
   *
   * ★ 再現の頁で気づけなかったのは、**基準点まで写していなかった**からである
   *   ―― 確かめる頁は、本番と**同じ入れ子**で作る（C-140）。
   */
  test('★ 帯の基準点は黒バーと同じ箱にある（高さが真ん中に揃う）', async () => {
    const css = await appCss()
    const main = /\.hh-main \{([^}]*)\}/.exec(css)
    assert.ok(main, '.hh-main の規則がある')
    assert.match(main![1]!, /position:\s*relative/,
      '基準点が無いと、帯は画面の上端を基準にして黒バーより上へずれる')
    const ref = /\.hh-criteria-ref \{([^}]*)\}/.exec(css)
    assert.match(ref![1]!, /position:\s*absolute/)
    assert.match(ref![1]!, /top:\s*0/)
  })

  test('★ 見出しを出さず、真ん中・大きめ・横送りで全件を出す（依頼者の指示）', async () => {
    // ★ 実行⑬で「流す」をやめた ―― 依頼者の指示は
    //   「評価軸は動かさなくていいので全部入るように」。
    //   流れているものは狙って読めない。**勝手に流さない**のはいまも生きている。
    // ★ 実行⑭で形が変わった ―― 依頼者の指示は
    //   「真ん中配置、文字大きめ、横スクロールにして」。
    //   折り返しをやめて1行に並べ、**送るのは利用者**にした。
    //   （折り返していた頃は軸が15本になって**天端で1行目が切れていた**。C-65）
    const shell = await read('app/_components/shell.tsx')
    // ★ 器の要素名で切り出さない（2026-08-20。C-231）。`div` + `role="region"` から
    //   `<section>` へ変えた瞬間に、この切り出しが空を返して**中身の検査が全部素通り**した。
    //   見るべきは帯そのものなので、class で位置を取る。
    const ref = shell.slice(shell.indexOf('className="hh-criteria-ref"'), shell.indexOf('{children}'))
    assert.doesNotMatch(ref, />評価基準</)
    assert.doesNotMatch(ref, /hh-criteria-step-name/)
    // ★ **自動で流す**（依頼者の指示。実行⑮。C-139）。実行⑬でいったん止めたが、
    //   依頼者の判断で戻した。流すには同じ並びを2組出して端をつなぐ。
    assert.match(ref, /\[false, true\]/, '流すには同じ並びが2組要る（継ぎ目を隠す）')
    assert.match(ref, /aria-hidden=\{copy \|\| undefined\}/,
      '2組目は写しである。読み上げが二度読まないようにする')

    const css = await appCss()
    const rule = /\.hh-criteria-ref \{([^}]*)\}/.exec(css)
    assert.ok(rule, '規則がある')
    assert.match(rule![1]!, /height:\s*var\(--bar-h\)/)
    // ★ 自動で流す（C-139）。動きの指定と、止める人のための道が**両方**要る。
    assert.match(css, /@keyframes criteria-marquee/, '流す指定が無い')
    const track = /\.hh-criteria-track \{([^}]*)\}/.exec(css)
    assert.match(track![1]!, /animation:\s*criteria-marquee/, '帯が流れていない')
    // 送り箱の中では指定した幅も縮む。縮むと1周したところで継ぎ目が飛ぶ。
    assert.match(track![1]!, /flex:\s*0 0 auto/, '流す帯を縮ませない（継ぎ目が飛ぶ）')
    assert.match(track![1]!, /width:\s*max-content/)
    assert.match(css, /animation-play-state:\s*paused/, '触れたら止まる（読ませるために流す）')
    assert.match(css, /prefers-reduced-motion[\s\S]{0,400}animation:\s*none/,
      '動きを減らす設定の人には流さない')
    const group = /\.hh-criteria-group \{([^}]*)\}/.exec(css)
    assert.match(group![1]!, /flex-wrap:\s*nowrap/, '1行に並べる（折り返さない）')
    const scroll = /\.hh-criteria-scroll \{([^}]*)\}/.exec(css)
    assert.match(scroll![1]!, /overflow:\s*hidden/, '流しているあいだは送り帯を出さない')
    assert.match(scroll![1]!, /align-items:\s*center/, '縦は真ん中に置く')
    assert.match(scroll![1]!, /justify-content:\s*safe center/,
      '収まるときは中央、溢れるときは先頭から（safe が無いと左端が掴めない）')
    // 流しを止めた人は、自分で送れる。
    assert.match(css, /prefers-reduced-motion[\s\S]{0,400}overflow-x:\s*auto/,
      '流さない人が自分で送れない')
    const axis = /\.hh-criteria-axis \{([^}]*)\}/.exec(css)
    const size = /font-size:\s*(\d+)px/.exec(axis![1]!)
    assert.ok(Number(size![1]) >= 13, `字が小さい（${size![1]}px）。依頼者の指示は「文字大きめ」`)

    // ★ 画面が**通し番号を作らない**（実行⑭）。段をまたいで 1〜15 と振ると、
    //   9番までが特別選考・10番からが最終面接なのに地続きに見える。
    //   記録に無い番号を画面で作らない。
    assert.doesNotMatch(ref, /\{i \+ 1\}/, '画面が通し番号を作っている')
    assert.doesNotMatch(ref, /\{index \+ 1\}|\bmap\(\(c, i\)/,
      '番号を作る形が別の書き方で戻っている')

    // ★ 重み付けの札（必須／加点）は**出さない**（依頼者の指示。実行⑮。C-134）。
    //   帯に出るのは**軸の名前だけ**である。
    //   ★ 見るのは**コメントを落とした本文**である ―― 「出さない」と書いた
    //     注記まで「出している」と数えると、理由を書くほど検査が落ちる。
    const shellBody = await body('app/_components/shell.tsx')
    const refBody = shellBody.slice(
      shellBody.indexOf('<div className="hh-criteria-ref"'), shellBody.indexOf('{children}'))
    assert.doesNotMatch(refBody, /必須|加点|hh-criteria-tag/, '帯に重み付けの札が戻っている')
    assert.doesNotMatch(css, /hh-criteria-tag/,
      '使わない規則を残さない（次に触る人が「まだあるもの」として扱う）')
  })

  test('★ 札を消しても、重み付けは記録層に残っている（消したのは画面だけ）', async () => {
    // 画面から消したのは**出し方**であって、事実ではない。
    // `evaluation_criteria.kind`（0033）と、それを読むクエリはそのまま効く。
    const queries = await read('src/queries/dashboard.ts')
    assert.match(queries, /ec\.kind/, '重み付けを読むのをやめてはいない')
  })

  test('★ 縦タブと横タブは同じ層（天端・厚みをそろえる。依頼者の指示）', async () => {
    const css = await appCss()
    // 帯の厚みは両方 `--logo-h`。ロゴ枠は**縮ませない**（縮むと厚みが食い違う）。
    const brand = /\.hh-brand \{([^}]*)\}/.exec(css)
    assert.match(brand![1]!, /height:\s*var\(--bar-h\)/)
    assert.match(brand![1]!, /flex:\s*0 0 auto/, 'ロゴ枠を縮ませない（67→24 に潰れていた）')
    const zoom = /\.zoom-bar \{([^}]*)\}/.exec(css)
    assert.match(zoom![1]!, /height:\s*var\(--bar-h\)/)
    // 天端をそろえる。`top` に余白を入れると縦バーだけ 16px 下がる。
    // （`.hh-sidebar` は面を塗るだけの規則が先にあるので、位置を持つほうを見る）
    const sidebar = /\.hh-sidebar \{[^}]*position:\s*sticky;\s*top:\s*([^;]+);/.exec(css)
    assert.ok(sidebar, '位置を決める規則がある')
    assert.equal(sidebar![1]!.trim(), '0', '天端は横バーと同じ（余白ぶん下げない）')
  })

  test('★ 縦バーの足元を切らない（出る手段を画面から消さない）', async () => {
    // 足元（期の切り替え・デモ札・出る）が 60px はみ出して届かなかった。
    // 送るのは**タブの並びだけ** ―― ロゴ（帯）と足元は動かさない。
    const css = await appCss()
    // ★ C-206 ―― 中で送ると、タブか入口のどちらかが必ず切れた。
    //   **柱ごと送る**（`.hh-sidebar` が送り、nav も入口も縮ませない）。
    assert.match(css, /\.hh-nav \{[^}]*flex:\s*0 0 auto/, 'タブを縮ませない')
    assert.match(css, /\.hh-sidebar \{[^}]*overflow-y:\s*auto/,
      '柱ごと送る形になっていない')
    assert.match(css, /\.hh-sidebar-foot \{[^}]*flex:\s*0 0 auto/, '足元は縮ませない')
    assert.match(css, /\.hh-nav-add \{[^}]*flex:\s*0 0 auto/, '追加の入口を縮ませない')
  })
})
