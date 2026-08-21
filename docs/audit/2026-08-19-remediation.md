# 監査 2026-08-19 是正 —— 実施記録と、人間が実行する残り

対象: `YouthDB @ 02aa6bd` / 元の意見: **限定付適正**（Critical 0 / High 5 / Medium 34 / Low 1）

この文書は実装セッションのAIが書いた。**AIは提案までしか行えない**
（`.audit/IRREVERSIBLE_OPS.md`）。下の「人間が実行する」節は実行していない。

---

## 0. 監査文書へ最高権限を与えた（依頼者指示）

序列を次へ変更した。**この編集自体が D7-01 で検知される**（下の 4. 参照）。

```text
.audit/  （最高権限）→ SUPERVISOR.md → vision → director → domain → CLAUDE.md → process
```

| 文書 | 変更 |
|---|---|
| `SUPERVISOR.md` | 「監査文書の最高権限」節を新設。本書は `.audit/` に対して下位と明記 |
| `AGENTS.md` | 読む順番の最上段へ `.audit/` を追加 |
| `CLAUDE.md` | 「文書の責任」の表の最上段へ `.audit/` を追加 |

---

## 1. AIが実施した是正

### D2-01（High）実データがリポジトリ内にあった → **解消**

`.gitignore` の1行だけが防壁になっていた 49MB をリポジトリの外へ移した。

| 移動元 | 移動先 |
|---|---|
| `db/private/backups/` | `../YouthDB-private/db-private/backups/` |
| `db/private/legacy-youthdb-2026-08-07/` | `../YouthDB-private/db-private/legacy-youthdb-2026-08-07/` |
| `db/private/deploy-check.env` | `../YouthDB-private/db-private/` |
| `YouthDB_DB構造説明資料_2026-08-08.pptx` | `../YouthDB-private/資料/` |
| `YouthDB_社長向け説明資料_2026-08-08.pptx` | `../YouthDB-private/資料/` |

**削除はしていない。全て移動である。**

あわせて構造を直した:

- `scripts/intake-dir.ts` —— `YOUTHDB_INTAKE_DIR` が**リポジトリの中を指したら止まる**検査を追加した。
  これが無いと「外に置く」構造が環境変数1本で崩れる。`intakeWritePath()` を追加。
- `scripts/backup-file.ts` / `scripts/db-restore.ts` / `scripts/import-legacy-2026.ts`
  —— 読み書き先を外部ディレクトリへ切り替えた。`pnpm exec tsc --noEmit` は通る。
- `.gitignore` —— `db/private/` の行を「唯一の防壁」から「残骸への保険」へ書き換えた。

### D3-06（Medium）push 先の取り違え → 既定を固定

```
git config remote.pushDefault origin
```

以後 `git push` は `origin`（非公開 `NEO-AX/YDB`）へ行く。
公開ミラー `ymatsushita-creator/YDB` へは明示指定しない限り届かない。
**ただし remote 自体の削除は行っていない**（下の 2. ）。

---

## 2. 人間が実行する（AIは実行できない）

### ① D3-05 / D3-06（High ×3）GitHub の設定

公開ミラー `ymatsushita-creator/YDB` の `main` に、必須ステータスチェックも
レビュー必須もない。**リポジトリ設定の変更は人間が行う。**

判断はどちらか:

- **公開ミラーが不要なら外す** —— これが一番短い。High 3件が同時に消える
  ```
  git remote remove mirror
  ```
  （GitHub 上のリポジトリ自体を消すかどうかは別判断。可視性の変更は
  `.audit/IRREVERSIBLE_OPS.md` の #4 に該当する不可逆操作）
- **公開先を残すなら** —— `main` に監査ジョブを required status check として設定し、
  レビュー必須にする（GitHub → Settings → Branches → Branch protection rules）

`origin=NEO-AX/YDB` のブランチ保護は **監査が確認できていない**
（`gh` がプラン制限で拒否。D3-05 は「実施できなかった手続」）。
**未検査であって、安全という意味ではない。**

