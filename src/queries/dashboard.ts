import { all, maybeOne, scalar, type Db } from '../db/client.ts'

/**
 * ダッシュボードが必要とする問い合わせ。
 *
 * SQL はここに集める。画面コンポーネントの中に SQL を書くと、
 * 同じ数字を出す別々のクエリが増えて、そのうち食い違う。
 *
 * 集計の定義そのものはビューと関数（db/migrations）にあり、
 * ここはそれを呼ぶだけに留める。
 */

/** 林のアクティブ判定窓。運用時に決定する値。 */
export const ACTIVE_WINDOW_DAYS = 90

/**
 * ドライバは date / timestamptz を JS の Date で返す（PGlite も node-postgres も）。
 * 型を string と書くと、実行時に .slice が無くて落ちる。実態に合わせる。
 */
export interface Season {
  id: string
  enrollment_year: number
  outreach_start_date: Date
  application_open_date: Date
  application_close_date: Date
  selection_end_date: Date
  capacity: number | null
  target_application_count: number | null
  /**
   * 期（1期・2期…）。運営が数える番号で、年度からは導けない。
   * 分からない年度は null ―― **年度で代替表示し、0期や1期で埋めない。**
   */
  cohort_number: number | null
  /** 今日が選考期間の中にあるか。 */
  is_live: boolean
  /** 幻のデモ期（0029）。架空データだけが入る期。 */
  is_demo: boolean
}

/**
 * 期の一覧。
 *
 * ★ **デモ期は最後**（0029）。年度の降順に混ぜると、実在しない年
 *   （9999）が先頭に来て、切替の一番上がデモ期になる。
 */
export const listSeasons = (db: Db) =>
  all<Season>(db, `
    SELECT s.*, (jst_today() BETWEEN s.outreach_start_date AND s.selection_end_date) AS is_live
      FROM seasons s
     WHERE NOT s.is_demo
     ORDER BY s.enrollment_year DESC`)

/**
 * 期の指定が無いときに開く期。
 *
 * ★ **デモ期は既定にしない。** 架空の期が既定になると、入った人は
 *   自分がデモを見ていることに気づかないまま数字を読む。
 *   実在の期が1つも無いときだけ、最後の手段としてデモ期を返す。
 */
export const defaultSeason = (seasons: Season[]): Season | undefined => {
  const real = seasons.filter((s) => !s.is_demo)
  return real.find((s) => s.is_live) ?? real[0] ?? seasons[0]
}


/**
 * その期はデモ期か。**画面の注意書きの判定はここ1箇所。**
 *
 * 外枠（`Shell`）が毎回引く。期の一覧を持たない画面でも同じ札が出るように、
 * 期の ID だけで答えられる形にしてある。
 */
export const isDemoSeason = async (db: Db, seasonId: string): Promise<boolean> => {
  if (!UUID.test(seasonId)) return false
  const row = await maybeOne<{ is_demo: boolean }>(db,
    `SELECT is_demo FROM seasons WHERE id = $1`, [seasonId])
  return row?.is_demo ?? false
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * URL の ?season= はユーザが自由に書ける。UUID でない文字列をそのまま
 * WHERE s.id = $1 に渡すと invalid input syntax で 500 になる。
 * 「知らない年度」と「壊れた入力」はどちらも「見つからない」でよい。
 */
export const getSeason = (db: Db, seasonId: string | string[] | undefined) => {
  const id = Array.isArray(seasonId) ? seasonId[0] : seasonId
  if (!id || !UUID.test(id)) return Promise.resolve(null)
  return maybeOne<Season>(db, `
    SELECT s.*, (jst_today() BETWEEN s.outreach_start_date AND s.selection_end_date) AS is_live
      FROM seasons s WHERE s.id = $1 AND NOT s.is_demo`, [id])
}

// -------------------------------------------------------------
// (1) 全体サマリとファネル
// -------------------------------------------------------------

export interface SeasonCriterion {
  step_name: string
  step_order: number
  name: string
  scale_max: number
  sort_order: number
  /** 重み付け（応募管理表の「特別選考」シートの2段。0033）。
   *  'required' 必須の前提 ／ 'strong' 加点 ／ 'standard' 段分け無し。 */
  kind: 'standard' | 'required' | 'strong'
}

/**
 * その期の評価基準（依頼者の指示。実行⑫）。
 *
 * 「期の項目の上に、エクセルから評価基準を持ってきて、参考にできるように貼って」。
 *
 * ★ **画面に写し書きしない。** 出すのは `evaluation_criteria`（記録層）で、
 *   そこへは応募管理表の「特別選考」シートから取り込んである（C-105）。
 *   画面に文字で置くと、**表を直しても画面が古いまま**になり、
 *   同じ基準が2箇所に増える。
 *
 * ★ 段の順・軸の順のまま出す。**こちらで並べ替えない**
 *   （運営が並べた順そのものが、見る順である）。
 *
 * ★ 軸を持たない段は出さない ―― 「軸が無い」ことは、
 *   その段の画面（面接シート）が言う仕事である。
 */
export const listSeasonCriteria = (db: Db, seasonId: string | undefined) => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  return all<SeasonCriterion>(db, `
    SELECT ss.name AS step_name, ss.sort_order AS step_order,
           ec.name, ec.scale_max, ec.sort_order, ec.kind
      FROM evaluation_criteria ec
      JOIN selection_steps ss ON ss.id = ec.selection_step_id
     WHERE ss.season_id = $1
     ORDER BY ss.sort_order, ec.sort_order`, [seasonId])
}

