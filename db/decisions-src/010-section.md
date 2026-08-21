### A-9. `GREATEST()` は NULL を伝播しない

上記の書き直しで実際に踏んだ。PostgreSQL の `GREATEST` / `LEAST` は、
多くの関数と違い NULL 引数を**無視して**非 NULL の最大値を返す。

```sql
SELECT greatest(NULL::date, '2025-11-01'::date);  --> 2025-11-01（NULL ではない）
```

「まだ合格していない」を表す NULL を応募開始日に丸めるつもりで
`greatest(accepted_day, application_open_date)` と書いたところ、
NULL が消えて**全応募が年度初日に合格したこと**になった。

テストが即座に落ちたので実害はなかったが、性質そのものを
テストに残してある。→ `tests/07_funnel_equivalence.test.ts`
