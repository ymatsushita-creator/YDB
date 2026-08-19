# process.md — 開発ループ

要件と設計原則は上位文書に置く。本書では作業手順だけを定める。

0. **既に決まっていないか** `db/DECISIONS-INDEX.md` を引く。決着済みなら覆さず持ち帰る
1. 変更が答える問いを1つ選ぶ
2. 記録層に必要な事実があるか確認する
3. 失敗するテストを書く
4. 記録層、集計、画面の順に実装する
5. DOMまたはSQL値で動作を確認する
6. `db/DECISIONS.md` に理由とテストを記録し、`pnpm decisions:index` を回す
7. **`pnpm verify` を通す**（型検査・テスト・索引・構成基準・ビルド）
8. 独立した目で見る（`reviewer` サブエージェント）。実装した本人の申告を根拠にしない
9. 監査が Critical / High を出していないことを確かめてから、コミットして GitHub へ反映する

## 変更しないもの

- `basic/*.sql` は受領原典
- 適用済みマイグレーション
- 凍結済み `docs/reports/REPORT-*.md`
- 生成物（`app/tokens.css` / `db/DECISIONS-INDEX.md`）。作り直す道具の側を直す
- 監査法人の管轄（`.audit/` / `.githooks/` / `.github/workflows/audit.yml`）

## 未確定事項

推測で埋めず、`db/DECISIONS.md` の D 節か `HANDOFF.md` に残す。
