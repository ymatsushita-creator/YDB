-- =============================================================
-- 0038 誰が入ったかを記録する（依頼者の許可。実行⑮）
--
-- ここまでの入口は**層ごとの合言葉1つ**だった（実行⑪・C-84）。
-- 層は分かるが、**同じ層の中で誰が入ったかは分からない。**
-- だからメモの「書いた人」も表の「入力者」も**自己申告**である。
-- 引き継ぎに毎回「認証がない」と書かれてきた穴が、これである。
--
-- ★ ここで作るもの／作らないもの
--
--   作る   … 職員ごとの合言葉（PBKDF2 の派生鍵だけを保存）、
--            入った記録（追記専用）
--   作らない … 実在の職員の合言葉そのもの。**こちらでは1つも設定しない。**
--            設定する道具（`pnpm staff:passphrase`）だけを置く
--
-- ★ **平文も、元へ戻せる形も保存しない。** 保存するのは
--   塩・反復回数・派生鍵の3つで、合言葉は復元できない。
--   合言葉を忘れたら**入れ替える**（思い出す道は無い）。
--
-- ★ 層は**この表が持つ**（職員ごと）。環境変数の共有合言葉も残す ――
--   移行の途中で全員を締め出さないため。ただし共有で入った場合は
--   **`staff_id` が NULL の記録**として残る（＝誰か分からないと明示する）。
--   「分からない」を空欄で濁さず、記録の形で言う。
--
-- ★ 反復回数を列に持つのは、あとで上げられるようにするためである。
--   固定して埋め込むと、上げた瞬間に既存の全員が入れなくなる。
-- =============================================================

CREATE TABLE staff_credentials (
    staff_id    uuid PRIMARY KEY REFERENCES staffs(id),
    -- その職員が入れる層。強い層を配るのは運営の判断で、こちらは決めない。
    tier        text        NOT NULL,
    salt        text        NOT NULL,
    iterations  integer     NOT NULL,
    -- PBKDF2-SHA256 の派生鍵（base64url）。**合言葉そのものではない。**
    hash        text        NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT staff_credentials_tier_chk
        CHECK (tier IN ('all', 'personal', 'input')),
    -- ★ 弱い設定を記録層で拒む。回数はあとで上げられるが、下げられない。
    CONSTRAINT staff_credentials_iterations_chk CHECK (iterations >= 100000),
    CONSTRAINT staff_credentials_salt_len_chk CHECK (length(salt) >= 16),
    CONSTRAINT staff_credentials_hash_len_chk CHECK (length(hash) >= 32)
);

COMMENT ON TABLE staff_credentials IS
    '職員ごとの合言葉（0038）。派生鍵だけを保存する。平文は持たない。';


-- 入った記録。**追記専用**（消さない・直さない）。
-- 誰が入ったかは、あとから読むためにあるので、書き換えられたら意味が無い。
CREATE TABLE sign_in_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = 共有の合言葉で入った（**誰か分からない**）。
    staff_id    uuid        REFERENCES staffs(id),
    tier        text        NOT NULL,
    method      text        NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sign_in_events_tier_chk
        CHECK (tier IN ('all', 'personal', 'input')),
    CONSTRAINT sign_in_events_method_chk CHECK (method IN ('staff', 'shared')),
    -- ★ 名乗りと記録を食い違わせない ―― 職員として入ったなら職員が居る、
    --   共有で入ったなら居ない。片方だけを直せる形にしない。
    CONSTRAINT sign_in_events_pair_chk
        CHECK ((method = 'staff') = (staff_id IS NOT NULL))
);

CREATE INDEX sign_in_events_staff_idx ON sign_in_events (staff_id, occurred_at DESC);
CREATE INDEX sign_in_events_time_idx ON sign_in_events (occurred_at DESC);

COMMENT ON TABLE sign_in_events IS
    '入った記録（0038）。追記専用。staff_id が NULL なら共有の合言葉で入った。';

CREATE TRIGGER sign_in_events_append_only
    BEFORE UPDATE OR DELETE ON sign_in_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();


-- 職員ごとの最後の入場。運営が「誰が使っているか」を見るための導出値。
CREATE VIEW v_staff_last_sign_in AS
SELECT s.id                        AS staff_id,
       s.display_name,
       max(e.occurred_at)          AS last_sign_in_at,
       count(e.id)                 AS sign_in_count,
       (c.staff_id IS NOT NULL)    AS has_passphrase,
       c.tier                      AS tier
  FROM staffs s
  LEFT JOIN sign_in_events e ON e.staff_id = s.id
  LEFT JOIN staff_credentials c ON c.staff_id = s.id
 GROUP BY s.id, s.display_name, c.staff_id, c.tier;

COMMENT ON VIEW v_staff_last_sign_in IS
    '職員ごとの最後の入場と回数（0038）。合言葉を持っているかも出す。';
