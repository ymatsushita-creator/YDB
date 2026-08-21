# 是正手順（2026-08-19 監査より）

この文書は監査人が書いた。**実行するのは人間。** AIは提案までしかできない
（`.audit/IRREVERSIBLE_OPS.md`）。

## 1. 最優先 —— Anthropic APIキーの失効と再発行

```
対象: .env.localecho（1行・sk-ant-api03-*** / 108文字）
状態: ローカル main の 0c9cd6e に平文でコミット済み
      origin/main（GitHub）には未到達。公開ミラーにも未到達
```

なぜコミットされたか（再発防止のため記録する）:

1. `.env.local` へ書くはずのシェルのリダイレクト先が `.env.localecho` になった
   （1行に `ANTHROPIC_API_KEY=` が2回入っているのがその痕跡）
2. `.gitignore` が `.env.local` の**完全一致**指定だったため、ずれた名前が除外されなかった
3. `git add -A` で無関係な17ファイルと一緒にコミットされた
4. commit 前に diff を確認しなかった

やること:

1. console.anthropic.com で当該キーを **revoke**、新しいキーを発行する
2. 新しいキーは **Vercel の Environment Variables** へ入れる（`vercel env add ANTHROPIC_API_KEY production`）
   —— 現在 Vercel 側に `ANTHROPIC_API_KEY` は登録されていない（`vercel env ls` で確認済み）。
   `src/ai/client.ts` は `process.env.ANTHROPIC_API_KEY` を要求するので、
   本番でAI機能を使うならここに入れる必要がある
3. ローカルでは `.env.local` にだけ置く。`.env.localecho` は**削除する**（すでに追跡からは外した）

## 2. ローカル履歴に残る平文キーの扱い

まだ push していないので、選択肢は2つある。

**A. 失効させて履歴はそのまま（推奨）**
失効済みのキーは価値を持たない。履歴改変のリスク（他の作業の巻き込み）を避けられる。

**B. push する前に履歴から除去する**
```bash
# 事前にバックアップを取ってから。履歴改変は不可逆。
git clone --mirror . ../YDB-backup.git
brew install git-filter-repo
git filter-repo --path .env.localecho --invert-paths --force
```
実行後、ローカルの参照が書き換わる。**必ず人間が確認してから push する。**

## 3. いま本番へ出せない理由（deploy-gate が拒否している）

```
送信対象 385ファイルに Critical 16 / High 134
  src/seed/demo.ts        氏名列に姓名形状の値（デモデータ）
  tests/*.test.ts         同上（テストデータ）
```

デモ・テストのデータが架空であることを機械は判定できない。どちらかを選ぶ:

- **Faker(ja_JP) で生成し直す** —— 根本的。以後この所見は出ない
- **指紋単位で `.audit/allowlist.yml` へ登録する** —— 人間が「架空である」と署名する。
  `kurosaki scan --repo . --format json` の `fingerprint` を使い、`reason` `approved_by` `expires` を付ける

## 4. リポジトリと本番の乖離

```
GitHub  origin/main = ba97158（08-16 22:19）
ローカル main        = 5784c24（08-17 18:43。未push 8件）
本番                 = 08-17 のローカル作業ツリー（40回デプロイ）
```

**本番にしか存在しないコードがある。** どちらへ寄せるかを決める:

- push してリポジトリを本番に追いつかせる（その前に 1. と 3. を済ませる）
- 本番を origin/main へ戻す（08-17 の作業が本番から消える）

以後は `pnpm deploy:production` が `kurosaki deploy-gate` を通り、
出したものが `.audit/deploys/` に追記専用で記録される。
