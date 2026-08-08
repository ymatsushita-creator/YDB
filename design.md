# design.md

## ★ 実行⑨（2026-08-09）の改定 —— 依頼者の指示による

**本書は改定された。** 依頼者から画面仕様（画像）と設計思想の変更が届き、
「これらと md が矛盾するなら md を書き換えろ」という指示があった。

改定の要点は3つ。

1. **最上位は Forest ではなく、年度と3つのタブ**
   （ヘッドハンティング / ボーダーライン / アプローチ）。
   年度はタブより上にあり、どのタブでも同じ場所で切り替わる
2. **一覧を主役にしてよい。`Never: List → Detail` は撤回した。**
   ただし一覧と詳細は**同じ画面に置く**（画面を移らずに深く見る）
3. **意匠の生成元は `basic/DESIGN.md`** で、その中身は依頼者の画像から
   起こしてある。本書はトークンを生成しない（末尾の付記のとおり）

**改定していないもの** —— 情報密度は高く視覚的な雑音は低く、
カードは装飾ではなく機能の器であること。
そして `director.md` 末尾の「憲法が上書きしないもの」。

改定した節には ★改定 と記した。改定前の条文は引用として残してある。

---

# Design North Star

This product is not designed around people.

It is designed around ecosystems.

People move through ecosystems.

The UI must make those ecosystems visible.

------------------------------------------------------------------------

# Product Philosophy

Entrepreneur Academy OS is **not** an ATS.

It is an operating system for building entrepreneurial communities.

The primary object is **Forest**, not Applicant.

The UI must prioritize relationships, ecosystems, ownership, and next
actions over records and tables.

------------------------------------------------------------------------

# Mental Model

Forest → Community → Person → Application → Member → Alumni → Connector

-   Forest = Reachable ecosystem
-   Community = Group inside a forest
-   Person = Individual
-   Application = Recruiting process
-   Member = Active academy member
-   Alumni / Connector = Expands or creates new forests

------------------------------------------------------------------------

# Forest Model

A Forest is not a folder.

A Forest is a living ecosystem.

Every Forest has:

-   Health
-   Relationship Strength
-   Activity
-   Conversion
-   Owner
-   Next Action

------------------------------------------------------------------------

# UX Principles

## DO

-   Zoom-based navigation
-   Workspace-oriented UI
-   Context first
-   Next actions first
-   Relationship visualization
-   Dense but calm information

## DON'T

-   CRUD-first screens
-   Applicant-first navigation
-   Giant tables
-   Empty dashboards
-   Report-only pages

------------------------------------------------------------------------

# Navigation

## ★改定（実行⑨）

```
年度（最上位。全タブ共通）
   ├── ヘッドハンティング   誰に声を掛けるか
   ├── ボーダーライン       誰を通すか
   └── アプローチ           どこから来ているか
```

**タブは3つで固定。** ファネル・流入元・選考オペレーション・人の一覧は、
独立した行き先にせず、3つのどれかの中に畳む。
サイドバーには3つのタブと**名前で検索**を置く。

改定前の条文（記録）。

> Dashboard — Forest / Community / Person / Tasks / Analytics / Settings

------------------------------------------------------------------------

# Dashboard Rules

Priority:

1.  Today
2.  Stuck
3.  Forest Health
4.  Pipeline
5.  Analytics

The home screen must answer:

-   What should I do now?
-   Who owns the ball?
-   What is blocked?
-   Which forest needs attention?

------------------------------------------------------------------------

# Forest Visualization

Each Forest may represent:

-   University
-   Student organization
-   Club
-   Internship partner
-   Alumni network
-   Event
-   Referral network

Each node displays:

-   Health
-   Reach
-   Applications
-   Acceptances
-   Owner
-   Last activity

## ★改定（実行⑨）

```
年度 → タブ → 一覧 → 1人 / 1件 → アクション
```

**`Never: List → Detail` は撤回した。** 順位は一覧でしか表せない。
ただし**一覧から1人を選んでも画面は移らない** ―― 同じ画面の中の
パネルが切り替わる。「画面遷移を減らす」という要求のほうは残っている。

改定前の条文（記録）。

> Navigation always zooms: Forest → Community → Person → Action.
> Never: List → Detail.

------------------------------------------------------------------------

# Information Density

-   High information density
-   Low visual noise
-   Every element should be actionable
-   Cards are functional containers, not decoration

------------------------------------------------------------------------

# Core Components

## ★改定（実行⑨）

実装のある部品を挙げる。**名前だけの部品を一覧に残さない** ――
残すと「実装漏れが8件ある」と読まれる。

-   Shell（暗い操作柱。3つのタブ＋名前で検索）
-   Year Bar（年度。最上位の軸。全タブ共通）
-   Panel Card（白いカード。浅い影で地から浮く）
-   Task Card（やること1件）
-   Rank Row（順位・王冠・前回比）
-   Person Panel（候補者1人）
-   Approach Chip（アプローチ状態）
-   Stars（評価。比で塗り、素点を必ず併記する）
-   Physical Button（厚みがあり、押すと沈む）

まだ無い部品（**記録層に事実が無いか、未着手**）――
Forest Map / Community Card / Activity Timeline / Health Ring /
Relationship Map。**Health は記録層に事実が無い**（`db/DECISIONS.md` C-18）。

改定前の条文（記録）。

> Core Components: Forest Map / Forest Card / Community Card / Person Panel /
> Task Queue / Activity Timeline / Health Ring / Relationship Map.
> Avoid an "Applicant List" as the primary experience.

------------------------------------------------------------------------

# Visual Identity

Inspired by:

-   Linear
-   Attio
-   Arc
-   Notion

Keywords（★改定。実行⑨）:

-   High density, low noise
-   Physical buttons（厚みがあり、押すと沈む）
-   Dark rail / orange year bar / white cards on a blue-grey field
-   Professional

改定前の条文（記録）。

> Calm / Organic / Forest metaphor / Soft green / Natural hierarchy / Spacious layout

**「Soft green」と「Spacious」は撤回した。** 実際の意匠は
`basic/DESIGN.md`（依頼者の画像から起こした）にあり、密度は高い。

------------------------------------------------------------------------

# 付記（リポジトリ側の事実。上の本文とは別）

序列: `vision.md` > `director.md` > `domain.md` > **`design.md`** > `CLAUDE.md` > `process.md`

**この文書はまだトークンを生成しない。** `scripts/build-tokens.ts` は
`basic/DESIGN.md`（Notion のブランド分析）を読み続けている。本文には
frontmatter が無く、色・字送り・余白の実数値が1つも無いため、`pnpm tokens` の
入力にならない（実測: frontmatter 検出なし、`#hex` 0件、`px/rem` 0件）。

**★実行⑨で決着した。** 依頼者の判断は「画像を正典にする」。
`basic/DESIGN.md` の frontmatter を依頼者の画面画像から起こし直し、
`app/tokens.css` はそこから生成されている（`db/DECISIONS.md` C-39）。
**本書は引き続きトークンを生成しない。** 本書が定めるのは構造と原則で、
実数値は `basic/DESIGN.md` にある。
