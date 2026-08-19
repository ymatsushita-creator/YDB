-- 原本に担当者が無い実在イベントを、架空の担当者へ寄せずに残す。
ALTER TABLE appointments ALTER COLUMN owner_staff_id DROP NOT NULL;

CREATE OR REPLACE VIEW v_appointments AS
SELECT a.id AS appointment_id, a.season_id, a.person_id, a.kind_id,
       k.code AS kind_code, k.label AS kind_label, a.title,
       a.starts_at, a.ends_at, jst_date(a.starts_at) AS starts_on,
       a.owner_staff_id, s.display_name AS owner_name, a.note
  FROM appointments a
  JOIN appointment_kinds k ON k.id = a.kind_id
  LEFT JOIN staffs s ON s.id = a.owner_staff_id
  LEFT JOIN persons p ON p.id = a.person_id
 WHERE a.cancelled_at IS NULL
   AND (a.person_id IS NULL OR (p.deleted_at IS NULL AND p.anonymized_at IS NULL));

COMMENT ON COLUMN appointments.owner_staff_id IS
  '担当者。受領記録に無い場合はNULL。手入力ではコマンド側が必須にする。';
