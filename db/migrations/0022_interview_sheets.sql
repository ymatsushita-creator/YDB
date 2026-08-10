-- =============================================================
-- 0022 面接シート（依頼者の指示。実行⑩）
--
-- 依頼者から面接シートの様式が届いた ――
-- 評価軸6つ（各1〜4点）、記入欄10、最終判定3択、判定補足。
--
-- ★ 評価軸はここに作らない。**すでにある。**
--   笑顔・リスペクト・前提超越・熱量・地頭力・素直さ は
--   `evaluation_criteria`（2期・最終面接、各4点満点）に登録済みで、
--   点と根拠は `evaluation_scores` に入る。**同じ軸を2箇所に持たない。**
--   ここが受け持つのは、**点では表せない記入欄と判定**だけである。
--
-- ★ 「面接官」もここに作らない。`evaluations.interviewer_staff_id` にある。
--   2人が面接すればその応募のその段に評価が2件でき、
--   **シートも面接官ごとに1枚**になる（UNIQUE (evaluation_id)）。
--
-- ★ 「面接日」は新しく持つ。`evaluations` にあるのは割当時刻と提出時刻で、
--   どちらも面接をした日ではない。**近い値で代用しない。**
--
-- ★★ 最終判定（合格・ボーダー・不合格）は、選考の判定ではない。★★
--
--   選考の通過／不合格は `status_histories` にあり、そこに「ボーダー」は無い。
--   ここに入るのは**面接官が出した所見**であって、組織の決定ではない。
--   混ぜると、誰がいつ決めたのかが辿れなくなる。
--   だから列名も `verdict` ではなく `recommendation` にしてある。
--
-- 変更ログ ―― 現在値は `interview_sheets`、変更後の全体像は
-- `interview_sheet_revisions` に追記する（0018 と同じ形）。
-- =============================================================

CREATE TABLE interview_sheets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id      uuid        NOT NULL REFERENCES evaluations(id),

    -- 面接日。まだ決まっていない・書いていない段階を許す。
    interviewed_on     date,

    -- 記入欄。空欄は「まだ書いていない」であって「無い」ではないので NULL 可。
    first_impression   text,   -- 第一印象・雰囲気
    check_point_notes  text,   -- 確認ポイントへの回答メモ
    strengths          text,   -- 良かった点・光ったポイント
    concerns           text,   -- 懸念が残る点・気になった点
    own_challenge      text,   -- 自分の課題は何か
    neo_career_link    text,   -- NEOとキャリアの接続ポイント
    neo_usage_plan     text,   -- NEO活用方針
    overall_comment    text,   -- 総評コメント

    -- 最終判定と判定補足。**選考の判定ではない**（上の注記）。
    recommendation     text,
    recommendation_note text,

    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT interview_sheets_evaluation_key UNIQUE (evaluation_id),
    CONSTRAINT interview_sheets_recommendation_chk
        CHECK (recommendation IS NULL
               OR recommendation IN ('pass', 'border', 'fail')),
    -- 判定補足だけがあって判定が無い状態を作らない。
    -- 逆（判定だけ）は許す ―― 補足は任意である。
    CONSTRAINT interview_sheets_note_needs_recommendation
        CHECK (recommendation_note IS NULL OR recommendation IS NOT NULL)
);

CREATE INDEX interview_sheets_evaluation_idx ON interview_sheets (evaluation_id);

COMMENT ON TABLE interview_sheets IS
    '面接シートの現在値。面接官ごとに1枚（evaluation 単位）。'
    '点と根拠は evaluation_scores、面接官は evaluations が持つ。'
    'recommendation は面接官の所見であって、選考の判定（status_histories）ではない。';

COMMENT ON COLUMN interview_sheets.recommendation IS
    '面接官の所見。pass=合格 / border=ボーダー / fail=不合格。'
    '選考の通過・不合格とは別。「ボーダー」は選考の側に存在しない。';


-- -------------------------------------------------------------
-- 変更ログ（追記専用）
-- -------------------------------------------------------------
-- 書き換えた事実を残す。**上書きで消えるのは、書き直した本人以外にとって
-- 一番困る情報**である ―― 面接直後の所見と、後から整えた所見は別物なので、
-- どちらも残す。
CREATE TABLE interview_sheet_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id            uuid        NOT NULL REFERENCES interview_sheets(id),
    evaluation_id       uuid        NOT NULL REFERENCES evaluations(id),
    revision_number     integer     NOT NULL,

    interviewed_on      date,
    first_impression    text,
    check_point_notes   text,
    strengths           text,
    concerns            text,
    own_challenge       text,
    neo_career_link     text,
    neo_usage_plan      text,
    overall_comment     text,
    recommendation      text,
    recommendation_note text,

    -- 誰が書いたか。認証が無いので画面が選ぶ（HANDOFF の残る課題）。
    changed_by_staff_id uuid        REFERENCES staffs(id),
    changed_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT interview_sheet_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT interview_sheet_revisions_key UNIQUE (sheet_id, revision_number),
    CONSTRAINT interview_sheet_revisions_recommendation_chk
        CHECK (recommendation IS NULL
               OR recommendation IN ('pass', 'border', 'fail'))
);

CREATE INDEX interview_sheet_revisions_sheet_idx
    ON interview_sheet_revisions (sheet_id, revision_number DESC);

CREATE TRIGGER interview_sheet_revisions_append_only
    BEFORE UPDATE OR DELETE ON interview_sheet_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE interview_sheet_revisions IS
    '面接シートの変更後スナップショット。追記専用。interview_sheets が現在値を持つ。';


-- -------------------------------------------------------------
-- 画面が読む形
-- -------------------------------------------------------------
-- ★ 面接官・応募・候補者は評価から辿れる。**シートに写して持たない。**
--   写すと、担当を替えたときにシートだけ古い面接官を指す。
--
-- 個人情報削除（deleted_at）を受けた人は、ここからも外す。
-- 氏名の見える窓を1つでも残したら、依頼に応えたことにならない。
CREATE VIEW v_interview_sheets AS
SELECT s.id                AS sheet_id,
       s.evaluation_id,
       e.application_id,
       a.person_id,
       a.season_id,
       ss.id               AS selection_step_id,
       ss.name             AS step_name,
       ss.sort_order       AS step_order,
       e.attempt,
       e.state             AS evaluation_state,
       e.interviewer_staff_id,
       stf.display_name    AS interviewer_name,
       s.interviewed_on,
       s.first_impression, s.check_point_notes, s.strengths, s.concerns,
       s.own_challenge, s.neo_career_link, s.neo_usage_plan, s.overall_comment,
       s.recommendation, s.recommendation_note,
       s.created_at, s.updated_at,
       (SELECT count(*)::int FROM interview_sheet_revisions r
         WHERE r.sheet_id = s.id) AS revision_count
  FROM interview_sheets s
  JOIN evaluations e   ON e.id = s.evaluation_id
  JOIN applications a  ON a.id = e.application_id AND a.deleted_at IS NULL
  JOIN persons p       ON p.id = a.person_id AND p.deleted_at IS NULL
  JOIN selection_steps ss ON ss.id = e.selection_step_id
  LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id;

COMMENT ON VIEW v_interview_sheets IS
    '面接シートに、評価から辿れる事実（段・面接官・応募・候補者）を添えたもの。'
    '個人情報削除を受けた候補者は出さない。';
