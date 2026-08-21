### C-1. 最終ステップ判定を1箇所に畳んだ

「最終ステップへの advance = 合格」の判定が

```sql
ORDER BY ss.sort_order DESC LIMIT 1
```

という相関副問い合わせとして4箇所に複製されていた（原典の
`v_person_state` に1箇所、`academy_views_revised.sql` に3箇所）。
合格の定義が4箇所にあると、1箇所だけ直したときに誰も気づかない。
`v_final_selection_step` に集約した。

→ `tests/04_funnel.test.ts`「中間ステップへの advance では幹にならない」
