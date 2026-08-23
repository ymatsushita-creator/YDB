---
name: "source-command-handoff"
description: "HANDOFF.md を現在の実測値で書き直す"
---

# source-command-handoff

Use this skill when the user asks to run the migrated source command `handoff`.

## Command Template

`HANDOFF.md` を、**いま確かめられる事実だけ**で書き直す。

先に測る（記憶や前回の内容を写さない）:

```
git status --porcelain
git log --oneline -5
git log --oneline origin/main..HEAD
kurosaki audit --repo . 2>&1 | head -8
pnpm verify:fast
```

書く内容:

- **いまの意見** —— 監査の意見と Critical / High の件数
- **動くか** —— 型検査とテストの結果（何件中何件）
- **未push** —— コミット数と、その中身の要約
- **待っている判断** —— 誰の、何についての判断で止まっているか。人間しかできない操作は明記する
- **次にやること** —— 1つだけ。複数あるなら優先順位の理由を書く

過去の経緯は書かない。それは `docs/reports/` と `db/DECISIONS.md` にある。
**この文書は「いまの状態」だけを持つ。**
