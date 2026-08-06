-- =============================================================
-- 0009 森の「誰が数えられているか」を返す関数
--
-- f_partner_reach_summary.identified_count は団体×年度ごとの実人数で、
-- 行をまたいで足せない。同じ人が2つの団体から接触されていれば
-- 両方の行で1と数えられるし、同じ団体が複数年度にリーチしていれば
-- 観測窓が重なりうる。年度全体の実人数を出すつもりで合計すると、
-- 重複したまま増える。
--
-- (4)流入元では、団体別の行と、年度全体の1つの数を同じ画面に並べる。
-- 合計が一致しないのは正しいのだが、その理由を画面側の計算に閉じると
-- 集計定義がアプリとデータベースの二箇所に散る。人の集合まで戻る関数を
-- データベース側に置き、画面はそれを数えるだけにする。
--
-- 観測窓の定義は f_partner_reach_summary と同じ
-- （最初のリーチ 〜 最後のリーチ + attribution_window_days）。
-- 定義が2箇所にある以上、片方だけ直したときに気づけるよう、
-- 団体×年度ごとの人数が一致することを tests/11 で固定している。
-- =============================================================

CREATE FUNCTION f_partner_reach_persons(attribution_window_days integer DEFAULT 90)
RETURNS TABLE (
    partner_id  uuid,
    season_id   uuid,
    person_id   uuid
) AS $$
    WITH windows AS (
        SELECT pr.partner_id,
               pr.season_id,
               min(pr.occurred_on) AS from_on,
               max(pr.occurred_on) + require_positive(
                   f_partner_reach_persons.attribution_window_days,
                   'attribution_window_days') AS to_on
          FROM partner_reaches pr
         GROUP BY pr.partner_id, pr.season_id
    )
    SELECT DISTINCT w.partner_id, w.season_id, t.person_id
      FROM windows w
      JOIN touchpoints t
        ON t.partner_id = w.partner_id
       AND jst_date(t.occurred_at) BETWEEN w.from_on AND w.to_on
      JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION f_partner_reach_persons(integer) IS
    '森の観測窓に入った Person。団体×年度の行をまたいで重複しうるので、年度全体を数えるときは person_id で重複排除する。';