export interface FunnelPoint {
  as_of: Date
  relative_day: number
  identified_person_cum: number
  applicant_cum: number
  accepted_cum: number
  net_accepted_cum: number
  rejected_cum: number
  withdrawn_cum: number
}

/**
 * 日次断面。今日より後の日付は返さない。
 * 未来の日付に0が並ぶと、折れ線が右端で床に落ちて「急減した」ように見える。
 */
export const getFunnel = (db: Db, seasonId: string, windowDays = ACTIVE_WINDOW_DAYS) =>
  all<FunnelPoint>(db, `
    SELECT as_of, relative_day, identified_person_cum, applicant_cum,
           accepted_cum, net_accepted_cum, rejected_cum, withdrawn_cum
      FROM f_funnel_daily($2)
     WHERE season_id = $1 AND as_of <= jst_today()
     ORDER BY as_of`, [seasonId, windowDays])

export interface HomeTrendPoint {
  as_of: Date
  candidates: number
  partners: number
  /**
   * 確度が閾値以上の候補者。
   *
   * ★ **閾値 0.8 は受領していない。** 0017 が「点数と閾値は運用時に決定」と
   *   書いたまま空で出荷しており、運営の基準は応募管理表
   *   `003_2期生アプローチリスト` の「参加確度」――
   *   **帯（020％／050％／080％／100％）と状態語（未計測・興味なし/対象外・応募完了）**
   *   である。**同じ基準ではない**（C-127）。帯を受け取るまでの仮の線である。
   * ★ 画面に「A」と名乗らせない ―― 記録に無い格付けで、応募管理表では
   *   A〜C・D〜I が**特別選考の軸の記号**として別の意味を持つ。
   */
  high_confidence: number
  special: number
}

/**
 * 確度の算出規則が1件でも登録されているか。
 *
 * ★ 規則が無ければ確度は算出されない（0017）。**そのとき0を出さない** ――
 *   「無いことを 0 と書くと、それは嘘の数字になる」（0017 のコメント）。
 */
export const hasScoringRules = async (db: Db): Promise<boolean> =>
  Number(await scalar<string>(db, `SELECT count(*)::text FROM scoring_rules`)) > 0

/** ホームで並べる4指標の日次累積。すべて同じ期・同じ暦日で数える。 */
export const getHomeTrends = (db: Db, seasonId: string) =>
  all<HomeTrendPoint>(db, `
    WITH season AS (
      SELECT *,
             LEAST(outreach_start_date, jst_today() - 30) AS first_day,
             LEAST(selection_end_date, jst_today()) AS last_day
        FROM seasons WHERE id = $1
    ), days AS (
      SELECT generate_series(first_day, last_day, interval '1 day')::date AS as_of
        FROM season
    ), confidence AS (
      SELECT sn.calculated_on, sn.person_id,
             sn.total_points::numeric / NULLIF(mx.max_points, 0) AS ratio
        FROM score_snapshots sn
        JOIN v_scoring_rule_set_max mx ON mx.rule_set_id = sn.rule_set_id
       WHERE sn.season_id = $1
    )
    SELECT d.as_of,
      (SELECT count(*) FROM candidate_numbers n
        WHERE n.season_id = $1 AND jst_date(n.assigned_at) <= d.as_of)::int AS candidates,
      (SELECT count(DISTINCT pr.partner_id) FROM partner_reaches pr
        WHERE pr.season_id = $1 AND pr.occurred_on <= d.as_of)::int AS partners,
      (SELECT count(DISTINCT c.person_id) FROM confidence c
        WHERE c.calculated_on <= d.as_of AND c.ratio >= .8)::int AS high_confidence,
      (SELECT count(DISTINCT ae.person_id) FROM v_effective_approach_events ae
        WHERE ae.season_id = $1 AND jst_date(ae.occurred_at) <= d.as_of)::int AS special
      FROM days d ORDER BY d.as_of`, [seasonId])

