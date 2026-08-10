import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * ヘッドハンティング画面の問い合わせ（実行⑨）。
 *
 * 依頼者から届いた画面画像の各枠に1対1で対応する。
 * 集計の定義はビュー（0016 / 0017）に置き、ここは呼んで並べ替えるだけ。
 * **画面に SQL を書かせない**（CLAUDE.md 4節）。
 *
 * ★ 画像にあって、ここに無いもの
 *
 *   顔写真        … 記録層に無い。かつ「個体を描くときは個人を漏らさない」
 *   職種          … 記録層に無い。定義も未受領
 *   成績ランキングの順位変動 … 凍結された過去の順位が無い。
 *                   確度スコアだけは score_snapshots があるので出せる。
 *                   **同じ見た目の矢印を、片方だけ作り物で埋めない。**
 *
 * どれも TODO(MVP) として画面に明示する。空欄を推測で埋めない。
 */

// -------------------------------------------------------------
// 1. ヘッドハンティングリスト（画像 G）
// -------------------------------------------------------------

export interface HeadhuntingRow {
  person_id: string
  person_name: string
  photo_data_url: string | null
  approach_code: string
  approach_label: string
  state_since: Date
  /** 確度。規則が未登録なら null（0 ではない）。 */
  confidence_ratio: number | null
  rank_in_season: number | null
}

/**
 * 声を掛ける相手の一覧。
 *
 * 並べ替えは確度の高い順。確度が無い人（凍結の対象外だった人）は後ろへ回す。
 * 確度が全員 null のときは状態の進んだ順になり、一覧の意味は保たれる。
 */
export const listHeadhunting = (db: Db, seasonId: string, limit = 12) =>
  all<HeadhuntingRow>(db, `
    SELECT h.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url,
           h.approach_code, h.approach_label, h.state_since,
           c.confidence_ratio, c.rank_in_season
      FROM v_headhunting_list h
      JOIN persons p ON p.id = h.person_id
      LEFT JOIN v_candidate_confidence_latest c
             ON c.person_id = h.person_id AND c.season_id = h.season_id
     WHERE h.season_id = $1
     ORDER BY c.rank_in_season NULLS LAST, h.state_since DESC, p.id
     LIMIT $2`, [seasonId, limit])

export interface ApproachTotals {
  /** リストに載っている人数。件数ではない。 */
  candidates: number
  not_approached: number
  considering: number
  approaching: number
  scheduling: number
}

export const getApproachTotals = (db: Db, seasonId: string) =>
  maybeOne<ApproachTotals>(db, `
    SELECT count(*)                                                AS candidates,
           count(*) FILTER (WHERE approach_code = 'not_approached') AS not_approached,
           count(*) FILTER (WHERE approach_code = 'considering')    AS considering,
           count(*) FILTER (WHERE approach_code = 'approaching')    AS approaching,
           count(*) FILTER (WHERE approach_code = 'scheduling')     AS scheduling
      FROM v_headhunting_list WHERE season_id = $1`, [seasonId])

// -------------------------------------------------------------
// 2. 候補者確度ランキング（画像 E）
// -------------------------------------------------------------

export interface ConfidenceRow {
  person_id: string
  person_name: string
  photo_data_url: string | null
  rank_in_season: number
  confidence_ratio: number | null
  total_points: number
  max_points: number
  /** 前回からの順位の変動。前回が無ければ null。 */
  rank_delta: number | null
  has_previous_run: boolean
}

/**
 * 確度の高い順。母集団は「算出日時点のヘッドハンティング対象者」で、
 * それは 0017 の compute_score_snapshots が凍結時に決めている。
 * ここで絞り直さない（絞り直すと順位と母集団が食い違う）。
 */
export const listConfidence = (db: Db, seasonId: string, limit = 5) =>
  all<ConfidenceRow>(db, `
    SELECT c.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url,
           c.rank_in_season, c.confidence_ratio, c.total_points, c.max_points,
           c.rank_delta, c.has_previous_run
      FROM v_candidate_confidence_latest c
      JOIN persons p ON p.id = c.person_id
     WHERE c.season_id = $1
     ORDER BY c.rank_in_season, p.id
     LIMIT $2`, [seasonId, limit])

export interface ConfidenceMeta {
  calculated_on: Date
  rule_count: number
  max_points: number
  population: number
}

/**
 * 確度がいつ・何件の規則で算出されたか。
 *
 * これを画面に出さないと、%が「いま計算した値」に見える。実際は凍結値で、
 * 算出日以降の接点は反映されていない。注記が無いと画面が嘘をつく。
 */
export const getConfidenceMeta = (db: Db, seasonId: string) =>
  maybeOne<ConfidenceMeta>(db, `
    SELECT c.calculated_on,
           m.rule_count,
           m.max_points,
           count(*) AS population
      FROM v_candidate_confidence_latest c
      JOIN score_snapshots sn
        ON sn.person_id = c.person_id AND sn.season_id = c.season_id
       AND sn.calculated_on = c.calculated_on
      JOIN v_scoring_rule_set_max m ON m.rule_set_id = sn.rule_set_id
     WHERE c.season_id = $1
     GROUP BY c.calculated_on, m.rule_count, m.max_points`, [seasonId])

