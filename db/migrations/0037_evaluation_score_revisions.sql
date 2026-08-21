-- =============================================================
-- 0037 点と根拠の変更ログ（E4 の記録層）
--
-- 実行⑮。依頼者の指示は「訂正の道が無い記録を潰す」で、規則の選び方は
-- こちらに委ねられた（実行⑮の問いに「特に無い」）。**選んだのは狭いほう** ――
--
--   直せるのは**未確定（`pending`）の評価だけ。** 確定した評価の点は直せない
--
-- ★ なぜ狭いほうを選ぶか
--
--   確定（`submitted`）は判断の材料が締め切られた印である。そのあとで点が
--   動くと、**確定時に見ていた数字と、いま見える数字が違う**ことになり、
--   判定（合否）の根拠が後から書き換わる。C-25 が E4 を保留したのは
--   まさにここで、「上書きの規則を決めずに通せる場所ではない」だった。
--   確定を戻す道は別にある（判定の訂正・保留）。**そちらを先に通る。**
--
--   広いほう（確定後も直せる）は、要ると分かってから足せる。
--   逆に、いったん通した上書きを**あとから狭めることはできない**
--   ―― 通っているあいだに書かれた行が残る。
--
-- ★ 形は 0022 / 0031 / 0032 と同じ ―― **現在値は `evaluation_scores`、
--   版には変更後の値**を入れる（「変更前」を入れる形にすると最初の1件が持てない）。
--
-- ★ `evaluation_scores` は追記専用ではない（0003 のトリガが無い）ので
--   UPDATE そのものは通る。**通るからこそ、経緯が要る** ――
--   点は合否の根拠であり、5 が 3 に変わった理由が残らないと、
--   落ちた人に何と説明したのかを誰も再現できない（0032 と同じ理由）。
--
-- ★ 満点・ステップ・再応募の判定は、既にある
--   `evaluation_scores_validity` が **UPDATE でも**効く（0001 で
--   `BEFORE INSERT OR UPDATE` にしてある）。ここで書き写さない。
-- =============================================================

CREATE TABLE evaluation_score_revisions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id       uuid        NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    criteria_id         uuid        NOT NULL REFERENCES evaluation_criteria(id),
    revision_number     integer     NOT NULL,

    -- 変更後の値。列は evaluation_scores と同じ並びにしてある。
    score               integer     NOT NULL,
    rationale           text        NOT NULL,

    -- 誰が直したか。認証が無いので画面が選ぶ（0022 / 0032 と同じ扱い。C-85）。
    -- **自己申告であって、本人である証拠ではない。**
    changed_by_staff_id uuid        REFERENCES staffs(id),
    changed_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT evaluation_score_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT evaluation_score_revisions_key
        UNIQUE (evaluation_id, criteria_id, revision_number),
    -- 現在値と同じ規則（0001 / 0015）。空白だけの根拠を版に残さない。
    CONSTRAINT evaluation_score_revisions_rationale_not_blank
        CHECK (btrim(rationale, E' \t\n\r　') <> ''),
    CONSTRAINT evaluation_score_revisions_score_lower CHECK (score >= 0)
);

CREATE INDEX evaluation_score_revisions_score_idx
    ON evaluation_score_revisions (evaluation_id, criteria_id, revision_number DESC);

-- 履歴そのものを書き換えられたら履歴ではない（原則4。0003 と同じ）。
CREATE TRIGGER evaluation_score_revisions_append_only
    BEFORE UPDATE OR DELETE ON evaluation_score_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE evaluation_score_revisions IS
    '点と根拠の変更後スナップショット。追記専用。evaluation_scores が現在値を持つ。'
    '直せるのは未確定の評価だけ（E4。0037）。';
COMMENT ON COLUMN evaluation_score_revisions.changed_by_staff_id IS
    '直した人（画面が選ぶ自己申告）。認証は無く、本人である証拠ではない。';
