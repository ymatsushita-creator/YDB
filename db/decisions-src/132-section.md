### C-83. 候補者と連携団体の写真、名前にはアイコン

依頼者の指示（実行⑪）――候補者追加と連携団体追加の双方で写真を登録でき、
名前を表示するときは写真または頭文字アイコンを並べる。

候補者写真は既存の `persons.photo_data_url`、団体写真は 0026 で追加した
`partners.photo_data_url` に置く。どちらも JPEG / PNG / WebP、2MB以下を
サーバー側で検証し、画像が無い名前には創作画像ではなく頭文字を表示する。

検証: `pnpm test`（464件）、`pnpm exec tsc --noEmit`、`pnpm build`。
