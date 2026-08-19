# YouthDB

起業家アカデミーの集客、候補者選定、選考を一元管理する運営コックピット。

## 着手する人（人間・AIとも）はここから

読む順番は決まっている。**上が下に優先する。**

| # | 文書 | 何が書いてあるか |
|---|---|---|
| 0 | [`.audit/`](.audit/) | **最高権限。** 監査基準・不可逆操作・是正手順。ここに反する実装はしない |
| 0.5 | [`.consultant/`](.consultant/) | **第2層。** 構成・工程・ゲート・完了条件。中身の仕様には及ばない |
| 1 | [`SUPERVISOR.md`](SUPERVISOR.md) | 誰が設計・実装を許可するか（権限境界） |
| 2 | [`vision.md`](vision.md) | なぜ存在するのか |
| 3 | [`director.md`](director.md) | 何を守るのか（プロダクト原則） |
| 4 | [`domain.md`](domain.md) | 何が存在するのか（用語・記録モデル） |
| 5 | [`CLAUDE.md`](CLAUDE.md) | **どう実装するか（開発規律の正典）** |
| 6 | [`process.md`](process.md) | どう回すか |

引き当てる文書:

- [`HANDOFF.md`](HANDOFF.md) — いま何が動いていて、誰の判断を待っているか
- [`db/DECISIONS-INDEX.md`](db/DECISIONS-INDEX.md) — **`C-121` などの番号から本文へ辿る索引**（生成物）
- [`db/DECISIONS.md`](db/DECISIONS.md) — 設計判断の本体。理由とテストが書いてある
- [`docs/reports/`](docs/reports/) — 実行①〜⑮の凍結レポート。**着手時に読む物ではない**
  （各ファイルの先頭に凍結の但し書きがある。grepで1本だけ拾っても分かるようにしてある）
- [`basic/DESIGN.md`](basic/DESIGN.md) — 意匠トークン

`AGENTS.md` は `CLAUDE.md` へのポインタである（複製は必ず片方だけ古くなるため）。

`.audit/`（黒崎＝独立監査）と `.consultant/`（コンサル＝分析・実働）は役割が違う。
監査は「出してはならない物が出ていないか」、コンサルは「速く安全に回る構造か」を見る。
**食い違えば監査が勝つ。** 詳細は [`.consultant/CHARTER.md`](.consultant/CHARTER.md)。

## 3つの画面

- `/headhunting` — 誰に声を掛けるか。候補者情報・顔写真・状態を編集可能
- `/borderline` — 誰を通すか。担当、評価、保留、判定を操作
- `/approach` — どのアプローチ可能圏から関係を作るか

補助画面は上記3つの配下に属する。

## 用語

- **アプローチ可能圏** — 継続的に接触できる大学、団体、企業、イベント等
- **構成コミュニティ** — 圏を構成する具体的な組織
- **接点継続中** — 判定窓内に接点がある実人数
- **応募 / 合格** — 応募件数

適用済みSQLの `forest` / `community` は内部互換識別子であり、UI用語ではない。

## 起動

```bash
pnpm install
pnpm db:reset
pnpm dev:demo
```

デモ: `http://localhost:3112`

通常の開発サーバは `.env.local` の `DATABASE_URL` を使用する。
必要な環境変数は [`.env.example`](.env.example) にある（値は入っていない）。

```bash
pnpm dev --port 3111
```

## 検証 —— 完了条件はこの1本

```bash
pnpm verify
```

型検査 → テスト（887件・約3分） → 設計判断の索引 → **構成基準** → ビルド を順に回す。
**同じものが CI（`.github/workflows/quality.yml`）でも走る。**
以前は3つを手で打つ規約しか無く、強制する機械が1件も無かった。

途中まででよいときは:

```bash
pnpm verify:fast     # 型検査 + テストだけ（ビルドを省く）
pnpm typecheck
pnpm test
pnpm decisions:index # DECISIONS.md に追記したら回す（生成物も一緒にコミットする）
pnpm structure       # 構成基準（.consultant/STRUCTURE.md の S1〜S12）だけを見る
pnpm tokens          # app/tokens.css を作り直す（basic/DESIGN.md から生成）
```

### 画面のCSS

`app/base.css` は `@import` の並びで、実体は [`app/_styles/`](app/_styles/) の10本にある。
**取り込み順がそのままカスケードの順序である。並べ替えない。**
`app/tokens.css` は生成物（`pnpm tokens`）。手で編集しない。

### 設計判断を引く —— `db/DECISIONS.md` は開かない

`db/DECISIONS.md` は **496,136字（≒33万トークン相当）**で、どの文脈長にも入らない。
**全文を読もうとしない。** 番号から引く。

```bash
pnpm decisions:show C-121        # その判断の本文だけを出す（約5,000字）
pnpm decisions:show C-95..C-96   # 範囲でまとめて
pnpm decisions:missing           # 参照されているのに本文が無い番号と、その参照元
```

コード中の `C-121` のような番号は、この道具で本文へ辿れる。
一覧は [`db/DECISIONS-INDEX.md`](db/DECISIONS-INDEX.md)（生成物。手で編集しない）。

**45件が「参照されているのに本文が無い」状態にある。** 実行⑯・⑰が報告書も
設計判断も残さずに終わったためで、`pnpm decisions:missing` が参照元のコードから
手がかりを集める。**埋められるのは、その判断を下した人間だけである。**

## ゲート —— 何が止めるか

| 段 | 何を見るか | 実体 |
|---|---|---|
| pre-commit | 個人情報・秘密・監査基盤の改変 | `.githooks/pre-commit`（監査法人の管轄） |
| pre-push | 同上 ＋ 保護ブランチへの強制push | `.githooks/pre-push`（同上） |
| CI: audit | 個人情報・体制監査 | `.github/workflows/audit.yml`（同上） |
| CI: quality | **型検査・テスト・索引・構成基準・ビルド** | `.github/workflows/quality.yml` |
| 構成基準 | ルート・索引・deny・役割分離・実データ・検査の迂回・履歴の秘密・`docs/` の分類・凍結の但し書き | `pnpm structure`（`.consultant/STRUCTURE.md` の S1〜S12） |
| deploy | 送る物の検査と出所の記録 | `kurosaki deploy-gate`（`pnpm deploy:production` の前段） |

`.audit/` `.githooks/` `audit.yml` は監査法人の管轄で、**実装セッションからは変更できない**
（変更は `.audit/MANIFEST.sha256` の照合とCIジョブBで必ず検知される）。

## データの扱い

- `basic/*.sql` は原典。変更しない
- 新しいDB変更は `db/migrations/` に追加する（適用済みは編集しない。新番号で足す）
- **実データはリポジトリの中に置かない。** 置き場は外部ディレクトリ（既定 `../YouthDB-private/`）で、
  場所の解決は [`scripts/intake-dir.ts`](scripts/intake-dir.ts) が行う。中を指す指定は拒否される
- 顔写真を含む個人情報をデモ・テスト・スクリーンショットへ使用しない。ダミーは Faker(ja_JP) で作る

`.gitignore` は**防壁ではない**。残骸への保険である
（完全一致指定の ignore を素通りして `.env.localecho` がコミットされた事故がある）。
