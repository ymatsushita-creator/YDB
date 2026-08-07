-- =============================================================
-- 0012 森を実体にし、「いまやること」を既存の事実から導く
--
-- 憲法（director.md）は森を最上位オブジェクトに置き、ホーム画面に
-- 「今日やること」「止まっているもの」「要注意の森」を要求している。
-- 一方 CLAUDE.md の順序は「記録の構造 > 集計の定義 > 画面」であり、
-- 憲法自身も最後にこう書いている ――
--
--   「森が主役に見える画面」を、森の実体が無いまま作ってはならない。
--   その場合に直すのは画面ではなく、記録層である。
--
-- 実装前の記録層には、森として使える実体が無かった。
--   partners          … フラットな表。階層を持たない（domain.md 9-1）
--   partner_reaches   … 個人を識別しないリーチの記録（推定値）
--   touchpoints       … partner_id を持つが、団体の階層は無い
--
-- domain.md 10-4 は「partners を Forest に育てるか、Community を新設して
-- 親子を張るか」を未決として残している。MVP モードの指示（実行⑥）に従い、
-- **単純なほうを選んで進めた。**
--
--   採用: partners に親を1本足す。親を持たない団体が森、親を持つ団体が林。
--   TODO(MVP): 森と林を別テーブルに分けるかは未決のまま。分ける必要が
--              出るのは、両者が違う属性を持つと分かったときである。
--
-- この選択の根拠は、既存のぶら下がりを動かさずに済むことである。
-- partner_reaches と partner_relations と touchpoints は partner_id を
-- 指しており、どちらの段に付いていても v_partner_forest が森へ畳む。
-- 新テーブルへ移すと、これら3つの FK をすべて張り替えることになる。
--
-- 2段に限る理由は、集計の畳み方が段数に依存するためである。
-- 3段目を許すと、森の集計は再帰になり、「林の集計に孫が入るのか」という
-- 問いが増える。domain.md 3節のトポロジーは Forest > Community > Person の
-- 2段しか定めていないので、記録層でも2段で止める。CHECK では他の行を
-- 参照できないため、トリガで拒否する。
--
-- ★ 語について。domain.md 11節は「森・林・木」の意味を変えたが、
--   実装は D-2（林は人、木と幹は応募）のまま動いている。ここで新しい
--   意味の語を既存のビュー名に混ぜると、実行③で踏んだ「同じ言葉が
--   2つの定義を持つ」の再演になる。そこでこのマイグレーションは
--   **既存の 林/木/幹 のビューを一切触らず、Forest / Community という
--   英語の語で新しい実体を作る。** 旧語の付け替えは別の実行で行う（D-11）。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 団体に階層を持たせる
-- -------------------------------------------------------------
ALTER TABLE partners
    ADD COLUMN parent_partner_id uuid REFERENCES partners(id);

-- 自分を親にできない。トリガより先に、書けない形は制約で閉じる。
ALTER TABLE partners
    ADD CONSTRAINT partners_parent_not_self
        CHECK (parent_partner_id IS NULL OR parent_partner_id <> id);

COMMENT ON COLUMN partners.parent_partner_id IS
    '親の団体。NULL なら森（Forest）、値があれば林（Community）。'
    '2段まで。3段目はトリガ partners_two_levels_only が拒否する。';

CREATE INDEX partners_parent_idx ON partners (parent_partner_id)
    WHERE parent_partner_id IS NOT NULL;

CREATE FUNCTION partners_reject_third_level()
RETURNS trigger AS $$
BEGIN
    -- 親が親を持っていたら3段目になる。
    IF NEW.parent_partner_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM partners p
         WHERE p.id = NEW.parent_partner_id
           AND p.parent_partner_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION '団体の階層は2段まで（林の下に林は作れない）: %', NEW.name
            USING HINT = 'domain.md 3節のトポロジーは Forest > Community > Person。';
    END IF;

    -- すでに子を持つ団体を、他の団体の子にすると孫ができる。
    IF NEW.parent_partner_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM partners c WHERE c.parent_partner_id = NEW.id
    ) THEN
        RAISE EXCEPTION '子を持つ団体を林にはできない: %', NEW.name
            USING HINT = '先に子の親を付け替える。';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION partners_reject_third_level() IS
    '団体の階層を2段に限る。集計の畳み方が段数に依存するため。';

