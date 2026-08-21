# scripts/ —— 道具

```
node scripts/<name>.ts
```

- **使い捨てをルートへ置かない。** 道具にするならここへ置く（S2 が追跡下のルートを見ている）。
- 受領データは `intake-dir.ts` 経由で外から取る。パスを直書きしない。**リポジトリ内を指す指定は拒否される。**
- 本番へ触る道具（`deploy-production` / `db-migrate-production` / `db-restore`）は**提案までで、実行は人間**（`.audit/IRREVERSIBLE_OPS.md`）。
- 生成物を作る道具は `--check` を持つ（CI がずれで落とせるように）。
- 架空データを入れる道具を既定で `DATABASE_URL` へ向けない（C-88）。
