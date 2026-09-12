# HANDOFF — いまの状態と、待っている判断

## 2026-09-12（夜） — ホームのKPIが実績を数えていなかった（未コミット）

**現状**: 指摘「KPI は連携してんのかよ」。ホームのKPIカードは題名と目標しか描いておらず、
「アワード 150 ―」としか出ていなかった。`countKpiMetric`（0049・C-199 の数え方）を
呼んでいたのは `/kpis` だけである。ホームにも実績・達成率・棒を出すよう直し
（`/kpis` の `.kpi-viz` と**同じ部品・同じ数え方**を再利用。数え方は増やしていない）、
`tests/45_home.test.ts` に契約テストを1本足した（**わざと壊して落ちることを確認済み**）。
typecheck・biome 通過、KPI／ホーム関連 68 件緑。**`npm test` 全88ファイルの通しも緑（919 pass / 0 fail・EXIT 0）。**
1つ前のコミット `c0cd900`（学校が未記録の候補者を編集できなかった欠陥）は**push・デプロイとも未実施**。

**次の一手**
1. **本番未反映のまま2件たまっている。** 打つのは利用者:
   `cd /Volumes/KIOXIA_2TB/NEO/YouthDB && git push origin main`
   → `cd /Volumes/KIOXIA_2TB/NEO/YouthDB && npm run deploy:production`
   （先頭の「書き込み先 ―― …」が約束したプロジェクトかを見る。違えば止める）
3. 反映後に `/people/new`（学校が空の行を直せるか）と `/`（KPIが 5/150・3% の形で出るか）を目視。

**触ったファイル**: `app/page.tsx` `tests/45_home.test.ts`（この節）。
`c0cd900` の分は `src/commands/profile.ts` `src/commands/intake.ts` `src/commands/sheet.ts`
`app/_components/sheet.tsx` `app/people/[id]/edit/page.tsx` `tests/29` `tests/41`。


## 2026-09-12 — 学校が未記録の候補者を編集できなかった欠陥を直した（未コミット）

**現状**: 表（`/people/new`）で「3 行は入らなかった。」だけが出て理由が読めない、という指摘。
再現は学校が空の3行（中西・上木場・本田）。0054「姓だけ必須」が**登録にしか入っておらず**、
編集（`updatePersonProfile`）は活性の学校を必須のまま残していた ―― 寄せ先「学校未記録」は
選択肢に出ないので、その人は名前1文字も直せない。落ちた理由も表の下端にしかなく画面外だった。
直した4点: ①`src/commands/profile.ts` 学校を任意化（未選択は登録と同じ寄せ先／非活性でも
その人の現在の学校なら通す） ②`app/_components/sheet.tsx` 理由を件数の真下へ ③`app/people/[id]/edit/page.tsx`
学校 select に空と現在の記録を足し `required` を外す（**先頭の学校が黙って選ばれていた**）
④同 名の `required` を外す。先に落ちるテストを書いてから直した。
実測: `tests/29`(9) `tests/41`(13) `tests/36` `tests/56` 全緑・typecheck・biome 通過。
**`npm test` 全88ファイルの通しも実測で緑（918 pass / 0 fail・EXIT 0・約320秒）。**

**次の一手**
1. commit（`fix(profile): 学校が未記録の候補者を編集できるようにする`）。テストは通し済み。
2. ブラウザ目視が未実施。**本番未反映**。デプロイ前に `/people/new` で学校が空の行を直せることを1回見る。
3. 前セッションからの持ち越し（本番マイグレーション 0054〜0056 の適用状況・承認待ちのプラン
   `.plans/2026-09-09-home-grade-partner-profile.json`）は下の 2026-09-09 節のまま。

**触ったファイル**: `src/commands/profile.ts` `src/commands/intake.ts`（PLACEHOLDER を export）
`src/commands/sheet.ts`（文言）`app/_components/sheet.tsx` `app/people/[id]/edit/page.tsx`
`tests/29_profile_editing.test.ts` `tests/41_sheet_bulk.test.ts`


## 2026-09-09（夜） — 達成状況をコードから判定し直した。プランは承認待ち

**現状**: 9/2 MTG原文の12要件を、ドキュメントではなく**コードから**判定した（Codex read-only・各件で
実体のパス:行／画面からの到達可否／テスト実測合否）。昼の自己申告と3件ずれた ――
**「評価軸が流れ続けるUIの修正」は未実装**（`app/_styles/02-shell.css:297` で 90 秒周期の marquee が生きている。
昼は C-239 で済としていた）。逆に**面接評価シートは実装済**（`app/interviews/[evaluation]/page.tsx:121`・テスト17件合格）、
**対応者リストの編集も実装済**（`/staff/new`・テスト12件合格）で、残りはデータ作業。
次バッチのプランはゲート合格（`.plans/2026-09-09-home-grade-partner-profile.json`・4件95分・
ブランチ `feat/home-grade-partner-profile` は未作成）。`fea74a3` `ef8e975` は push 済み・デプロイ済み。

**次の一手**
1. **利用者の承認待ち。** 承認後に Codex へ1発注（プランの絶対パスを貼る）→ GLM レビュー → `改修ゲート.py verify`。
2. **本番マイグレーション 0054〜0056 の適用状況が未確認。未適用ならホームが 500**
   （ローカルで `relation "v_candidate_population" does not exist` を実測）。Vercel ログは 403、DB直結も権限で拒否。
   `YOUTHDB_INTAKE_DIR=/Volumes/KIOXIA_2TB/YouthDB-private npm run db:migrate:production`
   （ホスト名の入力承認あり。`applied: 0` なら既に当たっている）。不可逆なので人の判断。
3. `.audit/reports/2026-08-19-*.json` の生年月日9本（Critical 10・今回の改修と無関係）の扱い。

**触ったファイル**: `.plans/2026-09-09-home-grade-partner-profile.json`（新規）と同 `.基準.json`、この HANDOFF.md のみ。
プロダクトコードは1行も変えていない。

**教訓**: 達成判定を前セッションの HANDOFF から引き写した。自己申告は証拠ではない。コードとテスト実測で判定する。

## 2026-09-09（昼） — 改修要件（MTG原文）の達成確認

達成＝対象外(F)／候補者数（全体6−対象外2＝ホーム「候補者」4）／個人ページのイベント履歴／
KPIのアワード連携（5/150人・3%）／月カレンダーと参加者表示（R10）／UI刷新（C-239・意匠テスト15本緑）。
半分＝S/A/B/C内訳（数える口はあるがホームに内訳カード無し）・AI自由記述。
未着手＝CSV一括登録／イベント一括登録／対応者リスト／チェックリスト／マイルストーン／団体プロフィール／
「所有権・編集権限・バックアップ体制の再確認」。
検証はデモデータの使い捨てDB（.pgdata-visual、後始末済み）。R10 6本・意匠15本・リスク9本＋typecheck すべて合格。

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
