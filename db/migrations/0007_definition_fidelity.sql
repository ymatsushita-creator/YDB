-- =============================================================
-- 0007 定義との食い違いを塞ぐ
--
-- 自己レビューで、原典の定義が述べていることと実装が食い違う箇所が
-- 3つ見つかった。いずれも「定義のほうが正しい」と判断して実装を寄せる。
-- =============================================================


-- -------------------------------------------------------------
-- 1. v_person_season_state を Person × Season で1行に戻す
-- -------------------------------------------------------------
-- 原典の定義:
--   「年度別の現在地（Person × Season 単位）」
--   「今期の応募母集団として見たときの林の人数であり、
--     Person に対する期スコープの検索結果である」（資料2-3）
--
-- 1人1行が定義。ところが A-2 で v_countable_applications が
-- 「無効化済みでも counts_as_application なら残す」ようになった結果、
-- 同一年度に同一 Person の集計対象応募が2件存在しうるようになった。
-- 取り下げて出し直した人がその形になる。
--
-- 素の LEFT JOIN のままだったので、同じ人が同じ年度に
-- 「木」と「幹」の2行で現れる。この上で current_level を数えれば、
-- 1人が林・木・幹のうち2段に同時に立つ。
--
-- A-2 を入れたときに、この結合が 1:1 でなくなることを見落としていた。
-- DECISIONS D-2 は「木が1人で2件になる」ことしか認めていない。
--
-- 直し方は定義から決まる。段は「その年度に到達した最高地点」なので、
-- 応募をまたいで最高地点を取る。取り下げて出し直して受かった人は幹。
CREATE OR REPLACE VIEW v_person_season_state AS
SELECT
    p.id      AS person_id,
    se.id     AS season_id,
    se.enrollment_year,
    s.is_accepted   AS is_accepted_in_season,
    s.has_applied   AS has_applied_in_season,
    CASE
        WHEN s.is_accepted THEN 'accepted'                       -- 幹
        WHEN s.has_applied THEN 'applicant'                      -- 木
        ELSE 'identified_person'                                 -- 林
    END AS current_level
  FROM persons p
 CROSS JOIN seasons se
 CROSS JOIN LATERAL (
        SELECT COALESCE(bool_or(a.is_accepted), false) AS is_accepted,
               count(*) > 0                            AS has_applied
          FROM v_application_state a
         WHERE a.person_id = p.id AND a.season_id = se.id
       ) s
 WHERE p.deleted_at IS NULL
   AND jst_date(p.created_at) <= se.selection_end_date;

COMMENT ON VIEW v_person_season_state IS
    '年度ごとの Person の現在地。Person × Season で必ず1行。段は年度内の最高到達点。';


-- -------------------------------------------------------------
-- 2. 訂正は同じ応募の中でしか行えない
-- -------------------------------------------------------------
-- 原典の定義:
--   「訂正は打ち消しの追記で表現し、元の記録は残す」（原則5）
--   status_histories は application_id を持ち、応募ごとの遷移ログである
--
-- 訂正とは「この応募のこの記録が誤っていた」という主張であり、
-- 別の応募の記録を打ち消すという操作は定義に存在しない。
-- ところが corrects_history_id には同一応募である制約がなく、
-- 応募Yの行から応募Xの合格を打ち消せてしまう。
--
-- しかも v_effective_status_histories は打ち消された行を黙って落とすので、
-- 応募Xの担当者には何が起きたか分からない。
--
-- 外部キーでは表現できないためトリガで担保する。
CREATE OR REPLACE FUNCTION check_correction_scope()
RETURNS trigger AS $$
DECLARE
    v_target_application uuid;
BEGIN
    IF NEW.corrects_history_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT sh.application_id INTO v_target_application
      FROM status_histories sh WHERE sh.id = NEW.corrects_history_id;

    IF v_target_application <> NEW.application_id THEN
        RAISE EXCEPTION
            'correction crosses applications: % cannot correct a history of %',
            NEW.application_id, v_target_application
            USING HINT = '訂正は同じ応募の記録に対してのみ行う（設計原則5）。';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER status_histories_correction_scope
    BEFORE INSERT ON status_histories
    FOR EACH ROW EXECUTE FUNCTION check_correction_scope();


-- -------------------------------------------------------------
-- 3. 選考ステップは応募の年度のものに限る
-- -------------------------------------------------------------
-- 原典の定義:
--   selection_steps は season_id を持ち「年度ごとに可変」（資料5-1）
--   evaluation_criteria は「ステップに属するため年度をまたいで共有されない」
--
-- 評価軸とステップの整合は 0001 のトリガで担保した。しかしその1段上、
-- 「ステップと応募の年度」が空いていた。2026年度の応募に2027年度の
-- ステップを指す評価や遷移を入れられる。
--
-- 入れると、応募が0件の年度のステップ別集計に到達数が立ち、
-- (2)の滞留一覧に他年度の応募者が現れる。年度をまたいで共有されないという
-- 定義が、1段上で破れていた。
CREATE OR REPLACE FUNCTION check_step_belongs_to_season()
RETURNS trigger AS $$
DECLARE
    v_application_season uuid;
    v_step_season        uuid;
BEGIN
    IF NEW.selection_step_id IS NULL THEN
        RETURN NEW;   -- reject / withdraw はステップを持たない
    END IF;

    SELECT a.season_id INTO v_application_season
      FROM applications a WHERE a.id = NEW.application_id;

    SELECT ss.season_id INTO v_step_season
      FROM selection_steps ss WHERE ss.id = NEW.selection_step_id;

    IF v_application_season <> v_step_season THEN
        RAISE EXCEPTION
            'selection step belongs to season %, but the application is in season %',
            v_step_season, v_application_season
            USING HINT = '選考ステップは年度をまたいで共有されない（資料5-1）。';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER status_histories_step_season
    BEFORE INSERT ON status_histories
    FOR EACH ROW EXECUTE FUNCTION check_step_belongs_to_season();

CREATE TRIGGER evaluations_step_season
    BEFORE INSERT OR UPDATE ON evaluations
    FOR EACH ROW EXECUTE FUNCTION check_step_belongs_to_season();
