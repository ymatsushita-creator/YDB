# HANDOFF — いまの状態と、待っている判断

測定日: 2026-08-19 / 基準コミット `02aa6bd`

**この文書は「いまの状態」だけを持つ。** 経緯は `docs/reports/` と `db/DECISIONS.md` にある。

## 監査意見

```
【限定付適正】 Critical 0 / High 4 / Medium 34 / Low 1   （17/18 手続・実施不能 1）
```

依頼者が規律文書の変更を承認し、`kurosaki install --repo .` で
`SUPERVISOR.md` `AGENTS.md` `CLAUDE.md` `process.md` を再封印した。
再監査（`.audit/reports/2026-08-19-02aa6bd-08.json`）で D7-01 の Critical 4件は解消した。

High 4件は、公開ミラーの必須チェック未設定・人間レビュー未設定・公開リモートの存在、
および過去のデプロイ記録が無いこと。依頼者が限定事項として進行を承認済みである。

## 動くか

```
pnpm verify   → 通る（exit 0）
  型検査      tsc --noEmit           通過
  テスト      887件 / 205 suite      全pass
  索引        DECISIONS-INDEX 220件  最新
  ビルド      next build             成功
```

## 未コミットの変更

作業ツリーに 69 件。内訳は次の3つで、**いずれもまだコミットしていない**。

1. **監査是正**（2026-08-19 の監査より）
   - 実データ 49MB をリポジトリ外へ移した（D2-01 High を解消）
   - `scripts/intake-dir.ts` に「受け入れ口をリポジトリ内へ向けさせない」検査を追加
   - `git config remote.pushDefault origin`（公開ミラーへの誤 push を防ぐ）
2. **権限構成の3層化** —— `.audit/`（監査・最高権限）→ `.consultant/`（構成基準）→ 既存文書。
   `.consultant/` に `CHARTER.md` / `STRUCTURE.md` / `DIAGNOSIS.md` を新設し、
   `SUPERVISOR.md` `AGENTS.md` `CLAUDE.md` `README.md` の序列を揃えた
3. **構成の改造**（AI駆動開発の体制整備）
   - `pnpm verify` と `.github/workflows/quality.yml` を新設
   - `REPORT-*.md` 35本を `docs/reports/` へ退避
   - `db/DECISIONS-INDEX.md` を生成（220件）
   - `.claude/settings.json` / `agents/` / `commands/` と `.env.example` を整備

## 残っている運用課題

優先順に並べる。依頼者は現在の限定事項を承知したうえで進行を承認済み。

| # | 何を | 現在の影響 |
|---|---|---|
| 1 | **GitHub の設定** —— 公開ミラーの要否、`main` の必須チェックとレビュー必須（High 3件） | 設定しない限り、公開ミラーはCI失敗時にもマージできる |
| 2 | **`quality.yml` を required status check にする** | 設定しない限り、品質CIが落ちてもマージできる |
| 3 | **allowlist への署名** —— `docs/audit/2026-08-19-allowlist-additions.yml` の `approved_by` を埋める | 監査上の Medium 30件を架空値・用語として正式に除外する場合に必要 |
| 4 | **次回デプロイから deploy-gate を必ず通す** | 過去の記録は復元できないため、以後の証跡を蓄積する |

## 独立レビュー（2026-08-19・4班）で判明した限界

**15の回避経路と複数の実装欠陥が実証された。** AIが直せる分は修正済み:

- `pnpm test` のグロブが `sh` に食われる問題 —— サブディレクトリにテストを1本置いた瞬間、
  **既存84本が沈黙して消える**状態だった。引用符で囲い、`scripts/test-preflight.ts` で
  対象0件と展開崩れを検知する
- `scripts/intake-dir.ts` の防壁 —— cwd依存・シンボリックリンク・大小文字の3経路で抜けていた。
  実体解決（`realpathSync.native`）とリポジトリ基準の解決に直し、S6 が毎回3経路を実際に試す
- `scripts/check-structure.ts` —— 全項目が文字列一致で、偽リポジトリに素通りされた。
  挙動で見る形へ作り直し、レビューが通した7つの回避が落ちることを確認済み
- `.claude/settings.local.json` から `node -e ' *` / `python3 -c ' *` / `pnpm exec *` を削除。
  **この3件が deny 全項目を無効化していた**（Bash経由で実APIキーが読める状態だった）
- `db/DECISIONS-INDEX.md` —— 参照されているのに本文に見出しが無い番号を **54件**検出するようにした

**残る根本的な限界**: `scripts/check-structure.ts` `.github/workflows/quality.yml`
`.claude/settings.json` `.consultant/` はいずれも封印対象外である。
条件を消せば検査は黙る。**品質ゲートを作ったAI自身がそれを消せる。**
`.audit/` が持つ不可侵性が品質側には無く、ここは人間が差分を読むことに依存している。

## 次にやること

承認・再封印済みの変更をレビュー可能な単位でコミットし、非公開の `origin` へ反映する。
公開ミラーへは、必須チェックと人間レビューを設定するまで送らない。

## 未確定事項

- `db/DECISIONS.md` の `C-45` `C-46` `C-116` が**それぞれ2件の判断に使われている**。
  番号で参照する設計なのに参照先が定まらない。`app/layout.tsx` とコミットメッセージが
  既に参照しているため、AIの判断では振り直していない。索引の先頭に掲げてある
- `origin=NEO-AX/YDB` のブランチ保護は**監査が確認できていない**（`gh` のプラン制限）。
  未検査であって、安全という意味ではない
- production seed 8件の追跡除外（D2-02 Medium）は、外すと本番マイグレーションと
  パイロットDBの再現性が失われるため保留。判断は remediation 文書の④
- **`.consultant/` は `.audit/MANIFEST.sha256` に登録されていない。**
  監査層と違い、改竄が D7-01 では検知されない。不可侵性は運用に依存する
  （`.consultant/CHARTER.md` §5）
