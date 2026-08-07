import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason } from '../../src/queries/dashboard.ts'
import { getOpenTasks, type OpenTask } from '../../src/queries/cockpit.ts'
import { Card, SeasonTabs, Empty, num } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

/**
 * パイロット（試運転）の手順。
 *
 * ★ これは機能ではない。**観測を得るための足場である。**
 *
 * Pilot Validation の制約は「観測がゼロ」であって、機能の不足ではない。
 * 開発者が気づいたことはすべて仮説にすぎず、運営が触るまで知識にならない。
 * だから**実装量あたりの学習量がいちばん大きいもの**を選んだ ――
 * 「使ってみてください」を「ここを押してください」に変える1枚である。
 *
 * 書き込みは無い。記録層も集計定義も1つも増やしていない。
 * 既存の `getOpenTasks` を読み、種別ごとに実在する1件へ直接リンクするだけ。
 *
 * 手順が終わったら消してよい。**残す価値があるのは、ここで得た観測のほう。**
 */

const STEPS: Array<{
  kind: OpenTask['kind'] | 'decide'
  title: string
  what: string
  watch: string
}> = [
  {
    kind: 'assign',
    title: '担当を決める',
    what: '面接官を1人選んで「決める」を押す',
    watch: '誰を選ぶか迷いましたか。選ぶのに必要な情報は足りていましたか',
  },
  {
    kind: 'unhold',
    title: '保留を解く',
    what: '止まっている理由を読んで「保留を解く」を押す',
    watch: '理由だけで判断できましたか。ほかに見たいものがありましたか',
  },
  {
    kind: 'evaluate',
    title: '評価する',
    what: '軸ごとに点と根拠を入れ、最後に「この評価を確定する」を押す',
    watch: '入力は面接中に間に合う速さですか。根拠は何文字くらい書きたいですか',
  },
  {
    kind: 'decide',
    title: '判定して、訂正する',
    what: '「通過にする」を押し、そのあと意図的に「不合格」へ訂正し、また戻す',
    watch: '訂正できると分かって安心しましたか。それとも押す前に確認が欲しいですか',
  },
]

export default async function PilotPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }
  const season =
    (await getSeason(db, (await searchParams).season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const tasks = await getOpenTasks(db, season.id)

  /** その種別で最初に見つかった1件。無ければ null。 */
  const pick = (kind: OpenTask['kind']) => tasks.find((t) => t.kind === kind) ?? null
  // 判定は「評価がすべて確定した応募」でしか成り立たない。いま動いている
  // 応募からは選べないので、評価する1件を辿ってもらう形にする。
  const forDecide = pick('evaluate')

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">試運転の手順（30 分）</h1>
          <p className="page-sub">
            {season.enrollment_year} 年度の実際のデータで、採用の1周を通してもらう
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id} basePath="/pilot" />
        </div>
      </div>

      <div className="section">
        <p className="callout">
          <strong>これは機能ではなく、観測を取るための手順である。</strong>
          いま分かっていないのは「何が足りないか」ではなく
          <strong>「実際にどこで手が止まるか」</strong>。
          押しながら、迷った場所とその理由を教えてほしい。
          <strong>間違った操作をしても直せる</strong>（判定は訂正できる）。
        </p>
      </div>

      <div className="section">
        <Card title="この順に押す" note="それぞれ、いま実在する1件へ直接つながっている">
          <ol className="pilot-list">
            {STEPS.map((step, i) => {
              const task = step.kind === 'decide' ? forDecide : pick(step.kind)
              return (
                <li key={step.title} className="pilot-step">
                  <div className="row-between">
                    <span>
                      <strong>{i + 1}. {step.title}</strong>
                      {task ? (
                        <>
                          {' — '}
                          <Link href={
                            step.kind === 'assign' || step.kind === 'unhold'
                              ? `/cockpit?season=${season.id}`
                              : `/applications/${task.application_id}`
                          }>
                            {task.person_name} の {task.step_name} を開く
                          </Link>
                        </>
                      ) : (
                        <span className="section-note">
                          {' '}— いまこの年度に該当する件が無い。手順 {i + 1} は飛ばす
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="section-note">やること: {step.what}</p>
                  <p className="unit-note" style={{ marginTop: 4 }}>
                    <strong>教えてほしいこと:</strong> {step.watch}
                  </p>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>

      <div className="section">
        <Card
          title="最後に、これだけ教えてほしい"
          note="ここで出たものだけが、次に作るものを決める"
        >
          <ol className="pilot-list">
            <li className="pilot-step">
              <strong>手が完全に止まった場所はどこか。</strong>
              画面の外（メモ・チャット・表計算）に書きたくなった内容があれば、
              <strong>それを何と呼んでいるか</strong>も一緒に
            </li>
            <li className="pilot-step">
              <strong>いちばんクリックが多いと感じたのはどこか</strong>
            </li>
            <li className="pilot-step">
              <strong>画面の数字で、実感と合わないものはあったか</strong>
              （件数・人数・日数・森の並び）
            </li>
            <li className="pilot-step">
              <strong>合格者が辞退したとき、いまはどこに記録しているか</strong>
              （この画面にその入口はまだ無い）
            </li>
          </ol>
        </Card>
      </div>

      <p className="footnote">
        いま {season.enrollment_year} 年度に残っているやることは {num(tasks.length)} 件。
        この手順で触るのはそのうち最大4件で、どれも訂正できる。
        書き込みが起きるのは 1〜4 の操作だけで、この画面自体は何も書かない。
      </p>
    </>
  )
}
