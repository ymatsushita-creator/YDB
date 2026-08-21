### C-110. ムダなコードを落とした

- `app/people/new/actions.ts` ―― 画面を表に置き換えたので**誰も通らない道**になっていた
- `getCandidateNumber`（`src/queries/intake.ts`）―― 参照 0
- `findDemoSeason` / `demoSeasonOrThrow`（`src/seed/demo_season.ts`）―― 参照 0
- 死んだ CSS 12 規則（`.task-row` / `.forest-*` / `.community-node` / `.rank-crest-*` ほか）

★ 機械で数えてから切った（`base.css` の class 207 件のうち、どこにも
出てこないものが 9 件 → 落として **0 件**）。行番号で切り、隣を巻き込んでいない。
