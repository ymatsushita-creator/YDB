-- =============================================================
-- 0014 やることを「4つの枝」から「1つの優先順位」に組み替える
--
-- レトロスペクティブ（REPORT-6.5）から出た、必要最小限の設計更新である。
--
-- 0012 の v_open_tasks は UNION ALL で4つの枝を並べ、それぞれに WHERE を
-- 書いていた。「1つの評価は1件のやることにしか出ない」という性質は、
-- 枝ごとの除外条件を人が正しく書き続けることで保たれていた。
--
-- 保たれなかった。0013 で直したのがそれである（A-18）。
--
--   'evaluate' には利益相反の除外を書いた
--   'unhold'   には書き忘れた  → 保留＋利益相反で2行
--
-- 枝が4つ、状態が2つ（pending / held）、相反が2通り。**組み合わせを
-- 種別ごとに読んでも抜ける。** 「評価する」の入力を足せば状態がさらに増え、
-- 同じ穴がまた開く。個別の異常を潰すより、異常が生まれる余地を閉じる
-- （0003 で UPDATE / DELETE を禁じたときと同じ判断）。
--
-- そこで**枝を1本にして、種別を優先順位で決める。**
-- 1つの評価は必ず1行になる。これは人が守る規律ではなく、構造である。
--
--   1. reassign … 利益相反がある（担当を替えるまで、ほかは意味を持たない）
--   2. unhold   … 保留（解くまで判断は進まない）
--   3. assign   … 担当がいない
--   4. evaluate … 担当がいて、判断待ち
--
-- 順序の根拠。相反を最初に置くのは、替えないまま評価すると記録が汚れる
-- からである（0012 の 'evaluate' の除外と同じ理由）。保留を次に置くのは、
-- 解かないと担当の有無に関係なく止まったままだからである。
--
-- ★ 相反の LEFT JOIN を DISTINCT ON で畳んでいる理由。
--
--   v_conflict_of_interest は UNION ALL なので、1つの評価に2行つく形が
--   ありうる（紹介者かつ本人）。LEFT JOIN でそのまま繋ぐと、
--   せっかく1本にした枝がそこで2行に増える。
--
--   **いまその形は作れない。** 両方が立つには
--   `applicant.referrer_person_id = applicant.person_id` が要るが、
--   `persons_no_self_referral` がそれを拒否する（tests/15 で確認した）。
--
--   それでも畳んでおくのは、**増えたときに静かに壊れる**からである。
--   件数が1件から2件になるだけで、エラーにはならない。
--   A-18 で踏んだのがまさにその壊れ方だった。
--   並べ替えは conflict_type まで指定して決定的にする（A-7 と同じ規律）。
--
-- 出力の列・型・順序は 0012 と同じなので CREATE OR REPLACE VIEW で足りる。
-- 依存している v_forest_season_activity を作り直す必要が無い。
--
-- 値が変わらないことは tests/15 が固定している（0013 と同じ結果になる）。
-- =============================================================

CREATE OR REPLACE VIEW v_open_tasks AS
WITH conflict AS (
    -- 1つの評価につき1行。紹介者と本人の両方が立つ場合は
    -- conflict_type の順で決定的に選ぶ（'referrer' < 'self'）。
    SELECT DISTINCT ON (coi.evaluation_id)
           coi.evaluation_id, coi.conflict_type
      FROM v_conflict_of_interest coi
     ORDER BY coi.evaluation_id, coi.conflict_type
)
SELECT CASE
           WHEN c.evaluation_id IS NOT NULL        THEN 'reassign'
           WHEN e.state = 'held'                   THEN 'unhold'
           WHEN e.interviewer_staff_id IS NULL     THEN 'assign'
           ELSE 'evaluate'
       END::text               AS kind,
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
       -- 種別ごとに読める言葉を1つだけ。相反なら種別、保留なら理由。
       CASE
           WHEN c.evaluation_id IS NOT NULL THEN
               CASE c.conflict_type WHEN 'self' THEN '面接官が応募者本人'
                                    ELSE '紹介者が面接官' END
           WHEN e.state = 'held' THEN e.hold_reason
           ELSE NULL
       END                     AS detail
  FROM evaluations e
  JOIN selection_steps ss       ON ss.id = e.selection_step_id
  JOIN v_active_applications a  ON a.id = e.application_id
  LEFT JOIN conflict c          ON c.evaluation_id = e.id
 -- 判断が下りた評価（submitted）は、やることではない。
 -- 相反が残っていても替えても戻らないので、ここで落とす（0012 と同じ）。
 WHERE e.state IN ('pending', 'held');

COMMENT ON VIEW v_open_tasks IS
    'いま誰かがやるべきこと。既存の事実（evaluations / 利益相反）からの導出で、'
    'Task エンティティの記録層ではない（domain.md 10-2 は未決）。'
    '母集団は v_active_applications。'
    '**1つの評価は必ず1件のやることになる**（種別は優先順位で決まる）。';
