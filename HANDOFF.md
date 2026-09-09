# HANDOFF — いまの状態と、待っている判断

## 2026-09-09 — 改修ループ 第1フェーズ（実装完了・commit 待ち）

**現状**: 第1フェーズ（R2 候補者数の定義統一 / R7 アワード参加人数のKPI連携 / R3 個人ページのイベント名）を
実装し、`改修ゲート.py verify` **合格**（AC4本＋リスク7本すべて合格・プラン逸脱0本）。
プランは `.plans/2026-09-09-第1フェーズ.json`、要件の正本は `docs/product/改修要件-2026-09.md`。
記録は `~/Desktop/AI効率化/data/改修記録.tsv`。

- 新規: `db/migrations/0055_candidate_population.sql`（`v_candidate_population` = 候補者番号の全体 −
  `is_terminal`。`declined` の表示を「対象外(F)」へ）／`0056_kpi_event_attendance.sql`（KPI指標 `event_attendees`）
- 変更: `dashboard.ts` `kpi_metrics.ts` `borderline.ts` `ai/ask.ts` `drilldown.ts` `app/people/[id]/page.tsx`
- テスト: 28_headhunting 17→19 / 72_kpi_metric 5→8 / 12_drilldown 18→19。**実装を外すと3本とも落ちることを確認済み**
- typecheck・biome ともに通過

**この回で直した既存の欠陥3件**（いずれもテスト／ゲートが無ければ出荷されていた）
1. 新ビューに `state_since` が無く `ORDER BY h.state_since` が壊れた（回帰1本で検出）
2. `AS S` が Postgres で `s` に畳まれ、型宣言と実キーが不一致（AIの期サマリの内訳が読めない）。`AS "S"` に
3. `改修ゲート.py` が `git status --porcelain` の1行目を1文字食う（`.strip()` × 固定長スライス）

**次の一手（利用者の判断が要る1点）**: commit が**既存の欠陥で止まっている**。
監査を実行した実数は **Critical 10 / High 8 / Medium 6 / Low 1**。
**Critical 10 件はすべて D6-01** ——「`.audit/reports/2026-08-19-*.json` に BIRTHDATE」。
追跡下の監査調書9本に生年月日が入っており、**2026-08 に一度指摘されて残ったまま**（★過去1回同じ指摘）。
`git diff origin/main...HEAD -- .audit` は **0本** ＝ 今回の改修とは無関係。
`CLAUDE.md` により `.audit/` の編集は禁止、allowlist を広げて通すのも禁止。
**追跡下からの除去は不可逆（履歴に残る）ため、判断は人が持つ。** 選択肢は
(a) 調書9本を追跡から外し履歴も落とす (b) 調書内の生年月日を伏字化して調書を作り直す
(c) 限定事項として引き受け、commit だけ通す運用を明文化する。
PII 走査側で私の変更に出た High 3件（テスト内の架空氏名）は、氏名リテラルを消して**0件**にした。

その後は第2フェーズ（R1 ブラウザCSV 240分 → R4 対応者リスト 80分）。

**触ったファイル（15本・すべて未コミット）**: 新規2 `db/migrations/0055` `0056`／変更6 `src/queries/{dashboard,kpi_metrics,borderline,drilldown}.ts` `src/ai/ask.ts` `app/people/[id]/page.tsx`／テスト3 `tests/{28_headhunting,72_kpi_metric,12_drilldown}.test.ts`／記録4 `HANDOFF.md` `docs/product/改修要件-2026-09.md` `.plans/` `.agents/skills/source-command-decisions/`（最後は改修前から在る未追跡物・未変更）。
AI効率化側も未コミット: `bin/改修ゲート.py`（リスク実行・porcelain 解析）`hooks/check-code-plan.sh`（誤爆修正）`hooks/tests/check-code-plan.test.sh`（回帰3本追加）`bin/受け入れ判定.py` `docs/失敗台帳.md` `NEO-AI-ROUTING.md`。

**決めたこと（データで決定・聞いていない）**: 対象外(F) = 既存 `declined` の表示ラベル。新規ステータスを足さない
（`declined` 70人中67人が復帰しており、終端を新設すると復帰運用と二重管理になる）。
247人の一括対象外印の是正と、追わない扱いで確度が付いた33人の掃除は**運用判断**でありコード改修の外。
`is_terminal` 側で除外が効くため候補者数には影響しない。

---

測定日: 2026-08-20 / 基準コミット `1ad2d97`（ブランチ `fix/quality-gate-false-pass`）

