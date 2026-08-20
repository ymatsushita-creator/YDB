### E-2. CHECK 制約2本が B 節の表から漏れていた

- `selection_steps_sla_positive CHECK (sla_days IS NULL OR sla_days > 0)`
  … 0日の SLA は「即日超過」になり、滞留一覧が全件警告で埋まる
- `evaluation_scores_score_lower CHECK (score >= 0)`
  … 上限は `scale_max` 参照のためトリガだが、下限は CHECK で足りる

→ `tests/09_definition_fidelity.test.ts`
