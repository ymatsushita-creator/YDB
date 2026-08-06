-- =============================================================
-- 参照データ
--
-- 集計定義に関わるマスタは更新せず、追加と非活性化で運用する（原則3）。
-- したがってこのファイルは「初回投入」であり、値の変更に使ってはならない。
-- 値を変えたくなったら is_active = false にして新しい行を足す。
--
-- 何度流しても同じ状態になるよう ON CONFLICT DO NOTHING で書く。
-- 更新しないのは原則3そのもの。ここで UPSERT を書くと、
-- 「マスタは追加と非活性化で運用する」が最初の一歩で破れる。
-- =============================================================


-- -------------------------------------------------------------
-- 応募の無効化理由
-- -------------------------------------------------------------
-- counts_as_application は「この無効化に対応する代替の Application が
-- 生まれるか」で決まる。生まれるなら false（付け替え先で1件数える）。
--
-- ただしこの規則だけでは決まらない場合がある。テスト送信には代替の
-- 応募が生まれないため規則上は true になるが、そもそも応募という事実が
-- 起きていないので数えてはならない。規則には
-- 「実在の応募であること」という前提が隠れている。
-- 詳細は db/DECISIONS.md D-6。
INSERT INTO void_reasons (code, label, counts_as_application) VALUES
    ('identity_merge_error',       '名寄せ誤り（別人の応募として登録していた）', false),
    ('duplicate_entry',            '二重応募（同一人物が重複して送信）',        false),
    ('test_submission',            'テスト送信',                                false),
    ('withdrawn_before_screening', '選考開始前の取り下げ',                      true),
    ('ineligible',                 '応募資格を満たさない',                      true)
ON CONFLICT (code) DO NOTHING;


-- -------------------------------------------------------------
-- 辞退理由
-- -------------------------------------------------------------
-- 自由入力にすると集計が死ぬため選択式。
-- 辞退理由の分布はチャネルの質を表すため(4)で参照する。
-- 「他プログラムを選択」が特定チャネルに偏るなら、そのチャネルは
-- 志望度の低い層を連れてきている、という読み方ができる。
INSERT INTO withdraw_reasons (code, label) VALUES
    ('schedule_conflict', '日程が合わない'),
    ('other_program',     '他のプログラムを選んだ'),
    ('family_objection',  '保護者の同意が得られない'),
    ('academic_priority', '学業・受験を優先'),
    ('lost_interest',     '関心が薄れた'),
    ('health',            '健康上の理由'),
    ('financial',         '費用・移動の負担'),
    ('no_response',       '連絡が取れない'),
    ('other',             'その他')
ON CONFLICT (code) DO NOTHING;


-- -------------------------------------------------------------
-- 流入チャネル
-- -------------------------------------------------------------
-- 自由入力を禁じる（資料3-2）。
--
-- form_param_value は事前入力リンクで渡る値で、計測用の細かい粒度。
-- self_report_group はフォームの自己申告設問で使う粗い粒度。
-- 応募者は「学校の先生に聞いた」までしか答えられないが、
-- こちらは「どの学校訪問の回か」まで知りたい。粒度を分ける理由がこれ。
INSERT INTO channels (name, form_param_value, self_report_group, category) VALUES
    ('学校訪問',         'school_visit',     '学校から',     'outreach'),
    ('教員からの紹介',   'teacher_referral', '学校から',     'referral'),
    ('進路指導室の掲示', 'career_room',      '学校から',     'outreach'),
    ('卒業生からの紹介', 'alumni_referral',  '知人から',     'referral'),
    ('友人からの紹介',   'friend_referral',  '知人から',     'referral'),
    ('提携団体イベント', 'partner_event',    'イベント',     'partner'),
    ('単独説明会',       'info_session',     'イベント',     'owned'),
    ('SNS広告',          'sns_ad',           'インターネット', 'paid'),
    ('SNS自然流入',      'sns_organic',      'インターネット', 'owned'),
    ('検索',             'organic_search',   'インターネット', 'owned'),
    ('メディア掲載',     'media',            'その他',       'earned'),
    ('スカウト',         'scout',            'その他',       'outbound')
ON CONFLICT (name) DO NOTHING;
