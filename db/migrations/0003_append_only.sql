-- =============================================================
-- 0003 追記専用テーブルの強制
--
-- 原則5「訂正は打ち消しの追記で表現し、元の記録は残す」を、
-- 運用の心がけではなくデータベースの制約にする。
--
-- 発見の経緯: tests/03_corrections.test.ts
--   訂正チェーンに循環（h1 が h2 を訂正し、h2 が h1 を訂正する）を作ると、
--   どちらの行も「誰にも訂正されていない行」にならないため
--   v_effective_status_histories の再帰の基底に現れず、
--   チェーンごと有効判定から静かに脱落する。
--   エラーで落ちるのではなく、集計から黙って消える壊れ方をする。
--
-- 循環を検出するトリガを書くこともできたが、より根本的な性質に気づいた。
-- corrects_history_id は既存の行しか指せない。つまり INSERT だけで
-- 構成されるグラフの辺は必ず過去方向を向き、循環はそもそも作れない。
-- 循環が生まれるのは UPDATE で後から辺を張り替えたときだけである。
--
-- したがって UPDATE と DELETE を禁じれば、循環検出は要らなくなる。
-- 個別の異常を潰すより、異常が生まれる余地のほうを閉じる。
-- =============================================================

CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        '% is append-only; % is not allowed. Record a new row instead.',
        TG_TABLE_NAME, TG_OP
        USING HINT = '訂正は打ち消し行の追記で表現する（設計原則5）。';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reject_mutation() IS
    '追記専用テーブルの UPDATE / DELETE を拒否する。';


-- 状態遷移ログ。訂正は打ち消し行の追記でのみ表現する（原則5）。
-- これにより訂正チェーンの循環も構造的に不可能になる。
CREATE TRIGGER status_histories_append_only
    BEFORE UPDATE OR DELETE ON status_histories
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Season の日付変更履歴。履歴そのものを書き換えられたら履歴ではない（原則4）。
CREATE TRIGGER season_revisions_append_only
    BEFORE UPDATE OR DELETE ON season_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- スコアの凍結結果。再現不能だから物理保存している（原則2）。
-- 書き換え可能なら凍結する意味がない。
CREATE TRIGGER score_snapshots_append_only
    BEFORE UPDATE OR DELETE ON score_snapshots
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 内訳。親が消えるときの ON DELETE CASCADE だけは通す必要があるため
-- DELETE は許し、UPDATE のみ禁じる。
-- ただし親の score_snapshots が DELETE 不可なので、実際には消えない。
CREATE TRIGGER score_snapshot_details_no_update
    BEFORE UPDATE ON score_snapshot_details
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 同一性判定の履歴。却下も残すのが目的なので、消せてはいけない。
-- 判断が変わったときは decision を書き換えるのではなく、
-- 新しい判断として別の行を追記する運用にする……が、
-- UNIQUE (person_id, candidate_person_id) がそれを許さない。
--
-- ここは追記専用にしない。同じ組に対する判断は1つであるべきで、
-- 覆るときは上書きが正しい。ただし覆った事実は残らないため、
-- 監査が必要になった時点で decided_at を含む履歴テーブルに切り出す。
-- いま切り出さないのは、実装段階[4]まで使われないテーブルだから。
