# REPORT-5.0 — 実行⑤

2026-08-07

**この報告書は凍結する。** 追記が要るときは `REPORT-5.1.md` を作る。

---

## 0. 要約

実行⑤は**土台の大改修の前半**にあたる。
文書の序列を立て、世界設定を定義し直した。**コードは1行も変えていない。**

| | |
|---|---|
| コードの変更 | **なし** |
| 追加した文書 | `director.md` / `domain.md` / `design.md` / `vision.md` |
| 更新した文書 | `CLAUDE.md`（序列）/ `db/DECISIONS.md`（D-11）/ `HANDOFF.md` |
| テスト | 149件 全通過（実行④から変化なし） |
| `tsc --noEmit` | クリーン |
| `pnpm tokens` | 差分なし |

終盤に MVP モードへの切替指示があり、実装に着手する直前で実行⑤を締めた。
**実装は実行⑥から。**

---

## 1. 引き継ぎ時点の状態確認（実測）

`951658a` を clone した状態で、引き継ぎ書の記載どおりであることを確認した。

| 項目 | 結果 |
|---|---|
| `pnpm db:reset` | マイグレーション11本を適用。完了 |
| `pnpm test` | **149件 全通過**（fail 0） |
| `pnpm exec tsc --noEmit` | クリーン（exit 0） |
| `pnpm tokens` | 再生成しても `app/tokens.css` に差分なし |
| 6画面 | すべて HTTP 200、ブラウザコンソールにエラーなし |

破損は無く、修復作業は発生しなかった。

---

## 2. トークン利用実態の調査

改訂版 DESIGN.md を当てるときの差分を見積もるための調査。**この段階では直していない。**

### 2-1. 貫通率

`app/tokens.css` の CSS 変数 140個のうち、実際に描画へ到達しているのは **47個（34%）**。

到達判定は「`app/base.css` または `.tsx` が直接参照」＋「6画面の DOM に実在する
コンポーネントクラスが参照」＋その推移閉包で求めた。
`tokens.css` の未使用クラスが内部で参照している変数は到達に数えていない。

### 2-2. 未到達 93個の内訳

| 群 | 数 |
|---|---|
| `--type-*`（タイポグラフィ） | **69** |
| `--color-*` | 17 |
| `--space-*` | 4 |
| `--rounded-*` | 3 |

**タイポグラフィが事実上まったく機能していない。**
DESIGN.md の typography 17グループのうち画面に効いているのは `caption-bold` の1つだけで、
`app/base.css:182` の `.badge-tag-blue` / `.badge-tag-gray` にしか使われていない。

理由は `base.css` が字を直値で書いているため。

```
.page-title  font-size: 36px; font-weight: 600; letter-spacing: -0.5px;
.kpi-value   font-size: 32px; font-weight: 600; letter-spacing: -0.5px;
body         font-size: 14px; line-height: 1.55;
```

DOM の computed style でも一致を確認した（`.page-title` = 36px/600/-0.5px、
`.kpi-value` = 32px/600/-0.5px）。

**したがって DESIGN.md の typography を差し替えても、いまの画面は1文字も動かない。**

### 2-3. 色は健全だった

- `.tsx` 内のハードコード色 **0件**。チャート（サーバ SVG）も `stroke="var(--color-*)"`
- `.css` 内の直値色は `app/base.css:13-14` の `--shadow-1` / `--shadow-2`
  （`rgba(15,15,15,…)`）の2箇所のみ。**しかもこの2つは参照ゼロで、どこからも使われていない**
  （`.card-base` は `box-shadow: none` で描かれている。DOM で確認）
- 未定義の変数を参照している箇所はゼロ
- `base.css` 独自定義は `--font-sans` / `--font-mono` / `--shadow-1` / `--shadow-2` の4つ

### 2-4. コンポーネントクラス

DESIGN.md 由来の50個のうち、6画面の DOM に現れるのは **8個**
（`card-base` `button-primary` `button-ghost` `text-input` `pill-tab` `pill-tab-active`
`badge-tag-orange` `badge-tag-purple`）。

残り42個は `pricing-card` `testimonial-card` `faq-accordion-item` `logo-wall-item`
`hero-band-dark` `comparison-table` `footer-link` など、**Notion のマーケティングページ部品**。

画面を組んでいる53クラスのうち **45個は `base.css` の手書き**（`.shell` `.kpi` `.timeline`
`.meter` など）。

`badge-tag` 一族が2つに割れている（orange/purple/green は tokens.css、blue/gray は base.css）が、
これは `base.css:179` に理由が書かれた意図的なもの。

### 2-5. `scripts/build-tokens.ts`

読み先は16行目の1箇所。ただし汎用のトークンビルダーではなく、
**Notion のブランド分析を読むために書かれたパーサ**である。

