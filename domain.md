# domain.md — 世界のルールブック

序列: `director.md` > **`domain.md`** > `design.md` > `vision.md` > `CLAUDE.md`

この文書は「何と呼ぶか」ではなく、**何が事実として存在するか**を定める。
画面より先、集計より先に、ここが決まる。
ここに定義の無い語を、画面や集計が勝手に使ってはならない。

---

## Important

```text
The forest metaphor describes the topology of the ecosystem.

It does NOT describe the recruiting pipeline.

Recruiting status is an independent state machine attached to Person.

Never mix topology with workflow.
```

**このシステムは「応募フロー」を表現するものではない。
「人と組織の関係性の深さ」を表現する。**

森・林・木は選考ステータスではない。**エンティティの階層である。**

このシステムは「人を管理するシステム」ではない。
**人と人、人とコミュニティ、人と組織の関係を育てるシステム**である。

---

## 1. 三つの軸を混ぜない

すべての語は、次のいずれか一つに属する。複数に属する語を作ってはならない。

| 軸 | 何を表すか | 時間 | 例 |
|---|---|---|---|
| **Topology** | 生態系の入れ子。誰がどこに居るか | **静的** | Forest / Community / Person |
| **Workflow** | 発生した出来事。履歴 | **イベント** | Application / Membership |
| **Relationship** | 主体と主体を結ぶ、続いている関係 | **継続** | Relationship（Role を持つ） |

**「幹は合格ですか」という問いは成立しない。**
幹はエンティティ、合格はステータス。軸が違う。

---

## 2. 第一級エンティティ（7つ）

```
Forest        生態系
Community     森の中のコミュニティ
Person        個人
Application   採用プロセスのイベント
Membership    所属のイベント
Relationship  主体と主体を結ぶ関係
Task          やること
```

この7つ以外を第一級として扱わない。
状態（Interested / Accepted / Member など）はエンティティではない。

---

## 3. Topology — 静的な構造

```
Forest
└── Community
    └── Person
```

### 森 Forest

アプローチ可能な生態系。大学・学生団体・企業・紹介ネットワーク・イベントなど。

**森は人ではない。人数でもない。**
森は Folder ではない。生きた生態系である（`design.md`）。

森の属性: Health / Reach / Relationship Strength / Activity / Conversion /
Owner / Next Action / Last activity。

**Reach（推定リーチ）は森の属性である。** 段ではない。
これは「まだ識別していない人の規模」を表す（8節）。

### 林 Community

森の中の具体的なコミュニティ。起業サークル・研究室・体育会など。
**林も人ではない。**

### 木 Person

個人。**まだ応募していなくても存在する。**
**Person は永続的な主体である。** 応募は木の通過点であって、木の存在条件ではない。

---

## 4. Workflow — イベント（履歴）

Topology は変わらない。Workflow は積み上がる。

```
Person
  ↓
Application #1 (2024) → Rejected
  ↓
Application #2 (2027) → Interview → Accepted
  ↓
Membership → Member
```

### Application

**Person に属する、独立した Entity。**（Aggregate Root ではないが Entity）

**属性へ降格させない。** Person は Application を**複数持てる**。

記録層がすでにそうなっている。一意制約は
`applications_person_season_key ON (person_id, season_id)`
（`basic/academy_schema.sql` 220行目）であり、**年度が違えば同一人物が何件でも持てる。**
Person に単一の `status` を置くと、この構造を表現できない。

```
Application
  id / season / status / interviews / evaluations / reviewers / decision / history
```

年度・評価・面接・履歴・判定を保持するのは Person ではなく Application である。

> UI 上では、現在の Application を Person の現在状態として表示してよい。
> **記録層では降格させない。**

### Membership

**Member は Person の属性ではない。**

```
Application → Accepted → Enrollment → Membership → Person is a Member
```

Accepted（合格）は Application の結果である。
そこから **Enrollment（入会）というイベント**を経て Membership が生成され、
その Membership によって Person が Member として扱われる。

**合格 ≠ 在籍。** 辞退があるため、この2つを同じ事実で判定してはならない。

---

## 5. Relationship — 関係性

**Person と Forest（または Community）を結ぶ、続いている関係。**

```
Person  ──[ Relationship: role ]──▶  Forest / Community
```

例 ——

```
山田（Person） ──[ connector ]──▶ 九州大学 起業サークル
OB（Person）   ──[ connector ]──▶ 学生団体A
```

これは Application でも Membership でもない。

### Role

```
Relationship.role
  - recruiter
  - ambassador
  - connector
  - mentor
  - partner
```