### ② D7-01（Critical ×3）文書編集のマニフェスト再封印 ← **いま最優先**

上の 0. と、その後の構成改造で `SUPERVISOR.md` / `AGENTS.md` / `CLAUDE.md` /
`process.md` の**4本**を編集したため、
`.audit/MANIFEST.sha256` のハッシュと一致しなくなった。監査意見はいま
**不適正（Critical 4）** に落ちている。

これは監査基盤が正しく働いた結果である。憲章 §6-5 が挙げる事故
「AIが自分の制約文書と権限設定を書き換えられた」がまさにこの形なので、
**AIがマニフェストを更新してはならない。**

人間が行うこと:

1. 差分を自分の目で読む —— `git diff SUPERVISOR.md AGENTS.md CLAUDE.md process.md`
2. 意図した変更であることを確認し、**人間名義でコミットする**
3. 正本を貼り直す —— `kurosaki install --repo .`
   （これは ⑤ の allowlist 雛形差 D7-01 も同時に解消する）
4. `kurosaki audit --repo .` で Critical が 0 に戻ることを確認する

**もし最高権限の付与を取り消すなら**、3 の代わりに差分を戻せばよい。

### ②b `.cursor/rules/supervisor-layer.mdc` を一緒に直す（②と同時）

**独立レビューで判明。** このファイルは序列を

```
SUPERVISOR.md > vision.md > director.md > domain.md > CLAUDE.md > process.md
```

と書いており、**`.audit/` も `.consultant/` も存在しない旧序列のまま**である。
しかも `alwaysApply: true` なので、**Cursor で作業するAIには毎回この旧序列が注入される。**
いま Cursor で着手するAIは、監査が最高権限であることを知らないまま作業を始める。

このファイルは `.audit/MANIFEST.sha256` に登録されており、
実装セッションからは編集できない（`.claude/settings.json` の deny + D7-01）。
**② の再封印のときに、中身も3層序列へ直すこと。**

### ②c 品質ゲートを保護対象に加える（②と同時。**構造的に最も重い**）

独立レビューの指摘:

> 「品質ゲートを作ったAI自身が、そのゲートを消せる」

`.audit/` `.githooks/` `audit.yml` は MANIFEST 封印と CI ジョブB で守られているが、
**品質側には不可侵性が一切ない。** 次のファイルは、実装セッションのAIが自由に消せる。

```
.github/workflows/quality.yml     品質CI
scripts/check-structure.ts        構成基準の検査
scripts/test-preflight.ts         テストが実際に走ることの確認
.claude/settings.json             危険操作の deny
.consultant/                      構成基準そのもの
```

人間が判断すること —— 次のどれを採るか:

1. **`.audit/MANIFEST.sha256` に上記を加える**（`kurosaki install` の雛形側の変更が要る。監査人と相談）
2. **`audit.yml` ジョブBの監視リストに加える**（`git diff --name-only ... -- .audit .githooks audit.yml` の行）
   —— `audit.yml` は封印されているので、これも人間の作業
3. **GitHub のブランチ保護で `quality` を required status check にする**（②d と同じ）

現状は 3 すら未設定であり、**品質ゲートは「消せるうえに、落ちてもマージできる」状態**である。

### ②d `quality` を required status check にする

設定するまで、CI が赤でもマージできる（D3-05 と同じ穴）。

### ③ D6-01（Medium ×30）allowlist への署名

30 所見・指紋 33 件を1行ずつ原本と突き合わせた。**個人データは1件も無い。**

