# db/ —— 記録の形と、設計判断

```
pnpm decisions:show C-121
```

```
pnpm decisions:index && pnpm decisions:parts
```

- **`DECISIONS.md` を開かない**（496,136字＝33万トークン相当）。番号から `db/decisions/<番号>.md` を1件だけ開く。
- `DECISIONS-INDEX.md` と `db/decisions/` は**生成物**。手で編集しない。道具（`scripts/build-decisions-*.ts`）を直す。
- 追記したら索引と写しを同じ差分でコミットする。ずれは CI が `--check` で落とす。
- **番号を書いたら記録も書く。** 記録の無い新番号は S13 が落とす。
- 適用済みマイグレーションを編集しない。**新番号で追加する。**
- 番号の重複を黙って振り直さない（git 履歴側の参照は直せない）。索引の先頭に掲げ、人間が決める。