**Connector（種）は Person の状態ではない。Relationship の Role である。**

Relationship を第一級に置くことで、紹介・メンター・共同イベント・団体連携・
OB ネットワークを、いずれも同じ世界観の中で表現できる。

> **Relationship と Touchpoint は違う。**
> Touchpoint は**起きた接触（イベント）**、Relationship は**続いている役割**である。
> 既存の `touchpoints` は `person_id` と `partner_id` を持つが、これは接触の記録であって
> 役割ではない。

---

## 6. Task

やること。`director.md` のホーム第1優先「今日やること」と、
`design.md` の Task Queue が要求する実体。

**記録層に一切存在しない。**（10-2）

---

## 7. Person の状態は、導出する

**決定: (b) を採用。** Application を実体として残し、Person の状態はそこから**導出する**。

原典の設計原則1「導出可能な値は物理保存しない」および原則7「事実の有無で判定し、
理由で分岐しない」に沿う。

```
Person の状態  ←  Applications[] と Membership と Touchpoints から導出
```

物理カラムとして `person.status` を持たない。

これにより「2024年度に応募して不合格、2027年度に再応募して合格」が破綻せずに表せる。
**Application ごとに結果があり、Person の状態は「どの年度から見るか」で決まる。**

---

## 8. Unknown は Person ではない

状態の並び（Unknown / Known / Interested / Applicant / Interview / Accepted /
Rejected / Member）のうち、**Unknown だけは Person の状態として持てない。**

まだ識別していない人は `persons` に行が無い。行が無いものに状態は付かない。

**Unknown の規模を表すのが、森の属性 Reach（`partner_reaches` の推定値）である。**
だから森は推定値であり、人数と同じ軸に置けない。

```
森.Reach（推定・未識別）  ┃  Person（識別済み・実数）
        Unknown          ┃  Known 以降
```

**この境界線をまたいで割り算をしない。**
実行②で「推定リーチに対する識別率」を作りかけて消したのは、この境界による。

---

## 9. 記録層の現状

### 9-1. 実体があるもの

| 語 | 実体 | 単位 | 備考 |
|---|---|---|---|
| **Person（木）** | `persons` | 人 | 個人情報削除を受けた人が存在する |
| **Application** | `applications` | 応募 | 独自の主キー。1人が複数年度に複数持つ |
| Touchpoint | `touchpoints` | 接触 | `person_id` + `partner_id`。年度に紐づかない接触がありうる |
| Season | `seasons` | 年度 | 実数値が未確定（D-8）。本番シードは空 |
| Selection Step | `selection_steps` | ステップ | |
| Evaluation | `evaluations` / `evaluation_scores` | 評価 | `rationale` 必須 |
| Status History | `status_histories` | 遷移 | 追記のみ。訂正は打ち消し行の追記 |
| Staff | `staffs` / `staff_roles` | 人 | |
| Channel | `channels` | 流入元 | |
| School | `schools` | 学校 | |
| Partner | `partners` | 団体 | `name / category / contact / first_contact_date / is_active`。**階層を持たない** |
| Partner Relation | `partner_relations` | 関係 | **Academy ↔ Partner の関係。**Relationship とは別物（10-1） |
| Partner Reach | `partner_reaches` | 接触機会（推定値） | 個人を識別しない |

### 9-2. 実体が無いもの

| 語 | 必要なもの |
|---|---|
| **Forest** | 実体。`partners` は階層を持たないフラットな表 |
| **Community** | 実体。Forest との親子関係 |
| **Membership** | 在籍の事実。Enrollment イベントと在籍期間 |
| **Relationship** | Person ↔ Forest/Community と Role |
| **Task** | 全て |
| Health / Relationship Strength / Activity / Owner | 定義と算出。`partners` に該当列が無い |
| Interested（芽） | 判定の事実（10-3） |
| Next Action / Ball | 無い。CLAUDE.md 8節が④の穴として明記 |
| カレンダー / メッセージ / 通知 | 丸ごと新規サブシステム |

---

## 10. 未決（指示待ち。推測で埋めない）

### 10-1. `partner_relations` と Relationship の語が衝突する ★

既存の `partner_relations` は **Academy ↔ Partner** の関係（送客・講演受入など）で、
Person を持たない。新しい Relationship は **Person ↔ Forest/Community** の役割である。

**別物なのに、どちらも「関係」を名乗る。** 実行③で踏んだ「同じ言葉が2つの定義を持つ」
の形そのものなので、どちらかを改名する必要がある。

### 10-2. Task の定義が無い

