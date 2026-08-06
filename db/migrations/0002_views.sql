-- =============================================================
-- 0002 導出ビュー
--
-- 出典: basic/academy_views_revised.sql（全体）
--       basic/academy_schema.sql の導出ビューのうち、改訂版に置き換えられて
--       いないもの（v_touchpoint_season / v_attribution_* / v_conflict_of_interest）
--
-- 原典の v_person_state は v_person_lifetime_summary と v_person_season_state に
-- 分割され、v_funnel_daily は f_funnel_daily(integer) に置き換えられたため、
-- この 0002 では再定義しない。
--
-- 物理保存しないと決めた値はすべてここで計算する（原則1）。
--
-- 命名対応
--   森 = partner_reaches（ファネル外）
--   林 = identified_person
--   木 = applicant
--   幹 = accepted
-- =============================================================


-- -------------------------------------------------------------
-- 0. 最終選考ステップ
-- -------------------------------------------------------------
-- [追加] 原典では「最終ステップへの advance＝合格」の判定が
--   ORDER BY ss.sort_order DESC LIMIT 1
-- という形で5箇所に複製されていた。合格の定義が5箇所にあると、
-- 1箇所だけ直したときに誰も気づかない。1箇所に畳む。
CREATE VIEW v_final_selection_step AS
SELECT DISTINCT ON (ss.season_id)
       ss.season_id,
       ss.id   AS selection_step_id,
       ss.name AS selection_step_name,
       ss.sort_order
  FROM selection_steps ss
 ORDER BY ss.season_id, ss.sort_order DESC;

COMMENT ON VIEW v_final_selection_step IS
    '年度ごとの最終選考ステップ。ここへの有効な advance が「幹」の定義。';


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
-- 正確には：履歴3が末尾なら深さ0で有効、履歴2は深さ1で無効、履歴1は深さ2で有効。
-- 訂正を訂正すれば元の記録が復活する、という会計の逆仕訳と同じ挙動になる。
--
-- 循環（h1 が h2 を訂正し h2 が h1 を訂正する）は起点を持たないため
-- 再帰の基底に現れず、チェーン全体が静かに集計から消える。
-- 無限ループにはならないが、消えたことに気づけないのはより悪い。
-- 0003 のトリガで循環そのものを禁止する。
CREATE VIEW v_effective_status_histories AS
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

COMMENT ON VIEW v_effective_status_histories IS
    '訂正チェーンを解決した後に有効な状態遷移。深さ偶数＝有効（会計の逆仕訳と同じ）。';


-- -------------------------------------------------------------
-- 2. 集計対象の応募
-- -------------------------------------------------------------
-- [追加] 原典は voided_at IS NOT NULL の応募を無条件に集計から外していた。
-- しかし void_reasons.counts_as_application は、まさに
-- 「この無効化に対応する代替の Application が生まれるか」を区別するために
-- 存在する。生まれないなら（＝取り下げ）、その応募は起きた事実として
-- 木に数えなければ、応募数が実態より少なく出る。
--
-- 無条件に除外すると counts_as_application は誰にも読まれないカラムになり、
-- マスタを整備した意味が消える。原則7「事実の有無で判定し、理由で分岐しない」は
-- 分岐を禁じているのではなく、理由テキストによる場当たりの分岐を禁じている。
-- ここはマスタに宣言された真偽値を読んでいるだけで、原則には反しない。
--
-- deleted_at（個人情報削除）は性質が違う。こちらは無条件に除外する。
CREATE VIEW v_countable_applications AS
SELECT a.*
  FROM applications a
  LEFT JOIN void_reasons vr ON vr.id = a.void_reason_id
 WHERE a.deleted_at IS NULL
   AND (a.voided_at IS NULL OR vr.counts_as_application);

COMMENT ON VIEW v_countable_applications IS
    '集計に数える応募。無効化済みでも counts_as_application が真なら残す。';


-- -------------------------------------------------------------
-- 3. 応募ごとの到達状況
-- -------------------------------------------------------------
-- 「到達したことがあるか」で判定する。
-- 差し戻し（revert）が起きても、一度到達していれば到達済みとして数える。
CREATE VIEW v_application_state AS
SELECT
    a.id            AS application_id,
    a.person_id,
    a.season_id,
    a.submitted_at,
    a.is_reapplication,
    (a.voided_at IS NOT NULL) AS is_voided,
    EXISTS (
        SELECT 1
          FROM v_effective_status_histories sh
          JOIN v_final_selection_step fs ON fs.season_id = a.season_id
         WHERE sh.application_id = a.id
           AND sh.transition_type = 'advance'
           AND sh.selection_step_id = fs.selection_step_id
    ) AS is_accepted,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'reject'
    ) AS is_rejected,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'withdraw'
    ) AS is_withdrawn
  FROM v_countable_applications a;


