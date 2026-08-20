# YouthDB

起業家アカデミーの集客、候補者選定、選考を一元管理する運営コックピット。

## 着手する人（人間・AIとも）はここから

**権限を持つのは [`Hitler.md`](Hitler.md) だけである。** 他はすべて参照・手順で、
互いに上下は無い。読む順番として並べてある。

| # | 文書 | 何が書いてあるか |
|---|---|---|
| — | [`Hitler.md`](Hitler.md) | **唯一の権限。** 不可侵ルール・禁止事項・完了ゲート |
| 1 | [`.audit/`](.audit/) | 監査所見・不可逆操作の一覧・是正手順 |
| 2 | [`.consultant/`](.consultant/) | 構成・工程・ゲート・完了条件 |
| 3 | [`director.md`](director.md) | 何を守るのか（プロダクト原則・UX判断） |
| 4 | [`domain.md`](domain.md) | 何が存在するのか（用語・記録モデル） |
| 5 | [`AGENTS.md`](AGENTS.md) | **どう実装するか（実装規律の実体）** |
| 6 | [`process.md`](process.md) | どう回すか |

★ **触るディレクトリの `AGENTS.md` を先に読む**（2026-08-20。C-233。S14 が存在を強制する）。
ルートの規律より近い物が優先する（`Hitler.md` §1）。

```
app/AGENTS.md   src/AGENTS.md   src/commands/AGENTS.md   src/queries/AGENTS.md
db/AGENTS.md    scripts/AGENTS.md   tests/AGENTS.md   docs/AGENTS.md
```

**2026-08-19、多層の序列を廃止し、権限を `Hitler.md` の1段へ集約した**（依頼者指示。C-222）。
それまでは `.audit/` > `.consultant/` > `SUPERVISOR.md` > … の8層だった。旧序列は Git 履歴に残る。

同じ差分で `SUPERVISOR.md` と `vision.md` を畳んだ。前者は序列の廃止で権限の条文が空になり、
後者は枠だけで中身（理念）を最後まで受け取っていなかった。
**空の文書を序列のために置かない。** 中身は `director.md`（原則・UX判断）と
`process.md`（観察 → 診断 → 設計 → 確認）に在る。

**`Hitler.md` に無い条件は、作業を止める根拠にならない。** `Hitler.md` は監査所見も
退けられる。退けるときは `.audit/` を書き換えず（封印されており D7-01 と CI ジョブB が
落ちる）、判断と理由を `db/DECISIONS.md` に記録して進む。**所見を無かったことにはしない。**

引き当てる文書:

- [`HANDOFF.md`](HANDOFF.md) — いま何が動いていて、誰の判断を待っているか
- [`db/DECISIONS-INDEX.md`](db/DECISIONS-INDEX.md) — **`C-121` などの番号から本文へ辿る索引**（生成物）
- [`db/decisions/`](db/decisions/README.md) — **設計判断を1件ずつ開く**（生成物。`C-176` なら `db/decisions/C-176.md`）
- [`db/DECISIONS.md`](db/DECISIONS.md) — 設計判断の本体。理由とテストが書いてある。**開かない**
- [`docs/reports/`](docs/reports/) — 実行①〜⑮の凍結レポート。**着手時に読む物ではない**
  （各ファイルの先頭に凍結の但し書きがある。grepで1本だけ拾っても分かるようにしてある）
- [`basic/DESIGN.md`](basic/DESIGN.md) — 意匠トークン

`CLAUDE.md` は `AGENTS.md` へのポインタである（複製は必ず片方だけ古くなるため。C-232）。

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

**Lint** → 型検査 → テスト（899件・約4分） → **正典の組み立て** → 設計判断の索引 → **構成基準** → ビルド を順に回す。
**同じものが CI（`.github/workflows/quality.yml`）でも走る。**
以前は3つを手で打つ規約しか無く、強制する機械が1件も無かった。

途中まででよいときは:

```bash
pnpm verify:fast     # 型検査 + テストだけ（ビルドを省く）
pnpm typecheck
pnpm test
pnpm lint            # biome。規則を切って通さない（誤検知は現場ごとに理由を書く）
pnpm decisions:canon # db/decisions-src/ から db/DECISIONS.md を組み立てる
pnpm decisions:index # 追記したら回す（生成物も一緒にコミットする）
pnpm decisions:parts # 番号ごとの1件1ファイル（db/decisions/）を作り直す
pnpm structure       # 構成基準（.consultant/STRUCTURE.md の S1〜S14）だけを見る
pnpm tokens          # app/tokens.css を作り直す（basic/DESIGN.md から生成）
```

### コードで見慣れない語に出会ったら

用語の正典は [`domain.md`](domain.md)。ただし**コードには旧生態系比喩が残っている**
（`森` 179 / `林` 152 / `木` 56 箇所）。対応表は
[`docs/product/legacy-terms.md`](docs/product/legacy-terms.md) にある。
**読むための表であって、新しく書くときは使わない。**

### 画面のCSS

`app/base.css` は `@import` の並びで、実体は [`app/_styles/`](app/_styles/) の10本にある。
**取り込み順がそのままカスケードの順序である。並べ替えない。**
`app/tokens.css` は生成物（`pnpm tokens`）。手で編集しない。

### 設計判断を引く —— `db/DECISIONS.md` は開かない

`db/DECISIONS.md` は **496,136字（≒33万トークン相当）**で、どの文脈長にも入らない。
**全文を読もうとしない。** 番号から引く。

**いちばん短い道 ―― 1件を1ファイルで開く。**

```
db/decisions/C-121.md      その判断だけ（2〜12KB）。grep でも当たる
db/decisions/README.md     217件の目次
```

端末からも同じものが出る ――

```bash
pnpm decisions:show C-121        # その判断の本文だけを出す（約5,000字）
pnpm decisions:show C-95..C-96   # 範囲でまとめて
pnpm decisions:missing           # 参照されているのに本文が無い番号と、その参照元
```

コード中の `C-121` のような番号は、これで本文へ辿れる。
一覧は [`db/DECISIONS-INDEX.md`](db/DECISIONS-INDEX.md)（生成物。手で編集しない）。

★ **書くのは `db/decisions-src/` の側である**（2026-08-20。C-234）。
`db/DECISIONS.md` は原稿284本の連結＝**生成物**になった（1本あたり最大95行）。
パスは動かしていないので、番号の参照・索引・`decisions:show` は今までどおり効く。
追記したら `pnpm decisions:canon && pnpm decisions:index && pnpm decisions:parts` を回す。
`db/decisions/` も生成物。CI が3つのずれを落とす。

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
- **実データはリポジトリの中に置かない。** 置き場は `YOUTHDB_INTAKE_DIR` で指す
  （**既定値は無い。** 設定を忘れた実行は止まる）。場所の解決は
  [`scripts/intake-dir.ts`](scripts/intake-dir.ts) が行い、中を指す指定は拒否される
- 顔写真を含む個人情報をデモ・テスト・スクリーンショットへ使用しない。ダミーは Faker(ja_JP) で作る

`.gitignore` は**防壁ではない**。残骸への保険である
（完全一致指定の ignore を素通りして `.env.localecho` がコミットされた事故がある）。