第一級エンティティに挙がったが、何を事実として持つかが未定義。
誰の・何に対する・いつまでの・どの状態か。
`director.md` の「今日やること」5項目のうち、既存の記録層で出せるのは
「面接官の評価待ち」1つだけである。

### 10-3. Interested（芽）を、どの事実で判定するか

LINE 交換・DM・説明会参加はいずれも `touchpoints` である。
「接点がある」で引くと、現行の 林 = `f_person_season_state(90).in_active_window`
（直近90日に接点がある人）と**ほぼ同じ述語**になる。

Known と Interested を接触の**回数や種類**で分けるのか、
`touchpoints` に種別を足すのか。観測窓 90 日も仮の値のまま。

### 10-4. Forest / Community の実体をどう作るか

`partners` は階層を持たないフラットな表で、`category` は自由入力（D-5）。

自然な読みは「`partners` を Forest に育て、Community を新設して親子を張る」だが、
`partners` には `partner_reaches` と `partner_relations` がぶら下がっており、
どちらの階層に付くかで集計が変わる。**確認したい。**

### 10-5. Membership の粒度

年度ごとか、通期か。在籍期間（開始・終了）を持つか。
Alumni は Membership の終了で表すのか、別の Role か。

### 10-6. 実装段階（原典 [1]〜[4]）を憲法で上書きするか

Forest（Partner 系）は[2]、Health（スコア）は[3]（原典は「着手判断は1年後」）、
Relationship / Connector は名寄せ[4] に接する。
CLAUDE.md 4節は「先の段階を勝手に始めない」と定めている。

### 10-7. `director.md` の IA に重複がある

INFORMATION ARCHITECTURE は `森 → 林 → 木 → 人 → アクション` だが、
本書で **木 = Person** と定めたため「木 → 人」が同じものの重複になる。
UX PHILOSOPHY 側の `Forest → Community → Person → Action` は本書と一致する。
憲法なので本書からは直さない。

### 10-8. 以前からの未決（`db/DECISIONS.md`）

- **D-8**: `seasons` の実数値（年度と4つの日付）が未確定
- **D-10**: 個人情報削除を受けた人の応募を数え続けるか
- **D-5**: `partners.category` が自由入力
- **E-7**: `is_reapplication` の再計算処理が無く、年輪の表示は保留

---

## 11. 旧定義との対応と、影響範囲

**4語すべてが意味を変える。** 同じ字で別の意味になるのが最も危険な形である
（実行③で「林」が2つの意味を持ち、同じ年度で 2,576 対 661 になった）。

| 語 | 旧（実装済み） | 新（本書） | 変化 |
|---|---|---|---|
| 森 | `partner_reaches` = 推定リーチ | Forest = 生態系の**実体** | 接触機会 → 実体（リーチは属性へ降りる） |
| 林 | `identified_person` = 直近90日に接点がある**人** | Community = 森の中の**組織** | **人 → 組織** |
| 木 | `applicant` = **応募** | Person = **個人** | **応募 → 人** |
| 幹 | `accepted` = 合格した**応募** | — | Member は Membership から導出。幹の割り当ては未決 |
| 純幹 | 辞退控除後の合格 | — | 対応語なし |

コード上の出現数（実測）——

```
林 94 / 木 60 / 幹 49 / 森 23 / 純幹 8   計 174箇所
```

影響を受ける主なもの: `v_person_season_state` / `f_person_season_state` /
`v_funnel_daily` 系のビューとカラム名、`src/queries/dashboard.ts`、
`app/page.tsx` の KPI 4枚とファネル図とチャート凡例、`app/layout.tsx` の説明文。

**移行の規律**: 旧語と新語を同じコードベースに同時に生かさない。
機械的な置換ではなく、旧ビューを非活性化して新しい語で作り直す
（CLAUDE.md「集計マスタは追加と非活性化で運用する」）。

---

## 12. 規律（改修後も変わらない）

1. **Topology / Workflow / Relationship を混ぜない**（1節）
2. **Application を属性へ降格させない**（4節）
3. **導出可能な状態を物理保存しない**（7節。原典の設計原則1）
4. **未識別（森の Reach）と識別済み（Person）の境界をまたいで割らない**（8節）
5. **単位の違うものを同じ軸に置かない。並べても割らない**（実行②）
6. **同じ言葉を2つの定義で使わない**（実行③）
7. **「数えるか」（`v_countable_applications`）と「動いているか」（`v_active_applications`）を
   同じ述語で扱わない**（実行④）
8. **無い記録から数字を作らない。** 表示のために数え直さない
9. **記録の構造 > 集計の定義 > 画面。** 画面で困ったら、疑うのは画面ではなく定義