export interface SeasonSummary {
  identified_person: number
  applicant: number
  accepted: number
  net_accepted: number
  rejected: number
  withdrawn: number
  in_progress: number
  reapplicant: number
}

/**
 * 現時点の断面。ファネルの最終行を取るのではなく、その日の値を直接引く。
 * 選考が終わった年度では最終日、進行中の年度では今日になる。
 */
export const getSummary = (db: Db, seasonId: string, windowDays = ACTIVE_WINDOW_DAYS) =>
  maybeOne<SeasonSummary>(db, `
    WITH latest AS (
      SELECT * FROM f_funnel_daily($2)
       WHERE season_id = $1 AND as_of <= jst_today()
       ORDER BY as_of DESC LIMIT 1
    )
    SELECT
      COALESCE(l.identified_person_cum, 0) AS identified_person,
      COALESCE(l.applicant_cum, 0)         AS applicant,
      COALESCE(l.accepted_cum, 0)          AS accepted,
      COALESCE(l.net_accepted_cum, 0)      AS net_accepted,
      COALESCE(l.rejected_cum, 0)          AS rejected,
      COALESCE(l.withdrawn_cum, 0)         AS withdrawn,
      -- 「まだ結論が出ていない」も今日時点で判定する。ここだけ期間無制限に
      -- すると、選考終了後に記録された遷移がこの項目にだけ効いて、
      -- 木 = 幹 + 不合格 + 辞退 + 選考中 が合わなくなる。
      (SELECT count(*) FROM v_application_state a
        WHERE a.season_id = $1
          AND jst_date(a.submitted_at) <= jst_today()
          AND NOT EXISTS (
                SELECT 1 FROM v_effective_status_histories sh
                 WHERE sh.application_id = a.application_id
                   AND sh.transition_type IN ('reject', 'withdraw')
                   AND jst_date(sh.occurred_at) <= jst_today())
          AND NOT EXISTS (
                SELECT 1 FROM v_effective_status_histories sh
                  JOIN v_final_selection_step fs ON fs.season_id = a.season_id
                 WHERE sh.application_id = a.application_id
                   AND sh.transition_type = 'advance'
                   AND sh.selection_step_id = fs.selection_step_id
                   AND jst_date(sh.occurred_at) <= jst_today())
      ) AS in_progress,
      (SELECT count(*) FROM v_application_state a
        WHERE a.season_id = $1 AND a.is_reapplication
          AND jst_date(a.submitted_at) <= jst_today()) AS reapplicant
      -- latest が0行でも1行返す。FROM latest だけだと、応募開始前の年度で
      -- COALESCE が効かず結果そのものが消える。
      FROM (SELECT 1) AS present
      LEFT JOIN latest l ON true`, [seasonId, windowDays])

export interface ReachConversion {
  /** 募集期間中に一度でも接点があった Person の実人数。 */
  reached_persons: number
  /** その年度に応募した Person の実人数。応募件数ではない。 */
  applied_persons: number
  /** 募集期間の範囲。分母がどこまでの話かを画面に出すため。 */
  period_from: Date
  period_to: Date
  /** 選考完了日を過ぎていれば確定。それまでは分母が増え続ける。 */
  is_final: boolean
}

