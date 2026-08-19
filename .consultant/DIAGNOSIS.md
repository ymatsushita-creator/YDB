# 構成診断 —— 2026-08-19

対象: `/Volumes/KIOXIA_2TB/NEO/YouthDB` @ `02aa6bd`
道具: `../コンサル/bin/consultant analyze`

## スコア

```
実施前  75/100   C05（権限設定なし）・C06（サブエージェントなし）・C07（.env.example なし）
実施後 100/100   所見なし
```

## 実測値

| 領域 | 実測 |
|---|---|
| コード | app 9,385行 / src 13,930 / db 15,420 / scripts 3,540 |
| テスト | 84ファイル・**887件**・205 suite・約175秒・全pass |
| ルート直下の `.md` | 44本 → **9本**（`REPORT-*.md` 35本を `docs/reports/` へ） |
| 設計判断 | `db/DECISIONS.md` 8,524行・**220件**（索引を生成） |
| CI | `audit.yml` 1本 → **`audit.yml` + `quality.yml`** |

## 診断ツールが拾えなかった穴 —— これが本題だった

**`consultant analyze` の C04「CIがない」は実施前から通過していた。**
`.github/workflows` の存在だけを見る判定のため、監査CI 1本で満たされていた。

実際に測ると:

```
CI・フックで pnpm test / tsc --noEmit / build が走る箇所 → 1件も無い
```

`CLAUDE.md` の「完了条件」3項目を強制する機械が**1つも無かった**。
887件のテストが1度も回らないままマージできる状態だった。

これは非対称の問題である。個人情報と監査基盤の防御は
pre-commit / pre-push / CI の**三重**に固められ、`--no-verify` すら想定した設計なのに、
**「動くかどうか」は誰も見ていない。**

`.audit/AUDIT_CHARTER.md` §1 は「実装者の説明・コミットメッセージを根拠として採用しない」と
定めている。同じ理屈が品質側に適用されていなかった。

**スコア100は「穴が無い」ではなく「既知の7項目に穴が無い」である。**

## 実施した是正

| 所見 | 是正 |
|---|---|
| **品質ゲート不在**（診断外） | `pnpm verify` と `.github/workflows/quality.yml` |
| **ルートの汚染**（診断外） | `REPORT-*.md` 35本を `docs/reports/` へ。README を着手導線に |
| **索引の不在**（診断外） | `db/DECISIONS-INDEX.md` を生成（220件）。CI が `--check` |
| C05 権限設定 | `.claude/settings.json`（deny 29 / ask 7） |
| C06 役割分離 | `.claude/agents/` に `investigator` と `reviewer` |
| C07 環境変数の契約 | `.env.example`（値は空） |

あわせて監査 2026-08-19 の **D2-01（High）** を解消した ——
`.gitignore` 1行が唯一の防壁だった実データ49MBをリポジトリ外へ移し、
`scripts/intake-dir.ts` に「受け入れ口をリポジトリ内へ向けさせない」検査を追加した。

## 第2次 —— コンサルを機械に組み込んだ（同日）

診断と文書だけでは、黒崎（フック・CI・deploy-gate で強制）に対して
**コンサル層は誰も回さなければ守られない**状態だった。同じ非対称を作らないため、
基準そのものを機械にした。

| 資産 | 役割 |
|---|---|
| `.consultant/TOOL_PATH` | 道具の位置を固定（`.audit/TOOL_PATH` と同じ形） |
| `scripts/check-structure.ts` | `STRUCTURE.md` の S1〜S7 を機械で照合。破れば exit 1 |
| `pnpm structure` | 単体で回す |
| `pnpm verify` | 完了条件の一部として回る（typecheck → test → 索引 → **構成** → build） |
| `quality.yml` | CI でも走る |
| `.claude/commands/plan.md` | 標準工程の第1段（観察→診断→計画。実装しない） |
| `.claude/commands/structure.md` | 崩れたときの直し方 |

### 検査が本当に効くことを確かめた（負のテスト）

「通るだけの検査」を資産と呼ばないため、意図的に4つ壊して落ちることを確認した。

| 壊し方 | 結果 |
|---|---|
| ルートに `MEMO.md` を置く | ✘ S2 で exit 1 |
| `deny` から `git push` を外す | ✘ S4 で exit 1 |
| `db/private/` を復活させる | ✘ S6 で exit 1 |
| `verify` から `test` を抜く | ✘ S1 で exit 1 |

いずれも復旧後に全項目パスへ戻ることも確認した。

### この仕組みの限界

- CI からは外部ツールを解決できないため、**C01〜C07 は CI では実行されない。**
  スクリプトはそれを「未実行」と明記して通す。**「問題なし」とは言わない。**
  CI が必ず強制するのは S1〜S7 である。
- `scripts/check-structure.ts` 自体は封印されていない。条件を消せば検査は黙る。
  検知は人間が差分を読むことに依存する（`CHARTER.md` §5 と同じ限界）。

## 残っている穴

1. **`quality.yml` が required status check ではない。** 設定するまで、CIが落ちてもマージできる。
   人間がGitHubで設定する。
2. **規律文書4本がマニフェストと不一致**（監査 Critical 4件）。
   本診断の是正で `SUPERVISOR.md` `AGENTS.md` `CLAUDE.md` `process.md` を編集したため。
   再封印は人間が行う（`kurosaki install --repo .`）。
3. **`C-45` `C-46` `C-116` が各2件の判断に重複している。** 参照先が定まらない。
   `app/layout.tsx` とコミットメッセージが既に参照しており、AIの判断では振り直していない。
4. **`.consultant/` は封印されていない**（`CHARTER.md` §5）。改竄は機械では検知されない。