CREATE TRIGGER partners_two_levels_only
    BEFORE INSERT OR UPDATE OF parent_partner_id ON partners
    FOR EACH ROW EXECUTE FUNCTION partners_reject_third_level();


-- -------------------------------------------------------------
-- 2. 森と林、そして「どの団体がどの森に属するか」
-- -------------------------------------------------------------
-- 集計はすべて v_partner_forest を通す。森に直付けされた接点と、
-- 林に付いた接点を、同じ式で森へ畳むため。ここを経由しない集計を
-- 書くと、林に付いた接点が森から漏れる。
CREATE VIEW v_partner_forest AS
SELECT p.id                                 AS partner_id,
       coalesce(p.parent_partner_id, p.id)  AS forest_id,
       (p.parent_partner_id IS NOT NULL)    AS is_community
  FROM partners p;

COMMENT ON VIEW v_partner_forest IS
    '団体 → その団体が属する森。森自身は自分を指す。'
    '森の集計は必ずここを通す（林に付いた接点を漏らさないため）。';


CREATE VIEW v_forests AS
SELECT p.id AS forest_id, p.name, p.category, p.contact_name, p.contact_email,
       p.first_contact_date, p.is_active
  FROM partners p
 WHERE p.parent_partner_id IS NULL;

COMMENT ON VIEW v_forests IS '森（Forest）。親を持たない団体。';


CREATE VIEW v_communities AS
SELECT p.id AS community_id, p.parent_partner_id AS forest_id,
       p.name, p.category, p.is_active
  FROM partners p
 WHERE p.parent_partner_id IS NOT NULL;

COMMENT ON VIEW v_communities IS '林（Community）。森の中の具体的なコミュニティ。';


-- -------------------------------------------------------------
-- 3. いまやること（導出タスク）
-- -------------------------------------------------------------
-- ★ これは Task エンティティの記録層ではない。
--   domain.md 10-2 が言うとおり Task の定義（誰の・何に対する・いつまでの・
--   どの状態か）は未決で、記録層に1行も存在しない。
--   ここにあるのは **既存の事実から導いたタスク**だけである。
--   1行1行が evaluations か v_conflict_of_interest の実在する行に対応し、
--   このビューが独自に作り出した事実は1つも無い（原則1・原則7）。
--
--   TODO(MVP): 人が手で作るタスク（連絡する・催促する・資料を送る）は
--              表せない。表すには tasks テーブルと、それを書く画面（＝
--              クライアント境界の新設）が要る。どちらも実行⑥の範囲外。
--
-- 母集団は v_active_applications。v_countable_applications ではない。
-- 「木に数えるか」と「いま誰かが判断すべきか」は別の述語である（A-14）。
-- ここを間違えると、9か月前に取り下げられた応募を催促し続ける。
--
-- 氏名を持たない。表示のために氏名が要る画面は persons に結合する。
-- v_active_applications が個人情報削除済みを外しているので、
-- このビューを通る限り削除済みの人はタスクに出ない。
--
-- ★ 年度は selection_steps から取る（`ss.season_id`。`a.season_id` ではない）。
--
--   応募の側から取ると、呼び出し側の `WHERE season_id = ...` が
--   v_active_applications へ降りる。その先には v_application_outcome があり、
--   さらに再帰 CTE の v_effective_status_histories が居るため、
--   絞り込むほど遅くなる（実測 74 ミリ秒 → 413 ミリ秒）。
--   選考ステップ側なら述語は小さな表で止まり、絞っても値は変わらない
--   （実測 74 → 76 ミリ秒）。既存の getPendingEvaluations も
--   `ss.season_id` で絞っており、そちらに合わせた形でもある。
--
--   一度 `WITH active AS MATERIALIZED (...)` で押さえる案も測ったが、
--   絞り込みの有無によらず 1,050 ミリ秒になった。全応募を毎回
--   実体化する分が、節約した分を上回る。**採らなかった案も測ってから捨てる。**
CREATE VIEW v_open_tasks AS
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
    '母集団は v_active_applications。手で作るタスクは表せない。';


