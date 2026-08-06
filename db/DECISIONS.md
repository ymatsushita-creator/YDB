# 設計判断の記録

`basic/academy_schema.sql` と `basic/academy_views_revised.sql` を実行可能な
マイグレーションに移す過程で加えた変更を、すべて理由付きで記録する。

原典は正典として `basic/` に置いたまま変更していない。
ここに書かれていない差分は存在しないはずで、もしあればそれはバグである。

各項目の末尾に、その判断を固定しているテストを示す。
テストのない判断は、次に触る人が理由を知らないまま壊せてしまう。

---

## A. 実測で見つかった不具合

### A-1. 日付境界がセッションのタイムゾーンに依存していた ★影響大

原典は日付への丸めを一貫して `x::date` で書いていた。`timestamptz::date` は
セッションの `TimeZone` 設定で結果が変わる。

実測（PostgreSQL 18.3 / PGlite）:

| セッション TZ | `'2025-04-01T08:00:00+09:00'::date` |
|---|---|
| Asia/Tokyo | 2025-04-01 |
| UTC | **2025-03-31** |
| America/New_York | **2025-03-31** |

JST 09:00 より前に起きたことがすべて前日に寄る。応募開始日の朝に届いた
応募は「応募開始前」に計上され、日次ファネルの初日が丸ごとずれる。
接続文字列を書き換えただけで過去の集計値が動く状態だった。

**対応**: `jst_date(timestamptz) -> date` を定義し、集計の日付境界はすべて
これを通す。タイムゾーンをリテラルで与えるため `IMMUTABLE` にでき、
式インデックスも張れる（`x::date` は `STABLE` 止まりで張れない）。

運用タイムゾーンを変えると過去の集計がすべて動く。Season の日付と同じ性質を
持つため、変更は必ずマイグレーションとして残すこと（原則4）。

→ `tests/02_time.test.ts`

### A-2. `void_reasons.counts_as_application` が誰にも読まれていなかった ★影響大

原典の `v_application_state` と `f_funnel_daily` は `voided_at IS NOT NULL` の
応募を無条件に除外していた。一方 `void_reasons` には

> `counts_as_application` は「この無効化に対応する代替の Application が
> 生まれるか」で決まる。名寄せ誤り → false（付け替え先で1件数える）、
> 取り下げ → true。

とある。代替が生まれない無効化（取り下げ）は、応募が起きた事実として
木に数えなければならない。無条件除外だと応募数が実態より少なく出て、
`counts_as_application` カラムは一度も参照されないまま残る。

**対応**: `v_countable_applications` を新設し、集計対象の定義を1箇所に置いた。

```sql
WHERE a.deleted_at IS NULL
  AND (a.voided_at IS NULL OR vr.counts_as_application)
```

`deleted_at`（個人情報削除）は性質が違うため無条件に除外を維持する。

なお原則7「事実の有無で判定し、理由で分岐しない」に反しないかを検討した。
この原則が禁じているのは理由テキストによる場当たりの分岐であり、
ここはマスタに宣言された真偽値を読んでいるだけなので抵触しない。

→ `tests/04_funnel.test.ts`「無効化された応募の扱い」

### A-3. 訂正チェーンに循環を作ると、記録が静かに消える

`v_effective_status_histories` は「誰にも訂正されていない行」を再帰の基底に
とる。h1 が h2 を訂正し h2 が h1 を訂正する状態を作ると、どちらも基底に
現れず、チェーンごと有効判定から脱落する。エラーにはならず、集計から
黙って消える。落ちるより悪い壊れ方をする。

循環検出トリガを書く前に、より根本的な性質に気づいた。
`corrects_history_id` は既存の行しか指せないため、INSERT だけで構成される
グラフの辺は必ず過去方向を向き、循環はそもそも作れない。循環が生まれるのは
UPDATE で後から辺を張り替えたときだけである。

**対応**: `status_histories` を追記専用にした（UPDATE / DELETE を拒否）。
これは原則5「訂正は打ち消しの追記で表現し、元の記録は残す」そのものであり、
循環検出は副産物として不要になる。個別の異常を潰すより、異常が生まれる
余地を閉じるほうを選んだ。