**この文書は「いまの状態」だけを持つ。** 経緯は `docs/consultant/`・`docs/reports/`・`db/DECISIONS.md` にある。

## 完了条件

```
pnpm verify   →  全段緑（EXIT 0。2026-08-20 実測）
```

| 段 | 実測 |
|---|---|
| lint（biome） | 236ファイル・所見0 |
| 型検査 | 通過 |
| テスト | 899件 pass / 0 fail・207 suite・約247秒 |
| 正典の組み立て | `db/DECISIONS.md` は原稿284本と一致 |
| 索引・写し | 一致 |
| 構成基準 | **S1〜S14 すべて緑** |
| ビルド | 通過 |

## 監査意見

```
【限定付適正】相当  Critical 0 / High 2 / Medium 3 / Low 1   （17/18 手続・実施不能 1）
```

- **High `D5-03`** —— `.audit/deploys` の記録が0件。`scripts/deploy-production.ts` は
  `deploy-gate` を通す作りになっている（`scripts/deploy-production.ts:44`）ので、
  **次に本番へ出したときから記録が残る。** 過去分は復元できない。
- **High `D7-02`** —— allowlist が人間以外の名義で変更されている。**2026-08-20 に依頼者が
  署名の代理を Claude に許可した**結果である（`.audit/allowlist.yml` の各 `approved_by` に明記）。
  ツールから見れば「AIが自分への例外を書ける状態」であり、判定は正しい。
  依頼者は限定事項として引き受ける判断をした。
- **Medium `D7-01`** —— `allowlist.yml` がツール側の雛形より古い（改変ではない）。
- **実施不能 `D3-05`** —— ブランチ保護を確認できない（private プランの制限）。

PII 走査は **236件すべて allowlist 除外・未除外0件**（2026-08-20。D6-01 の32件を登録）。

## 構成（S1〜S14 が強制している形）

```
ルート直下      規律文書8本 ＋ 設定11本（biome.json を含む）
近傍の規約      app / src / src/commands / src/queries / db / scripts / tests / docs に AGENTS.md
docs/           audit / consultant / pilot / product / reports / guides の6分類（直下は AGENTS.md のみ）
設計判断        原稿 db/decisions-src/ 284本（最大95行）→ db/DECISIONS.md（生成物）→ 索引・1件1ファイル
AI資産          .claude/ の1系統だけ（.agents/ .codex/ 等の写しは S5 が落とす）
```

規律の実体は **`AGENTS.md`**（`CLAUDE.md` はポインタ。2026-08-20 に反転。C-232）。

## 待っている判断（人間しかできない）

1. **履歴に在る現役の `ANTHROPIC_API_KEY`**（`0c9cd6e`）。**まず鍵の失効・再発行。**
   履歴の書き換えは不可逆操作で、`Hitler.md` §4 が禁じている。S9 は台帳に据え置いて増分だけを見る。
2. **`quality.yml` を required status check にできない。** private プランではブランチ保護も
   ruleset も 403。プランを上げるか、限定事項として引き受けるかを決めれば閉じる。
3. **欠番45件**（C-番号44 ＋ `D-30`）と、番号の重複3件（`C-45` `C-46` `C-116`）。
   AIは埋められない（`AGENTS.md`「記録にない値の創作」の禁止）。`pnpm decisions:missing` が下ごしらえを出す。
4. **`.consultant/` は封印されていない。** 改竄は機械では検知されない。
5. **実データは NEO の外に在るが、同じ物理ディスク上**。NEO 構成基準 R2 の条文は未充足。

## 直近の変更（2026-08-20）

`ac2a137` → `e1a3e78` → `1ad2d97`

- C-230 AI資産の写し（`.agents/` `.codex/` `.cursor/rules` の複製）を畳み、S5 で再発を止めた
- C-231 完了ゲートに Lint を足した（`Hitler.md` §5-1 の未充足を閉じた）
- C-232 `AGENTS.md` を実装規律の実体にした（§2 の逸脱を解消）
- C-233 近傍 `AGENTS.md` 8本と `docs/guides/glossary.md`（§2・§3）。S14 として機械化
- C-234 正典を原稿284本の連結にした（§2 の200行を、パスを動かさずに充足）
- allowlist に D6-01 の32件を指紋単位で登録（署名は依頼者の許可による代理）

★ `Hitler.md` §0 の逸脱表に残っているのは、上の「待っている判断」の1・2だけである。
