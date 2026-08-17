import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { freshDb } from '../src/db/testing.ts'
import { all } from '../src/db/client.ts'
import { DECIDE_CODE_MESSAGE } from '../src/commands/decide.ts'
import { gateOfScores } from '../src/queries/document_screening.ts'

/**
 * 平社員ペルソナのパイロット試験で見つけた詰まりの見張り（C-216）。
 *
 * 依頼者の指示（実行⑱）――「概要を理解していない社員が触る際、選考フロー、
 * イベント、名前検索などをどう使うかを確かめたい。選考を行う平社員の
 * ペルソナを5人作って、2期生のデータを使って、同時に模擬選考を行う」。
 *
 * ★ 画面を実際に触って見つけたものだけを固定する。**先回りして仕様を書かない。**
 */

const src = (rel: string) =>
  readFile(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('平社員が詰まった所（C-216）', () => {
  /**
   * ★★ これが最も重い1件だった ――
   *   0005 が「特別選考」を先頭へ入れて 0002 の段を1つずつ後ろへずらしたのに、
   *   一覧のタブは `sort_order` の数字を直に持ったままだった。
   *   結果、**「書類選考」タブに特別選考、「2次選考」タブに書類選考**が出て、
   *   書類選考の段に居る候補者はどのタブにも見えなかった。
   */
  test('★ 一覧のタブは段を名前で引く（並び順で引かない）', async () => {
    const s = await src('app/borderline/page.tsx')
    assert.match(s, /stepName: '書類選考'/, '書類選考のタブが段名で引かれていない')
    assert.match(s, /stepName: 'グループ面接'/, '2次選考のタブが段名で引かれていない')
    assert.match(s, /stepName: '最終面接'/, '最終選考のタブが段名で引かれていない')
    assert.doesNotMatch(s, /stepOrder/,
      '並び順で引く形が残っている ―― 段の編成が変わるとまたずれる')
  })

  test('★ タブが名指しする段は、2期・3期に実在する', async () => {
    const db = await freshDb({ seeds: 'production' })
    const names = await all<{ cohort_number: number; name: string }>(db, `
      SELECT se.cohort_number, ss.name
        FROM selection_steps ss
        JOIN seasons se ON se.id = ss.season_id AND NOT se.is_demo
       WHERE se.cohort_number IN (2, 3)`)
    for (const cohort of [2, 3]) {
      const inCohort = names.filter((r) => Number(r.cohort_number) === cohort)
        .map((r) => r.name)
      for (const tabStep of ['書類選考', 'グループ面接', '最終面接']) {
        assert.ok(inCohort.includes(tabStep),
          `${cohort}期に「${tabStep}」の段が無い ―― タブが空振りする`)
      }
    }
    await db.close()
  })

  /**
   * ★ 「今日やること」という画面は無い。通過の知らせがそこへ人を送っていた。
   *   平社員は探して見つけられなかった。**無い場所へ人を送らない。**
   */
  test('★ 通過の知らせが、存在しない画面を名指ししない', async () => {
    assert.doesNotMatch(DECIDE_CODE_MESSAGE.advanced, /今日やること/)
    assert.match(DECIDE_CODE_MESSAGE.advanced, /通常選考/,
      '次にどこを見るのかが書かれていない')
  })

  /**
   * ★ 面接の一覧に出るのは**点が付いた軸の数**である（`scored_criteria`）。
   *   見出しが「点」だと、8/10 点の応募が「4 / 4」＝満点に見える。
   */
  test('★ 軸の数を「点」と書かない（面接一覧・人の詳細）', async () => {
    for (const f of ['app/interviews/page.tsx', 'app/people/[id]/page.tsx']) {
      const s = await src(f)
      assert.doesNotMatch(s, /<th className="num">点<\/th>/,
        `${f} が軸の数を「点」として出している`)
      assert.match(s, /採点した軸/, `${f} に軸の数の見出しが無い`)
    }
  })

  /**
   * ★ 平社員（personal）は特別選考を開けない（`canOpen`）。
   *   開けない画面をパンくずに常設すると、押した瞬間にホームへ弾かれる。
   */
  test('★ 開けない画面をパンくずに常設しない（層で出し分ける）', async () => {
    for (const f of ['app/people/page.tsx', 'app/people/[id]/page.tsx']) {
      const s = await src(f)
      assert.match(s, /canOpen\(tier, '\/headhunting'\)/,
        `${f} が層を見ずに特別選考へのパンくずを出している`)
      assert.match(s, /'通常選考'/, `${f} に平社員の戻り先が無い`)
    }
  })

  /**
   * ★ 期はタブより上の層。人の画面へ入って戻ったときに落ちると、
   *   2期の候補者が消えたように見える（`Shell` の注記と同じ理由）。
   */
  test('★ 人の画面は、来た期を持ち回る', async () => {
    const detail = await src('app/people/[id]/page.tsx')
    assert.match(detail, /searchParams/, '人の詳細が期を受け取っていない')
    assert.match(detail, /seasonId=\{seasonId\}/, '人の詳細が期をタブへ渡していない')
    assert.match(detail, /name="season"/,
      '「選考を始める」が期を持ち回っていない（押した後に期が戻る）')

    const search = await src('app/people/page.tsx')
    assert.match(search, /\/people\/\$\{p\.person_id\}\?season=\$\{season\.id\}/,
      '人を探す画面のリンクが期を落としている')

    const action = await src('app/people/[id]/actions.ts')
    assert.match(action, /season=\$\{seasonRaw\}/,
      '選考開始後の戻り先が期を落としている')
  })

  /**
   * ★ 段のタブは、候補者が居ても「この段には居ない」だけで空になる。
   *   そこで「1人も居ない」と書くと、確度順に15人居るのに0人だと読める。
   */
  test('★ 段のタブの空表示が、母集団0と読めない', async () => {
    const s = await src('app/borderline/page.tsx')
    assert.match(s, /この段に候補者が居ない/, '段のタブ用の空表示が無い')
    assert.match(s, /選考は「1\. 確度順候補者リスト」/,
      '選考を始める場所が空表示に書かれていない（行き止まりになる）')
  })

  /**
   * ★ 一覧は採点する対象しか出さない（確定した評価は消える）。
   *   消えた分を黙って落とさず、判定待ちの件数として言う。
   */
  test('★ 確定して一覧から消えた分を、件数で言う', async () => {
    const s = await src('app/borderline/page.tsx')
    assert.match(s, /awaitingDecision/, '判定待ちの件数を数えていない')
    assert.match(s, /確定済み・判定待ちが/, '判定待ちの件数が画面に出ていない')
    // タブに載らない段の件数。元からの決めごとだが、実装が抜けていた。
    assert.match(s, /タブに無い段:/, 'タブに載らない段が黙って隠れている')
  })
})

/**
 * 書類選考の門を、採点シートの数字から出す（C-216 / C-212）。
 *
 * ★ 依頼者の指示は「10点満点で、7点以上を通して。それ以外は要注意ラベル」。
 *   第1周のペルソナ試験では、4軸に点を入れ切っても合計も閾値も画面に無かった。
 */
describe('採点シートの合計と門（C-216）', () => {
  test('★ 満点は記録から数える（定数を書き写さない）', () => {
    const g = gateOfScores([
      { score: 4, scale_max: 4 }, { score: 2, scale_max: 2 },
      { score: 2, scale_max: 2 }, { score: 2, scale_max: 2 },
    ])
    assert.equal(g.scaleMax, 10)
    assert.equal(g.score, 10)
    assert.equal(g.verdict, 'pass')
  })

  test('★ 7点で通り、6点は要注意', () => {
    assert.equal(gateOfScores([
      { score: 3, scale_max: 4 }, { score: 2, scale_max: 2 },
      { score: 1, scale_max: 2 }, { score: 1, scale_max: 2 },
    ]).verdict, 'pass', '7点が通っていない')
    assert.equal(gateOfScores([
      { score: 2, scale_max: 4 }, { score: 2, scale_max: 2 },
      { score: 1, scale_max: 2 }, { score: 1, scale_max: 2 },
    ]).verdict, 'watch', '6点が要注意になっていない')
  })

  test('★ 点が揃っていない間は「要注意」にしない（採点中）', () => {
    const g = gateOfScores([
      { score: 3, scale_max: 4 }, { score: 2, scale_max: 2 },
      { score: 1, scale_max: 2 }, { score: null, scale_max: 2 },
    ])
    assert.equal(g.verdict, 'incomplete', '読む前に落ちて見える')
    assert.equal(g.score, 6, '付いた点だけを足していない')
    assert.equal(g.scaleMax, 10, '満点は軸の合計である')
  })

  test('★ 採点シートが合計と閾値を出している', async () => {
    const s = await src('app/_components/scoring.tsx')
    assert.match(s, /gateOfScores/, '採点シートが合計を出していない')
    assert.match(s, /点以上で人が読む段へ通す/, '閾値が画面に出ていない')
  })
})

/**
 * 終わった応募の空のシートを、面接の一覧に出さない（C-216）。
 *
 * ★ 判定を訂正して不合格にすると、先に作られていた次の段の評価行が残る。
 *   それが「未割当・0/4・書く」として並び、押しても採点できなかった。
 */
describe('触れない幽霊行を出さない（C-216）', () => {
  test('★ 面接の一覧は、終わった応募の空シートを外す', async () => {
    const s = await src('src/queries/interview.ts')
    assert.match(s, /v_active_applications/,
      '面接の一覧が、終わった応募を落としていない')
    assert.match(s, /s\.id IS NOT NULL\s*\n\s*OR EXISTS/,
      '書き終えたシートまで落としている（過去の記録が読めなくなる）')
  })
})
