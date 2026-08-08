-- =============================================================
-- 0017 確度スコア（実装段階[3] スコアリングへの着手）
--
-- 発見の経緯: 実行⑨の画像に「候補者確度ランキング（96% / 93% / …）」がある。
-- この数字は記録層のどこにも無く、算出規則も無かった。
-- CLAUDE.md は「先の段階の機能を勝手に始めない」と定めているので、
-- **依頼者の判断（実行⑨「記録層から作る」）を根拠に着手する。**
-- 勝手に始めたのではない。
--
-- ★ ここで作るもの／作らないもの
--
--   作る   … 規則を評価して点に畳むエンジン、凍結、順位、順位の変動
--   作らない … 規則そのもの（どの事実に何点を付けるか）
--
-- 点数と閾値は原典が「運用時に決定」と書いている値であり、
-- 依頼者から受け取っていない。CLAUDE.md 10節「未確定の値を
-- 『たぶんこうだろう』で埋めない」に従い、**本番シードは空にする。**
-- 集計マスタを空で出荷するのは既存の運用と同じ（最初に入れた値が
-- 事実上の初期値として固定化されるのを避けるため）。
--
-- 規則が0件なら確度は算出されず、画面は「規則未登録」と出る。
-- 0% とは違う。**無いことを 0 と書くと、それは嘘の数字になる。**
--
-- ★ target_key の語彙は、ここで構造として定める
--
-- 原典は target_key を「運用時に決定」とだけ書いていた。しかし
-- 何を指せるかが決まっていないと、規則を1件も書けない。
-- **参照できる事実の一覧は構造の問題**なので、ここで閉じた集合にする。
-- 点数（値の判断）は依頼者、語彙（構造）はこちら、という切り分けである。
--
-- 語彙はすべて既存の記録から導ける事実に限る。新しい事実は作らない。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 規則が参照できる事実
-- -------------------------------------------------------------
-- 人 × 年度あたり1行。ここに無い事実は規則から参照できない。
--
-- 接点の年度帰属は v_touchpoint_season を通す。**自前で窓を書かない。**
-- あちらは期間が重なる年度を enrollment_year の小さいほうへ寄せている。
-- ここで BETWEEN を書き直すと、重なる期間の接点が両方の年度に入り、
-- 同じ「その年度の接点数」が画面ごとに違う値になる（実行③で踏んだ
-- 「同じ言葉が2つの定義を持つ」の再演）。
CREATE VIEW v_scoring_facts AS
SELECT p.id                                   AS person_id,
       s.id                                   AS season_id,
       count(t.touchpoint_id)                 AS touchpoint_count,
       max(jst_date(t.occurred_at))           AS last_touchpoint_on,
       (p.referrer_person_id IS NOT NULL)     AS has_referral,
       EXISTS (SELECT 1 FROM v_countable_applications a
                WHERE a.person_id = p.id AND a.season_id = s.id)
                                              AS has_application,
       EXISTS (SELECT 1 FROM v_application_outcome o
                JOIN applications a2 ON a2.id = o.application_id
                WHERE a2.person_id = p.id AND a2.season_id = s.id
                  AND o.outcome = 'accepted') AS has_acceptance
  FROM persons p
 CROSS JOIN seasons s
  LEFT JOIN v_touchpoint_season t
         ON t.person_id = p.id
        AND t.season_id = s.id
 WHERE p.deleted_at IS NULL
 GROUP BY p.id, s.id, p.referrer_person_id;

COMMENT ON VIEW v_scoring_facts IS
    '確度の規則が参照できる事実。ここに無い事実は規則から指せない。';


