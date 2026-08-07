# process.md — 開発の進め方（MVP モード）

序列: `vision.md` > `director.md` > `domain.md` > `design.md` > `CLAUDE.md` > **`process.md`**

この文書は `CLAUDE.md`（Engineering）の下に付く。**何を作るか**ではなく
**どう回すか**を定める。上位文書と食い違ったときは上位が勝つ。

実行⑥（2026-08-07）に受領。

---

# Development Strategy: MVP First

You are now entering MVP Development Mode.

Your responsibility is no longer to perfect the architecture.

Your responsibility is to produce a working product that real operators can use as quickly as possible.

---

## Development Philosophy

This project follows an iterative product development approach inspired by Lean Startup, Agile, Extreme Programming (XP), and Domain-Driven Design.

The goal is not to discover the perfect architecture before implementation.

The goal is to discover the correct architecture through implementation and real operational feedback.

Software design is an evolving process.

Every assumption should eventually be validated by actual usage.

---

## Development Loop

Always follow this cycle:

```
Think a little
    ↓
Build something working
    ↓
Use it
    ↓
Observe problems
    ↓
Improve the design
    ↓
Repeat
```

Never stay in the "thinking" phase for too long.

---

## Priority Order

1. Working software
2. Operator usability
3. Speed of iteration
4. Domain correctness
5. Architectural elegance

Architecture exists to support working software, not replace it.

---

## Current Scope

The objective is NOT to build the final Entrepreneur Academy OS.

The objective is to build the smallest version that can actually support one day's recruiting operations.

Everything else can evolve later.

---

## Freeze Core Concepts

For MVP, only assume these core concepts exist.

- Forest
- Community
- Person
- Task

Other concepts should remain provisional until real operational needs justify them.

Examples:

- Membership
- Connector
- Ambassador
- Relationship
- Forest Health
- Ecosystem Score
- Advanced Analytics

If uncertain:

Leave a `TODO(MVP)`

Continue implementation.

---

## Avoid Analysis Paralysis

Do not continue architectural discussions indefinitely.

If a discussion cannot be resolved within two implementation cycles:

- make a reasonable assumption
- document it
- continue implementation

Perfect certainty is not required during MVP development.

---

## Domain Model Policy

The domain model is expected to evolve.

Do not attempt to complete `domain.md` before implementation.

Instead:

```
Implement
    ↓
Learn from usage
    ↓
Update domain.md
```

The documentation should describe the product, not dictate it.

---

## YAGNI

Do not implement features because they might become useful.

Implement features only when they are required by the current workflow.

Avoid speculative abstractions.

---

## XP Principle

Always choose

**"The simplest thing that could possibly work."**

Avoid premature optimization.

Avoid unnecessary abstractions.

Avoid unnecessary entities.

---

## Refactoring Policy

Prefer extending existing working code over rewriting.

Refactor only when:

- duplication becomes harmful
- implementation becomes difficult
- operational feedback indicates a problem

Never refactor only because the architecture feels imperfect.

---

## UI Philosophy

Every screen must answer these questions immediately:

- What should I do now?
- Which Forest needs attention?
- Who currently owns the next action?
- What is blocking progress?

If a feature does not improve one of these answers, postpone it.

---

## Deliverables

For every task:

1. Build the working implementation.
2. Explain temporary compromises.
3. Record `TODO(MVP)`.
4. Continue to the next feature.

Avoid stopping development for theoretical discussions.

---

## Success Criteria

Success is NOT

"The architecture is complete."

Success IS

**"A recruiter can successfully operate today's recruiting activities."**

The architecture will improve after observing real usage.

Ship first.

Learn second.

Refine continuously.

Progress over perfection.

---

# Development Loop

This project is developed through short, iterative implementation cycles.

The objective of each cycle is not to improve the architecture.

The objective is to improve the product.

---

## The Development Cycle

Every iteration must follow this process.

### 1. Select

Choose exactly ONE feature.

The feature should be small enough to complete within one implementation cycle.

If it is too large, split it into smaller independently usable features.

### 2. Implement

Build the simplest implementation that satisfies the current requirements.

Do not optimize for future flexibility.

Do not over-engineer.

YAGNI always applies.

### 3. Self Review

After implementation, review your own work.

Answer:

- Does it work?
- Does it follow `director.md`?
- Is it the simplest implementation?
- What assumptions were made?
- What `TODO(MVP)` items remain?

### 4. Human Review

Present the implementation.

The human reviewer should focus on operational experience, not code quality.

Feedback should answer questions like:

- What feels confusing?
- What feels unnecessary?
- What takes too many clicks?
- What is missing?
- What should be easier?

Do not request architectural decisions unless implementation is blocked.

### 5. Improve

Implement only the feedback from the review.

Avoid introducing unrelated improvements.

Stay focused on the current feature.

### 6. Commit

When the feature works, commit it.

Use conventional commit messages.

Examples:

```
feat:
fix:
refactor:
docs:
```

### 7. Learn

After each completed feature, answer:

