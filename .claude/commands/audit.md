---
description: 黒崎の監査を回し、所見を分類して、AIが直せる分だけ直す
---

独立監査を回して、結果を処理する。

```
kurosaki audit --repo .
kurosaki scan  --repo .
```

## 所見の扱い

意見に **Critical / High** が残る間は、commit / push / マージ / デプロイへ進まない
（`.audit/AUDIT_CHARTER.md` §4。`SUPERVISOR.md` の「監査文書の最高権限」）。

所見を3つに分ける。**分類を報告に必ず書く。**

1. **AIが直せる** —— コードの修正、ファイルの移動、設定の追加。直す。
2. **人間しか実行できない** —— `.audit/IRREVERSIBLE_OPS.md` に載っている操作、
   GitHub のリポジトリ設定、`.audit/` の編集、allowlist への署名。
   **提案までに留める。** 手順書を書いて渡す。
3. **誤検知** —— `*_WEAK` ルールは「要確認」であって確定検知ではない。
   検出値を原本の行と突き合わせ、**実体が何かを表で示す。**
   誤検知なら Faker への置換ではなく、指紋単位の allowlist 登録が正しい処理になる。
   ただし **`approved_by` への署名は人間だけが行える。** AIは断片を用意するに留める。

構成・工程の是正は `.consultant/STRUCTURE.md` の基準に合わせる。
**ただし監査が Critical / High を出している間、構成改善は着手の理由にならない。**

## してはならないこと

- `.audit/` `.githooks/` `.github/workflows/audit.yml` を編集すること
- 監査を通すために閾値を緩める / allowlist を広げる / `continue-on-error` を足す
- 「検査できなかった」を「問題なし」と言い換えること
