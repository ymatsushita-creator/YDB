-- =============================================================
-- 0030 候補者メモに「どう関わったか」を足す
--
-- 依頼者の指示（実行⑫）――
--   「候補者に紐づくメモに、どう関わったかの来歴を残す」
--
-- 決めたのは依頼者である ――
--   持ち方   **自由入力の1行**（マスタにしない）
--   必須     **任意**
--   関わった人 **書いた人と同じ**（列を増やさない）
--
-- ★ マスタにしなかったので、**この列は集計できない。**
--   「面談」「面談した」「面談（オンライン）」が別の値として溜まる。
--   `staff_roles.role` の自由入力で同じことが起きている（D-5）。
--   数えたくなったら、運営の語を受け取ってからマスタへ移す
--   ―― こちらで名付けない（D-14 / C-79 と同じ規律）。
--
-- ★ 「関わった人」を別に持たなかった理由は 0027 と同じである。
--   合言葉は層ごとに1つで、層の中では誰が入ったか記録されない
--   （`src/auth/tiers.ts`）。書き手は手入力の自己申告なので、
--   関わった人を別の列にしても**同じ精度の自己申告が2つ並ぶだけ**である。
--
-- ★ 空白の判定は 0015 の形を使う。`btrim` の既定は半角スペースだけを落とすので、
--   改行・タブ・全角スペースだけの「関わり方」が通ってしまう。
--   任意の列なので**空白だけは弾く**（コマンド側は空白だけを NULL に倒す。
--   NULL は「書いていない」、空白は「書いたつもりで中身が無い」）。
--
-- 0027 は適用済みなので編集しない。列を足し、ビューを作り直す。
-- =============================================================

ALTER TABLE person_notes
    ADD COLUMN involvement text,
    ADD CONSTRAINT person_notes_involvement_not_blank
        CHECK (involvement IS NULL OR btrim(involvement, E' \t\n\r　') <> '');

COMMENT ON COLUMN person_notes.involvement IS
    'どう関わったか（自由入力の1行・任意）。依頼者の判断でマスタにしていないため'
    '集計できない。書いたのは author_name と同じ人である（別に持たない）。';


-- -------------------------------------------------------------
-- 有効なメモのビューを作り直す
-- -------------------------------------------------------------
-- ★ `SELECT pn.*` は**作った時点の列に展開されている。**
--   列を足してもビューには出ないので、画面には「保存はできたのに出ない」
--   という形で現れる。0022 の記入欄で同じ穴を踏んでいる
--   （送りの名前と列名を対で持たなかった件）。
--
-- 定義は 0027 と同じ（深さ偶数が有効。訂正を訂正すれば元が復活する）。
-- 列を増やす向きなので CREATE OR REPLACE で足りる。
CREATE OR REPLACE VIEW v_effective_person_notes AS
WITH RECURSIVE chain AS (
    SELECT n.id, n.corrects_note_id, 0 AS depth
      FROM person_notes n
     WHERE NOT EXISTS (
               SELECT 1 FROM person_notes c WHERE c.corrects_note_id = n.id
           )
    UNION ALL
    SELECT t.id, t.corrects_note_id, ch.depth + 1
      FROM chain ch
      JOIN person_notes t ON t.id = ch.corrects_note_id
)
SELECT pn.*
  FROM person_notes pn
  JOIN chain ON chain.id = pn.id
 WHERE chain.depth % 2 = 0;

COMMENT ON VIEW v_effective_person_notes IS
    '訂正チェーンを解決した後に有効なメモ。深さ偶数が有効。画面はこれを読む。'
    '0030 で involvement を足したため作り直してある。';