1. frontmatter のグループは `colors` / `typography` / `rounded` / `spacing` / `components`
   の5つ前提。`components` のプロパティは `CSS_PROP` テーブルに無いキーが来ると **throw する**（134行目）
2. `fontValue()` の書体判定が `/notion|inter/i` のベタ書き（70行目）
3. `border: "0 0 2px …"` を下線として解釈する分岐（138行目）は DESIGN.md の表記癖に合わせたもの

---

## 3. 文書の序列を立てた

実行⑤で受け取った指示により、次の序列を確定した。

```
director.md   憲法（AI Director + 着手条件）
     ↓
domain.md     世界設定（ルールブック）
     ↓
design.md     UI
     ↓
vision.md     理念
     ↓
CLAUDE.md     実装の規律
```

上が下に優先する。ただし**食い違いを勝手にどちらかへ寄せない。**
`CLAUDE.md` の冒頭にこの序列を明記した。

### 3-1. `director.md`（新規）

指示された `# AI Director` の英文ブロックを憲法として冒頭に据え、
「実装前の自己チェック」4項目を**着手条件**として置いた。

末尾に「憲法が上書きしないもの」を1節足した。これは実行⑤側の判断である。

> 思想は画面を支配するが、事実を作り替えることはできない。
> 「森が主役に見える画面」を、森の実体が無いまま作ってはならない。
> その場合に直すのは画面ではなく、記録層である。

これが無いと、憲法の `begin with Forest` が、記録層に Forest が無いまま
画面だけ森に見せる方向に働く。

### 3-2. `domain.md`（新規・3回改稿）

最終形の骨子。

**三つの軸を混ぜない。**

| 軸 | 時間 | 例 |
|---|---|---|
| Topology | 静的 | Forest / Community / Person |
| Workflow | イベント | Application / Membership |
| Relationship | 継続 | Relationship（Role を持つ） |

**第一級エンティティは7つ** —— Forest / Community / Person / Application /
Membership / Relationship / Task。

森・林・木は**エンティティの階層**であって選考ステータスではない。
「幹は合格ですか」という問いは成立しない（幹はエンティティ、合格はステータス）。

### 3-3. `design.md`（新規）

改訂版を全文収録した。冒頭に「この文書はまだトークンを生成しない」と明記。

### 3-4. `vision.md`（新規・枠のみ）

内容は未受領。理念は依頼する側が定めるものなので創作していない。

---

## 4. 決まったこと

実行⑤の往復で確定した設計判断。

### 4-1. トポロジーとワークフローを分離する

```text
The forest metaphor describes the topology of the ecosystem.
It does NOT describe the recruiting pipeline.
Recruiting status is an independent state machine attached to Person.
Never mix topology with workflow.
```

この分離だけで、それまで未決だった4問が解けた。

| 問い | 答え |
|---|---|
| 森は推定値か人口か | **どちらでもない。** 森は実体。推定リーチは森の**属性 Reach** |
| 幹は合格かメンバーか | **合格ではない。** 合格は状態、幹は実体側の語 |
| 芽は木の前か後か | **どちらでもない。** 芽は階層ではなく Person の状態 |
| 森と林の粒度 | 森 = Forest、林 = Community で別の階層 |

### 4-2. Application は Entity である（属性へ降格させない）

Person は Application を複数持つ。記録層がすでにそうなっている ——
一意制約は `applications_person_season_key ON (person_id, season_id)` であり、
**年度が違えば同一人物が何件でも持てる**（`basic/academy_schema.sql` 220行目）。

Person に単一の `status` を置くと
「2024年度に応募して不合格、2027年度に再応募して合格」が表現できない。

したがって **Person の状態は Applications[] から導出する**。物理カラムを持たない
（原典の設計原則1「導出可能な値は物理保存しない」）。

### 4-3. Member は Person の属性ではない

```
Application → Accepted → Enrollment → Membership → Person is a Member
```

**合格 ≠ 在籍。** 辞退があるため、この2つを同じ事実で判定しない。

### 4-4. Connector は Relationship の Role である

Person の状態ではない。

```
Person ──[ Relationship: role ]──▶ Forest / Community
role: recruiter / ambassador / connector / mentor / partner
```

Relationship を第一級に置くことで、紹介・メンター・共同イベント・団体連携・
OB ネットワークを同じ世界観で表現できる。

**Relationship と Touchpoint は違う。** Touchpoint は起きた接触（イベント）、
Relationship は続いている役割。既存の `touchpoints` は `person_id` と `partner_id` を
持つが、これは接触の記録であって役割ではない。

### 4-5. Unknown は Person の状態として持てない

まだ識別していない人は `persons` に行が無い。行が無いものに状態は付かない。

**Unknown の規模を表すのは森の属性 Reach（`partner_reaches` の推定値）である。**