同じ理由で `season_revisions`（原則4）と `score_snapshots`（原則2）にも
適用した。

→ `tests/03_corrections.test.ts`「訂正チェーンの構造的な健全性」

### A-4. 集計窓に NULL を渡すと、もっともらしい0が返る

`f_funnel_daily(NULL)` は比較が NULL になり、林が黙って0人になる。
0人のファネルは異常だと気づけるが、「引数を渡し忘れた」とは気づけない。

**対応**: `require_positive()` で明示的に落とす。ガードは最外の `FROM` に
置き、Season が0件でも必ず評価されるようにした。

→ `tests/01_schema.test.ts`「集計関数の引数」

### A-5. `is_correction` とチェーンが食い違いうる

原典は「`is_correction = true` なら `corrects_history_id` が必要」の片側しか
縛っていなかった。`corrects_history_id` を持ちながら `is_correction = false`
の行が作れる。有効性判定は `corrects_history_id` しか見ないため、
食い違うとフラグのほうが嘘になる。

**対応**: 逆向きの CHECK を追加し、両者を同値にした。

→ `tests/03_corrections.test.ts`

### A-6. 名寄せ判定が (A,B) と (B,A) の二重登録を許していた

`UNIQUE (person_id, candidate_person_id)` は順序違いの重複を防がない。
「AとBは別人」と「BとAは同一人物」を同時に登録できてしまい、
同じ組を毎年候補に上げないという目的が崩れる。

**対応**: `CHECK (person_id < candidate_person_id)` で組を正規化した。
書き込み側は挿入前に2つの id をソートする必要がある。

→ `tests/05_constraints.test.ts`「名寄せ判定の一意性」

### A-7. アトリビューションが同時刻の接点で非決定的だった

`DISTINCT ON (person_id, season_id) ... ORDER BY occurred_at` は、同時刻の
接点が複数あると勝つ行が実行ごとに変わりうる。同じ質問に日によって
違う答えが返るダッシュボードは信用されない。

**対応**: `touchpoint_id` を第2ソートキーに足して決定的にした。

→ `tests/06_person_state.test.ts`「同時刻の接点があっても結果が揺れない」

---

## B. 制約として足したもの

いずれも原典のコメントが述べている設計意図を、運用の心がけではなく
データベースの制約に落としたもの。

| 追加した制約 | 塞いだ穴 |
|---|---|
| `evaluation_scores.score <= scale_max`（トリガ） | 上限のない5段階評価。平均が意味を失う |
| 評価軸は評価と同じ選考ステップのものに限る（トリガ） | ステップ別平均が別物の混合になる |
| `rationale` が空白のみは不可 | NOT NULL だけでは空文字が通り、資料5-3 の必須化が形骸化する |
| `evaluations.submitted_at >= assigned_at` | 滞留日数が負になり(2)の平均滞留が壊れる |
| `evaluations.attempt >= 1` | 「何回目の評価か」を意味しない値 |
| `touchpoints.attended_at >= applied_at` | ドタキャン判定（資料3-3）の前提 |
| `selection_steps.sort_order > 0` | 最終ステップ判定（`ORDER BY DESC LIMIT 1`）に効く |
| `evaluation_criteria.scale_max >= 1` | 妥当なスコアが存在しない軸 |
| `scoring_rules` の閾値・半減期 | ゼロ除算と、閾値のない `count_threshold` |
| `partner_reaches.estimated_reach >= 0` | 負のリーチ |
| `partner_relations.ended_on >= started_on` | 逆転した期間 |

→ `tests/05_constraints.test.ts`

`evaluation_scores` のトリガは、原典の `check_criteria_applicability()` を
`check_evaluation_score_validity()` に拡張したもの。3つの検査を1つのトリガに
まとめたのは、いずれも同じ2テーブルを引くため。

---

## C. 構造の整理

### C-1. 最終ステップ判定を1箇所に畳んだ

「最終ステップへの advance = 合格」の判定が

```sql
ORDER BY ss.sort_order DESC LIMIT 1
```

という相関副問い合わせとして5箇所に複製されていた。合格の定義が5箇所に
あると、1箇所だけ直したときに誰も気づかない。`v_final_selection_step` に
集約した。

