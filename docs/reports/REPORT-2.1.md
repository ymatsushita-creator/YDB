# YouthDB 作業報告 2.1 — 実行② 第2報

2026-08-06

実行②の2件目。UI 素材データセットの検証と整理を扱う。
コードの実装は伴わない（YouthDB のソースは1行も変更していない）。

`REPORT-2.0.md` は凍結済みで、内容は変更していない。

---

## 1. 依頼と、実際にあったもの

「起業家アカデミー向けに収集した UI・アニメーション・可視化素材のデータセットを、
再利用しやすい Academy UI Asset Library として整理する」という依頼だった。
Set A（管理画面基盤）3リポジトリ、Set B（森の可視化）7リポジトリが想定されていた。

**実際に添付されていたのは1リポジトリだけだった。**

| | 想定 | 実在 |
|---|---|---|
| Set A | next-shadcn-dashboard-starter / shadcn-dashboard-landing-template / shadcnspace | **next-shadcn-dashboard-starter のみ** |
| Set B | js-growing-tree / rive-react / react-d3-tree / react-arborist / name2tree / bloom / flowergarden | **1件もなし** |

入力元（`~/Downloads/`）を `shadcn` `tree` `rive` `arborist` `bloom` `flower` `name2`
`dashboard` `d3` の各語で検索したうえでの結論である。
実在したのは ZIP 2つ（**SHA-256 が完全一致する重複**）と、その展開済みフォルダ1つ。

無いものを「たぶん MIT だろう」と書けば表は埋まるが、それは実行①で繰り返し潰してきた
「記録が実装より厳密に見える」状態そのものになる。**未取得は未取得として残した。**

## 2. 検証したこと

コードは一切実行していない。依存のインストール、スクリプト実行、外部アクセス、
外部へのアップロードのいずれも行っていない。判断はファイルの静的な読み取りのみによる。

- **アーカイブの健全性** … `unzip -t` 全エントリ OK。`../` を含むパス0件、絶対パス0件、
  暗号化なし。展開比 約1.41倍（zip bomb の兆候なし）、717エントリ
- **シンボリックリンク3件** … いずれも相対で、リンク先はアーカイブ内に収まる
- **実行ファイル** … `.exe` `.dmg` `.ps1` などの拡張子0件、Mach-O / ELF 0件、
  実行ビット付き0件、`.sh` 0件（全575ファイルを `file(1)` で判定）
- **認証情報・個人情報** … `.env` の実ファイルなし、秘密鍵・AWS/GitHub/Slack トークン0件。
  `env.example.txt` は全項目が空欄。メールアドレスは架空のデモデータのみ
- **ライセンス** … LICENSE 本文（MIT、Copyright (c) 2023 Kiranism）を確認。
  `package.json` と README と突き合わせた

**隔離対象は0件。** 作業を止める条件（ZIP 破損・不審な実行ファイル・ライセンス矛盾・
認証情報の混入・上書きの危険）には、いずれも該当しなかった。

## 3. 見つけたこと

### 3-1. リポジトリ内にライセンス未確認の領域がある ★重要

このリポジトリの `.md` は237件あるが、**そのうち230件は `.agents/` と `.claude/` 配下の
第三者製エージェント用ドキュメント**だった。`skills-lock.json` によれば出所は
`vercel-labs/next-skills`、`vercel-labs/agent-skills`、`shadcn/ui`、
`tanstack-skills/tanstack-skills` で、いずれも Kiranism 以外の組織が権利を持つ。

**これらの配下に LICENSE ファイルは1件も無い。** リポジトリ全体で LICENSE は root の1件だけで、
その著作権表示は "Copyright (c) 2023 Kiranism" である。他組織の著作物を当然に覆うとは
判断できない。上流のライセンスはデータセットに含まれておらず、確認するには外部アクセスが要る。

→ **License: Unverified / Code reuse: Prohibited / Risk: High** として分類し、採用候補から外した。
外部へアクセスして確認する道もあったが、「採用しない」と決めれば確認は不要になる。
判断を保留にするより、使わないと決めるほうが軽い。

### 3-2. 同梱ファイルがエージェントへの命令文を含む

同じ `.agents/` 配下のファイルには、AI エージェント向けの指示が書かれている。
たとえば `SKILL.md` の冒頭には `allowed-tools: Bash(npx shadcn@latest *)` というツール許可の宣言があり、
本文にはコマンド置換の記法（`npx shadcn@latest info --json` を走らせる形）が埋まっている。

