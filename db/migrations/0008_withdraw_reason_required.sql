-- =============================================================
-- 0008 辞退理由を必須にする
--
-- 原典は withdraw_reason_id を NULL 可のままにし、
-- 「理由が付くのは withdraw のときだけ」という片側だけを縛っていた。
--   CONSTRAINT status_histories_withdraw_reason
--       CHECK (withdraw_reason_id IS NULL OR transition_type = 'withdraw')
--
-- しかし原典のコメントは辞退理由について
--   「自由入力にすると集計が死ぬため選択式」
--   「辞退理由の分布はチャネルの質を表すため(4)で参照する」
-- と述べている。分布を指標として読むなら、母数から静かに抜ける行が
-- あってはならない。NULL を許すと
--
--   ・まだ理由を聞けていない
--   ・聞いたが本人が答えなかった
--   ・記録し忘れた
--
-- がすべて同じ「NULL」になり、分布の合計が辞退件数に届かない理由を
-- 誰も説明できなくなる。
--
-- 理由不明は「理由が無い」ではなく「未確認という事実がある」と捉える。
-- 原則7「事実の有無で判定し、理由で分岐しない」を、記録の側にも通す。
-- 受け皿として withdraw_reasons に 'unconfirmed'（未確認）を置き、
-- 本番の参照データにも入れてある（db/seeds/0001_reference.sql）。
--
-- 「未確認」が分布のどれだけを占めるかは、そのまま運用の質を表す。
-- 見えるところに出しておくほうが、NULL で隠れているより良い。
-- =============================================================

ALTER TABLE status_histories
    ADD CONSTRAINT status_histories_withdraw_reason_required
    CHECK (transition_type <> 'withdraw' OR withdraw_reason_id IS NOT NULL);

COMMENT ON CONSTRAINT status_histories_withdraw_reason_required ON status_histories IS
    '辞退には必ず理由を付ける。不明なときは withdraw_reasons の unconfirmed を使う。';