-- -------------------------------------------------------------
-- 4. 生涯状態（Person 単位）
-- -------------------------------------------------------------
-- 一生を通じた最高到達点と最終接触。年度の概念を持たない。
-- タレントプールの対象抽出や、再応募者の識別に使う。
CREATE VIEW v_person_lifetime_summary AS
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
-- 5. 年度別の現在地（Person × Season 単位）
-- -------------------------------------------------------------
-- 資料2-3「林に期は存在しない。存在するのは、今期の応募母集団として
-- 見たときの林の人数であり、Person に対する期スコープの検索結果である」
-- を実装したもの。
--
-- 前年度に不合格だった人は、今年度に応募していなければ林に戻る。
-- 生涯状態と混同しないよう、ビューを分離している。
CREATE VIEW v_person_season_state AS
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
   AND jst_date(p.created_at) <= se.selection_end_date;


-- -------------------------------------------------------------
-- 6. ファネル日次断面
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
--
-- [変更] 日付境界をすべて jst_date() に通した。原典の `x::date` は
-- セッションの TimeZone に依存し、UTC 接続だと JST 09:00 未満の
-- 出来事が前日に寄る。集計定義が接続設定に漏れるのを止める。
--
-- [変更] 日付列の生成を timestamp（TZ なし）経由にした。date を
-- timestamptz に暗黙変換すると、セッション TZ を一往復する。
--
-- [変更] 最終ステップの判定を v_final_selection_step に集約した。
-- 原典では同じ相関副問い合わせが4回複製されていた。
--
-- [変更] active_window_days が NULL のとき、原典は比較が NULL になり
-- 林が黙って0人になる。0人のファネルは異常だと気づけるが、
-- 「引数を渡し忘れた」とは気づけない。require_positive で明示的に落とす。
-- ガードを最外の FROM に置いているのは、Season が0件でも必ず評価させるため。
CREATE FUNCTION f_funnel_daily(active_window_days integer)
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
        d.day,
        (d.day - s.application_open_date)::integer,

        -- 林：識別済みかつ直近に接触がある Person
        (SELECT count(*) FROM persons p
          WHERE p.deleted_at IS NULL
            AND jst_date(p.created_at) <= d.day
            AND EXISTS (
                    SELECT 1 FROM touchpoints t
                     WHERE t.person_id = p.id
                       AND jst_date(t.occurred_at) <= d.day
                       AND jst_date(t.occurred_at) > d.day - guard.window_days
                )),

        -- 木
        (SELECT count(*) FROM v_application_state a
          WHERE a.season_id = s.id AND jst_date(a.submitted_at) <= d.day),

        -- 幹（累積）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
           JOIN v_final_selection_step fs  ON fs.season_id = a.season_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'advance'
            AND sh.selection_step_id = fs.selection_step_id
            AND jst_date(sh.occurred_at) <= d.day),

        -- 純幹（内定辞退を控除）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
           JOIN v_final_selection_step fs  ON fs.season_id = a.season_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'advance'
            AND sh.selection_step_id = fs.selection_step_id
            AND jst_date(sh.occurred_at) <= d.day
            AND NOT EXISTS (
                    SELECT 1 FROM v_effective_status_histories w
                     WHERE w.application_id = sh.application_id
                       AND w.transition_type = 'withdraw'
                       AND jst_date(w.occurred_at) <= d.day
                )),

        -- 不合格
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'reject'
            AND jst_date(sh.occurred_at) <= d.day),

        -- 辞退（不合格と混ぜない。チャネルの質を表す指標になる）
        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'withdraw'
            AND jst_date(sh.occurred_at) <= d.day)

      FROM (
             SELECT require_positive(
                        f_funnel_daily.active_window_days, 'active_window_days'
                    ) AS window_days
           ) AS guard
     CROSS JOIN seasons s
     CROSS JOIN LATERAL generate_series(
         s.application_open_date::timestamp,
         s.selection_end_date::timestamp,
         interval '1 day'
     ) AS g(ts)
     CROSS JOIN LATERAL (SELECT g.ts::date) AS d(day);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION f_funnel_daily(integer) IS
    '年度×日のファネル累積断面。active_window_days は林のアクティブ判定窓（日）。';


-- -------------------------------------------------------------
-- 7. 接点の年度帰属
-- -------------------------------------------------------------
-- 期間が重複する場合は enrollment_year が最小の Season に寄せる。
-- 該当 Season が存在しない接点は season_id が NULL となり、(4)で「未割当」として表示する。
CREATE VIEW v_touchpoint_season AS
SELECT
    t.id AS touchpoint_id,
    t.person_id,
    t.channel_id,
    t.partner_id,
    t.occurred_at,
    (SELECT s.id FROM seasons s
      WHERE jst_date(t.occurred_at) BETWEEN s.outreach_start_date AND s.selection_end_date
      ORDER BY s.enrollment_year ASC LIMIT 1) AS season_id
  FROM touchpoints t;


