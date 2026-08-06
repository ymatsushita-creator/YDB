-- =============================================================
-- 導出ビュー 修正版
-- academy_schema.sql のビュー定義を置き換える。
-- テーブル定義の変更は追加インデックス1本のみ。
--
-- 修正内容
--   1. 訂正（打ち消し行）を正しく解釈する v_effective_status_histories を新設
--   2. v_person_state を生涯状態と年度別状態に分割
--   3. ファネルに幹（accepted）と純幹（辞退控除後）を追加
--   4. 林を Season スコープのアクティブ判定に変更
--   5. 比喩を使わない命名に統一
--
-- 命名対応
--   森 = partner_reaches（ファネル外）
--   林 = identified_person
--   木 = applicant
--   幹 = accepted
-- =============================================================


-- -------------------------------------------------------------
-- 0. 前提となるテーブル定義の追加
-- -------------------------------------------------------------

-- 1つの履歴行を打ち消す訂正行は最大1つ。
-- これがないと訂正チェーンが分岐し、有効性の判定が一意に定まらない。
CREATE UNIQUE INDEX status_histories_corrects_key
    ON status_histories (corrects_history_id)
    WHERE corrects_history_id IS NOT NULL;


-- -------------------------------------------------------------
-- 1. 有効な状態遷移
-- -------------------------------------------------------------
-- is_correction = false は「この行が訂正行ではない」ことしか意味しない。
-- 打ち消された元の行を除外するには、その行を訂正対象にしている
-- 有効な打ち消し行が存在しないことを確認する必要がある。
--
-- 訂正の訂正も許容するため、チェーンを再帰的にたどる。
-- 末尾（誰にも訂正されていない行）を深さ0とし、深さが偶数の行が有効。
--
--   履歴1 advance      ← 履歴2に訂正された     深さ1  無効
--   履歴2 reject       ← 履歴3に訂正された     深さ1... ではなく
--
-- 正確には：履歴3が末尾なら深さ0で有効、履歴2は深さ1で無効、履歴1は深さ2で有効。
-- 訂正を訂正すれば元の記録が復活する、という会計の逆仕訳と同じ挙動になる。
CREATE OR REPLACE VIEW v_effective_status_histories AS
WITH RECURSIVE chain AS (
    SELECT h.id,
           h.corrects_history_id,
           0 AS depth
      FROM status_histories h
     WHERE NOT EXISTS (
               SELECT 1 FROM status_histories c
                WHERE c.corrects_history_id = h.id
           )
    UNION ALL
    SELECT t.id,
           t.corrects_history_id,
           ch.depth + 1
      FROM chain ch
      JOIN status_histories t ON t.id = ch.corrects_history_id
)
SELECT sh.*
  FROM status_histories sh
  JOIN chain ON chain.id = sh.id
 WHERE chain.depth % 2 = 0;


-- -------------------------------------------------------------
-- 2. 応募ごとの到達状況
-- -------------------------------------------------------------
-- 「到達したことがあるか」で判定する。
-- 差し戻し（revert）が起きても、一度到達していれば到達済みとして数える。
CREATE OR REPLACE VIEW v_application_state AS
SELECT
    a.id            AS application_id,
    a.person_id,
    a.season_id,
    a.submitted_at,
    a.is_reapplication,
    EXISTS (
        SELECT 1
          FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id
           AND sh.transition_type = 'advance'
           AND sh.selection_step_id = (
                   SELECT ss.id FROM selection_steps ss
                    WHERE ss.season_id = a.season_id
                    ORDER BY ss.sort_order DESC LIMIT 1
               )
    ) AS is_accepted,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'reject'
    ) AS is_rejected,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'withdraw'
    ) AS is_withdrawn
  FROM applications a
 WHERE a.voided_at IS NULL
   AND a.deleted_at IS NULL;


-- -------------------------------------------------------------
-- 3. 生涯状態（Person 単位）
-- -------------------------------------------------------------
-- 一生を通じた最高到達点と最終接触。年度の概念を持たない。
-- タレントプールの対象抽出や、再応募者の識別に使う。
CREATE OR REPLACE VIEW v_person_lifetime_summary AS
SELECT
    p.id AS person_id,
    p.created_at AS identified_at,
    (SELECT max(t.occurred_at) FROM touchpoints t WHERE t.person_id = p.id)
        AS last_touch_at,
    EXISTS (SELECT 1 FROM v_application_state s WHERE s.person_id = p.id)
        AS has_ever_applied,
    EXISTS (SELECT 1 FROM v_application_state s
             WHERE s.person_id = p.id AND s.is_accepted)
        AS has_ever_been_accepted,
    (SELECT count(*) FROM v_application_state s WHERE s.person_id = p.id)
        AS application_count
  FROM persons p
 WHERE p.deleted_at IS NULL;


