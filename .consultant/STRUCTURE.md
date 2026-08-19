# 構成基準 —— この形を保つ

`CHARTER.md` の原則を、**このリポジトリで機械が確かめられる条件**に落としたもの。
`consultant analyze` の C01〜C07 は「在るか」しか見ないので、その先をここで定める。

崩れたら直す。**基準の側を緩めない。**

## この基準は機械が確かめる

```
pnpm structure      # 単体で回す
pnpm verify         # 完了条件の一部として回る（typecheck → test → 索引 → 構成 → build）
```

実体は `scripts/check-structure.ts`。下の各節の見出しに付いた `S1`〜`S7` が検査IDで、
1つでも破れば **exit 1** になる。CI（`.github/workflows/quality.yml`）でも走る。

外部ツール `consultant analyze`（C01〜C07）は解決できたときだけ走る。
CI からは外部リポジトリを解決できないので**実行されない**。
そのとき検査は「未実行」と明記して通す —— **「問題なし」とは言わない**（`CHARTER.md` §1）。
CI が必ず強制するのは S1〜S7 である。

道具の位置は `.consultant/TOOL_PATH` に固定してある（`.audit/TOOL_PATH` と同じ形）。

## 1. 完了条件は1本のコマンドである〔S1・S1b〕

```
pnpm verify   =  typecheck → test → decisions:index --check → structure → build
```

- 完了条件を人間やAIが手で打つ規約にしない。**打ち忘れは必ず起きる。**
- 同じものが CI（`.github/workflows/quality.yml`）で走る。
  **ローカルで通ったという申告は根拠にならない。**
- `quality.yml` を `audit.yml` に合流させない。`audit.yml` は監査法人の管轄で
  `.audit/MANIFEST.sha256` に封印されており、実装側の都合で触ると CI ジョブB が落とす。

**残っている穴**: `quality.yml` は required status check に設定されていない。
設定するまで、CI が落ちてもマージできる。設定は人間が行う（監査 D3-05 と同じ話）。

## 2. ルートは着手時に読む物だけを置く〔S2〕

ルート直下の `.md` は次の9本に限る。

```
README.md      着手導線（ここから読む）
AGENTS.md      CLAUDE.md へのポインタ
SUPERVISOR.md  vision.md  director.md  domain.md  CLAUDE.md  process.md   規律の階層
HANDOFF.md     いまの状態
```

- 実行レポートは `docs/reports/`。**着手時に読む物ではない。**
  2026-08-19 時点で35本・7,733行あり、これがルートにあると
  規律文書がその6倍の量のノイズに埋もれる。
- 凍結した文書を現行文書と同じ場所に置かない。

## 3. 番号で参照する物には索引を置く〔S3〕

- `db/DECISIONS.md` の `C-121` 形式は、コード内コメント・`CLAUDE.md`・
  コミットメッセージから参照される。→ `db/DECISIONS-INDEX.md`（生成物）。
- 生成物は手で編集しない。**道具の側を直す**（`scripts/build-decisions-index.ts`）。
- ずれは CI が `--check` で落とす。追記したら索引も一緒にコミットする。
- 番号の重複は**黙って振り直さない。** git 履歴側の参照は後から直せない。
  索引の先頭に掲げ、どちらを正とするかは人間が決める。

## 4. 危険操作は設定で落とす〔S4〕

`.claude/settings.json` の `deny` に置く。**AIの自制に頼らない。**

| 対象 | 理由 |
|---|---|
| `.env` / `.env.*` の読取 | 平文の秘密。過去に APIキーがコミットされた事故がある |
| `../YouthDB-private/**` / `.pgdata/**` の読取 | 実在の候補者データ。文脈に入れない |
| `.audit/` `.githooks/` `audit.yml` の編集 | 監査法人の管轄。触れば CI ジョブB が落とす |
| `basic/**` の編集 | 受領原典 |
| `git push` / `filter-repo` / `filter-branch` / `--no-verify` | 不可逆または検査の迂回 |
| 本番系（`deploy:production` / `db:migrate:production` / `db:restore` / `vercel`） | `.audit/IRREVERSIBLE_OPS.md` の管轄。実行は人間 |

`ask` は、取り返しはつくが範囲が広い操作に使う（`git commit` / `db:reset` / `import:*`）。

## 5. 役割を分ける〔S5〕

| 資産 | 役割 |
|---|---|
| `.claude/agents/investigator.md` | 着手前の観察と診断。**実装しない** |
| `.claude/agents/reviewer.md` | 完了後の独立審査。**編集しない。実装者の申告を根拠にしない** |
| `.claude/commands/plan.md` | 着手前の計画（観察→診断→計画）。**実装しない** |
| `.claude/commands/verify.md` | 完了条件を回す |
| `.claude/commands/structure.md` | 構成基準を確かめ、崩れを直す |
| `.claude/commands/audit.md` | 監査を回し、所見をAI可・人間のみ・誤検知の3つに分ける |
| `.claude/commands/handoff.md` | `HANDOFF.md` を実測で書き直す |

反復する手順を毎回自然言語から組み立て直さない。2回やったら資産にする。

## 6. 実データはリポジトリの外にある〔S6〕

- 置き場は外部ディレクトリ（既定 `../YouthDB-private/`）。
  解決は `scripts/intake-dir.ts` が行い、**リポジトリ内を指す指定は拒否する。**
- `.gitignore` は防壁ではない。残骸への保険である
  （完全一致指定の ignore を素通りして `.env.localecho` がコミットされた）。
- 環境変数の契約は `.env.example` に置く。**値は書かない。**

## 7. 検査を通すために検査を緩めない〔S7〕

**本節がこの禁止事項の正典である。** 他の文書は同じ条文を複製せず、ここを参照する
（`CLAUDE.md`「同じ要件を複数文書へ複製しない」）。


閾値を下げる、テストを消す・skip する、`continue-on-error` を足す、
`--no-verify` を使う、allowlist を広げる —— すべて禁止。いずれも CI で検知される。

**誤検知だと判断した場合も同じ。** 実体を原本の行と突き合わせて表で示し、
指紋単位で allowlist へ登録する。**`approved_by` への署名は人間だけが行える。**
