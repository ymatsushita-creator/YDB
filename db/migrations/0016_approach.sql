-- =============================================================
-- 0016 ヘッドハンティング（アプローチ）の記録層
--
-- 発見の経緯: 実行⑨で依頼者から「ヘッドハンティング画面」の意匠が届いた。
-- その画面は候補者ごとに「アプローチ中 / 面談調整中 / 検討中 / 未アプローチ」
-- を出す。**この事実は記録層のどこにも無かった。**
--
--   touchpoints … 「接触があった」という出来事。状態ではない
--   applications … 応募が起きてからの話。アプローチはその手前にある
--   status_histories … 応募の選考段階。アプローチとは別の軸
--
-- director.md 末尾が禁じているのは、まさにこの状況で画面側に状態を
-- 合成することである ――
--
--   「森が主役に見える画面」を、森の実体が無いまま作ってはならない。
--   その場合に直すのは画面ではなく、記録層である。
--
-- 依頼者の判断（実行⑨）は「記録層から作る」だった。ここで作る。
--
-- ★ 設計の選択と、その理由
--
-- 1. 状態カラムを持つ表にしない。**出来事の追記だけにする。**
--    原則1「記録層は上書きカラムを持たない。導出可能な値は物理保存しない」。
--    現在の状態は最新の有効な出来事から導ける（v_person_approach_state）。
--    上書きにすると、実行⑦で踏んだ C-22（担当を替えると前の担当が
--    黙って消える）をアプローチ状態でもう一度踏む。
--
-- 2. 「リストに載せる／外す」を別の表にしない。**状態の一種として扱う。**
--    載せる = 最初の出来事（通常 not_approached）を追記すること。
--    外す   = is_terminal な状態（declined）を追記すること。
--    表を2つに割ると「リストに居ないのに状態がある」行が作れてしまい、
--    どちらが正かを画面が決めることになる。1つの表なら構造で閉じる。
--
-- 3. 訂正は打ち消し行の追記（原則5）。**status_histories と同じ型を使う。**
--    深さ偶数が有効という再帰判定まで含めて写している。ここで別の型を
--    発明すると、訂正の意味が表ごとに変わる。
--
-- 4. 年度で分ける。アプローチは「どの年度の採用に向けて声を掛けたか」で
--    意味が変わる。ただし画像のパンくずは「2026年卒」（卒業年度）であり、
--    記録層に卒業年度は無い。**年度（seasons）で代用している。**
--    TODO(MVP): 卒業年度を軸にするなら persons への列追加が要る。未決。
--
-- 5. 職種（画像の「エンジニア職（新卒）」）は作っていない。
--    記録層に職種の実体が無く、依頼者からの定義も無い。
--    推測で埋めない（CLAUDE.md 10節）。TODO(MVP)。
-- =============================================================

-- -------------------------------------------------------------
-- 1. アプローチ状態のマスタ
-- -------------------------------------------------------------
-- 原則3「集計定義に関わるマスタは更新せず、追加と非活性化で運用する」。
-- is_active = false にしても過去の出来事は状態を指し続ける。
--
-- is_terminal は「この状態になったらヘッドハンティングリストから外れる」
-- ことを宣言する。理由テキストで分岐せず、マスタの真偽値を読む（原則7）。
CREATE TABLE approach_states (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    label       text        NOT NULL,
    sort_order  integer     NOT NULL,
    is_terminal boolean     NOT NULL DEFAULT false,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT approach_states_code_key UNIQUE (code),
    CONSTRAINT approach_states_sort_key UNIQUE (sort_order)
);

COMMENT ON TABLE approach_states IS
    'アプローチ状態のマスタ。追加と非活性化で運用する（原則3）。';
COMMENT ON COLUMN approach_states.is_terminal IS
    'true になった人はヘッドハンティングリストから外れる。'
    '理由ではなくマスタの真偽値で判定する（原則7）。';


-- -------------------------------------------------------------
-- 2. アプローチの出来事（追記専用）
-- -------------------------------------------------------------
CREATE TABLE approach_events (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id            uuid        NOT NULL REFERENCES persons(id),
    season_id            uuid        NOT NULL REFERENCES seasons(id),
    approach_state_id    uuid        NOT NULL REFERENCES approach_states(id),
    occurred_at          timestamptz NOT NULL,
    recorded_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    is_correction        boolean     NOT NULL DEFAULT false,
    corrects_event_id    uuid        REFERENCES approach_events(id),
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    -- 訂正の向きを双方向にしない。自分で自分を打ち消す行は再帰の始点を
    -- 持たず、行がまるごと集計から消える（status_histories と同じ理由）。
    CONSTRAINT approach_events_no_self_correction
        CHECK (corrects_event_id IS NULL OR corrects_event_id <> id),
    -- フラグと参照を両方向で縛る。片側だけだとフラグのほうが嘘になる。
    CONSTRAINT approach_events_correction_pair
        CHECK (is_correction = false OR corrects_event_id IS NOT NULL),
    CONSTRAINT approach_events_correction_pair_reverse
        CHECK (corrects_event_id IS NULL OR is_correction = true)
);

