# CLAUDE.md — 開発規律

## 文書の責任

```text
.audit/        監査文書（最高権限。全てに優先する）
               AUDIT_CHARTER.md / IRREVERSIBLE_OPS.md / REMEDIATION.md / 監査意見
.consultant/   構成基準（作り方の構造。.audit/ に劣後し、以下に優先する）
               CHARTER.md / STRUCTURE.md / DIAGNOSIS.md
SUPERVISOR.md  監督判断・権限境界（上記2つを除く全てに優先）
vision.md    目的
director.md  プロダクト原則
domain.md    用語・記録モデル
CLAUDE.md    実装規律（本書）
process.md   作業手順
```

引き当てる物（読む順番には入らない）:

```text
db/DECISIONS-INDEX.md  設計判断の索引（生成物。番号から本文の行へ辿る）
db/DECISIONS.md        設計判断の本体
docs/reports/          実行①〜⑮の凍結レポート。着手時に読む物ではない
HANDOFF.md             いまの状態と、待っている判断
```

`SUPERVISOR.md` は実装担当が変更してはならない。監督官が承認した設計と
実装指示が無い場合、観察・診断から実装へ進まない。
`.audit/` は監督官も実装担当も変更できず、**監査要求は本書の条文に優先する。**
`.consultant/` は構成・工程・完了条件について本書に優先する（中身の仕様には及ばない）。
本書と食い違ったら、本書の側を直す。

同じ要件を複数文書へ複製しない。矛盾した場合は上位文書を優先し、
現行文書へ旧条文を併記せずGit履歴を参照する。

**UI の指示書は持たない**（実行⑨で `design.md` を削除した）。
画面の形は依頼者が都度指示し、**決まったことだけを本書と
`basic/DESIGN.md`（意匠トークン）に残す。** 先回りして仕様を書かない。

## 実装規律

- `basic/` は変更しない
- 適用済みマイグレーションを編集しない。新番号で追加する
- 書き込み判定は `src/commands/`、読み取りは `src/queries/` に置く
- 画面は値の受け渡しと表示に限定する
- `'use client'` は**表（`app/_components/sheet.tsx`）と追従光
  （`app/_components/glass.tsx`）の2つだけ**。増やさない（C-95 / C-104）。
  表が持つのは行の状態、追従光が持つのはポインタの座標だけで、
  判定は `src/commands/` に、見た目は CSS に置く
- 操作可能な母集団と画面に出す母集団を一致させる
- 層（権限）の判定は `src/auth/tiers.ts` の `canOpen` だけで行う。
  入口（`proxy.ts`）もタブもパンくずも同じ判定を見る（C-84）
- 個人情報やIDを結果メッセージとしてURLへ載せない
- 日付は `jst_date()` / `jst_today()` を使う
- 追記専用テーブルの訂正は打ち消し行で行う
- `app/tokens.css` は生成物。`pnpm tokens` で作る
- 実在個人情報をデモ、テスト、スクリーンショットへ使わない。ダミーは Faker(ja_JP) で作る
- **実データをリポジトリの中に置かない。** 置き場は外部（既定 `../YouthDB-private/`）で、
  解決は `scripts/intake-dir.ts` が行う。中を指す指定は拒否される。
  `.gitignore` は防壁ではなく残骸への保険である（監査 D2-01）
- 本番の状態は、自分の実行記録ではなく**本番の帳簿に聞く**
  （`schema_migrations.applied_by`。行数から段数を推測しない。C-121）

## 編集

- 現在値を更新する場合も、変更履歴を追記保存する
- 削除済み候補者は編集できない
- 必須値、参照先、形式、サイズをコマンド側で再検証する
- 確度・順位・集計値などの導出値を直接UPDATEしない
- 顔写真は画像形式と2MB上限をサーバ側でも検証する

## 完了条件

```
pnpm verify
```

型検査 → テスト → 設計判断の索引 → 構成基準 → ビルド を順に回す。**同じものが CI で走る**
（`.github/workflows/quality.yml`）。以前は3つを手で打つ規約しか無く、
強制する機械が1件も無かった。**「回した」という申告は完了の根拠にならない。**

- `pnpm verify`（途中まででよいときは `pnpm verify:fast` ＝ 型検査＋テスト）
- 画面またはSQLで結果を確認
- 単位と母集団は**画面に書かない**（依頼者の指示。C-62）。
  定義はクエリのコメントと `db/DECISIONS.md` に置く
- `db/DECISIONS.md` に理由とテストを記録し、`pnpm decisions:index` で索引を作り直す
  （索引は生成物。手で編集しない。ずれは CI が `--check` で落とす）

## 禁止

- 開発サーバ起動中の `pnpm db:reset`
- 架空データを入れる道具を、既定で `DATABASE_URL` へ向けること（C-88）
- 本番へ書き込むコマンドを実行できる塊で渡し、**渡す前の状態を前提に続けること**。
  渡した時点で、それは自分が流したのと同じである（C-121）
- 記録にない値の創作
- 単位の違う値の割り算
- 旧生態系比喩を現行UIや現行仕様の用語として使うこと
- **検査を通すために検査の側を緩めること。** 閾値を下げる、テストを消す・skip する、
  `continue-on-error` を足す、`--no-verify` を使う、allowlist を広げる ——
  いずれも禁止であり、いずれも CI で検知される
- 生成物を手で編集すること（`app/tokens.css` / `db/DECISIONS-INDEX.md`）

<!-- kurosaki:begin —— この区画は監査法人が管理する。実装セッションで編集しないこと。 -->
## 監査基盤（編集禁止）

このリポジトリには独立した監査基盤が入っている。実装を担当するAIは次を守る。

- **`.audit/` と `.githooks/` と `.github/workflows/audit.yml` を編集しない。**
  変更は `.audit/MANIFEST.sha256` との照合（D7-01）とCIのジョブBで検知され、必ず落ちる。
- **seed / fixture / テスト / デモ / スクリーンショットに実在の個人情報を使わない。**
  ダミーは `Faker(ja_JP)` で生成する。実データは git の外に置く。
- **不可逆操作を実行しない。** 一覧と承認手順は `.audit/IRREVERSIBLE_OPS.md`。
  該当する操作は提案までに留め、実行は人間が行う。
- 監査で Critical / High が出ている状態で、commit / push / マージ / デプロイへ進まない。
- 監査を通すために閾値を緩める、allowlist を広げる、`continue-on-error` を足す、
  `--no-verify` を使う —— これらはすべて禁止であり、いずれも検知される。

自分で監査を回す場合:

```
kurosaki scan  --repo .            # 個人情報・秘密の走査
kurosaki audit --repo .            # 体制監査（意見が出る）
```
<!-- kurosaki:end -->
