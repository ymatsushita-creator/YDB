-- =============================================================
-- 流入チャネル（依頼者の指示。実行⑩）
--
-- 「LINE、インスタなどからの Google フォームの回答から SNS 分析も行う」
--
-- ★ 名前は**旧システムが使っていた語をそのまま**置く。
--   `select_options` の `contact_method` と `inflow_source` にこう並んでいた ――
--
--     contact_method  LINE / メール / 電話 / Instagram DM / X DM / 対面 / その他
--     inflow_source   イベント / 紹介 / SNS / 学校連携 / 問い合わせ / その他
--
--   運営の言葉をこちらの語に翻訳して記録しない（Pilot Rule）。
--
-- ★ `category` は「面で分ける」ためだけに置く。集計の定義ではない。
--   SNS 分析は `channels.category = 'sns'` で束ねられる。
--
-- ★ 足りない分類が出たら**足す。既存の行の名前を書き換えない**
--   （原則3: 集計マスタは更新せず追加と非活性化で運用する）。
--   名前を書き換えると、過去の接点の意味が後から変わる。
-- =============================================================

INSERT INTO channels (name, category)
VALUES
    -- SNS。フォームの「どこで知ったか」がここへ写る。
    ('LINE',          'sns'),
    ('Instagram',     'sns'),
    ('X',             'sns'),
    ('TikTok',        'sns'),
    ('YouTube',       'sns'),
    -- SNS 以外。旧システムの inflow_source をそのまま。
    ('イベント',       'event'),
    ('紹介',           'referral'),
    ('学校連携',       'school'),
    ('問い合わせ',     'inbound'),
    ('メール',         'direct'),
    ('電話',           'direct'),
    ('対面',           'direct'),
    ('その他',         'other')
ON CONFLICT (name) DO NOTHING;
