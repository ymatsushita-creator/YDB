-- =============================================================
-- 0025 フォーム回答の受け皿と、候補者番号
--
-- 依頼者の指示（実行⑩）――
--   「LINE、インスタなどからの Google フォームの回答から SNS 分析も行うから、
--     そこの基盤も用意しておいてほしい」
--   「候補者追加は、Google フォームの結果の自動接合と、
--     ナンバー割り当てを自動で行いたい」
--
-- ★ **フォームはまだ無い。** だから受け皿と接合の規則だけを作る。
--   届く形が決まったら、取り込む側（`src/commands/form_response.ts`）が
--   `raw` に入れて、分かる項目だけを列へ写す。
--
-- ---------------------------------------------------------------
-- なぜ「回答」を人と別に持つのか
-- ---------------------------------------------------------------
-- 回答は**届いた事実**であって、誰の回答かは後から決まる。
-- いきなり `persons` へ入れると、
--   ・同姓同名を取り違えたときに、元の回答が残らない
--   ・接合をやり直せない（何を根拠に結び付けたかが消える）
-- 回答をそのまま残し、**人への結び付けだけを後から書く。**
--
-- ★ 回答そのものは書き換えられない（トリガ）。
--   書き換えてよいのは「誰に結び付けたか」だけである。
-- =============================================================

CREATE TABLE form_responses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- どのフォームの、どの回答か。**取り込みの冪等性はここで担保する。**
    -- Google フォームなら form_key はフォームID、response_key は回答ID。
    source          text        NOT NULL,
    form_key        text        NOT NULL,
    response_key    text        NOT NULL,

    -- 回答が送信された時刻。取り込んだ時刻ではない。
    submitted_at    timestamptz NOT NULL,

    -- 回答者が名乗った値。**照合の材料であって、確定した事実ではない。**
    respondent_name  text,
    respondent_kana  text,
    respondent_email text,
    respondent_phone text,
    respondent_line  text,

    -- 「どこで知ったか」の回答を、チャネルへ写したもの。
    -- ★ 写せないときは NULL。**近いチャネルへ寄せない**
    --   （寄せた瞬間、SNS 別の集計が実際と違う値を出す）。
    channel_id      uuid        REFERENCES channels(id),
    -- 回答された生の文字列。写せなかったときに、何と書いてあったかが残る。
    channel_answer  text,

    -- 回答の全体。届く形が決まっていないので、まず丸ごと持つ。
    raw             jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- 誰の回答か。**後から決まる。**
    person_id           uuid        REFERENCES persons(id),
    matched_at          timestamptz,
    matched_by_staff_id uuid        REFERENCES staffs(id),
    -- 何を根拠に結び付けたか（auto_email / auto_line / manual）。
    match_method        text,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT form_responses_key UNIQUE (source, form_key, response_key),
    -- 結び付けの3つは、そろうか、そろわないか。片方だけを許さない。
    CONSTRAINT form_responses_match_pair CHECK (
        (person_id IS NULL) = (matched_at IS NULL)
        AND (person_id IS NULL) = (match_method IS NULL)
    ),
    CONSTRAINT form_responses_match_method_chk CHECK (
        match_method IS NULL
        OR match_method IN ('auto_email', 'auto_line', 'auto_phone', 'manual')
    )
);

CREATE INDEX form_responses_unmatched_idx
    ON form_responses (submitted_at DESC) WHERE person_id IS NULL;
CREATE INDEX form_responses_person_idx ON form_responses (person_id);
CREATE INDEX form_responses_channel_idx ON form_responses (channel_id, submitted_at);

COMMENT ON TABLE form_responses IS
    '外部フォームから届いた回答。届いた事実をそのまま残し、'
    '人への結び付けだけを後から書く。回答そのものは書き換えられない。';


-- 回答そのものは書き換えられない。**変えてよいのは結び付けだけ。**
CREATE OR REPLACE FUNCTION reject_form_response_rewrite()
RETURNS trigger AS $$
BEGIN
    IF NEW.source          IS DISTINCT FROM OLD.source
    OR NEW.form_key        IS DISTINCT FROM OLD.form_key
    OR NEW.response_key    IS DISTINCT FROM OLD.response_key
    OR NEW.submitted_at    IS DISTINCT FROM OLD.submitted_at
    OR NEW.respondent_name IS DISTINCT FROM OLD.respondent_name
    OR NEW.respondent_kana IS DISTINCT FROM OLD.respondent_kana
    OR NEW.respondent_email IS DISTINCT FROM OLD.respondent_email
    OR NEW.respondent_phone IS DISTINCT FROM OLD.respondent_phone
    OR NEW.respondent_line  IS DISTINCT FROM OLD.respondent_line
    OR NEW.channel_answer   IS DISTINCT FROM OLD.channel_answer
    OR NEW.raw              IS DISTINCT FROM OLD.raw
    THEN
        RAISE EXCEPTION
            'form_responses は届いた回答そのもの。書き換えられるのは結び付けだけである';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_responses_immutable_payload
    BEFORE UPDATE ON form_responses
    FOR EACH ROW EXECUTE FUNCTION reject_form_response_rewrite();


-- -------------------------------------------------------------
-- SNS 別の分析が読む形
-- -------------------------------------------------------------
-- ★ 母集団は**回答**であって人ではない。同じ人が2回答えれば2件である。
--   人数で見たいときは `person_id` を DISTINCT で数える（別の軸）。
CREATE VIEW v_form_response_channels AS
SELECT r.id            AS form_response_id,
       r.source,
       r.form_key,
       r.submitted_at,
       jst_date(r.submitted_at) AS submitted_on,
       r.channel_id,
       c.name          AS channel_name,
       c.category      AS channel_category,
       r.channel_answer,
       r.person_id,
       (r.person_id IS NOT NULL) AS is_matched,
       -- 回答が起きた期。どの期の期間にも入らない回答は NULL のまま
       -- （**近い期へ寄せない**）。
       (SELECT s.id FROM seasons s
         WHERE jst_date(r.submitted_at)
               BETWEEN s.outreach_start_date AND s.selection_end_date
         ORDER BY s.enrollment_year LIMIT 1) AS season_id
  FROM form_responses r
  LEFT JOIN channels c ON c.id = r.channel_id;

COMMENT ON VIEW v_form_response_channels IS
    'フォーム回答を SNS（チャネル）別に見る形。母集団は回答であって人ではない。';


-- -------------------------------------------------------------
-- 候補者番号
-- -------------------------------------------------------------
-- 依頼者の指示 ――「ナンバー割り当てを自動で行いたい」。
--
-- ★ 期ごとに 1 から振る。**人に一意の番号ではない** ――
--   再応募した人は期ごとに別の番号を持つ。
--
-- ★ 番号は**使い回さない。** 候補者を消しても欠番のままにする。
--   欠番を詰めると、紙や口頭で番号を言い合っている運用と食い違う。
CREATE TABLE candidate_numbers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id   uuid        NOT NULL REFERENCES seasons(id),
    person_id   uuid        NOT NULL REFERENCES persons(id),
    number      integer     NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_numbers_positive CHECK (number > 0),
    CONSTRAINT candidate_numbers_season_number_key UNIQUE (season_id, number),
    CONSTRAINT candidate_numbers_season_person_key UNIQUE (season_id, person_id)
);

CREATE INDEX candidate_numbers_person_idx ON candidate_numbers (person_id);

COMMENT ON TABLE candidate_numbers IS
    '期ごとの候補者番号。1 から振り、使い回さない（消しても欠番のまま）。';
