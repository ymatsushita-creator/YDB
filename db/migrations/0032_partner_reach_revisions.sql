-- =============================================================
-- 0032 接触記録の変更ログ
--
-- 依頼者の指示（実行⑫）――
--   接触の記録（接触した日・やり方・推定リーチ・記録）を**表のセルで直せる**
--   ようにする。訂正の可否を問うたところ「直せる。変更履歴を新しく持つ」。
--
-- ★ なぜログが要るか
--
--   `partner_reaches` は追記専用ではない（0003 のトリガは付いていない）ので、
--   UPDATE そのものは通る。**通るからこそ危ない** ――
--   推定リーチは集客の集計そのものなので、300 が 30 に書き換わった経緯が
--   残らないと、数字が動いた理由を後から誰も説明できない。
--   `CLAUDE.md`「現在値を更新する場合も、変更履歴を追記保存する」。
--
-- ★ 形は 0022 / 0031 と同じ。**現在値は `partner_reaches`、
--   版には変更後の値**を入れる（「変更前」を入れる形にすると最初の1件が持てない）。
--
-- ★ 期の帰属（season_id）も版に持つ。日付を直すと帰属も動くので、
--   **その版の時点でどの期に数えられていたか**が分からないと、
--   過去の集計と突き合わせられない。
-- =============================================================

CREATE TABLE partner_reach_revisions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    reach_id            uuid        NOT NULL REFERENCES partner_reaches(id),
    partner_id          uuid        NOT NULL REFERENCES partners(id),
    revision_number     integer     NOT NULL,

    -- 変更後の値。列は partner_reaches と同じ並びにしてある。
    season_id           uuid        REFERENCES seasons(id),
    occurred_on         date        NOT NULL,
    method              text,
    estimated_reach     integer,
    note                text,

    -- 誰が変えたか。認証が無いので画面が選ぶ（0022 と同じ扱い。C-85）。
    changed_by_staff_id uuid        REFERENCES staffs(id),
    changed_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT partner_reach_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT partner_reach_revisions_key UNIQUE (reach_id, revision_number),
    -- 現在値と同じ規則（0001）。**0 と空は違う。** 負の数は受け取らない。
    CONSTRAINT partner_reach_revisions_estimate_non_negative
        CHECK (estimated_reach IS NULL OR estimated_reach >= 0)
);

CREATE INDEX partner_reach_revisions_reach_idx
    ON partner_reach_revisions (reach_id, revision_number DESC);

CREATE TRIGGER partner_reach_revisions_append_only
    BEFORE UPDATE OR DELETE ON partner_reach_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE partner_reach_revisions IS
    '接触記録の変更後スナップショット。追記専用。partner_reaches が現在値を持つ。'
    'season_id も持つ（日付を直すと帰属が動くため、版ごとの帰属を残す）。';
COMMENT ON COLUMN partner_reach_revisions.estimated_reach IS
    '変更後の推定リーチ。NULL は「分からない」で、0 は「届かなかった」。';
