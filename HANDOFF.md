# HANDOFF — いまの状態と、待っている判断

測定日: 2026-08-19 / 基準コミット `bcf18f3`（ブランチ `fix/quality-gate-false-pass`。`main` から 11 コミット）

**この文書は「いまの状態」だけを持つ。** 経緯は `docs/consultant/`・`docs/reports/`・`db/DECISIONS.md` にある。

## 監査意見

```
【限定付適正】 Critical 0 / High 2 / Medium 34 / Low 1   （17/18 手続・実施不能 1）
```

High 2件はどちらも `D5-03`。**過去の High 3件（公開ミラー関連）は解消した** ――
公開リモート `mirror=ymatsushita-creator/YDB` を外したため、
「公開先の必須チェック未設定」「人間レビュー未設定」「公開リモートの存在」が消えた。

| 残る High | 内容 |
|---|---|
| D5-03 | 本番へ出した記録が1件も無い（★12回連続）。以後 `deploy-gate` を通して蓄積する |
| D5-03 | 未pushのコミットが1件（★3回連続）。`origin` へ push すれば消える |

## 動くか

```
pnpm verify   → S9 で止まる（exit 1）
  型検査      tsc --noEmit              通過
  テスト      887件 / 205 suite         全pass
  索引        DECISIONS-INDEX 220件     最新
  構成基準    S1〜S12 のうち S9 のみ ✘
  ビルド      next build                成功
```

**S9 は意図して赤い。** 現役の `ANTHROPIC_API_KEY` が git 履歴（`0c9cd6e`）に在り、
依頼者の判断でその鍵を使い続けている。事実が変わるまで緑にはしない
（`docs/audit/2026-08-19-secret-in-history.md`）。日常の作業は `pnpm verify:fast` で回す。

## 待っている判断

| # | 何を | 誰が | 現在の影響 |
|---|---|---|---|
| 1 | **欠番45件**を `db/DECISIONS.md` へ書く（一覧は索引の先頭） | 依頼者のみ | 番号で設計判断を辿る仕組みが、その分だけ空を指す |
| 2 | `domain.md` へ旧語対応表を入れる（`.tmp/domain-glossary.patch`）＋ `kurosaki install --repo .` | 依頼者 | 正典がコードの語彙（森179・林152・木56）を説明していない |
| 3 | `quality.yml` を required status check にする | 依頼者（GitHub） | CIが落ちてもマージできる |
| 4 | 次回デプロイから `deploy-gate` を必ず通す | 依頼者 | 本番へ出した証跡が1件も無い（High） |
| 5 | 番号の重複3件（索引の先頭に掲げてある）—— どちらを正とするか | 依頼者のみ | 番号の参照先が定まらない |
| 6 | `db/DECISIONS.md` の分割（`CLAUDE.md` の書き換え＋再封印を伴う） | 依頼者 | 49万字。`pnpm decisions:show` で当面は凌げている |

1・5 は **AIが埋められない**（`CLAUDE.md`「記録にない値の創作」の禁止）。
2・6 は封印対象の編集を伴い、pre-commit が止める。**許可があっても機械は止まる。**

## 欠番45件について

実行⑯・⑰は**報告書も設計判断も残さずに終わった。**
`docs/reports/` は REPORT-15.1（実行⑮）で止まっており、
`db/DECISIONS.md` の穴と `docs/reports/` の穴は同じ穴の両側である。

```bash
pnpm decisions:missing          # 参照元のコードから手がかりを集める
pnpm decisions:missing <番号>   # 1件だけ
```

実行⑯ 2件 / 実行⑰ 23件 / 手がかりなし 20件。コメントの多くが
「依頼者の指示。実行⑰」まで書いているので、そこから思い出せる可能性がある。

## 残る根本的な限界

- **品質側の検査は封印されていない。** `scripts/check-structure.ts`
  `.github/workflows/quality.yml` `.claude/settings.json` `.consultant/` はいずれも
  `.audit/MANIFEST.sha256` の対象外で、条件を消せば検査は黙る。
  **品質ゲートを作ったAI自身がそれを消せる。** 検知は人間が差分を読むことに依存する。
- **番号を「使う」ことは強制できても、「書く」ことは強制できない。**
  CI は索引のずれを落とすが、最初から書かれなかった判断は検知しようがない。
  実行⑯・⑰で実際にそれが起きた。索引の先頭に欠番が毎回掲げられることだけが防壁である。
- `origin=NEO-AX/YDB` のブランチ保護は**監査が確認できていない**（`gh` のプラン制限）。
  未検査であって、安全という意味ではない。
- production seed 8件の追跡除外（D2-02 Medium）は、外すと本番マイグレーションと
  パイロットDBの再現性が失われるため保留。

## 次にやること

`origin` へ push する（未push 1件の High が消える）。公開リモートは外してあるので、
`git push -u origin fix/quality-gate-false-pass` は非公開側へ向く。
