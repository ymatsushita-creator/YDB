-- =============================================================
-- 0042 評価軸と選考の段に「何を見るか」を持たせる
--
-- 依頼者の指示（実行⑯）――「評価軸や選考関係はもっと情報を取得して、
-- DBに組み込んで」。
--
-- ★★ **軸の名前しか入っていなかった。** ★★
--
--   応募管理表の `特別選考` シートには、9軸それぞれに
--   **判断の観点が3〜4行ずつ**書いてある（「週5時間以上の継続コミットが明確」
--   「『忙しいけど頑張りたい』ではなく → 何を削って参加するか を言語化できる」）。
--   `013_選考フロー` には段ごとの手順と成果物が書いてある。
--   どちらも DB には1文字も入っていなかった ―― **採点する人が、
--   何を見て点を付けるのかを画面から読めない。**
--
-- ★ 列を足すだけにする。**既存の行は動かさない**（適用済みは編集しない）。
-- ★ 文面は運営のものをそのまま入れる。要約も翻訳もしない。
-- =============================================================

ALTER TABLE evaluation_criteria ADD COLUMN description text;
COMMENT ON COLUMN evaluation_criteria.description IS
    '何を見る軸なのか。応募管理表の基準表の文面をそのまま持つ。翻訳しない。';

ALTER TABLE selection_steps ADD COLUMN description text;
COMMENT ON COLUMN selection_steps.description IS
    'その段で事務局が何をするか。選考フロー表の「詳細」をそのまま持つ。';


-- -------------------------------------------------------------
-- 募集要項
--
-- ★ 段にも軸にもぶら下がらない ―― **期の条件**である
--   （年齢・コミット時間・理念への共感）。`seasons` に列を足すと
--   1行の自由文になり、項目ごとに読めない。行で持つ。
--
-- ★ 期ごとに持つ。要項は年で変わる（2期の要項が3期に効くとは限らない）。
-- ★ 追記して並べるだけの表にする。訂正は行を差し替える（現在値の表である）。
-- -------------------------------------------------------------
CREATE TABLE season_requirements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id   uuid        NOT NULL REFERENCES seasons(id),
    -- どの枠の条件か（共通軸／ユース選抜／企業選抜）。**表の見出しのまま。**
    category    text        NOT NULL,
    body        text        NOT NULL,
    sort_order  integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT season_requirements_body_not_blank CHECK (btrim(body) <> ''),
    CONSTRAINT season_requirements_category_not_blank CHECK (btrim(category) <> ''),
    CONSTRAINT season_requirements_order_key UNIQUE (season_id, category, sort_order),
    -- 同じ条文を2度入れない（取り込みを何度流しても増えない）。
    CONSTRAINT season_requirements_body_key UNIQUE (season_id, category, body)
);

COMMENT ON TABLE season_requirements IS
    '募集要項。期ごとの応募条件を1行1条文で持つ。文面は運営のものをそのまま。';

CREATE INDEX season_requirements_season_idx
    ON season_requirements (season_id, category, sort_order);
