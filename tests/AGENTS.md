# tests/ —— テスト

```
pnpm test
```

- ファイル名は `NN_主題.test.ts`。番号は `db/DECISIONS.md` から参照される。
- **グロブは引用符で囲う**（`sh` に globstar は無い。外れると直下が沈黙して緑になる。S8）。
- `node --test` は対象0件でも exit 0 を返すので、`scripts/test-preflight.ts` が前段で落とす。
- 実在の個人情報を使わない。ダミーは Faker(ja_JP)。
- **架空の設計判断番号を本文に書かない**（`C-` 接頭辞は欠番として拾われる。S13）。
- テストを消す・skip する・閾値を下げる —— 禁止（S7）。
