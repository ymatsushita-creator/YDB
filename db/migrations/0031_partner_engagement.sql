-- =============================================================
-- 0031 団体に「NEO としてどう関わるか」を持つ
--
-- 依頼者の指示（実行⑫）――
--   「団体のメモに、Neo としてどう関わるかの属性を紐づける」
--
-- 決めたのは依頼者である ――
--   位置     **団体そのものの属性**（現在値。メモ1件ごとではない）
--   持ち方   **自由入力の1行**（マスタにしない）
--   メモ本体 **既存の接触記録の「記録」欄を使う** ―― 団体メモの表は作らない
--
-- ★ 団体メモの表を作らなかったのは依頼者の判断である。
--   したがって「接触が無い日のメモ」は書けない（接触した日が必須）。
--   日付を作ってメモを置くくらいなら、書ける場所を増やさない。
--
-- ★ 現在値を上書きするので、**変更履歴を追記保存する**（CLAUDE.md）。
--   形は 0022（interview_sheets ＋ interview_sheet_revisions）と同じ ――
--   現在値のテーブルを画面が読み、変更後の値を版として積む。
--
-- ★ マスタにしていないので**集計できない**（0030 と同じ性質）。
--   「共催」「共催先」「共同開催」が別の値として溜まる。
--   数えたくなったら運営の語を受け取ってマスタへ移す。
--
-- ★ 空白の判定は 0015 の形（btrim の既定は半角スペースだけを落とす）。
-- =============================================================

ALTER TABLE partners
    ADD COLUMN engagement text,
    ADD CONSTRAINT partners_engagement_not_blank
        CHECK (engagement IS NULL OR btrim(engagement, E' \t\n\r　') <> '');

COMMENT ON COLUMN partners.engagement IS
    'NEO としてどう関わるか（自由入力の1行）。現在値で、変更履歴は '
    'partner_engagement_revisions に積む。マスタではないので集計できない。';


-- -------------------------------------------------------------
-- 変更ログ（追記専用）
-- -------------------------------------------------------------
-- ★ 版には**変更後の値**を入れる（0018 / 0022 と同じ向き）。
--   「変更前」を入れる形にすると、最初の1件が持てない。
--
-- ★ 空にした版も残す。**消したことは記録である** ――
--   行が無いことと「関わり方を取り消した」ことは違う。
CREATE TABLE partner_engagement_revisions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id          uuid        NOT NULL REFERENCES partners(id),
    revision_number     integer     NOT NULL,

    -- 変更後の値。空にした場合は NULL。
    engagement          text,

    -- 誰が変えたか。認証が無いので画面が選ぶ（0022 と同じ扱い。C-85）。
    changed_by_staff_id uuid        REFERENCES staffs(id),
    changed_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT partner_engagement_revisions_number_positive
        CHECK (revision_number > 0),
    CONSTRAINT partner_engagement_revisions_key
        UNIQUE (partner_id, revision_number),
    -- 現在値と同じ規則。版にも空白だけを入れない。
    CONSTRAINT partner_engagement_revisions_not_blank
        CHECK (engagement IS NULL OR btrim(engagement, E' \t\n\r　') <> '')
);

CREATE INDEX partner_engagement_revisions_partner_idx
    ON partner_engagement_revisions (partner_id, revision_number DESC);

CREATE TRIGGER partner_engagement_revisions_append_only
    BEFORE UPDATE OR DELETE ON partner_engagement_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE partner_engagement_revisions IS
    '団体の関わり方の変更後スナップショット。追記専用。partners.engagement が現在値。';
