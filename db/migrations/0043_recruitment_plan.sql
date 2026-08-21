-- =============================================================
-- 0043 募集要項・ペルソナ・KPI目標を、記録層に置く
--
-- 依頼者の指示（実行⑯）――「2期応募2のエクセルから、要項やペルソナやKPIを
-- 持ってきて新規DBにも実装して、設計は自動でやって」。
--
-- 3枚の表を読む ――
--   募集要項              期の条件（0042 の season_requirements。表が増えただけ）
--   015_ペルソナ（NEW）    集客対象の人物像
--   006_ユース募集施策     施策別／コース別の目標人数と実績
--
-- ★ 3つとも**集客・選考の計画**であって、候補者の記録ではない。
--   個人情報を1つも含まない（氏名・連絡先が入る表は対象外）。
--
-- ★ 期ごとに持つ（season_id）。ペルソナも施策も年によって変わる。
--   `partner_recommendation_states`（0035）と同じ理由 ―― 現在値を
--   1つだけ持たせると、期をまたいだ瞬間に前の期の計画が消える。
-- =============================================================

-- -------------------------------------------------------------
-- ペルソナ（015_ペルソナ（NEW））
--
-- 表の列をそのまま持つ。要約しない ―― 「集客の対象は誰か」を
-- 運営が書いた言葉のまま読めることが目的で、こちらで言い換えると
-- 次に表を見た人と画面の文言が食い違う。
-- -------------------------------------------------------------
CREATE TABLE recruitment_personas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id         uuid    NOT NULL REFERENCES seasons(id),
    -- 表の左端（学生／社会人／クリエイター／社会人クリエイター）。
    segment           text    NOT NULL,
    -- WHO（自己成長欲求型、起業志向型…）。
    name              text    NOT NULL,
    -- 人数。表は目安の数（12.0 など）で、厳密な定員ではない。
    headcount         integer,
    -- 「」で括られた一言（表の列見出しが無いまま置かれている一文）。
    -- 独立した観点なので、他の列へ混ぜずにそのまま持つ。
    tagline           text,
    problem           text,
    value_proposition text,   -- WHAT（提供価値）
    features          text,
    target            text,
    target_needs      text,
    desired_feeling   text,   -- イベントで感じて欲しい感情
    guest_candidates  text,
    exit_image        text,
    sort_order        integer NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recruitment_personas_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT recruitment_personas_order_key UNIQUE (season_id, sort_order)
);

COMMENT ON TABLE recruitment_personas IS
    '集客のペルソナ（015_ペルソナ（NEW））。期ごと。文面は運営のまま。';

CREATE INDEX recruitment_personas_season_idx ON recruitment_personas (season_id, sort_order);


-- -------------------------------------------------------------
-- コース別の目標（006_ユース募集施策・下段の表）
--
-- 「合格者区分（就職／起業／創造）× 学生／社会人」ごとに、
-- 想定合格者数・応募者・説明会・リーチ数の目標を持つ。
-- -------------------------------------------------------------
CREATE TABLE recruitment_course_targets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id         uuid    NOT NULL REFERENCES seasons(id),
    -- 表の区分列（「施策別」「コース別」）。表がこの語で束ねている。
    category          text    NOT NULL,
    -- コースの名前（イベント集客／就職／起業／創造／総数…）。
    course_label      text    NOT NULL,
    -- 学生／社会人。無い区分（施策別の行）は null。
    segment_label      text,
    target_accepted    integer,  -- 想定合格者数
    target_applicants  integer,  -- 応募者
    target_briefing    integer,  -- 説明会
    target_reach       integer,  -- リーチ数
    sort_order          integer NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recruitment_course_targets_label_not_blank CHECK (btrim(course_label) <> ''),
    CONSTRAINT recruitment_course_targets_order_key UNIQUE (season_id, category, sort_order)
);

COMMENT ON TABLE recruitment_course_targets IS
    'コース・施策ごとの目標人数（006_ユース募集施策）。期ごと。';

CREATE INDEX recruitment_course_targets_season_idx
    ON recruitment_course_targets (season_id, category, sort_order);


-- -------------------------------------------------------------
-- 施策（コース目標にぶら下がる、個別の集客アクション）
--
-- 「1期生＆事務局からのリファラル」「地元就職向けイベント①」など、
-- コース目標を達成するための個別の打ち手。実績・優先順位・担当者を持つ。
-- -------------------------------------------------------------
CREATE TABLE recruitment_tactics (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_target_id  uuid    NOT NULL REFERENCES recruitment_course_targets(id),
    label             text    NOT NULL,
    briefing_actual   integer,  -- 説明会（実績）
    reach_actual      integer,  -- リーチ数（実績）
    -- 進捗率は表が小数で持っている（0.69…）。**計算し直さない**
    -- ―― 分母がどの数（想定合格者数か応募者か）かは表側の判断で、
    -- こちらで復元すると値が変わりうる。
    progress_ratio    numeric,
    priority          text,     -- 高／中／低（運営の語のまま）
    detail            text,
    starts_on         date,
    ends_on           date,
    owner             text,
    remark            text,
    sort_order        integer NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recruitment_tactics_label_not_blank CHECK (btrim(label) <> ''),
    CONSTRAINT recruitment_tactics_order_key UNIQUE (course_target_id, sort_order)
);

COMMENT ON TABLE recruitment_tactics IS
    '個別の集客施策。recruitment_course_targets にぶら下がる（006）。';

CREATE INDEX recruitment_tactics_course_idx ON recruitment_tactics (course_target_id, sort_order);
