### E-1. 式インデックス7本

原典にはない。`0001_schema.sql` に `[追加]` コメントは付けていたが、
DECISIONS には1行も書いていなかった。

| インデックス | 目的 |
|---|---|
| `persons_created_day_idx` | 林の Season スコープ判定が `jst_date(created_at)` で絞る |
| `applications_season_day_idx` | ファネル日次断面が暦日で絞る |
| `touchpoints_day_idx` | 林のアクティブ判定 |
| `touchpoints_partner_day_idx` | 森の `identified_count` |
| `evaluations_unassigned_idx` | (2)の「担当未割当」一覧 |
| `evaluation_scores_criteria_idx` | 評価軸ごとのスコア集計 |
| `identity_resolutions_candidate_idx` | 名寄せ候補の逆引き |

`jst_date()` を `IMMUTABLE` にしたのは、この式インデックスを張るためでもある
（`x::date` は `STABLE` 止まりで張れない）。