-- -------------------------------------------------------------
-- 2. 規則が指せる語彙を構造で閉じる
-- -------------------------------------------------------------
-- 綴りを間違えた target_key は、静かに0点として評価される。
-- 「エラーにならず、黙って点が減る」は最も気づけない壊れ方なので、
-- 書けない形を制約で閉じる。
--
-- 条件種別ごとに意味のある語彙が違う。存在の有無に「直近何日」は無い。
ALTER TABLE scoring_rules
    ADD CONSTRAINT scoring_rules_target_key_chk
    CHECK (
        (condition_type = 'existence'
             AND target_key IN ('has_referral', 'has_application', 'has_acceptance'))
     OR (condition_type = 'count_threshold'
             AND target_key IN ('touchpoint_count'))
     OR (condition_type = 'recency_days'
             AND target_key IN ('last_touchpoint_on'))
    );

COMMENT ON CONSTRAINT scoring_rules_target_key_chk ON scoring_rules IS
    '規則が指せる事実を v_scoring_facts の列に限る。綴り違いを黙って0点にしない。';

-- 減衰は recency_days でしか意味を持たない。存在の有無は減衰しない。
ALTER TABLE scoring_rules
    ADD CONSTRAINT scoring_rules_decay_only_recency
    CHECK (decay_half_life_days IS NULL OR condition_type = 'recency_days');


-- -------------------------------------------------------------
-- 3. 規則を評価して点に畳む
-- -------------------------------------------------------------
-- 満点は「正の点を持つ規則の合計」。負の点を混ぜても満点は増えない。
-- 確度は total / 満点 なので、満点の定義がずれると全員の % が動く。
-- 定義をここ1箇所に置き、画面には持たせない。
CREATE VIEW v_scoring_rule_set_max AS
SELECT rs.id AS rule_set_id,
       coalesce(sum(r.points) FILTER (WHERE r.points > 0), 0) AS max_points,
       count(r.id)                                            AS rule_count
  FROM scoring_rule_sets rs
  LEFT JOIN scoring_rules r ON r.rule_set_id = rs.id
 GROUP BY rs.id;

COMMENT ON VIEW v_scoring_rule_set_max IS
    'ルールセットの満点（正の点の合計）。確度の分母。定義はここ1箇所。';


-- 1つの規則を1人に当てた結果。
-- 減衰は 0.5^(経過日数 / 半減期)。基準日より後の接点は減衰させない
-- （負の経過日数で点が満点を超えるのを防ぐ）。
CREATE FUNCTION scoring_rule_points(
    p_condition_type       text,
    p_comparator           text,
    p_threshold            integer,
    p_points               integer,
    p_decay_half_life_days integer,
    p_basis_date           date,
    p_touchpoint_count     bigint,
    p_last_touchpoint_on   date,
    p_has_referral         boolean,
    p_has_application      boolean,
    p_has_acceptance       boolean,
    p_target_key           text
) RETURNS TABLE (raw_points integer, decayed_points integer)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_hit  boolean := false;
    v_days integer;
BEGIN
    IF p_condition_type = 'existence' THEN
        v_hit := CASE p_target_key
                     WHEN 'has_referral'    THEN coalesce(p_has_referral, false)
                     WHEN 'has_application' THEN coalesce(p_has_application, false)
                     WHEN 'has_acceptance'  THEN coalesce(p_has_acceptance, false)
                 END;

    ELSIF p_condition_type = 'count_threshold' THEN
        -- comparator は明示されたものだけを解釈する。未知の綴りは
        -- 「当たらなかった」ではなく例外にする。黙って0点にしない。
        v_hit := CASE coalesce(p_comparator, '>=')
                     WHEN '>=' THEN coalesce(p_touchpoint_count, 0) >= p_threshold
                     WHEN '>'  THEN coalesce(p_touchpoint_count, 0) >  p_threshold
                     WHEN '<=' THEN coalesce(p_touchpoint_count, 0) <= p_threshold
                     WHEN '<'  THEN coalesce(p_touchpoint_count, 0) <  p_threshold
                     WHEN '='  THEN coalesce(p_touchpoint_count, 0) =  p_threshold
                     ELSE NULL
                 END;
        IF v_hit IS NULL THEN
            RAISE EXCEPTION '未知の比較演算子: %', p_comparator;
        END IF;

    ELSIF p_condition_type = 'recency_days' THEN
        -- 接点が1件も無ければ「直近 N 日以内」は成立しない。
        IF p_last_touchpoint_on IS NOT NULL THEN
            v_days := p_basis_date - p_last_touchpoint_on;
            v_hit  := v_days <= p_threshold;
        END IF;
    ELSE
        RAISE EXCEPTION '未知の条件種別: %', p_condition_type;
    END IF;

    IF NOT coalesce(v_hit, false) THEN
        RETURN QUERY SELECT 0, 0;
        RETURN;
    END IF;

    IF p_decay_half_life_days IS NULL OR v_days IS NULL OR v_days <= 0 THEN
        RETURN QUERY SELECT p_points, p_points;
    ELSE
        RETURN QUERY SELECT
            p_points,
            round(p_points * power(0.5, v_days::numeric / p_decay_half_life_days))::integer;
    END IF;