- What did we learn?
- What assumptions proved wrong?
- What should change in the documentation?
- What should remain unchanged?

Update documentation only if implementation produced new knowledge.

**Documentation follows implementation.**

Implementation does not follow documentation blindly.

### 8. Plan

Choose the next highest-impact feature.

Never begin multiple major features simultaneously.

Always complete one feature before beginning another.

---

# Product Review

At the end of every iteration, answer:

1. What can an operator do now that was impossible before?
2. What is the biggest remaining source of operator friction?
3. What is the smallest change that would produce the largest improvement?

The answer to question (3) becomes the next implementation task.

---

# Architecture Policy

Architecture evolves through implementation.

Do not pause development to perfect architecture.

When uncertainty exists:

1. Make the simplest reasonable assumption.
2. Record it as `TODO(MVP)`.
3. Continue implementation.

Refactor only after real operational feedback demonstrates that change is necessary.

---

# Human and AI Responsibilities

Human responsibilities:

- Define product vision.
- Evaluate operational usability.
- Prioritize features.
- Make strategic decisions.

AI responsibilities:

- Design within the constraints of `director.md`.
- Implement features.
- Perform self-review.
- Suggest improvements.
- Maintain code quality.
- Record technical debt.
- Continue progress without unnecessary discussion.

---

# Success Criteria

Every iteration must leave the product in a better, usable state than before.

Success is measured by operational value delivered, not by architectural completeness.

Ship.

Observe.

Learn.

Repeat.

---

# 付記 — このリポジトリで、上位文書と衝突する点（実行⑥時点）

**勝手にどちらかへ寄せない**（`director.md`）。衝突は消さずに残す。

### 1. 「Documentation follows implementation」と、記録の規律

本書は「実装が文書に盲従しない」と定める。一方 `CLAUDE.md` は
**記録の構造 > 集計の定義 > 画面**の順序と、`db/DECISIONS.md` への
理由の記載を求めている。

両立する読み方を採る ―― **文書が実装を先回りして縛らない**（本書）が、
**実装した結果は必ず記録に残す**（`CLAUDE.md`）。
`DECISIONS.md` は仕様書ではなく**実装の記録**なので、順序は逆転しない。

### 2. Forest Health は「provisional」だが、`design.md` は要求している

本書の Freeze Core Concepts は Forest Health を**暫定扱い**に置いている。
`design.md` と `director.md` は Forest Health を画面要素として挙げている。
原典の実装段階では [3]（スコアリング）で、原典自身が着手判断を1年後と書いている。

**実行⑥は点数を作らなかった。** 代わりに事実の旗3つ（滞留・休眠・接点なし）で
表している（`DECISIONS.md` C-18）。3者のうち2者が「まだ作るな」なので、
実際の運用が必要性を示すまでこの扱いを続ける。

### 3. Relationship も「provisional」

同様。森と人の結び付きは `touchpoints.partner_id`（接触があった事実）で
代用している。所属や役割は表せない（`DECISIONS.md` D-12 の TODO(MVP) 4）。

### 4. 変わらないもの

MVP モードでも、次は緩めない（`director.md` 末尾、`CLAUDE.md`）。

- 単位の違うものを同じ軸に置かない。並べても割らない
- 無い記録から数字を作らない
- 同じ言葉を2つの定義で使わない
- 適用済みマイグレーションを編集しない
- `basic/` を変更しない

**「動くものを早く出す」は、記録を雑にする許可ではない。**
早く出す理由は、運用しなければ分からない欠陥を早く踏むためである。

---

# Pilot Rule

During Pilot, the objective is **not to discover bugs.**

The objective is to discover **misunderstandings.**

Whenever an operator hesitates,

**assume the interface is wrong before assuming the operator is wrong.**

---

## この規則が実務で何を変えるか

**迷いは観測データである。** バグ報告だけを集めると、いちばん重要なものを
取りこぼす ―― 運営が**操作できたのに迷った**場所は、バグとして報告されない。
「使えた」で終わるので、こちらから訊かなければ永久に見えない。

だから訊く順番を変える。

| 集めるもの | 扱い |
|---|---|
| 手が止まった | 最優先。**画面が答えを出していない** |
| 迷ったが操作できた | 同じ重み。**言葉か配置か順序が間違っている** |
| 押し間違えた | 画面の責任として読む。ラベル・並び・確認の欠落を疑う |
| エラーが出た | いちばん軽い。落ちた場所は特定できる |

**運営の理解が足りない、という結論を出さない。** 説明を足して解決したくなったら、
それは「画面が説明を要るものになっている」という観測である。
`director.md` が「コックピットであって管理画面ではない」と言うのはこの意味でもある。

**言い換えの禁止も同じ規律に入る。** 運営が使った言葉（「送客」「打診」など）を
こちらの語（Forest / Community / 林）に翻訳して記録しない。
`domain.md` に無い語が出てきたら、それは**世界設定の側が足りていない**
可能性がある ―― 語を捨てずに、10節の未決として残す。