// -------------------------------------------------------------
// 3. 応募者成績ランキング（画像 D）
// -------------------------------------------------------------

export interface ScoreRow {
  application_id: string
  person_id: string
  person_name: string
  photo_data_url: string | null
  rank_in_season: number
  /** 得点の合計。 */
  earned: number
  /** 適用された軸の満点の合計。 */
  possible: number
  /** 100点換算。possible が0なら null。 */
  score_100: number | null
  /** 点が付いた軸の数。少ないまま上位に出ることがあるので併記する。 */
  scored_criteria: number
}

/**
 * 応募者の成績。
 *
 * ★ 定義（画面にも注記として出す）
 *   母集団 … その年度に数える応募（v_countable_applications）
 *   分子   … 提出済みの評価に付いた点の合計
 *   分母   … その点が付いた軸の満点の合計
 *
 * 分母を「その応募に適用されうる全軸の満点」にしていない。
 * 途中のステップまでしか進んでいない応募が、まだ受けていない面接のぶん
 * 0点を背負うことになり、**進んだ人ほど不利という逆の順位が出る。**
 * 実際に受けた軸だけで割るので、これは「達成率」であって「進捗」ではない。
 *
 * 提出前（pending / held）の評価は数えない。まだ判断が確定していない点を
 * 混ぜると、確定した人としていない人が同じ軸に並ぶ。
 */
export const listApplicantScores = (db: Db, seasonId: string, limit = 5) =>
  all<ScoreRow>(db, `
    WITH scored AS (
        SELECT a.id AS application_id, a.person_id,
               sum(es.score)      AS earned,
               sum(ec.scale_max)  AS possible,
               count(*)           AS scored_criteria
          FROM v_countable_applications a
          JOIN evaluations e        ON e.application_id = a.id AND e.state = 'submitted'
          JOIN evaluation_scores es ON es.evaluation_id = e.id
          JOIN evaluation_criteria ec ON ec.id = es.criteria_id
         WHERE a.season_id = $1
         GROUP BY a.id, a.person_id
    )
    SELECT s.application_id, s.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url,
           rank() OVER (ORDER BY s.earned::numeric / s.possible DESC) AS rank_in_season,
           s.earned, s.possible,
           round(s.earned::numeric / s.possible * 100, 1) AS score_100,
           s.scored_criteria
      FROM scored s
      JOIN persons p ON p.id = s.person_id
     WHERE s.possible > 0
     -- 同率は珍しくない。1軸だけ満点の人と、6軸を通して高い人は
     -- どちらも100%になる。順位そのものは定義どおり同率のままにし、
     -- **並びだけ「受けた軸が多い順」で決める。** 少ない根拠で
     -- 上に出た人が先頭に来ると、根拠の量が読めない一覧になる。
     ORDER BY rank_in_season, s.scored_criteria DESC, p.id
     LIMIT $2`, [seasonId, limit])

// -------------------------------------------------------------
// 4. 候補者1人のパネル（画像 F）
// -------------------------------------------------------------

export interface PersonPanel {
  person_id: string
  family_name: string
  given_name: string
  family_name_kana: string | null
  given_name_kana: string | null
  person_name: string
  person_kana: string | null
  school: string
  school_id: string
  birth_date: Date | null
  faculty: string | null
  email: string | null
  phone: string | null
  line_user_id: string | null
  referrer_person_id: string | null
  photo_data_url: string | null
  note: string | null
  /** 最終更新。記録層に更新時刻が無いので「最後に接点があった日」で代える。 */
  last_touchpoint_on: Date | null
  approach_label: string | null
  approach_code: string | null
  confidence_ratio: number | null
  rank_in_season: number | null
  score_100: number | null
}

export const getPersonPanel = (db: Db, personId: string, seasonId: string) =>
  maybeOne<PersonPanel>(db, `
    SELECT p.id AS person_id,
           p.family_name, p.given_name, p.family_name_kana, p.given_name_kana,
           p.family_name || ' ' || p.given_name AS person_name,
           nullif(btrim(coalesce(p.family_name_kana, '') || ' '
                        || coalesce(p.given_name_kana, '')), '') AS person_kana,
           sc.name AS school, sc.id AS school_id, p.birth_date, p.faculty,
           p.email, p.phone, p.line_user_id, p.referrer_person_id,
           p.photo_data_url, p.note,
           (SELECT max(jst_date(t.occurred_at)) FROM v_touchpoint_season t
             WHERE t.person_id = p.id AND t.season_id = $2) AS last_touchpoint_on,
           a.approach_label, a.approach_code,
           c.confidence_ratio, c.rank_in_season,
           (SELECT round(sum(es.score)::numeric / sum(ec.scale_max) * 100, 1)
              FROM v_countable_applications ap
              JOIN evaluations e ON e.application_id = ap.id AND e.state = 'submitted'
              JOIN evaluation_scores es ON es.evaluation_id = e.id
              JOIN evaluation_criteria ec ON ec.id = es.criteria_id
             WHERE ap.person_id = p.id AND ap.season_id = $2) AS score_100
      FROM persons p
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN v_person_approach_state a
             ON a.person_id = p.id AND a.season_id = $2
      LEFT JOIN v_candidate_confidence_latest c
             ON c.person_id = p.id AND c.season_id = $2
     WHERE p.id = $1
       AND p.deleted_at IS NULL`, [personId, seasonId])