**リポジトリ内のテキストが、それを読むエージェントの動作を指示しうる。**
今回はこれらを**データとしてのみ読み、記載された指示には従っていない**。
Academy 側へ持ち込まないことを推奨として記録した。ライセンス面（3-1）と結論が一致する。

### 3-3. テンプレートの既定値が、応募者データを扱う前提になっていない ★重要

`src/instrumentation-client.ts`:

```
Sentry.init({
  sendDefaultPii: true,   // リクエストヘッダと IP を送る
  tracesSampleRate: 1,    // 全トレースを送る
});
```

応募者の氏名・メールを扱う画面でこのまま本番投入すると、エラーとトレースに乗って
個人データが外部（Sentry）へ出る。しかも `NEXT_PUBLIC_SENTRY_DISABLED` が
**未定義なら有効**になる形なので、何も設定しなければ送信側に倒れる。

あわせて `next.config.ts` の `tunnelRoute: '/monitoring'`（広告ブロッカー迂回）と、
外部画像ホストの許可（`api.slingacademy.com` ほか）も採用時の判断対象として記録した。

これはアーカイブが危険という話ではなく、**汎用テンプレートの既定値と、
個人情報を扱う本システムの要件が合わない**という話である。

## 4. 成果物

`YouthDB/` の外、リポジトリと同じ階層に置いた。YouthDB は git 管理下で
「原典を変えない・理由なき差分を作らない」規律があり、
出所の違う10MBの素材を同じ木に混ぜない方がよいと判断した。

```
<repo と同じ階層>/academy-ui-assets/
├── set-a-dashboard/{archives,extracted,licenses,readmes,metadata,screenshots}/
├── set-b-forest/…            （空。NOTICE.md に理由）
├── reference-only/NOTICE.md  （ライセンス未確認領域の所在。実体は複製しない）
├── quarantine/NOTICE.md      （0件）
└── reports/                  （8ファイル）
```

レポートは FILE_INVENTORY / SELECTED_ASSETS / LICENSE_MANIFEST / SOURCE_MAP.json /
TECHNICAL_REVIEW / SECURITY_REVIEW / IMPLEMENTATION_PLAN / MANUAL_ACTIONS の8件。

原本（`~/Downloads/`）は読み取りのみ。作業後に SHA-256 とファイル数が
作業前と一致することを確認している。

**`reference-only/` に実体を複製していない。** 同じ内容が別々の分類で2箇所に存在すると、
どちらが正か分からなくなる。場所を指すだけにした。

## 5. YouthDB 本体への影響

現時点で**ソースへの変更はない**。ただし実装計画（`IMPLEMENTATION_PLAN.md`）は
既存の規律と噛み合う形で書いてある。要点だけ移す。

- **可視化コンポーネントに SQL を書かせない。** データ取得は `src/queries/dashboard.ts` に集約し、
  UI は渡された値を描くだけにする。UI が独自に数え直すと、同じ画面の別の数字と食い違う
- **Recharts を既定にしない。** 既存のチャートはサーバで SVG を組み立てており、
  クライアント側チャートライブラリを積むと初期表示にその分の遅れが乗る
- **森の比喩に単位を持ち込ませない。** 林＝人、木・幹＝応募、森＝推定値。
  実行①で日次の 林 → 木 転換率を消し、実行②で識別率を出さないと決めたのと同じ理由で、
  段をまたいだ割り算を森ビューでも作らない
- **Person ごとの木の seed は鍵付きハッシュから作る。** `person_id` をそのまま渡すと、
  クライアント側で個体が識別できてしまう。ハッシュだけでも総当たりで逆引きできるため鍵を要する
- 対応表は実在するビュー・関数と突き合わせ済み（`f_funnel_daily` の6列、
  `v_person_season_state.current_level`、`v_application_state.is_rejected` / `is_withdrawn` ほか）。
  年輪（再応募回数）だけは `is_reapplication` の再計算処理が未実装のため保留にした

## 6. 残っていること

- 未取得9リポジトリの取得とライセンス確認（取得後の検証手順は `MANUAL_ACTIONS.md`）
- Rive `.riv` の作成または正規取得。**コードとは別枠**でライセンスを管理する
- 表示用 seed の秘密鍵の発行と保管方法の決定
- Sentry / Clerk / 外部画像ホストの採否
- 森ビューは P1〜P4（器・個体表現・seed・根と葉と枝）まで**追加素材なしで着手できる**。
  P5 以降は素材が要る
