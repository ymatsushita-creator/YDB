-- =============================================================
-- 0013 保留と利益相反が重なると、やることが二重に出ていた
--
-- 発見の経緯: 「担当を替える」を画面から実行できるようにする作業中。
-- 操作できる母集団を `v_open_tasks` の 'reassign' に揃えようとして、
-- 保留中の評価に利益相反が出ている場合を数え直したら2行あった。
--
--   unhold    … state = 'held'（利益相反を見ていない）
--   reassign  … 利益相反 AND state IN ('pending','held')
--
-- 0012 では 'evaluate' から利益相反を除いてある。理由はこう書いた。
--
--   利益相反が出ている評価に「評価してください」とは出さない。
--   そこでやるべきことは担当の差し替えであって、評価ではない。
--   同じ評価を2種類のタスクとして2回出すと、件数が二重に見える。
--
-- **同じ手当てを 'unhold' にしていなかった。** 保留を解いても、面接官が
-- 紹介者のままなら次にやることは差し替えである。順序が逆になっている。
--
-- 表に出ていなかったのは、デモに「保留 かつ 利益相反」の組み合わせが
-- 無かったからである。乱数で生まれた利益相反はすべて submitted で、
-- 明示的に置いた1件は pending だった。**組み合わせを1つ置き忘れると、
-- 分岐は静かに死ぬ**（実行⑥で `reassign` そのものが踏まれていなかったのと同じ形）。
--
-- 直し方は 'evaluate' と同じ NOT EXISTS を 'unhold' にも付けるだけである。
-- 0012 は適用済みなので編集しない。ここで置き換える。
--
-- CREATE OR REPLACE VIEW を使う。列の並びも型も変えないため置換できる。
-- 依存している v_forest_season_activity（open_tasks の CTE）を
-- 作り直す必要が無い。
--
-- tests/15「保留中の評価に利益相反があっても、やることは1件だけ出る」が
-- この一致を固定している。
-- =============================================================

CREATE OR REPLACE VIEW v_open_tasks AS
-- 評価する。担当が決まっていて、判断がまだ下りていない。
SELECT 'evaluate'::text        AS kind,
       e.id                    AS source_id,
       ss.season_id,
       a.id                    AS application_id,
       a.person_id,
       ss.id                   AS selection_step_id,
       ss.name                 AS step_name,
       ss.sort_order           AS step_order,
       e.interviewer_staff_id  AS owner_staff_id,
       e.assigned_at           AS since,
       (jst_today() - jst_date(e.assigned_at))    AS waiting_days,
       ss.sla_days,
       (ss.sla_days IS NOT NULL
        AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days) AS is_overdue,
       NULL::text              AS detail
  FROM evaluations e
  JOIN selection_steps ss       ON ss.id = e.selection_step_id
  JOIN v_active_applications a  ON a.id = e.application_id
 WHERE e.state = 'pending'
   AND e.interviewer_staff_id IS NOT NULL
   -- 利益相反が出ている評価に「評価してください」とは出さない。
   -- そこでやるべきことは担当の差し替えであって、評価ではない。
   -- 同じ評価を2種類のタスクとして2回出すと、件数が二重に見える。
   AND NOT EXISTS (
       SELECT 1 FROM v_conflict_of_interest coi WHERE coi.evaluation_id = e.id)

UNION ALL

-- 担当を決める。第1ステップは面接官なしで評価行が生成される。
SELECT 'assign'::text, e.id, ss.season_id, a.id, a.person_id,
       ss.id, ss.name, ss.sort_order,
       NULL::uuid,                       -- 担当がいないから、これがタスクである
       e.assigned_at,
       (jst_today() - jst_date(e.assigned_at)),
       ss.sla_days,
       (ss.sla_days IS NOT NULL
        AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days),
       NULL::text
  FROM evaluations e
  JOIN selection_steps ss       ON ss.id = e.selection_step_id
  JOIN v_active_applications a  ON a.id = e.application_id
 WHERE e.state = 'pending'
   AND e.interviewer_staff_id IS NULL

UNION ALL

-- 保留を解く。理由が必須（0008 と同じ規律）なので、必ず読める形で出る。
SELECT 'unhold'::text, e.id, ss.season_id, a.id, a.person_id,
       ss.id, ss.name, ss.sort_order,
       e.interviewer_staff_id,
       e.assigned_at,
       (jst_today() - jst_date(e.assigned_at)),
       ss.sla_days,
       (ss.sla_days IS NOT NULL
        AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days),
       e.hold_reason
  FROM evaluations e
  JOIN selection_steps ss       ON ss.id = e.selection_step_id
  JOIN v_active_applications a  ON a.id = e.application_id
 WHERE e.state = 'held'
   -- [0013 で追加] 'evaluate' と同じ理由。保留を解いても面接官が紹介者の
   -- ままなら、次にやることは差し替えである。順序が逆になる。
   AND NOT EXISTS (
       SELECT 1 FROM v_conflict_of_interest coi WHERE coi.evaluation_id = e.id)

UNION ALL

-- 担当を替える。紹介者が面接官、または面接官が応募者本人。
-- 判断が下りてしまった評価（submitted）は替えても戻らないので出さない。
-- 検証（紹介チャネルの合格率が実力かバイアスか）は /operations の仕事。
SELECT 'reassign'::text, e.id, ss.season_id, a.id, a.person_id,
       ss.id, ss.name, ss.sort_order,
       e.interviewer_staff_id,
       e.assigned_at,
       (jst_today() - jst_date(e.assigned_at)),
       ss.sla_days,
       (ss.sla_days IS NOT NULL
        AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days),
       CASE coi.conflict_type WHEN 'self' THEN '面接官が応募者本人'
                              ELSE '紹介者が面接官' END
  FROM v_conflict_of_interest coi
  JOIN evaluations e            ON e.id = coi.evaluation_id
  JOIN selection_steps ss       ON ss.id = e.selection_step_id
  JOIN v_active_applications a  ON a.id = coi.application_id
 WHERE e.state IN ('pending', 'held');

COMMENT ON VIEW v_open_tasks IS
    'いま誰かがやるべきこと。既存の事実（evaluations / 利益相反）からの導出で、'
    'Task エンティティの記録層ではない（domain.md 10-2 は未決）。'
    '母集団は v_active_applications。1つの評価は1件のやることにしか出ない。';
