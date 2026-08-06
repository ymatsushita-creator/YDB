-- =============================================================
-- 0011 応募の結末を定義し、「いま動いている応募」を切り出す
--
-- 実行③で作った画面2枚を初めて開いて分かった。
-- 9か月前に取り下げられた応募が「選考中」と表示されていた。
--
-- 原因は、応募の結末がどこにも定義されていなかったことである。
-- 画面2枚が、それぞれ次のラダーを自前で書いていた。
--
--   合格 → 辞退 → 不合格 → （どれでもなければ）選考中
--
-- 「どれでもなければ選考中」は、遷移が1行も無い応募をすべて選考中にする。
-- 選考開始前に取り下げられた応募（voided_at あり、遷移なし）がそこに落ちる。
-- counts_as_application = true なので v_countable_applications には残り、
-- 木にも数えられるため、集計側では正しい。壊れているのは結末のほうだった。
--
-- ここで分けるべき軸は2つある。混ぜると、催促しない相手を催促する。
--
--   数えるか     … 応募が起きた事実として木に数えるか（counts_as_application）
--   動いているか … いま誰かが判断すべき状態にあるか
--
-- 選考開始前の取り下げは「数えるが、動いていない」。この組み合わせを
-- 表す述語が無かったので、v_countable_applications が両方の役を
-- 兼ねてしまっていた（判断待ち・保留の問い合わせがそれを使っている）。
--
-- 定義を画面ではなくここに置く理由は C-11 と同じ。画面2枚に同じラダーを
-- 書くと、片方だけ直したときに同じ応募の結末が食い違う。
-- tests/14 がその一致を機械的に固定している。
--
-- v_application_state の上には作れない。あれは v_countable_applications を
-- 母集団にしているため、名寄せ誤りで無効化された応募には行が無い。
-- 合格したあとに事務処理の都合で無効化された応募の結末を引けなくなる。
-- 「起きた事実」は、数えるかどうかとは無関係に残さなければならない（C-12）。
-- =============================================================

CREATE VIEW v_application_outcome AS
SELECT
    a.id AS application_id,
    CASE
        -- 辞退が合格より先に来る。合格したあとに辞退した応募の「結末」は
        -- 辞退である。席は空くので、ファネルの net_accepted_cum も
        -- 同じ扱いをしている。到達した事実のほうは v_application_state
        -- .is_accepted に残っており、こちらが消すわけではない。
        WHEN EXISTS (
            SELECT 1 FROM v_effective_status_histories sh
             WHERE sh.application_id = a.id AND sh.transition_type = 'withdraw'
        ) THEN 'withdrawn'
        WHEN EXISTS (
            SELECT 1
              FROM v_effective_status_histories sh
              JOIN v_final_selection_step fs ON fs.season_id = a.season_id
             WHERE sh.application_id = a.id
               AND sh.transition_type = 'advance'
               AND sh.selection_step_id = fs.selection_step_id
        ) THEN 'accepted'
        WHEN EXISTS (
            SELECT 1 FROM v_effective_status_histories sh
             WHERE sh.application_id = a.id AND sh.transition_type = 'reject'
        ) THEN 'rejected'
        -- 無効化は最後。起きた事実（合格・不合格・辞退）を上書きしない。
        -- 無効化は「その後どう扱うか」の話であって、結末そのものではない。
        WHEN a.voided_at IS NOT NULL THEN 'voided'
        ELSE 'in_selection'
    END AS outcome
  FROM applications a
 WHERE a.deleted_at IS NULL;

COMMENT ON VIEW v_application_outcome IS
    '応募の結末。数えるかどうか（counts_as_application）とは独立に、'
    '起きた事実から決まる。in_selection だけが「いま動いている」。';


-- -------------------------------------------------------------
-- いま動いている応募
-- -------------------------------------------------------------
-- 判断待ち・保留・担当未割当・利益相反は、すべてここを母集団にする。
-- 「数える応募」ではない。数えるかどうかは集計の話で、
-- 誰かに次の一手を促すかどうかとは別である（③と④に効くのはこちら）。
--
-- 個人情報削除（deleted_at）は無条件に外す。集計から外すだけでは
-- 削除の依頼（資料9-2）に応えたことにならない。運用の画面にも
-- 氏名の見える窓を残さない。
CREATE VIEW v_active_applications AS
SELECT a.*
  FROM applications a
  JOIN persons p ON p.id = a.person_id
  JOIN v_application_outcome o ON o.application_id = a.id
 WHERE a.deleted_at IS NULL
   AND p.deleted_at IS NULL
   AND o.outcome = 'in_selection';

COMMENT ON VIEW v_active_applications IS
    'いま選考が動いている応募。判断待ち・保留・担当未割当・利益相反の母集団。'
    '集計の母集団（v_countable_applications）とは別物。';