END;
$$;

COMMENT ON FUNCTION scoring_rule_points IS
    '規則1件を1人に当てた点。減衰は 0.5^(経過日数/半減期)。'
    '未知の綴りは0点ではなく例外にする（黙って点が減るのを防ぐ）。';


-- 人 × 年度 × 規則 の内訳。凍結の材料になる。
--
-- 基準日を引数に取る。ここを jst_today() で固定すると、過去の算出を
-- 再現できず、順位の変動（前回との差）がそもそも作れない。
-- decay_basis_date を記録する理由が原典に書いてあるのと同じ理屈である ――
-- 「どの基準で出た点数か」が無いと、後から誰も解釈できない。
CREATE FUNCTION scoring_breakdown(p_rule_set_id uuid, p_basis_date date)
RETURNS TABLE (person_id uuid, season_id uuid, scoring_rule_id uuid,
               raw_points integer, decayed_points integer)
LANGUAGE sql STABLE AS $$
SELECT f.person_id,
       f.season_id,
       r.id,
       pts.raw_points,
       pts.decayed_points
  FROM v_scoring_facts f
  JOIN scoring_rules r ON r.rule_set_id = p_rule_set_id
 CROSS JOIN LATERAL scoring_rule_points(
        r.condition_type, r.comparator, r.threshold, r.points,
        r.decay_half_life_days, p_basis_date,
        f.touchpoint_count, f.last_touchpoint_on,
        f.has_referral, f.has_application, f.has_acceptance,
        r.target_key) AS pts;
$$;

COMMENT ON FUNCTION scoring_breakdown IS
    '規則ごとの点の内訳。基準日を引数に取る（過去の算出を再現するため）。';


-- 算出して凍結する。**これが確度を書き込む唯一の経路。**
--
-- 規則が0件のルールセットでは何も書かない。0点の行を並べると
-- 「全員0%」に見えるが、実際は「規則が無い」であって別の事実である。
--
-- ★ 母集団は「算出日時点のヘッドハンティング対象者」に限る。
--   全員を凍結すると、順位が応募済みの人や声を掛ける気の無い人まで
--   含んだ通し番号になり、「候補者の中で何位か」を答えなくなる。
--   順位は母集団を書かないと意味が決まらないので、母集団をここで固定し、
--   画面には注記として出す（画面側で絞り直させない）。
--
-- score_snapshots は追記専用（0003）。同じ算出日で2度流すと
-- UNIQUE 制約で落ちる。**黙って上書きも、黙って読み飛ばしもしない。**
CREATE FUNCTION compute_score_snapshots(
    p_rule_set_id      uuid,
    p_season_id        uuid,
    p_calculated_on    date,
    p_decay_basis_date date
) RETURNS integer
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM scoring_rules WHERE rule_set_id = p_rule_set_id) THEN
        RETURN 0;
    END IF;

    WITH totals AS (
        SELECT b.person_id, sum(b.decayed_points)::integer AS total
          FROM scoring_breakdown(p_rule_set_id, p_decay_basis_date) b
          JOIN v_headhunting_list h
            ON h.person_id = b.person_id AND h.season_id = b.season_id
         WHERE b.season_id = p_season_id
         GROUP BY b.person_id
    ), written AS (
        INSERT INTO score_snapshots
            (person_id, season_id, rule_set_id, calculated_on,
             decay_basis_date, total_points)
        SELECT t.person_id, p_season_id, p_rule_set_id, p_calculated_on,
               p_decay_basis_date, t.total
          FROM totals t
        RETURNING id, person_id
    )
    INSERT INTO score_snapshot_details
        (snapshot_id, scoring_rule_id, raw_points, decayed_points)
    SELECT w.id, b.scoring_rule_id, b.raw_points, b.decayed_points
      FROM written w
      JOIN scoring_breakdown(p_rule_set_id, p_decay_basis_date) b
        ON b.person_id = w.person_id AND b.season_id = p_season_id;

    RETURN (SELECT count(*)::integer FROM score_snapshots
             WHERE season_id = p_season_id AND calculated_on = p_calculated_on);
