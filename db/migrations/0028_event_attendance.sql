-- =============================================================
-- 0028 予定の参加者
--
-- 依頼者の指示（実行⑪）――
--   「カレンダーから、イベントを押したらポップアップを出して、
--     誰が参加したかが見れるようにして、参加者をチェックボタンで記録し、
--     **参加者個々人の属性に追加**して。後でそれを確度にする」
--
-- ★★ 「属性に追加」は**接点（touchpoints）そのもの**である。★★
--
--   参加という事実を人に貼る場所は、すでにある。domain.md ――
--   「接点 = 候補者との接触事実」。ここに新しい属性の列を作ると、
--   **同じ事実が2箇所に載る。**
--
--   そして確度（0017）が規則から参照できる事実は5つしかない ――
--   has_referral / has_application / has_acceptance /
--   **touchpoint_count / last_touchpoint_on**。
--   参加を接点として積めば、**語彙を1つも足さずに確度の材料になる。**
--   別の列に書いていたら、確度からは永久に見えない。
--
-- ★ この表は「記録」ではなく「対応づけ」である
--
--   参加した事実は touchpoints の行が持つ。この表が持つのは
--   **どの予定から積んだ接点か**だけ。役目は2つ ――
--     1. チェックの状態を画面に戻す（誰が記録済みか）
--     2. 同じ予定で同じ人を二重に数えない（UNIQUE）
--
-- ★ チェックを外したら、接点は**消える**
--
--   ここだけは他の表と扱いが違う。`appointments.cancelled_at` は
--   「取り消した予定も残す」―― 空いていたのか流れたのかを区別するためである。
--   しかし参加の記録は、外したときに残す意味が無い。
--   **残せば確度が数え続ける。** 「参加しなかった人」を接点として
--   数えないために、押し間違いは行ごと消す。
--
--   消す範囲は**この表が指している接点だけ**である（`ON DELETE CASCADE` は
--   接点が消えたときに対応づけも消す向き）。手で入れた接点は巻き込まない。
--
--   ★ 誰が記録したかは残らない。合言葉が層で共有だからで、
--     `assign` / `unhold` と同じ穴である（`src/auth/tiers.ts`）。
-- =============================================================

CREATE TABLE event_attendances (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id uuid        NOT NULL REFERENCES appointments(id),
    person_id      uuid        NOT NULL REFERENCES persons(id),
    -- この参加で積んだ接点。接点が消えれば対応づけも消える。
    touchpoint_id  uuid        NOT NULL REFERENCES touchpoints(id) ON DELETE CASCADE,
    recorded_at    timestamptz NOT NULL DEFAULT now(),
    -- 同じ予定に同じ人を2回積まない。押すたびに接点が増えると、
    -- 確度の touchpoint_count が**押した回数**になる。
    CONSTRAINT event_attendances_key UNIQUE (appointment_id, person_id)
);

COMMENT ON TABLE event_attendances IS
    '予定と、その参加で積んだ接点の対応づけ。参加した事実は touchpoints が持つ。';
COMMENT ON COLUMN event_attendances.touchpoint_id IS
    'この参加で積んだ接点。チェックを外すとこの接点ごと消す'
    '（残すと確度が数え続けるため）。';

CREATE INDEX event_attendances_person_idx ON event_attendances (person_id);


-- -------------------------------------------------------------
-- 参加者を出す（画面はこれを読む）
-- -------------------------------------------------------------
-- 「誰が参加したか」の定義はここ1箇所。画面が絞り直さない。
-- 個人情報削除を受けた人は出さない（v_appointments と同じ扱い）。
CREATE VIEW v_event_attendance AS
SELECT ea.id            AS attendance_id,
       ea.appointment_id,
       ea.person_id,
       ea.touchpoint_id,
       ea.recorded_at,
       t.occurred_at,
       p.family_name || ' ' || p.given_name AS person_name
  FROM event_attendances ea
  JOIN persons p    ON p.id = ea.person_id
  JOIN touchpoints t ON t.id = ea.touchpoint_id
 WHERE p.deleted_at IS NULL AND p.anonymized_at IS NULL;

COMMENT ON VIEW v_event_attendance IS
    '予定ごとの参加者。定義はここ1箇所（画面が絞り直さない）。';
