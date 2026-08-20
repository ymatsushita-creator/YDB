### C-38. デプロイ先が決まった ―― マネージド Postgres（Supabase）。PostgreSQL アダプタを実装した

実行⑧。止まっていた3件（`HANDOFF.md` 5節）のうち1件（デプロイ先）に、
依頼側から回答があった。`docs/pilot/DEPLOY-READINESS.md` 4節は
Option A（1台＋永続ディスク）を推奨していたが、**依頼側は Option B
（マネージド Postgres）を選んだ。** 費用と運用体制の判断であり、
推奨はあくまで見立てだったので、そのまま従う。

#### pg アダプタ（`src/db/postgres.ts`）

`Db` インターフェイスは `query`/`exec`/`close` の3つだけなので、
差し替えは `src/db/server.ts` の該当箇所（元から「throw する」と
書かれていた場所）に閉じた。`exec` はパラメータ無しの `query()` が
simple query protocol を使う性質を利用し、PGlite の `exec` と同じく
`;` 区切りの複数文をそのまま流せる。

#### 直接接続は IPv6 専用で届かなかった。プーラーへ切り替えた

Supabase の直接接続ホスト（`db.<ref>.supabase.co`）は AAAA レコードしか
持たない。開発機に IPv6 の外向き経路が無く `ENOTFOUND` になった。
Connection Pooler（Supavisor）は IPv4 で届く上、サーバレスでの
コネクション数管理にも向くため、そもそも Pilot の構成としてはこちらが正しい。

Session pooler（5432）と Transaction pooler（6543）の2つがあり、
**Session pooler を選んだ。** セッション単位の `SET`（後述のタイムゾーン
設定）がトランザクションをまたいで保持される保証が要るため。
Transaction pooler はコネクション数をさらに絞れるので、
Pilot の規模で問題が出たら見直す（Technical Debt）。

#### `SET` を接続イベントで投げると競合した

最初は `Pool` の `'connect'` イベントで `SET TimeZone = 'Asia/Tokyo'` を
fire-and-forget していたが、プールがそのクライアントを次のクエリに
使い回すタイミングと競合し、「client.query() が実行中にまた呼ばれた」という
非推奨警告（pg 9 系で削除予定）が出た。起動パラメータ
（`options: '-c TimeZone=Asia/Tokyo'`）に切り替えて解消した。
**目視ではなく、実接続に対して `tests/00_environment.test.ts` を
走らせて再現・修正・再確認した。**

#### 環境テストを実接続に対しても走らせる形にした

`tests/00_environment.test.ts` の元のコメントは「本番へ初めて適用する前に、
同じ検査を本番の接続に対して走らせること」と書いていたが、手順が無かった。
`DATABASE_URL` が設定されていれば同じ検査を Supabase 接続に対しても
実行する形にした。実測（Session pooler 経由）: PostgreSQL 17.6、
`gen_random_uuid()`・`UNIQUE NULLS NOT DISTINCT`・式インデックス・
セッション TZ 依存のすべてを確認できた。

#### 本番マイグレーション導線（`scripts/db-migrate-production.ts`）

`db:reset` は全消しなので本番には使えない。`migrate()` と `seed()` だけを
呼ぶ導線を別に作った。**何も消さない。** 2回実行して冪等性を確認した ――
1回目: マイグレーション15件・シード2件を適用。2回目: マイグレーションは
0件（チェックサム一致でスキップ）、シードは再実行されたが `seasons` の
行数は1のまま。参照データが再投入に耐える設計（`migrate.ts` の想定通り）
であることも合わせて確認できた。

実行結果は、D-8 で確定した2026年度シードそのものが Supabase 上に
入っていることを実接続の SQL で確認した ―― 2026年度・定員36・
4ステップ・6軸。**実データ（社長の DB）はまだ入っていない。**
生年月日の欠落（HANDOFF.md 5節）は未解決のまま。

#### `db:reset` の事故防止（`DEPLOY-READINESS.md` B-3）

`DATABASE_URL` が設定された環境では拒否する。加えて、開発サーバ
（`next dev`, port 3111）が起動中なら拒否する ―― PGlite の dataDir には
プロセス間ロックが無く、これまで実際に2回壊れている（`HANDOFF.md`）。
ポート監視は `scripts/guard.ts` に切り出した。

#### 確かめ方

`tests/00_environment.test.ts`（`DATABASE_URL` 設定時は Supabase 接続に
対しても同じ5件を実行）、`tests/27_deploy_readiness.test.ts`
（ポート衝突検査2件）。`pnpm test`・`tsc --noEmit`・`pnpm build` を確認した。

★ 残るもの（TODO(MVP)）。**Supabase CLI（`supabase init` / `link`）は
未実行。** 認証などで今後 Supabase の機能を使うなら要るが、今回の
pg 接続そのものには不要だったため後回しにした。`DEPLOY-READINESS.md`
5節の残り6項目（バックアップ・認証・DB分離・エラー確認方法・E2E）は
未着手のまま。**これは Pilot Go ではない。** デプロイ先以外の
ブロッカー（実データの生年月日・運営4名の日程）もそのまま残っている。

---