-- -------------------------------------------------------------
-- 4. 森の活動（年度を問わない）
-- -------------------------------------------------------------
-- 接点の鮮度に年度を掛けない。森との関係は年度をまたいで続くもので、
-- 「2027年度の接点が無い」ことは「関係が切れている」ことではない。
-- D-3 で林のアクティブ判定を Season で絞らなかったのと同じ理由である。
-- 年度で意味を持つ数（応募・合格・タスク）は次の 5. に置く。
--
-- ★ 単位の警告。persons_touched は実人数、estimated_reach は推定の
--   接触機会である。同じ行に並んでいるが、**割ってはならない。**
--   未識別（森の Reach）と識別済み（Person）の境界をまたぐ割り算は
--   domain.md 8節が禁じており、実行②で作りかけて消した指標そのもの。
--   同じ人へ2回リーチすれば estimated_reach は2と数える。
CREATE VIEW v_forest_activity AS
WITH touch AS (
    SELECT pf.forest_id,
           count(*)                          AS touchpoints,
           count(DISTINCT t.person_id)       AS persons_touched,
           max(jst_date(t.occurred_at))      AS last_touch_on
      FROM touchpoints t
      JOIN v_partner_forest pf ON pf.partner_id = t.partner_id
      JOIN persons p           ON p.id = t.person_id AND p.deleted_at IS NULL
     GROUP BY pf.forest_id
), reach AS (
    SELECT pf.forest_id,
           sum(pr.estimated_reach) AS estimated_reach,
           max(pr.occurred_on)     AS last_reach_on
      FROM partner_reaches pr
      JOIN v_partner_forest pf ON pf.partner_id = pr.partner_id
     GROUP BY pf.forest_id
)
SELECT f.forest_id,
       f.name,
       f.category,
       f.is_active,
       f.first_contact_date,
       (SELECT count(*) FROM v_communities c WHERE c.forest_id = f.forest_id)
                                                  AS communities,
       coalesce(tc.touchpoints, 0)                AS touchpoints,
       coalesce(tc.persons_touched, 0)            AS persons_touched,
       tc.last_touch_on,
       CASE WHEN tc.last_touch_on IS NULL THEN NULL
            ELSE jst_today() - tc.last_touch_on END AS days_since_touch,
       rc.estimated_reach,
       rc.last_reach_on
  FROM v_forests f
  LEFT JOIN touch tc ON tc.forest_id = f.forest_id
  LEFT JOIN reach rc ON rc.forest_id = f.forest_id;

COMMENT ON VIEW v_forest_activity IS
    '森の活動。年度で絞らない（森との関係は年度をまたぐ）。'
    'persons_touched は実人数、estimated_reach は推定の接触機会。割らない。';


