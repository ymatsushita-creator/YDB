# app/ —— 画面

```
pnpm dev:demo
```

```
pnpm verify
```

- **判定を書かない。** 値の受け渡しと表示だけ。書き込み判定は `src/commands/`、読み取りは `src/queries/`。
- `'use client'` は**表（`_components/sheet.tsx`）と追従光（`_components/glass.tsx`）の2つだけ**（C-95 / C-104）。増やさない。
- 意匠の正典は `basic/DESIGN.md`。色・余白・角丸をここで決めない。
- CSS は `_styles/01〜10` に分割済み。**取り込み順＝カスケード順**なので、番号を入れ替えない（`base.css` が `@import` する）。
- `tokens.css` は生成物。`pnpm tokens` で作る。手で編集しない。
- 層の判定は `src/auth/tiers.ts` の `canOpen` だけ。タブもパンくずも同じ判定を見る（C-84）。
- 単位と母集団を画面に書かない（C-62）。定義はクエリのコメントと `db/DECISIONS.md` に置く。
- 個人情報やIDを結果メッセージとして URL へ載せない。
- 一覧の `key` に配列の添字を使わない（`pnpm lint` が落とす）。記録の値から組む。