| 検出値 | 実体 |
|---|---|
| 書類選考 / 最終面接 / 応募受付 / 特別選考 / 一次面接 / 書類審査 | 選考段の名前 |
| イベント / 紹介 / 学校連携 / メール / 電話 / 対面 / 学校訪問 / 検索 / スカウト | 流入チャネルの名前 |
| 笑顔 / リスペクト / 前提超越 / 熱量 / 地頭力 / 論理力 | 最終面接の評価軸 |
| 学校未記録 | `schools` のプレースホルダ（`0023` のコメントに明記） |
| 架空太郎 / 架空大学 / 架空高専 / 架空商業 / 架空表団体 / 窓口 太郎 | 既に架空と明示されたテスト値 |
| 検査用 | テスト用の Vercel プロジェクト名 |
| 2007-05-05 / 2006-04-05 | 架空太郎の生年月日 |

`scripts/import-legacy-2026.ts:304` に至っては `JOIN seasons se ON ...` という
純粋なSQLで、値ですらない。

ルール名は `JP_PERSON_NAME_**WEAK**`、理由欄も「表が人物表と断定できず（**要確認**）」であり、
確定検知ではなく確認要求である。**ここを Faker の氏名へ置換すると製品が壊れる**
（「書類選考」という段が実在の段名だから）。

したがって `.audit/REMEDIATION.md` §3 の後者 ——「指紋単位で allowlist へ登録し、
**人間が架空であると署名する**」—— が正しい処理になる。

貼り付け用の断片を用意した: **`docs/audit/2026-08-19-allowlist-additions.yml`**

1. 中身を自分の目で確認する（上の表と `git grep` で裏を取る）
2. `approved_by:` の `TODO` を自分の名前と確認日に**自分で書き換える**
3. `.audit/allowlist.yml` の `allow:` の末尾へ貼る
4. `kurosaki scan --repo .` で 0 件になることを確認する

**AIは署名できない。** 納得できない行は貼らずに残してよい。

### ④ D2-02（Medium）追跡下の production seed 8件 —— 判断が要る

```
db/seeds/0002_season_2026.production.sql        db/seeds/0006_season3_align_to_season2.production.sql
db/seeds/0003_season_2027.production.sql        db/seeds/0007_season3_target.production.sql
db/seeds/0005_season2_special_selection.production.sql  db/seeds/0008_group_interview_criteria.production.sql
```

監査自身が「**人物データは検出されず**」と書いている。中身は期・段・評価軸・
書類選考の配点という参照マスタで、`scripts/db-migrate-production.ts` と
`scripts/pilot-db.ts` と `scripts/simulate-selection.ts` が読んでいる。

**追跡から外すと本番マイグレーションとパイロットDBの再現性が失われる。**
機械的に外すのは害の方が大きいと判断し、AIの判断では実行していない。
選択肢は2つ:

- **追跡下に残す** —— 人物データが無いことを根拠に、Medium を限定事項として引き受ける
- **外す** —— 参照マスタの入手経路を別に用意してから外す（外部ディレクトリ or 生成スクリプト）

### ⑤ D7-01（Medium）allowlist が雛形より古い

`kurosaki install --repo .` で解消する。② の 3 と同じ操作なので、一緒に済む。

### ⑥ D6-01（Medium）検査できない7ファイル

`public/brand/*.png`（ロゴとアイコン）。人物は写っていないが、機械には判定できない。
「安全だと言っていない」という記録であり、放置してよいなら記録のまま残す。

### ⑦ D5-03（High）本番へ出した記録が0件

**過去分は復元できない。** `pnpm deploy:production` は既に `kurosaki deploy-gate` を
通る構成になっているので、**次のデプロイから記録が残る。** ここは作業ではなく、
「以後そこを通す」という運用の確認である。

---

## 3. いまの状態

```
実施前  Critical 0 / High 5 / Medium 34 / Low 1   限定付適正
現在    Critical 4 / High 4 / Medium 34 / Low 1   不適正
              ↑ ②の文書編集（未封印）  ↑ D2-01 が消えた
```

**Critical が残っている間は commit / push / マージ / デプロイへ進まない**
（`SUPERVISOR.md` の「監査文書の最高権限」／`.audit/AUDIT_CHARTER.md` §4）。
まず ② を済ませること。
