---
name: "source-command-verify"
description: "完了条件（型検査・テスト・索引・構成基準・ビルド）を回し、落ちたら原因を直す"
---

# source-command-verify

Use this skill when the user asks to run the migrated source command `verify`.

## Command Template

`pnpm verify` を実行する。

落ちたら、**通すために検査を緩めない。** 原因を直す
（禁止事項の正典: `.consultant/STRUCTURE.md` §7）。

途中経過ではなく、最後に次を報告する:

- 型検査 / テスト（何件中何件） / 索引 / 構成基準 / ビルド のそれぞれの結果
- 落ちた場合、**何が原因で、どう直したか**
- 直していない失敗が残っているなら、それを隠さず書く