END;
$$;

COMMENT ON FUNCTION compute_score_snapshots IS
    '確度を算出して凍結する唯一の経路。規則が0件なら何も書かない（全員0%にしない）。';


-- -------------------------------------------------------------
-- 4. 凍結された確度
-- -------------------------------------------------------------
-- 表示に使うのは凍結された値だけである。その場で計算した値を出すと、
-- 規則を変えた瞬間に過去の順位が書き換わり、順位の変動が意味を失う。
-- 原則2「再現不能なものだけ凍結する（スコアのみ）」がまさにこれ。
--
-- 確度 = 凍結した点 ÷ そのとき使ったルールセットの満点。
-- 満点0（規則が0件）のときは NULL。0% ではない。
CREATE VIEW v_candidate_confidence AS
SELECT sn.person_id,
       sn.season_id,
       sn.calculated_on,
       sn.rule_set_id,
       sn.total_points,
       m.max_points,
       CASE WHEN m.max_points > 0
            THEN sn.total_points::numeric / m.max_points
            ELSE NULL END AS confidence_ratio,
       rank() OVER (PARTITION BY sn.season_id, sn.calculated_on
                        ORDER BY sn.total_points DESC) AS rank_in_season
  FROM score_snapshots sn
  JOIN v_scoring_rule_set_max m ON m.rule_set_id = sn.rule_set_id;

COMMENT ON VIEW v_candidate_confidence IS
    '凍結された確度と、その算出日時点の順位。分母はそのとき使ったルールセットの満点。';


-- 最新の算出日と、その1つ前。順位の変動はこの2つの差でしか出せない。
-- 算出が1回しか行われていない年度では、変動は NULL になる。
-- **「変動なし（—）」と「前回が無い」を同じ記号にしない。**
CREATE VIEW v_candidate_confidence_latest AS
WITH runs AS (
    SELECT season_id,
           calculated_on,
           row_number() OVER (PARTITION BY season_id ORDER BY calculated_on DESC) AS n
      FROM (SELECT DISTINCT season_id, calculated_on FROM score_snapshots) d
),
latest   AS (SELECT season_id, calculated_on FROM runs WHERE n = 1),
previous AS (SELECT season_id, calculated_on FROM runs WHERE n = 2)
SELECT c.person_id,
       c.season_id,
       c.calculated_on,
       c.total_points,
       c.max_points,
       c.confidence_ratio,
       c.rank_in_season,
       prev.rank_in_season                          AS previous_rank,
       prev.rank_in_season - c.rank_in_season       AS rank_delta,
       (previous.calculated_on IS NOT NULL)         AS has_previous_run
  FROM v_candidate_confidence c
  JOIN latest ON latest.season_id = c.season_id
             AND latest.calculated_on = c.calculated_on
  LEFT JOIN previous ON previous.season_id = c.season_id
  LEFT JOIN v_candidate_confidence prev
         ON prev.person_id = c.person_id
        AND prev.season_id = c.season_id
        AND prev.calculated_on = previous.calculated_on;

COMMENT ON VIEW v_candidate_confidence_latest IS
    '最新の算出結果と、前回からの順位の変動。'
    'has_previous_run = false なら前回が無い（変動なしとは別）。';