/**
 * 年度単位の 林 → 木 転換率。
 *
 * 日次の転換率は出さない。日次の林はローリングウィンドウ（その日から遡って
 * N 日）、日次の木は年度累積で、母集団の定義が日ごとに違う。
 * 定義の違うものを割っても分析にならない。
 *
 * こちらは期間全体の EXISTS で数える。「募集期間中に一度でも接点があったか」
 * なので、ウィンドウの幅に依存しない。分母は年度が進むにつれて増え、
 * 応募締切を過ぎれば動かなくなる。
 *
 * 募集期間を outreach_start_date 〜 application_close_date と解釈している。
 * 林は集客期に積み上がるので応募開始日からでは足りず、応募締切より後に
 * 接点を持った人はその年度の応募母集団ではない、という読み。
 * ここは定義が明文化されていないので、違うなら直す（DECISIONS D-7）。
 *
 * 分子は応募「件数」ではなく「実人数」。分母が人なので揃える。
 */
export const getReachConversion = (db: Db, seasonId: string) =>
  maybeOne<ReachConversion>(db, `
    SELECT
      (SELECT count(DISTINCT t.person_id)
         FROM touchpoints t
         JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
        WHERE jst_date(t.occurred_at)
              BETWEEN s.outreach_start_date AND s.application_close_date
          AND jst_date(t.occurred_at) <= jst_today()
          -- 架空の人は架空の期にだけ数える（0029）。ここは年度を日付の窓で
          -- 見るので、窓が重なれば混ざる。**窓の置き方に依存させない。**
          AND p.is_demo = s.is_demo)                           AS reached_persons,
      (SELECT count(DISTINCT a.person_id)
         FROM v_application_state a
        WHERE a.season_id = s.id
          AND jst_date(a.submitted_at) <= jst_today())         AS applied_persons,
      s.outreach_start_date                                    AS period_from,
      s.application_close_date                                 AS period_to,
      (jst_today() > s.selection_end_date)                     AS is_final
      FROM seasons s WHERE s.id = $1`, [seasonId])

export interface StepFlow {
  sort_order: number
  name: string
  reached: number
  passed: number
}

/**
 * ステップごとの通過状況。どこで落ちているかを見る。
 *
 * 「到達」は、そのステップの評価行が作られたこと。遷移ログではなく
 * evaluations を見るのは、評価行の生成がステップ到達の定義だから。
 *
 * 「通過」は、そのステップを対象とする有効な advance。訂正で取り消された
 * 通過は含まれない。
 *
 * 不合格の内訳をステップ別に出していない。reject は selection_step_id を
 * 持たないため、どのステップで落ちたかは「直前に割り当てられた評価」から
 * 推測するしかない。推測を集計値として出すと、根拠のない数字が
 * 一人歩きする。必要になったら reject にステップを持たせるほうが正しい。
 */
export const getStepFlow = (db: Db, seasonId: string) =>
  all<StepFlow>(db, `
    SELECT ss.sort_order, ss.name,
           count(DISTINCT e.application_id)   AS reached,
           count(DISTINCT adv.application_id) AS passed
      FROM selection_steps ss
      -- 到達・通過とも v_countable_applications を通す。ここだけ生テーブルを
      -- 見ていると、無効化済み・個人情報削除済みの応募がこの表にだけ残る。
      LEFT JOIN v_countable_applications ca ON ca.season_id = ss.season_id
      LEFT JOIN evaluations e
             ON e.selection_step_id = ss.id AND e.application_id = ca.id
      LEFT JOIN v_effective_status_histories adv
             ON adv.selection_step_id = ss.id AND adv.transition_type = 'advance'
            AND adv.application_id = ca.id
     WHERE ss.season_id = $1
     GROUP BY ss.sort_order, ss.name
     ORDER BY ss.sort_order`, [seasonId])

export interface ChannelRow {
  channel: string
  self_report_group: string | null
  /** その年度に初回接触した実人数。林（直近N日のローリング）とは別物。 */
  first_touch_persons: number
  applicants: number
  accepted: number
}

/**
 * チャネル別の成果。初回接触アトリビューションで見る。
 * 3方式のうち初回を既定にするのは、集客の投資判断に使う指標だから。
 *
 * この表の人数列を「林」と呼ばない。林は「その日から遡って N 日以内に
 * 接点がある人」で、ここは「その年度に初回接触した人の累積」。
 * 定義も単位の取り方も違うものを同じ名前で1画面に並べると、
 * 二つの数が合わないことが不具合に見える。
 *
 * 削除済み Person を除く。ファネルの林も生涯サマリも森の集計も除いており、
 * ここだけ残すと個人情報削除の依頼（資料9-2）が集客画面から漏れる。
 *
 * 当該年度に接点が帰属しない応募者は「（年度内に接点なし）」に集める。
 * 原典は「該当 Season が存在しない接点は…(4)で『未割当』として表示する」と
 * 指示している。WHERE で落とすと、チャネル別の応募数の合計が
 * 実際の応募数に届かないのに、その差が画面のどこにも出ない。
 */
