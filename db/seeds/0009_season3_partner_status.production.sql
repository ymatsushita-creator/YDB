-- =============================================================
-- 0009 連携団体の状態を、2期から3期へ引き継ぐ
--
-- 依頼者の指摘（実行⑰）――「去年のアプローチが引き継がれてねぇんだよ。
-- 連携団体にパートナーステータスも付与してねぇし」。
--
-- ★★ **これは俺の設計漏れである。** ★★
--   本番の帳簿はこうなっていた ――
--     団体            170件
--     接点（2期）      53件      接点（3期）      0件
--     状態（2期）      23件      状態（3期）      0件
--   0006 で「2期の形を3期へ渡す」と決めたのに、**渡したのは選考の枠だけ**で、
--   団体の状態は渡していなかった。170団体のうち147件は
--   **どの期にも状態が無い** ―― 画面では全部「未アプローチ」に見える。
--
-- ★ 引き継ぎ方は**到達点を出発点にする**。
--   2期に状態がある団体は、その状態のまま3期を始める ――
--   去年アポまで行った相手を、今年また「未連絡」から数え直さない。
--
--   ★ ただし `out_of_scope`（対象外）は**引き継がない。**
--     期をまたげば事情は変わる。去年の「対象外」を今年に持ち越すと、
--     声を掛け直す判断ができなくなる。3期は `not_contacted` から始める。
--
-- ★ 状態がまだ無い団体（147件）にも `not_contacted` を置く。
--   **「無い」と「未連絡」は別物**だが、画面はどちらも「未アプローチ」と
--   出していて、区別が運用の役に立っていない。
--   状態を置くと、そこから先の記録（いつ誰が動かしたか）が積める。
--
-- ★ 追記専用（0016 の作法）。**訂正ではなく最初の記録**として置く。
--   `occurred_at` は3期の募集開始日 ―― 引き継ぎがいつ効いたかを日付で残す。
--
-- ★ 冪等。3期に既に状態がある団体には触らない。
--
-- ★ 接点（`partner_reaches`）は**引き継がない。**
--   接点は「その期に何回どう当たったか」の実績で、
--   引き継ぐと3期に**やっていない接触が53回あることになる**（記録の創作）。
-- =============================================================

INSERT INTO partner_recommendation_events
    (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id, note)
SELECT p.id,
       s3.id,
       -- 2期の到達点。対象外と、記録の無い団体は「未連絡」から。
       coalesce(carry.state_id, base.id),
       s3.outreach_start_date::timestamptz,
       staff.id,
       '2期からの引き継ぎ'
  FROM partners p
  CROSS JOIN (SELECT id, outreach_start_date FROM seasons
               WHERE enrollment_year = 2027 AND NOT is_demo) s3
  CROSS JOIN (SELECT id FROM partner_recommendation_states
               WHERE code = 'not_contacted') base
  -- 記録した人。**引き継ぎも誰かが行ったこととして残す。**
  CROSS JOIN LATERAL (SELECT id FROM staffs ORDER BY created_at LIMIT 1) staff
  -- 2期の到達点（対象外は持ち越さない）。
  LEFT JOIN LATERAL (
        SELECT v.state_id
          FROM v_partner_recommendation_state v
          JOIN seasons s2 ON s2.id = v.season_id
                         AND s2.enrollment_year = 2026 AND NOT s2.is_demo
          JOIN partner_recommendation_states st ON st.id = v.state_id
         WHERE v.partner_id = p.id
           AND st.code <> 'out_of_scope'
       ) carry ON true
 -- 3期に既に状態がある団体には触らない（冪等）。
 WHERE NOT EXISTS (
       SELECT 1 FROM partner_recommendation_events e
        WHERE e.partner_id = p.id AND e.season_id = s3.id);
