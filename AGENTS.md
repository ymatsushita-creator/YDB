# AGENTS.md

このリポジトリの開発規律は **`CLAUDE.md` を正典**とする。
監督判断と権限境界は **`SUPERVISOR.md`** が下位文書に優先する。
その上に **`.consultant/`（作り方の構造）**、さらに上に
**`.audit/`（監査・最高権限）** が立つ。

以前この文書は `CLAUDE.md` の複製だったが、**複製は必ず片方だけ古くなる。**
実際、実行⑧の内容のまま29行分ずれていた。実行⑨で一枚のポインタに置き換えた。

## 着手前に読む順番

```
.audit/        Audit        何を出してはならないか（最上位・監査人の文書）
               AUDIT_CHARTER.md / IRREVERSIBLE_OPS.md / REMEDIATION.md / 監査意見
    ↓
.consultant/   Structure    どう作れば速く安全に回るか（構成・工程・ゲート）
               CHARTER.md / STRUCTURE.md / DIAGNOSIS.md
    ↓
SUPERVISOR.md  Oversight    誰が設計・実装を許可するか
    ↓
vision.md      Why          なぜ存在するのか（内容は未受領。枠のみ）
    ↓
director.md    Principles   何を守るのか（憲法）
    ↓
domain.md      Model        何が存在するのか
    ↓
    ↓
CLAUDE.md      Engineering  どう開発するのか  ← 開発規律の正典
    ↓
process.md     Loop         どう回すのか（MVP モード）
```

上が下に優先する。ただし**食い違いを勝手にどちらかへ寄せない。**
`SUPERVISOR.md` は、この監督チャットで依頼者から明示指示を受けた監督官だけが変更できる。
`.audit/` は監査人の文書であり、**監督官を含め誰も実装セッションからは変更できない。**
監査意見に Critical / High が残る間は commit / push / マージ / デプロイへ進まない。
`.consultant/` は構成・工程だけを扱い、**プロダクトの中身（vision / director / domain）には及ばない。**
`.audit/` と食い違えば監査が勝つ。

## そのほか

- **`README.md`** —— 着手の導線。読む順番・検証コマンド・ゲートの一覧
- **`HANDOFF.md`** —— 引き継ぎ。いま何が動いていて、誰の判断を待っているか
- **`db/DECISIONS-INDEX.md`** —— 設計判断の索引（生成物）。`C-121` から本文の行へ辿る
- **`db/DECISIONS.md`** —— 記録の本体。原典から変えた点と理由
- **`docs/reports/`** —— 実行①〜⑮の凍結レポート。**着手時に読む物ではない**

## 完了条件は1本

```
pnpm verify
```

型検査・テスト・索引・構成基準・ビルド。同じものが `.github/workflows/quality.yml` で走る。
**回したという申告ではなく、機械が通ったことが完了の根拠である。**