export const getChannelPerformance = (db: Db, seasonId: string) =>
  all<ChannelRow>(db, `
    WITH attributed AS (
      SELECT af.person_id, af.channel_id
        FROM v_attribution_first af
        JOIN persons p ON p.id = af.person_id AND p.deleted_at IS NULL
       WHERE af.season_id = $1
    ),
    apps AS (
      SELECT a.application_id, a.person_id, a.is_accepted
        FROM v_application_state a
       WHERE a.season_id = $1
    )
    SELECT COALESCE(c.name, '（年度内に接点なし）')                  AS channel,
           c.self_report_group,
           count(DISTINCT at.person_id)                             AS first_touch_persons,
           count(DISTINCT ap.application_id)                        AS applicants,
           count(DISTINCT ap.application_id) FILTER (WHERE ap.is_accepted) AS accepted
      FROM attributed at
      FULL OUTER JOIN apps ap ON ap.person_id = at.person_id
      LEFT JOIN channels c ON c.id = at.channel_id
     GROUP BY c.name, c.self_report_group
     ORDER BY first_touch_persons DESC, applicants DESC`, [seasonId])

export interface WithdrawReasonRow {
  label: string
  count: number
}

/**
 * 辞退理由の分布。チャネルの質を表す指標として(4)で読む。
 *
 * 応募単位で数える。有効な withdraw 行が1応募に2本残る形があるため
 * （訂正の訂正で深さ0と深さ2の両方が有効になる）、行を数えると
 * KPI の「辞退」より多く出る。同じ画面で数が合わないのは事故のもと。
 *
 * withdraw_reason_id は原典で NULL 可のまま。理由なしの辞退を
 * INNER JOIN で落とすと、分布の合計が辞退件数に届かないのに
 * その差が画面のどこにも出ない。未記録として明示する。
 */
export const getWithdrawReasons = (db: Db, seasonId: string) =>
  all<WithdrawReasonRow>(db, `
    SELECT COALESCE(wr.label, '（理由未記録）') AS label,
           count(DISTINCT sh.application_id)    AS count
      FROM v_effective_status_histories sh
      JOIN v_countable_applications a ON a.id = sh.application_id
      LEFT JOIN withdraw_reasons wr ON wr.id = sh.withdraw_reason_id
     WHERE a.season_id = $1 AND sh.transition_type = 'withdraw'
     GROUP BY wr.label ORDER BY count DESC`, [seasonId])

// -------------------------------------------------------------
// (4) 流入元
// -------------------------------------------------------------

/**
 * 森の観測窓。最後のリーチから何日後までの識別を、そのリーチに帰属させるか。
 *
 * 林の ACTIVE_WINDOW_DAYS とは別の概念なので、同じ 90 でも定数を分ける。
 * 片方を運用データに合わせて動かしたときに、もう片方まで動くと困る。
 * こちらも仮の値である。
 */
export const REACH_WINDOW_DAYS = 90

export interface PartnerReachRow {
  partner_id: string
  partner_name: string
  photo_data_url: string | null
  /** 推定値。実人数と同じ軸に並べない。 */
  estimated_reach_total: number | null
  contact_occasions: number
  first_reach_on: Date
  last_reach_on: Date
  /** 観測窓に入った実人数。団体をまたいで重複しうるので縦に足さない。 */
  identified_count: number
}

/** 団体別のリーチ。年度で絞る。 */
export const getPartnerReach = (db: Db, seasonId: string, windowDays = REACH_WINDOW_DAYS) =>
  all<PartnerReachRow>(db, `
    SELECT r.partner_id, p.name AS partner_name, p.photo_data_url,
           COALESCE(r.estimated_reach_total, 0) AS estimated_reach_total,
           r.contact_occasions, r.first_reach_on, r.last_reach_on, r.identified_count
      FROM f_partner_reach_summary($2) r
      JOIN partners p ON p.id = r.partner_id
     WHERE r.season_id = $1
     -- ★ 並びは**直近の接触が新しい順**（依頼者の指示。実行⑫）。
     --   実行⑪までは推定リーチの多い順だったが、旧データに推定リーチが
     --   1件も無いため（作れば「届かなかった」が「届いた」に化ける。C-78）、
     --   実データでは事実上ただの識別人数順になっていた。
     --   日付が無い団体は後ろへ（NULLS LAST）、同日は名前で決める ――
     --   並びが決まらないと、同じ問いに開くたび違う答えが出る。
     ORDER BY r.last_reach_on DESC NULLS LAST, p.name`,
    [seasonId, windowDays])

