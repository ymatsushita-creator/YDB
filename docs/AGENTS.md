# docs/ —— 文書

```
pnpm structure
```

- **直下にファイルを置かない。** 必ず分類へ入れる（S10 が落とす）。
- 分類: `audit/` 監査の是正記録 ／ `consultant/` 構成診断の経緯 ／ `pilot/` Pilot 運用 ／ `product/` 製品の参照資料 ／ `reports/` 凍結レポート ／ `guides/` 開発手順・用語
- **分類を増やすときは `.consultant/STRUCTURE.md` §10 を先に直す**（未定義の分類は落ちる）。
- 凍結文書は**先頭5行以内で凍結を名乗り、では何が正かを書く**（S12）。
- `reports/` と `consultant/` は**着手時に読む物ではない。**
