### C-2. 森の観測窓 90 日を引数にした

`v_partner_reach_summary` は「最終リーチ日 + 90 日」を定数で埋め込んでいた。
90 は集計定義そのものであり、コードに埋めると変更履歴が残らない（原則4）。
`f_partner_reach_summary(attribution_window_days integer DEFAULT 90)` にした。
`first_reach_on` / `last_reach_on` も返すようにして、窓の根拠を見えるようにした。
