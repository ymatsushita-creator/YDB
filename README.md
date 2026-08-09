# YouthDB

起業家アカデミーの集客、候補者選定、選考を一元管理する運営コックピット。

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

```bash
pnpm dev --port 3111
```

## 検証

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm tokens
```

## 文書

- `director.md` — プロダクト原則
- `domain.md` — 用語と記録モデル
- `CLAUDE.md` — 実装規律
- `process.md` — 開発手順
- `db/DECISIONS.md` — 設計判断の履歴
- `HANDOFF.md` — 現在状態と次の作業

同じ要件を複数文書へ複製しない。旧要件はGit履歴と凍結報告書で確認する。

## データの扱い

- `basic/*.sql` は原典。変更しない
- 新しいDB変更は `db/migrations/` に追加する
- 実データはGitへ追加しない
- 顔写真を含む個人情報をデモやテストへ使用しない