```
森.Reach（推定・未識別）  ┃  Person（識別済み・実数）
        Unknown          ┃  Known 以降
```

これは実行⑤側が (b) の決定と記録層の形から導いた帰結であり、指示された事項ではない。
**この境界をまたいで割り算をしない。** 実行②で「推定リーチに対する識別率」を
消したのは、この境界による。

---

## 5. 実装との食い違い（`DECISIONS.md` D-11）

**実装は一切変えていない。** したがって現在のコードは D-2（「林は人、木と幹は応募」）の
ままで正しく、`domain.md` の定義とは食い違っている。

| 語 | 実装（動いているもの） | `domain.md` | 変化 |
|---|---|---|---|
| 森 | `partner_reaches` = 推定リーチ | Forest = 生態系の実体 | 接触機会 → 実体 |
| 林 | `identified_person` = 直近90日に接点がある**人** | Community = **組織** | **人 → 組織** |
| 木 | `applicant` = **応募** | Person = **個人** | **応募 → 人** |
| 幹 | `accepted` = 合格した応募 | 未決 | 応募 → 未決 |
| 純幹 | 辞退控除後の合格 | 対応語なし | — |

コード上の出現数（実測）——

```
林 94 / 木 60 / 幹 49 / 森 23 / 純幹 8   計 174 箇所
```

影響を受ける主なもの: `v_person_season_state` / `f_person_season_state` /
`v_funnel_daily` 系のビューとカラム名、`src/queries/dashboard.ts`、
`app/page.tsx` の KPI 4枚とファネル図とチャート凡例、`app/layout.tsx` の説明文。

**現行ダッシュボードの KPI 4枚とファネル凡例は、`domain.md` の定義から見ると
すべてラベルが誤りである。** ただし実装としては一貫しているので、
中途半端に直すほうが危険である。

---

## 6. 未解決のまま実行⑥へ渡すもの

`domain.md` 10節にある。

| # | 内容 |
|---|---|
| 10-1 | `partner_relations`（Academy↔Partner）と Relationship（Person↔Forest）の**語が衝突する** |
| 10-2 | **Task の定義が無い**。誰の・何に対する・いつまでの・どの状態か |
| 10-3 | **Interested（芽）の判定事実**。`touchpoints` で引くと現行の林（90日窓）とほぼ同じ述語になる |
| 10-4 | **Forest / Community の実体**。`partners` を育てるか新設するか |
| 10-5 | **Membership の粒度**。年度ごとか通期か。Alumni は終了か別 Role か |
| 10-6 | 実装段階（原典 [1]〜[4]）を憲法で上書きするか |
| 10-7 | `director.md` の IA に重複がある（`森 → 林 → 木 → 人` の「木 → 人」） |
| 10-8 | 以前からの未決 —— D-8（`seasons` 実数値）/ D-10（削除済みの応募）/ D-5 / E-7 |

MVP モードでは、これらは **TODO(MVP)** として置き、実装を止めない。

---

## 7. 終盤に受けたモード切替

実装に着手する直前（既存コードの読み込み中）に、MVP モードへの切替指示を受けた。

- 目的は完全なドメインモデルではなく、**運用できる最小のプロダクト**
- **凍結する概念**: Forest / Community / Person / Task の4つ
- **TODO(MVP) 送り**: Membership / Connector / Relationship / Ambassador / Alumni /
  Forest Health / Ecosystem Score / Advanced Analytics
- 大規模な書き換えを避け、**既存構造の拡張を優先**する
- 未解決の設計論で実装を止めない。TODO(MVP) を置いて進む

**5節の174箇所の語の付け替えは、この方針では実施しない。**
既存のダッシュボードとオペレーション画面はそのまま残し、
運用者向けの入口を新しく足す形になる。

実行⑤はここで締め、実装は実行⑥から。

---

## 8. 検証したこと・していないこと

**したこと**

- テスト149件・`tsc`・`pnpm tokens` の通過を、引き継ぎ直後と文書追加後の2回確認した
- トークンの貫通率は、DOM に実在するクラスからの推移閉包で機械的に求めた
- 画面の確認は6画面すべて、スクリーンショットではなく **DOM**（`fetch` → `DOMParser` で
  クラス名と inline `var()` を列挙、`getComputedStyle` で実効値）で行った
- 比喩語174箇所は `grep` の実測値

**していないこと**

- **コードの変更を一切していない。** したがって新しいテストも足していない
- 改訂版 `design.md` からトークンを生成していない（frontmatter が無く、
  `#hex` 0件・`px/rem` 0件のため生成不能）
- 画像から色を起こしていない。**推測で意匠を決めない**という指示による
- `seasons` の実数値、削除済み Person の扱いは触っていない（D-8 / D-10 のまま）