-- -------------------------------------------------------------
-- 4. 年度別の現在地（Person × Season 単位）
-- -------------------------------------------------------------
-- 資料2-3「林に期は存在しない。存在するのは、今期の応募母集団として
-- 見たときの林の人数であり、Person に対する期スコープの検索結果である」
-- を実装したもの。
--
-- 前年度に不合格だった人は、今年度に応募していなければ林に戻る。
-- 生涯状態と混同しないよう、ビューを分離している。
CREATE OR REPLACE VIEW v_person_season_state AS
SELECT
    p.id      AS person_id,
    se.id     AS season_id,
    se.enrollment_year,
    COALESCE(s.is_accepted, false)  AS is_accepted_in_season,
    (s.application_id IS NOT NULL)  AS has_applied_in_season,
    CASE
        WHEN COALESCE(s.is_accepted, false) THEN 'accepted'      -- 幹
        WHEN s.application_id IS NOT NULL   THEN 'applicant'     -- 木
        ELSE 'identified_person'                                 -- 林
    END AS current_level
  FROM persons p
 CROSS JOIN seasons se
  LEFT JOIN v_application_state s
         ON s.person_id = p.id AND s.season_id = se.id
 WHERE p.deleted_at IS NULL
   AND p.created_at::date <= se.selection_end_date;


-- -------------------------------------------------------------
-- 5. ファネル日次断面
-- -------------------------------------------------------------
-- 3段（林・木・幹）。森は単位が異なるため含めない。
-- 累積で数え、段間に不合格と辞退を明示する。
--
-- identified_person_cum は Season スコープのアクティブ林。
-- 全 Person を数えると、どの年度のファネルでも同じ値になり、
-- 過去の Person が分母に積み上がって転換率が年々下がる。
-- active_window_days は運用時に決定するため引数とする。
--
-- accepted_cum は最終ステップへの有効な advance の累積。
-- net_accepted_cum は内定辞退を控除した実質の充足数。
-- 定員に対する充足を測るのは後者。
CREATE OR REPLACE FUNCTION f_funnel_daily(active_window_days integer)
RETURNS TABLE (
    season_id              uuid,
    as_of                  date,
    relative_day           integer,
    identified_person_cum  bigint,
    applicant_cum          bigint,
    accepted_cum           bigint,
    net_accepted_cum       bigint,
    rejected_cum           bigint,
    withdrawn_cum          bigint
) AS $$
    SELECT
        s.id,
        d.day::date,
        (d.day::date - s.application_open_date)::integer,

        -- 林：識別済みかつ直近に接触がある Person
        (SELECT count(*) FROM persons p
          WHERE p.deleted_at IS NULL
            AND p.created_at::date <= d.day::date
            AND EXISTS (
                    SELECT 1 FROM touchpoints t
                     WHERE t.person_id = p.id
                       AND t.occurred_at::date <= d.day::date
                       AND t.occurred_at::date
                           > d.day::date - active_window_days
                )),

        -- 木
        (SELECT count(*) FROM v_application_state a
          WHERE a.season_id = s.id AND a.submitted_at::date <= d.day::date),

        -- 幹（累積）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND a.voided_at IS NULL AND a.deleted_at IS NULL
            AND sh.transition_type = 'advance'
            AND sh.occurred_at::date <= d.day::date
            AND sh.selection_step_id = (
                    SELECT ss.id FROM selection_steps ss
                     WHERE ss.season_id = s.id
                     ORDER BY ss.sort_order DESC LIMIT 1
                )),

        -- 純幹（内定辞退を控除）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND a.voided_at IS NULL AND a.deleted_at IS NULL
            AND sh.transition_type = 'advance'
            AND sh.occurred_at::date <= d.day::date
            AND sh.selection_step_id = (
                    SELECT ss.id FROM selection_steps ss
                     WHERE ss.season_id = s.id
                     ORDER BY ss.sort_order DESC LIMIT 1
                )
            AND NOT EXISTS (
                    SELECT 1 FROM v_effective_status_histories w
                     WHERE w.application_id = sh.application_id
                       AND w.transition_type = 'withdraw'
                       AND w.occurred_at::date <= d.day::date
                )),

        -- 不合格
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND a.voided_at IS NULL AND a.deleted_at IS NULL
            AND sh.transition_type = 'reject'
            AND sh.occurred_at::date <= d.day::date),

        -- 辞退（不合格と混ぜない。チャネルの質を表す指標になる）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND a.voided_at IS NULL AND a.deleted_at IS NULL
            AND sh.transition_type = 'withdraw'
            AND sh.occurred_at::date <= d.day::date)

      FROM seasons s
     CROSS JOIN LATERAL generate_series(
         s.application_open_date, s.selection_end_date, interval '1 day'
     ) AS d(day);
$$ LANGUAGE sql STABLE;


-- -------------------------------------------------------------
-- 6. 森（ファネル外・流入元セクション用）
-- -------------------------------------------------------------
-- 団体・期間単位の集計としてのみ意味を持つ。
-- partner_reaches の特定の1行と、そこから生まれた特定の Person を
-- 対応させることはできない。個人識別しないのが森の定義だから。
-- estimated_reach は推定値であり、identified_count は実人数である点に注意。
CREATE OR REPLACE VIEW v_partner_reach_summary AS
SELECT
    pr.partner_id,
    pr.season_id,
    sum(pr.estimated_reach) AS estimated_reach_total,
    count(*)                AS contact_occasions,
    (SELECT count(DISTINCT t.person_id)
       FROM touchpoints t
      WHERE t.partner_id = pr.partner_id
        AND t.occurred_at::date
            BETWEEN min(pr.occurred_on) AND max(pr.occurred_on) + 90
    ) AS identified_count
  FROM partner_reaches pr
 GROUP BY pr.partner_id, pr.season_id;