export interface ReachTotals {
  /** 推定値の合計。接触機会は重複を含む概念なので足してよい。 */
  estimated_reach_total: number
  contact_occasions: number
  partners: number
  /** 年度全体の実人数。団体別の identified_count の合計とは一致しない。 */
  identified_persons: number
  /** 年度に紐づかないリーチ。この画面のどの表にも出ないので件数だけ示す。 */
  season_less_occasions: number
  season_less_reach: number
}

/**
 * 森の年度合計。
 *
 * identified_persons を団体別の合計から作らない。同じ人が2団体から
 * 接触されていれば両方の行で1と数えられており、足すと重複したまま増える。
 * 人の集合まで戻る f_partner_reach_persons を数える。
 */
export const getReachTotals = (db: Db, seasonId: string, windowDays = REACH_WINDOW_DAYS) =>
  maybeOne<ReachTotals>(db, `
    SELECT
      (SELECT COALESCE(sum(pr.estimated_reach), 0)::bigint
         FROM partner_reaches pr WHERE pr.season_id = $1)      AS estimated_reach_total,
      (SELECT count(*) FROM partner_reaches pr
        WHERE pr.season_id = $1)                               AS contact_occasions,
      (SELECT count(DISTINCT pr.partner_id) FROM partner_reaches pr
        WHERE pr.season_id = $1)                               AS partners,
      (SELECT count(DISTINCT pp.person_id)
         FROM f_partner_reach_persons($2) pp
        WHERE pp.season_id = $1)                               AS identified_persons,
      (SELECT count(*) FROM partner_reaches pr
        WHERE pr.season_id IS NULL)                            AS season_less_occasions,
      (SELECT COALESCE(sum(pr.estimated_reach), 0)::bigint
         FROM partner_reaches pr WHERE pr.season_id IS NULL)    AS season_less_reach`,
    [seasonId, windowDays])

export interface ChannelAttributionRow {
  channel: string
  self_report_group: string | null
  /** 3方式とも合計は同じ実人数になる。配り方だけが違う。numeric は文字列で返る。 */
  first_touch: string
  last_touch: string
  linear: string
}

/**
 * チャネル別のアトリビューション3方式。
 *
 * (1)のチャネル別表は初回接触だけを出している。投資判断には初回を使うが、
 * 初回だけを見ると「最初に見つけてもらう経路」と「最後に背中を押す経路」の
 * 区別がつかない。3方式を並べると、その差がそのまま読める。
 *
 * 3方式は同じ実人数を違う重みで配るので、列の合計は3つとも一致する。
 * 一致しないなら、どれかが人を落としているか二重に数えている。
 *
 * 削除済み Person を除く。他の集計もすべて除いており、ここだけ残すと
 * 個人情報削除の依頼（資料9-2）がこの画面から漏れる。
 */
export const getChannelAttribution = (db: Db, seasonId: string) =>
  all<ChannelAttributionRow>(db, `
    WITH attributed AS (
      SELECT 'first' AS method, person_id, channel_id, weight
        FROM v_attribution_first  WHERE season_id = $1
      UNION ALL
      SELECT 'last',  person_id, channel_id, weight
        FROM v_attribution_last   WHERE season_id = $1
      UNION ALL
      SELECT 'linear', person_id, channel_id, weight
        FROM v_attribution_linear WHERE season_id = $1
    )
    SELECT c.name AS channel, c.self_report_group,
           COALESCE(sum(a.weight) FILTER (WHERE a.method = 'first'), 0)  AS first_touch,
           COALESCE(sum(a.weight) FILTER (WHERE a.method = 'last'), 0)   AS last_touch,
           -- 丸めない。表示の桁で丸めると、行ごとの誤差が積もって
           -- 縦計が3列で食い違い、「合計は一致する」という注記が嘘になる。
           COALESCE(sum(a.weight) FILTER (WHERE a.method = 'linear'), 0) AS linear
      FROM attributed a
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN channels c ON c.id = a.channel_id
     GROUP BY c.name, c.self_report_group
     ORDER BY first_touch DESC, c.name`, [seasonId])