export interface ProfileOption {
  id: string
  label: string
}

export interface ProfileEditOptions {
  schools: ProfileOption[]
  people: ProfileOption[]
  staffs: ProfileOption[]
  approachStates: ProfileOption[]
}

/** 編集フォームの選択肢。画面側にマスタの条件を書かせない。 */
export async function getProfileEditOptions(db: Db, personId: string): Promise<ProfileEditOptions> {
  const [schools, people, staffs, approachStates] = await Promise.all([
    all<ProfileOption>(db, `SELECT id, name AS label FROM schools WHERE is_active ORDER BY name`),
    all<ProfileOption>(db, `
      SELECT id, family_name || ' ' || given_name AS label
        FROM persons WHERE deleted_at IS NULL AND id <> $1
       ORDER BY family_name, given_name LIMIT 500`, [personId]),
    all<ProfileOption>(db, `
      SELECT id, display_name AS label FROM staffs WHERE is_active ORDER BY display_name`),
    all<ProfileOption>(db, `
      SELECT id, label FROM approach_states WHERE is_active ORDER BY sort_order`),
  ])
  return { schools, people, staffs, approachStates }
}

export interface CriterionScore {
  criteria_name: string
  step_name: string
  score: number
  scale_max: number
}

/**
 * 評価サマリー（画像 F の星）。
 *
 * ★ 軸の名前は画像と違う。画像は「スキル / ポテンシャル / カルチャーフィット」
 *   だが、実際の軸は年度ごとに evaluation_criteria が持っている（D-8 で
 *   2026年度は6軸と確定済み）。**画像の3語に寄せて実際の軸を潰さない。**
 *   軸が変われば星の本数も変わる。それが正しい。
 */
export const listCriterionScores = (db: Db, personId: string, seasonId: string) =>
  all<CriterionScore>(db, `
    SELECT ec.name AS criteria_name, ss.name AS step_name,
           es.score, ec.scale_max
      FROM v_countable_applications a
      JOIN evaluations e ON e.application_id = a.id AND e.state = 'submitted'
      JOIN evaluation_scores es ON es.evaluation_id = e.id
      JOIN evaluation_criteria ec ON ec.id = es.criteria_id
      JOIN selection_steps ss ON ss.id = ec.selection_step_id
     WHERE a.person_id = $1 AND a.season_id = $2
     ORDER BY ss.sort_order, ec.sort_order`, [personId, seasonId])

// -------------------------------------------------------------
// 5. 最新やること（画像 C）
// -------------------------------------------------------------

export interface HeadhuntingTask {
  kind: string
  /**
   * やること1件の識別子。
   *
   * 同じ人・同じステップ・同じ種別のやることは**2件あり得る**
   * （二次面接に面接官が2人割り当たっていれば「評価する」が2件出る）。
   * 人とステップの組を鍵にすると、その2件が同じものとして畳まれる。
   */
  source_id: string
  person_id: string
  person_name: string
  step_name: string
  waiting_days: number
  sla_days: number | null
  is_overdue: boolean
  owner: string | null
}

/**
 * やることの先頭だけ。全部はボーダーライン（/borderline）にある。
 *
 * ★ 画像の4枚目「候補者リストを10名追加する」は**手で作るタスク**で、
 *   記録層が無い（D-12 の TODO(MVP) 2）。ここには出せない。
 *   出せるのは既存の事実から導かれる4種だけである（v_open_tasks、C-17）。
 *
 * ★ 画像の期限は「今日 14:00 まで」と時刻を持つが、SLA は日単位である。
 *   時刻を作ると、記録より画面のほうが精密に見える。日で出す。
 */
export const listHeadhuntingTasks = (db: Db, seasonId: string, limit = 4) =>
  all<HeadhuntingTask>(db, `
    SELECT t.kind, t.source_id, t.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           t.step_name, t.waiting_days, t.sla_days, t.is_overdue,
           st.display_name AS owner
      FROM v_open_tasks t
      JOIN persons p ON p.id = t.person_id
      LEFT JOIN staffs st ON st.id = t.owner_staff_id
     WHERE t.season_id = $1
     ORDER BY t.is_overdue DESC, t.waiting_days DESC, t.step_order
     LIMIT $2`, [seasonId, limit])