-- -------------------------------------------------------------
-- 5. 森×年度（応募・合格・いまやること）
-- -------------------------------------------------------------
-- 森に人を結ぶ事実は touchpoints.partner_id である。Relationship
-- （domain.md 5節の Person ↔ Forest の役割）は記録層に無い。
--
-- TODO(MVP): これは「接触があった」であって「所属している」ではない。
--            所属を表すには Relationship が要る（domain.md 10-1 で
--            partner_relations と語が衝突しており、未決）。
--
-- ★ 行をまたいで足せない。同じ人が2つの森から接触されていれば、
--   両方の行で1と数えられる。0009 の f_partner_reach_summary と同じ性質で、
--   年度全体の実人数を出すつもりで合計すると重複したまま増える。
--   画面には森ごとの行として出し、合計は出さない。
--
-- ★★ CTE がすべて MATERIALIZED である理由（実測。消してはならない）
--
--   最初は素の WITH で書いた。全件（WHERE なし）で 19 ミリ秒だったので
--   速いと判断したが、**年度を1つ指定した瞬間に 177 秒になった。**
--   9000 倍である。パラメータでもリテラルでも同じだったので、
--   プリペアドの汎用プランの話ではない。
--
--   原因は述語のプッシュダウンである。`season_id = X` が各 CTE の内側へ
--   降りると、プランナは「対象は数行」と見積もってハッシュ結合をやめ、
--   入れ子ループを選ぶ。その内側に居るのが v_open_tasks と
--   v_application_state で、どちらも v_effective_status_histories
--   （再帰 CTE）を通る。外側の行ごとに再帰が回り直す。
--
--   A-11「年度を指定した検索が、外側の行ごとに集計関数を評価し直していた」
--   と同じ形だが、**向きが逆**である。あれは絞ると速く見えた。これは
--   絞ると遅くなる。だから「絞り込みなしで開いて確かめる」という
--   実行③の手順だけでは見つからない。**両方で測る。**
--
--   MATERIALIZED は、まさにこのプッシュダウンを禁じるための指定である。
--   高い供給元（接点・応募・やること）を1回ずつ走査してから畳むので、
--   外側の絞り込みがどうであれ計算量は変わらない。年度を1つしか見なくても
--   全件を1回走ることになるが、爆発しないほうを取る。
--   実測 177 秒 → 0.15 秒。全件（絞り込みなし）は 0.02 秒のままで、
--   絞ったときとの差が桁で開かなくなった。
--   tests/15「年度を1つ絞っても、全件と同じ桁で返る」が固定している。
CREATE VIEW v_forest_season_activity AS
WITH forest_person AS MATERIALIZED (
    SELECT DISTINCT pf.forest_id, ts.season_id, t.person_id
      FROM touchpoints t
      JOIN v_touchpoint_season ts ON ts.touchpoint_id = t.id
      JOIN v_partner_forest pf    ON pf.partner_id = t.partner_id
      JOIN persons p              ON p.id = t.person_id AND p.deleted_at IS NULL
     WHERE ts.season_id IS NOT NULL
), countable AS MATERIALIZED (
    SELECT a.id, a.person_id, a.season_id, st.is_accepted
      FROM v_countable_applications a
      LEFT JOIN v_application_state st ON st.application_id = a.id
), open_tasks AS MATERIALIZED (
    SELECT t.person_id, t.season_id, t.kind, t.is_overdue FROM v_open_tasks t
), apps AS (
    SELECT fp.forest_id, fp.season_id,
           count(DISTINCT a.id)                            AS applications,
           count(DISTINCT a.id) FILTER (WHERE a.is_accepted) AS accepted
      FROM forest_person fp
      JOIN countable a
        ON a.person_id = fp.person_id AND a.season_id = fp.season_id
     GROUP BY fp.forest_id, fp.season_id
), tasks AS (
    SELECT fp.forest_id, fp.season_id,
           count(*)                                  AS open_tasks,
           count(*) FILTER (WHERE t.is_overdue)       AS overdue_tasks,
           count(*) FILTER (WHERE t.kind = 'assign')  AS unassigned_tasks,
           count(*) FILTER (WHERE t.kind = 'unhold')  AS held_tasks
      FROM forest_person fp
      JOIN open_tasks t
        ON t.person_id = fp.person_id AND t.season_id = fp.season_id
     GROUP BY fp.forest_id, fp.season_id
), people AS (
    SELECT forest_id, season_id, count(*) AS persons_touched
      FROM forest_person
     GROUP BY forest_id, season_id
)
SELECT pe.forest_id,
       pe.season_id,
       pe.persons_touched,
       coalesce(ap.applications, 0)      AS applications,
       coalesce(ap.accepted, 0)          AS accepted,
       coalesce(tk.open_tasks, 0)        AS open_tasks,
       coalesce(tk.overdue_tasks, 0)     AS overdue_tasks,
       coalesce(tk.unassigned_tasks, 0)  AS unassigned_tasks,
       coalesce(tk.held_tasks, 0)        AS held_tasks
  FROM people pe
  LEFT JOIN apps  ap ON ap.forest_id = pe.forest_id AND ap.season_id = pe.season_id
  LEFT JOIN tasks tk ON tk.forest_id = pe.forest_id AND tk.season_id = pe.season_id;

COMMENT ON VIEW v_forest_season_activity IS
    '森×年度。接触があった人と、その人たちの応募・合格・いまやること。'
    '同じ人が複数の森に現れるため、行をまたいで足せない。';