export interface UnattributedTouchpoints {
  touchpoints: number
  persons: number
}

/**
 * どの年度にも属さない接点。
 *
 * 原典は「該当 Season が存在しない接点は(4)で『未割当』として表示する」と
 * 指示している。集計から落とすだけだと、チャネル別の人数の合計が
 * 実際の接点数に届かない理由が画面のどこにも出ない。
 *
 * 年度で絞らない。どの年度にも属さないものを数えているので、
 * 年度ごとに違う値になりようがない。
 */
export const getUnattributedTouchpoints = (db: Db) =>
  maybeOne<UnattributedTouchpoints>(db, `
    SELECT count(*) AS touchpoints, count(DISTINCT ts.person_id) AS persons
      FROM v_touchpoint_season ts
      JOIN persons p ON p.id = ts.person_id AND p.deleted_at IS NULL
     WHERE ts.season_id IS NULL`)

// -------------------------------------------------------------
// (2) 選考オペレーション
// -------------------------------------------------------------

export interface PendingEvaluation {
  evaluation_id: string
  applicant_name: string
  step_name: string
  step_order: number
  interviewer: string | null
  assigned_at: Date
  waiting_days: number
  sla_days: number | null
  over_sla: boolean
}

/**
 * 判断待ちの評価。
 *
 * 滞留の起点は assigned_at（ステップ到達時に評価行が生成される時刻）。
 * 基準日は jst_today()。CURRENT_DATE を使うと接続のタイムゾーン次第で
 * 滞留日数が1日ずれる。
 *
 * 母集団は v_active_applications。v_countable_applications ではない。
 * あれは「木に数えるか」であって「いま動いているか」ではないため、
 * 選考開始前に取り下げられた応募（数えるが動いていない）が残り、
 * 面接官に催促し続けることになっていた（0011、A-14）。
 */
export const getPendingEvaluations = (db: Db, seasonId: string) =>
  all<PendingEvaluation>(db, `
    SELECT e.id AS evaluation_id,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name, ss.sort_order AS step_order,
           st.display_name AS interviewer,
           e.assigned_at,
           (jst_today() - jst_date(e.assigned_at)) AS waiting_days,
           ss.sla_days,
           (ss.sla_days IS NOT NULL
            AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days) AS over_sla
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_active_applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1 AND e.state = 'pending'
     ORDER BY over_sla DESC, waiting_days DESC, ss.sort_order`, [seasonId])

export interface HeldEvaluation {
  evaluation_id: string
  applicant_name: string
  step_name: string
  interviewer: string | null
  hold_reason: string
  waiting_days: number
}

/** 保留。理由が必須なので、必ず読める形で出る。 */
export const getHeldEvaluations = (db: Db, seasonId: string) =>
  all<HeldEvaluation>(db, `
    SELECT e.id AS evaluation_id,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name, st.display_name AS interviewer,
           e.hold_reason,
           (jst_today() - jst_date(e.assigned_at)) AS waiting_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_active_applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1 AND e.state = 'held'
     ORDER BY waiting_days DESC`, [seasonId])

export interface InterviewerLoad {
  interviewer: string
  pending: number
  submitted: number
  held: number
  /** numeric はドライバが文字列で返す。 */
  avg_turnaround_days: string | null
}

/** 面接官別の負荷。偏りがあれば滞留の原因になる。 */
export const getInterviewerLoad = (db: Db, seasonId: string) =>
  all<InterviewerLoad>(db, `
    SELECT st.display_name AS interviewer,
           count(*) FILTER (WHERE e.state = 'pending')   AS pending,
           count(*) FILTER (WHERE e.state = 'submitted') AS submitted,
           count(*) FILTER (WHERE e.state = 'held')      AS held,
           round(avg(EXTRACT(epoch FROM (e.submitted_at - e.assigned_at)) / 86400)
                 FILTER (WHERE e.state = 'submitted'), 1) AS avg_turnaround_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1
     GROUP BY st.display_name
     ORDER BY pending DESC, interviewer`, [seasonId])

