# 設計判断を引く

```bash
pnpm decisions:show C-121
```

## なぜこの道具が要るか

`db/DECISIONS.md` は **496,136字（≒33万トークン相当）** の1本のファイルである。
**どの文脈長にも入らない。全文を読もうとしない。**

読めないものは参照されず、参照されないものは更新されない。
実際、実行⑯・⑰の44件は報告書も設計判断も残さずに終わった
（`.consultant/DIAGNOSIS.md`）。番号で指す設計なら、番号から引ける道具が要る。

## 使い方

| したいこと | コマンド |
|---|---|
| `C-121` の本文だけ読む | `pnpm decisions:show C-121` |
| まとめて読む | `pnpm decisions:show C-95..C-96` |
| 一覧から探す | `db/DECISIONS-INDEX.md`（生成物。手で編集しない） |
| 本文が無い番号を調べる | `pnpm decisions:missing` |
| 1件だけ調べる | `pnpm decisions:missing <番号>` |

## コードで番号に出会ったら

```
/* 題名は画面から隠している（C-nnn）*/
```

まず `pnpm decisions:show <番号>` を叩く。**本文が無いと言われたら**
`pnpm decisions:missing <番号>` で参照元を集める ―― 45件がその状態にある。

**そこを自分で埋めない。** `CLAUDE.md` が「記録にない値の創作」を禁じている。
何を決めたのかを知っているのは、その判断を下した人間だけである。
分かったことは索引に掲げたまま、依頼者へ渡す。

## 追記したとき

```bash
pnpm decisions:index
```

生成物（`db/DECISIONS-INDEX.md`）も一緒にコミットする。
ずれは CI が `--check` で落とす。**索引を手で編集しない。**

## 見慣れない語（森・林・木・幹）

コードに旧生態系比喩が残っている。対応表は
[`docs/product/legacy-terms.md`](../../docs/product/legacy-terms.md)。
**読むための表であって、新しく書くときは使わない。**
