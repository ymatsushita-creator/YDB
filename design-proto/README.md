# design-proto — DESIGN.md の再現性テスト

`basic/DESIGN.md`（alpha / Iridescent-Black-design-system）だけを入力に、
**ガワのみ**を静的HTMLで3枚起こしたもの。バックエンドには一切触れていない。

## 起動

```
python3 -m http.server 4321 --directory design-proto
```

`.claude/launch.json` に `design-proto` として登録済み。

## 構成（3層。ここが再現性の検証点）

| ファイル | 役割 | DESIGN.md との対応 |
|---|---|---|
| `tokens.css` | 色・角丸・余白・書体・グラデーション | front-matter の `colors` / `rounded` / `spacing` / `gradients` を機械的に写した。**判断を入れていない** |
| `app.css` | コンポーネント | `typography.*` / `components.*` のキー名をそのままクラス名にした |
| `index.html` | 画面1：ホーム（コックピット） | `hero-band` / `card-marketing` / `ex-data-table-cell` / `card-brand-accent` / `ex-toast` |
| `people.html` | 画面2：候補者一覧 | `form-input` / `tab-ghost` / `tab-active` / `ex-data-table-cell` / `ex-empty-state-card` |
| `person.html` | 画面3：候補者詳細 | `card-marketing-dark` / `card-marketing-large` / `badge-*` / `ex-data-table-cell` |

## 守った規律

- **無彩色 85–90% ／ スペクトラム 10–15%。** 表・入力・絞り込み・操作ボタンは
  黒白グレーのみ。色が出るのは（a）ヒーロー面、（b）現在地の細線、
  （c）focus リング、（d）状態バッジ、（e）空状態の低不透明度の光field。
- **面をスペクトラムで塗らない。** `activeIndicator` / `accentBorder` は
  2–3px の線に落とす（`tab-active::after`、`nav-row-active::before`、
  `card-brand-accent::before`）。
- **細すぎるグラデーションを作らない。** 4% の棒などは単色 `--primary` にした。
- **等幅の虹にしない。** `.grad-spectrum` は DESIGN.md の
  「Suggested CSS Construction」の多重 radial をそのまま使い、黒を残す。
- **暗い面を全部同じ黒にしない。** `canvas-dark` / `canvas-dark-soft` を使い分ける。
- 表ヘッダは `caption-mono`、数値は tabular-nums（`ex-data-table-cell` の指定）。

## 語彙

`domain.md` の現行語のみ。期／アプローチ可能圏／構成コミュニティ／候補者／
接点／応募／合格／アプローチ状態／予定／やること。旧生態系比喩は使っていない。
数値は全て架空。

## DESIGN.md に無くて、実装時に決めるしかなかったもの（＝仕様の穴）

1. **影** … `ex-modal-card` / `ex-toast` に "restrained stacked shadow" と
   文章はあるが、トークンが無い。`ex-toast` で暫定値を入れた。
2. **hover / disabled の状態** … `canvas-soft-2` が "hover surfaces" と
   書かれているだけで、ボタン・行・タブそれぞれの hover 指定が無い。
3. **ダークモード** … 黒面・白面が「どちらも正当な canvas」とあるが、
   配色の切替規則（どのトークンが入れ替わるか）が無い。今回は光面のみ。
4. **フォーカスリング** … `form-input` にはあるが、ボタン・リンク・行には無い。
5. **ボタンの高さ** … `padding` だけが指定され `height` が無い（nav-cta のみ 28px）。
   `button-lg` = 40px、`btn-sm` = 32px と決め打ちした。
6. **表の行の高さ・ゼブラ・選択行** … `ex-data-table-cell` は
   padding と border のみ。密度の段階が無い。
7. **grid / breakpoint** … 段組みの規定が無い。900px で1段に畳んだ。
8. **アイコン** … 一切定義が無い。今回は文字のみで組んだ。
