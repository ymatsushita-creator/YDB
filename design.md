# design.md

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

Dashboard

-   Forest
-   Community
-   Person
-   Tasks
-   Analytics
-   Settings

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

Navigation always zooms:

Forest → Community → Person → Action

Never: List → Detail.

------------------------------------------------------------------------

# Information Density

-   High information density
-   Low visual noise
-   Every element should be actionable
-   Cards are functional containers, not decoration

------------------------------------------------------------------------

# Core Components

-   Forest Map
-   Forest Card
-   Community Card
-   Person Panel
-   Task Queue
-   Activity Timeline
-   Health Ring
-   Relationship Map

Avoid an "Applicant List" as the primary experience.

------------------------------------------------------------------------

# Visual Identity

Inspired by:

-   Linear
-   Attio
-   Arc
-   Notion

Keywords:

-   Calm
-   Organic
-   Professional
-   Forest metaphor
-   Soft green
-   Natural hierarchy
-   Spacious layout

------------------------------------------------------------------------

# 付記（リポジトリ側の事実。上の本文とは別）

序列: `vision.md` > `director.md` > `domain.md` > **`design.md`** > `CLAUDE.md` > `process.md`

**この文書はまだトークンを生成しない。** `scripts/build-tokens.ts` は
`basic/DESIGN.md`（Notion のブランド分析）を読み続けている。本文には
frontmatter が無く、色・字送り・余白の実数値が1つも無いため、`pnpm tokens` の
入力にならない（実測: frontmatter 検出なし、`#hex` 0件、`px/rem` 0件）。

したがって `app/tokens.css` は、この文書ではなく Notion の意匠から生成されている。
生成元をどうするかは未決。決まるまで、**画像から色を起こして推測で埋めない。**
