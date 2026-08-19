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
  1件1ファイル db/decisions/ 217件       最新（生成物。pnpm decisions:parts）
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
| 3 | **必須チェックの強制は、このプランでは不可能**（下記）。方針を決める | 依頼者 | CIが落ちてもマージできる |
| 4 | 次回デプロイから `deploy-gate` を必ず通す | 依頼者 | 本番へ出した証跡が1件も無い（High） |
| 5 | 番号の重複3件（索引の先頭に掲げてある）—— どちらを正とするか | 依頼者のみ | 番号の参照先が定まらない |
| 6 | 〜〜`db/DECISIONS.md` の分割〜〜 **解消** ―― 正典は残したまま `db/decisions/<番号>.md` へ1件1ファイルで展開した（生成物。CI が `--check` で一致を見る）。封印の書き換えは要らなかった | ―― | ―― |

1・5 は **AIが埋められない**（`CLAUDE.md`「記録にない値の創作」の禁止）。
2・6 は封印対象の編集を伴い、pre-commit が止める。**許可があっても機械は止まる。**

## `quality.yml` を必須チェックにできない件（D3-05・12回連続の指摘）

**「設定すれば直る」ものではなかった。** 2026-08-19 に実測した。

```
gh api repos/NEO-AX/YDB/branches/main/protection
  → 403 Upgrade to GitHub Pro or make this repository public
gh api repos/NEO-AX/YDB/rulesets
  → 403 同上
```

`NEO-AX/YDB` は private で、**現在のプランではブランチ保護も ruleset も使えない。**
サーバ側で必須チェックを強制する手段が存在しない。取れる道は3つしかない。

1. **プランを上げる**（GitHub Team 等）—— 保護と ruleset が使えるようになる
2. **受け入れる** —— 限定事項として明示的に引き受け、人間が push 前に CI を見る
3. 公開にする —— **採らない。** 現役の鍵が履歴に在り、実データに隣接する

12回「設定せよ」と指摘され続けたのは、実行不能な是正を要求していたためである。
**どれを採るかを決めて記録すれば、この所見は閉じられる。**

## 欠番45件について

実行⑯・⑰は**報告書も設計判断も残さずに終わった。**
`docs/reports/` は REPORT-15.1（実行⑮）で止まっており、
`db/DECISIONS.md` の穴と `docs/reports/` の穴は同じ穴の両側である。

```bash
pnpm decisions:missing          # 参照元のコードから手がかりを集める
pnpm decisions:missing <番号>   # 1件だけ
```

記入用の雛形つきシートを `.tmp/欠番-記入シート.md` に出してある（追跡外）。
各番号の下に `### C-nnn. 題名` の枠と、参照元のコードが並べてある。
埋めたら `db/DECISIONS.md` へ貼り、`pnpm decisions:index` で索引を作り直す。

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