### C-2. 森の観測窓 90 日を引数にした

`v_partner_reach_summary` は「最終リーチ日 + 90 日」を定数で埋め込んでいた。
90 は集計定義そのものであり、コードに埋めると変更履歴が残らない（原則4）。
`f_partner_reach_summary(attribution_window_days integer DEFAULT 90)` にした。
`first_reach_on` / `last_reach_on` も返すようにして、窓の根拠を見えるようにした。

### C-3. `pgcrypto` への依存を外した

`gen_random_uuid()` は PostgreSQL 13 以降コアの関数で、拡張を要さない。
拡張を要求すると、それが使えない環境でスキーマ全体が適用できなくなる。

### C-4. `partners` を `touchpoints` より前に定義した

原典は `touchpoints` を先に定義し、`ALTER TABLE` で外部キーを後付けしていた。
依存順に並べ替えて `ALTER` を不要にした。定義の位置以外に差はない。

### C-5. 利益相反に「面接官＝応募者」を追加した

原典は紹介者のケースだけを見ていた。卒業生スタッフが再応募すれば
面接官と応募者が同一人物になりうる。紹介より直接的な相反が素通りしていた。
`conflict_type` 列で2種を区別する。

### C-6. 日付系列の生成を timestamp 経由にした

`generate_series(date, date, interval)` は date を timestamptz に暗黙変換し、
セッション TZ を一往復する。`::timestamp`（TZ なし）を経由して往復を消した。

---

## D. 判断を保留したもの

実装せずに残した。いずれも運用の意図を確かめないと決められない。

### D-1. ファネルの開始日を `outreach_start_date` にするか

`f_funnel_daily` は `application_open_date` から日次系列を作る。しかし林は
集客期間（`outreach_start_date` 〜 `application_open_date`）に積み上がるため、
その立ち上がりがチャートに映らない。

`outreach_start_date` から始めれば集客期が見えるようになり、
`relative_day` は応募開始前が負になる（D-30 のような読み方）。
原典に指定がないため変更していない。

### D-2. 林は「人」、木と幹は「応募」を数えている

`identified_person_cum` は Person を、`applicant_cum` と `accepted_cum` は
Application を数える。同一年度の有効な応募は1件までなので実質は一致するが、
無効化された応募が `counts_as_application = true` で残ると、
1人が2件として木に乗りうる（A-2 の変更で顕在化した）。

段間の転換率を人単位で見るのか応募単位で見るのかは運用の問題なので、
原典どおり応募単位のままにしてある。

### D-3. 林のアクティブ判定が Season で絞られていない

`identified_person_cum` は「その日から遡って N 日以内に接点がある Person」で、
どの Season のファネルから見ても同じ暦日なら同じ値になる。
資料2-3 の「今期の応募母集団として見たときの林」という定義には、
接点が当該 Season の集客期間に属することまで求める読み方もありうる。

現状の実装は「その日時点で生きている見込み層」を数えており、これはこれで
一貫している。どちらを指標にするかは運用の判断。

### D-4. `identity_resolutions` を追記専用にしていない

同じ組に対する判断は1つであるべきで、覆るときは上書きが正しい。
ただし覆った事実は残らない。監査が必要になった時点で
`decided_at` を含む履歴テーブルへ切り出す。
実装段階[4]まで使われないため、いまは切り出していない。

### D-5. `staff_roles.role` などの自由入力

`role` / `partner_relations.relation_type` / `channels.category` /
`partners.category` は原典で「運用時に決定」とされている text カラム。
`channels` は「自由入力を禁じる」と明記されているのに `category` は
自由入力のままなので、値が決まり次第マスタ化するか CHECK を入れる。

---

## E. 実行環境について

テストは PGlite（WASM 版 PostgreSQL 18.3）で動く。デーモンを必要としないため
`pnpm test` だけで完結する。本番の想定は PostgreSQL 15 以上。

18 と 15 で挙動が分かれる機能は使っていないが、
`UNIQUE NULLS NOT DISTINCT`（15+）と `gen_random_uuid()`（13+）は
バージョン依存なので、本番の初回適用時に確認すること。