export interface ConflictRow {
  applicant_name: string
  interviewer: string
  step_name: string
  conflict_type: string
  state: string
}

/**
 * 利益相反。紹介者が面接官、または面接官が応募者本人。
 *
 * 検出そのものは v_conflict_of_interest が行う。ここは「担当を替える
 * 必要が残っているか」を出す画面なので、動いている応募だけに絞る。
 * 生の applications に結合していたため、個人情報削除を受けた応募者の
 * 氏名が運用の画面に出うる形でもあった（0011、A-14）。
 */
export const getConflicts = (db: Db, seasonId: string) =>
  all<ConflictRow>(db, `
    SELECT p.family_name || ' ' || p.given_name AS applicant_name,
           st.display_name AS interviewer,
           ss.name AS step_name,
           coi.conflict_type,
           e.state
      FROM v_conflict_of_interest coi
      JOIN evaluations e ON e.id = coi.evaluation_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_active_applications a ON a.id = coi.application_id
      JOIN persons p ON p.id = coi.applicant_person_id
      JOIN staffs st ON st.id = coi.interviewer_staff_id
     WHERE a.season_id = $1
     ORDER BY ss.sort_order`, [seasonId])

export interface UnassignedRow {
  count: number
  oldest_days: number | null
}

/**
 * 担当未割当。第1ステップは面接官なしで評価行が生成される。
 *
 * この問い合わせは applications にも persons にも結合していなかった。
 * すぐ隣に並ぶ判断待ちの一覧は v_countable_applications を通っており、
 * 同じ画面の2つの数字が別の母集団から出ていた。個人情報削除を受けた
 * 人の評価まで数える形でもあった（0011、A-14）。
 */
export const getUnassignedSummary = (db: Db, seasonId: string) =>
  maybeOne<UnassignedRow>(db, `
    SELECT count(*) AS count,
           max(jst_today() - jst_date(e.assigned_at)) AS oldest_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_active_applications a ON a.id = e.application_id
     WHERE ss.season_id = $1 AND e.interviewer_staff_id IS NULL AND e.state = 'pending'`,
    [seasonId])

/**
 * KPI目標と実績（依頼者の指示。実行⑯〜⑰。C-179）。
 *
 * 依頼者の言葉 ――「要項やペルソナやKPIを持ってきて新規DBにも実装して」
 * 「AスペースにKPIとかのリザルトが見れたら」。
 *
 * ★ 目標は 0043 に入っている（`recruitment_course_targets`。14件）。
 *   **取り込んだのに、どの画面からも読んでいなかった。**
 *
 * ★ 実績は**まだ結びつけない。** 目標の側は「コース別」「施策別」の呼び名で、
 *   記録の側にその区分が無い ―― `channels` とも `courses` とも一致しない。
 *   無理に当てると、**違う母集団の割り算**になる（CLAUDE.md の禁止）。
 *   ここでは目標だけを返し、実績の欄は空で出す。
 */
export interface CourseTargetRow {
  category: string
  course_label: string
  segment_label: string | null
  target_accepted: number | null
  target_applicants: number | null
  target_briefing: number | null
  target_reach: number | null
}

export const listCourseTargets = (
  db: Db, seasonId: string,
): Promise<CourseTargetRow[]> =>
  all<CourseTargetRow>(db, `
    SELECT category, course_label, segment_label,
           target_accepted, target_applicants, target_briefing, target_reach
      FROM recruitment_course_targets
     WHERE season_id = $1
     ORDER BY sort_order`, [seasonId])

export interface AcceptedCandidateRow {
  person_id: string
  application_id: string
  person_name: string
  photo_data_url: string | null
  school: string
}

export const listAcceptedCandidates = (
  db: Db, seasonId: string, limit = 5,
): Promise<AcceptedCandidateRow[]> =>
  all<AcceptedCandidateRow>(db, `
    SELECT p.id AS person_id,
           a.id AS application_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url,
           sc.name AS school
      FROM applications a
      JOIN persons p ON p.id = a.person_id
      JOIN schools sc ON sc.id = p.school_id
      JOIN v_application_outcome o ON o.application_id = a.id
     WHERE a.season_id = $1 AND o.outcome = 'accepted'
     ORDER BY p.family_name, p.given_name, p.id
     LIMIT $2`, [seasonId, limit])
