-- =============================================================
-- 0020 手で作るやること（タスク）の記録層
--
-- 発見の経緯: 実行⑨の画像は「やること」に4枚並べていたが、中身は
-- 「高確度候補者にアプローチする」「面談日程を調整する」「書類を確認する」
-- 「候補者リストを20名追加する」だった。
--
-- **いまの v_open_tasks とは別物である。** あちらは選考の事実から導く4種
-- （評価する・担当を決める・担当を替える・保留を解く）で、C-17 で
-- 「Task の記録層を作らず導出にした」と決めたものである。
-- 導出でないやること（人が決めて人が書く）は、どこにも記録できなかった。
--
-- 依頼者の判断（実行⑨）は「手で作るタスクを記録層から作る」。ここで作る。
--
-- ★ C-17 の決定を取り消してはいない
--
-- 導出できるやること（評価・担当・保留）は**引き続き導出のまま**である。
-- 記録層に写すと、選考の事実とやることが二重管理になり、必ずずれる。
-- ここで作るのは**導出できないやること**だけで、両者は画面で合流させる。
--
-- ★ 状態を持たせず、事実から導く
--
-- 画面の「要対応 / 進行中 / タスク」は状態カラムにしない。
--   完了した          … completed_at がある
--   進行中            … started_at があり、まだ完了していない
--   要対応            … 期限が今日以前
--   タスク            … それ以外
-- 状態カラムを足すと、「完了なのに要対応」のような組み合わせが書けてしまう。
-- 導出なら、そもそも矛盾した行が作れない（原則1）。
--
-- ★ 期限は日と時刻を分ける
--
-- 画像の期限は「今日 14:00 まで」と時刻を持つ。選考の SLA は日単位なので、
-- **同じ列に混ぜない。** due_on は必須、due_time は任意にして、
-- 時刻が無いタスクを「00:00 まで」と読み替えない。
-- =============================================================

CREATE TABLE manual_tasks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           uuid        NOT NULL REFERENCES seasons(id),
    -- 相手のいないやること（リストを N 名追加する等）もあるので NULL 可。
    person_id           uuid        REFERENCES persons(id),
    title               text        NOT NULL,
    detail              text,
    due_on              date        NOT NULL,
    /** 時刻まで決まっているときだけ入る。無いことと 00:00 は別である。 */
    due_time            time,
    owner_staff_id      uuid        REFERENCES staffs(id),
    created_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT manual_tasks_title_not_blank CHECK (btrim(title) <> ''),
    -- 完了しているのに着手していない行は、経緯として成り立たない。
    CONSTRAINT manual_tasks_started_before_completed
        CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

COMMENT ON TABLE manual_tasks IS
    '人が作るやること。導出できるやること（v_open_tasks）とは別物で、'
    '画面で合流させる。状態カラムは持たず、日付と時刻から導く。';
COMMENT ON COLUMN manual_tasks.due_time IS
    '時刻まで決まっているときだけ入る。無いことを 00:00 と読み替えない。';

CREATE INDEX manual_tasks_open_idx ON manual_tasks (season_id, due_on)
    WHERE completed_at IS NULL;
CREATE INDEX manual_tasks_person_idx ON manual_tasks (person_id)
    WHERE person_id IS NOT NULL;


CREATE FUNCTION manual_tasks_check_person()
RETURNS trigger AS $$
BEGIN
    -- 個人情報削除を受けた人のやることは作れない。
    IF NEW.person_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM persons p
         WHERE p.id = NEW.person_id AND p.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '削除済みの候補者にやることは作れない';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manual_tasks_person_alive
    BEFORE INSERT OR UPDATE ON manual_tasks
    FOR EACH ROW EXECUTE FUNCTION manual_tasks_check_person();


-- -------------------------------------------------------------
-- 変更履歴（追記専用）。0018 / 0019 と同じ型。
-- -------------------------------------------------------------
CREATE TABLE manual_task_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manual_task_id      uuid        NOT NULL REFERENCES manual_tasks(id),
    revision_number     integer     NOT NULL,
    season_id           uuid        NOT NULL REFERENCES seasons(id),
    person_id           uuid        REFERENCES persons(id),
    title               text        NOT NULL,
    detail              text,
    due_on              date        NOT NULL,
    due_time            time,
    owner_staff_id      uuid        REFERENCES staffs(id),
    started_at          timestamptz,
    completed_at        timestamptz,
    changed_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    changed_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT manual_task_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT manual_task_revisions_key UNIQUE (manual_task_id, revision_number)
);

CREATE INDEX manual_task_revisions_idx
    ON manual_task_revisions (manual_task_id, revision_number DESC);

CREATE TRIGGER manual_task_revisions_append_only
    BEFORE UPDATE OR DELETE ON manual_task_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE manual_task_revisions IS
    '手で作るやることの変更後スナップショット。追記専用。';


-- -------------------------------------------------------------
-- 開いているやること
-- -------------------------------------------------------------
-- 「まだ終わっていないやること」の定義はここ1箇所。画面が数え直さない。
--
-- urgency は色ではなく**事実の名前**である。画面はこれを読んで
-- チップの色を選ぶだけで、期限を自分で比べ直さない。
CREATE VIEW v_manual_tasks AS
SELECT t.id AS manual_task_id,
       t.season_id,
       t.person_id,
       t.title,
       t.detail,
       t.due_on,
       t.due_time,
       t.owner_staff_id,
       s.display_name AS owner_name,
       (t.started_at IS NOT NULL) AS is_started,
       (t.due_on < jst_today())   AS is_overdue,
       CASE
           WHEN t.started_at IS NOT NULL THEN 'in_progress'
           WHEN t.due_on <= jst_today() THEN 'due'
           ELSE 'later'
       END AS urgency,
       t.due_on - jst_today() AS days_left
  FROM manual_tasks t
  LEFT JOIN staffs s ON s.id = t.owner_staff_id
  LEFT JOIN persons p ON p.id = t.person_id
 WHERE t.completed_at IS NULL
   AND (t.person_id IS NULL OR (p.deleted_at IS NULL AND p.anonymized_at IS NULL));

COMMENT ON VIEW v_manual_tasks IS
    'まだ終わっていない、人が作ったやること。urgency は事実の名前で、'
    '画面はこれを読むだけ（期限を画面で比べ直さない）。';