-- -------------------------------------------------------------
-- 8. アトリビューション3方式
-- -------------------------------------------------------------
-- 1本にまとめて分岐させるとクエリプランが劣化するため分ける。
--
-- [変更] 同時刻の接点で順序が決まらないと結果が実行ごとに変わる。
-- touchpoint_id を第2キーに足して決定的にした。
CREATE VIEW v_attribution_first AS
SELECT DISTINCT ON (ts.person_id, ts.season_id)
       ts.person_id, ts.season_id, ts.channel_id, 1.0::numeric AS weight
  FROM v_touchpoint_season ts
 ORDER BY ts.person_id, ts.season_id, ts.occurred_at ASC, ts.touchpoint_id ASC;

CREATE VIEW v_attribution_last AS
SELECT DISTINCT ON (ts.person_id, ts.season_id)
       ts.person_id, ts.season_id, ts.channel_id, 1.0::numeric AS weight
  FROM v_touchpoint_season ts
 ORDER BY ts.person_id, ts.season_id, ts.occurred_at DESC, ts.touchpoint_id DESC;

-- 接点数で按分するため、weight の合計が実人数と一致する。
CREATE VIEW v_attribution_linear AS
SELECT ts.person_id,
       ts.season_id,
       ts.channel_id,
       (count(*)::numeric / sum(count(*)) OVER (PARTITION BY ts.person_id, ts.season_id))
           AS weight
  FROM v_touchpoint_season ts
 GROUP BY ts.person_id, ts.season_id, ts.channel_id;


-- -------------------------------------------------------------
-- 9. 森（ファネル外・流入元セクション用）
-- -------------------------------------------------------------
-- 団体・期間単位の集計としてのみ意味を持つ。
-- partner_reaches の特定の1行と、そこから生まれた特定の Person を
-- 対応させることはできない。個人識別しないのが森の定義だから。
-- estimated_reach は推定値であり、identified_count は実人数である点に注意。
--
-- [変更] identified_count の観測窓（最終リーチ+90日）を定数で埋め込まず
-- 引数にした。90 は集計定義そのものであり、コードに埋めると
-- 変更履歴が残らない（原則4）。
CREATE FUNCTION f_partner_reach_summary(attribution_window_days integer DEFAULT 90)
RETURNS TABLE (
    partner_id             uuid,
    season_id              uuid,
    estimated_reach_total  bigint,
    contact_occasions      bigint,
    first_reach_on         date,
    last_reach_on          date,
    identified_count       bigint
) AS $$
    SELECT
        pr.partner_id,
        pr.season_id,
        sum(pr.estimated_reach)::bigint,
        count(*)::bigint,
        min(pr.occurred_on),
        max(pr.occurred_on),
        (SELECT count(DISTINCT t.person_id)
           FROM touchpoints t
           JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
          WHERE t.partner_id = pr.partner_id
            AND jst_date(t.occurred_at) BETWEEN min(pr.occurred_on)
                AND max(pr.occurred_on) + require_positive(
                        f_partner_reach_summary.attribution_window_days,
                        'attribution_window_days')
        )
      FROM partner_reaches pr
     GROUP BY pr.partner_id, pr.season_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION f_partner_reach_summary(integer) IS
    '団体×年度のリーチ集計。identified_count は実人数、estimated_reach_total は推定値。同じ軸に並べない。';


-- -------------------------------------------------------------
-- 10. 利益相反の検出
-- -------------------------------------------------------------
-- 面接官が卒業生スタッフで、かつ応募者の紹介者である場合を洗い出す。
-- (5)に出す。紹介チャネルの合格率が実力かバイアスかの検証に使う。
--
-- [追加] 面接官と応募者が同一人物のケースを追加した。紹介より直接的な
-- 利益相反であり、卒業生スタッフが再応募すれば起こりうる。
-- 原典は referrer だけを見ていたため、これが素通りしていた。
CREATE VIEW v_conflict_of_interest AS
SELECT e.id AS evaluation_id,
       e.application_id,
       e.interviewer_staff_id,
       a.person_id AS applicant_person_id,
       'referrer'::text AS conflict_type
  FROM evaluations e
  JOIN applications a ON a.id = e.application_id
  JOIN persons      p ON p.id = a.person_id
  JOIN staffs       s ON s.id = e.interviewer_staff_id
 WHERE s.person_id IS NOT NULL
   AND p.referrer_person_id = s.person_id
UNION ALL
SELECT e.id,
       e.application_id,
       e.interviewer_staff_id,
       a.person_id,
       'self'::text
  FROM evaluations e
  JOIN applications a ON a.id = e.application_id
  JOIN staffs       s ON s.id = e.interviewer_staff_id
 WHERE s.person_id = a.person_id;
