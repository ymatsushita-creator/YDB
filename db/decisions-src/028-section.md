### C-6. 日付系列の生成を timestamp 経由にした

`generate_series(date, date, interval)` は date を timestamptz に暗黙変換し、
セッション TZ を一往復する。`::timestamp`（TZ なし）を経由して往復を消した。
