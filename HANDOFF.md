# HANDOFF — いまの状態と、待っている判断

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