COMMENT ON TABLE approach_events IS
    'アプローチの出来事。追記専用。現在の状態は v_person_approach_state が導く。';

CREATE INDEX approach_events_person_idx
    ON approach_events (person_id, season_id, occurred_at);
CREATE INDEX approach_events_season_idx
    ON approach_events (season_id, occurred_at);

-- 1つの行を打ち消す訂正行は最大1つ。分岐すると有効性が一意に定まらない。
CREATE UNIQUE INDEX approach_events_corrects_key
    ON approach_events (corrects_event_id)
    WHERE corrects_event_id IS NOT NULL;

-- 追記専用。UPDATE を禁じることで訂正チェーンの循環が構造的に作れなくなる
-- （0003 と同じ理由。辺は INSERT でしか張れず、必ず過去を向く）。
CREATE TRIGGER approach_events_append_only
    BEFORE UPDATE OR DELETE ON approach_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();


-- -------------------------------------------------------------
-- 3. 有効な出来事（訂正チェーンの解決）
-- -------------------------------------------------------------
-- v_effective_status_histories と同じ判定。深さ偶数が有効。
-- 訂正を訂正すれば元が復活する（会計の逆仕訳と同じ挙動）。
CREATE VIEW v_effective_approach_events AS
WITH RECURSIVE chain AS (
    SELECT e.id, e.corrects_event_id, 0 AS depth
      FROM approach_events e
     WHERE NOT EXISTS (
               SELECT 1 FROM approach_events c
                WHERE c.corrects_event_id = e.id
           )
    UNION ALL
    SELECT t.id, t.corrects_event_id, ch.depth + 1
      FROM chain ch
      JOIN approach_events t ON t.id = ch.corrects_event_id
)
SELECT ae.*
  FROM approach_events ae
  JOIN chain ON chain.id = ae.id
 WHERE chain.depth % 2 = 0;

COMMENT ON VIEW v_effective_approach_events IS
    '訂正チェーンを解決した後に有効なアプローチの出来事。深さ偶数が有効。';


-- -------------------------------------------------------------
-- 4. 現在のアプローチ状態
-- -------------------------------------------------------------
-- 同じ瞬間に2件入った場合は created_at、それも同じなら id で決める。
-- 順序が決まらないと、同じ問いに画面ごとに違う答えが出る。
CREATE VIEW v_person_approach_state AS
SELECT DISTINCT ON (e.person_id, e.season_id)
       e.person_id,
       e.season_id,
       e.approach_state_id,
       s.code                  AS approach_code,
       s.label                 AS approach_label,
       s.is_terminal,
       e.occurred_at           AS state_since,
       e.recorded_by_staff_id  AS last_recorded_by_staff_id,
       e.note                  AS last_note
  FROM v_effective_approach_events e
  JOIN approach_states s ON s.id = e.approach_state_id
 ORDER BY e.person_id, e.season_id, e.occurred_at DESC, e.created_at DESC, e.id DESC;

COMMENT ON VIEW v_person_approach_state IS
    '人 × 年度の現在のアプローチ状態。最新の有効な出来事から導出する。';


-- -------------------------------------------------------------
-- 5. ヘッドハンティングリスト
-- -------------------------------------------------------------
-- 「リストに載っている」の定義はここ1箇所。画面が数え直さない。
--
-- 個人情報削除を受けた人は外す。木と幹に数え続けるか（D-10）とは
-- 別の話で、こちらは「これから声を掛ける相手」なので、削除依頼を
-- 受けた人を載せ続ける理由が無い。
CREATE VIEW v_headhunting_list AS
SELECT a.person_id,
       a.season_id,
       a.approach_state_id,
       a.approach_code,
       a.approach_label,
       a.state_since,
       a.last_recorded_by_staff_id,
       a.last_note
  FROM v_person_approach_state a
  JOIN persons p ON p.id = a.person_id
 WHERE a.is_terminal = false
   AND p.deleted_at IS NULL
   AND p.anonymized_at IS NULL;

COMMENT ON VIEW v_headhunting_list IS
    'ヘッドハンティングの対象者。終端状態に達しておらず、個人情報削除も受けていない人。';


-- -------------------------------------------------------------
-- 6. マスタの初期値
-- -------------------------------------------------------------
-- ★ これは推測ではない。**画像に描かれた4つの状態**（未アプローチ /
--   検討中 / アプローチ中 / 面談調整中）を依頼者の指定としてそのまま置く。
--
-- declined（見送り）だけは画像に無い。しかし終端状態が1つも無いと
-- **誰もリストから出られない**。出る手段の無いリストは運用できないので、
-- 構造上の必要として1つだけ足している。
-- TODO(MVP): 「見送り」という語と、見送りに理由が要るかは未確認。
INSERT INTO approach_states (code, label, sort_order, is_terminal) VALUES
    ('not_approached', '未アプローチ', 10, false),
    ('considering',    '検討中',       20, false),
    ('approaching',    'アプローチ中', 30, false),
    ('scheduling',     '面談調整中',   40, false),
    ('declined',       '見送り',       90, true);
