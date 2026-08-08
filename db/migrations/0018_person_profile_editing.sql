-- =============================================================
-- 0018 候補者プロフィールを編集可能にし、変更後の全体像を追記保存する
--
-- persons は現在値（検索・既存集計との互換性）、person_profile_revisions は
-- 変更後のスナップショット（いつ何になったかの復元）を担う。
-- 画面ごとに別の編集表を作らず、プロフィールの正典を1つに保つ。
-- =============================================================

ALTER TABLE persons
    ADD COLUMN photo_data_url text,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE persons
    ADD CONSTRAINT persons_photo_data_url_image
        CHECK (photo_data_url IS NULL OR photo_data_url ~ '^data:image/(jpeg|png|webp);base64,');

CREATE TABLE person_profile_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id           uuid        NOT NULL REFERENCES persons(id),
    revision_number     integer     NOT NULL,
    family_name         text        NOT NULL,
    given_name          text        NOT NULL,
    family_name_kana    text,
    given_name_kana     text,
    birth_date          date        NOT NULL,
    school_id           uuid        NOT NULL REFERENCES schools(id),
    faculty             text,
    email               text        NOT NULL,
    phone               text,
    line_user_id        text,
    referrer_person_id  uuid        REFERENCES persons(id),
    note                text,
    photo_data_url      text,
    changed_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT person_profile_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT person_profile_revisions_key UNIQUE (person_id, revision_number),
    CONSTRAINT person_profile_revisions_photo_image
        CHECK (photo_data_url IS NULL OR photo_data_url ~ '^data:image/(jpeg|png|webp);base64,')
);

CREATE INDEX person_profile_revisions_person_idx
    ON person_profile_revisions (person_id, revision_number DESC);

CREATE TRIGGER person_profile_revisions_append_only
    BEFORE UPDATE OR DELETE ON person_profile_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE person_profile_revisions IS
    '候補者プロフィールの変更後スナップショット。追記専用。persons は現在値を持つ。';
