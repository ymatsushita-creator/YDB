---
description: 構成基準（.consultant/STRUCTURE.md）を確かめ、崩れていたら直す
---

```
pnpm structure
```

`S1`〜`S11` と、外部ツールの `C01`〜`C07` を見る。

## 落ちたときの直し方

**この検査の側を緩めない**（正典: `.consultant/STRUCTURE.md` §7）。

| ID | 崩れ方 | 直す場所 |
|---|---|---|
| S1 / S1b | `pnpm verify` から段が抜けた・`quality.yml` が回さない | `package.json` / `.github/workflows/quality.yml` |
| S2 | 着手時に読まない `.md` がルートに増えた | `docs/` へ出す |
| S3 | 索引が無い | `pnpm decisions:index` |
| S4 | `deny` から必須項目が消えた | `.claude/settings.json` |
| S5 | サブエージェントが消えた | `.claude/agents/` |
| S6 | 実データ・受け入れ口がリポジトリ内に戻った | 外部ディレクトリへ移す |
| S7 | `continue-on-error` / `--no-verify` / `\|\| true` が入った | 消す。握り潰しは事故を隠す |
| S8 | テストのグロブが引用符から外れた・前段が消えた | `package.json` の `test` |
| S9 | `.env` 系が履歴に入った・origin 以外のリモートが増えた | **まず鍵を失効**（`docs/audit/2026-08-19-secret-in-history.md`） |
| S10 | `docs/` 直下にファイルが増えた・未定義の分類ができた | `docs/{audit,pilot,product,reports}/` へ |
| S11 | 検査を足したのに `STRUCTURE.md` に節が無い | 基準を先に書く |

基準そのものが現実に合わなくなったと判断した場合だけ、
**`.consultant/STRUCTURE.md` を先に直し、その差分を人間が読む。**
検査を先に緩めて後から文書を合わせる順序にしない。

## C01〜C07 が「未実行」と出たとき

外部ツール `consultant` を解決できていない。`.consultant/TOOL_PATH` を確かめる。
**未実行は「問題なし」ではない。** そう報告すること。
