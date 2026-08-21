-- =============================================================
-- 0049 KPIの「変数」を、記録に繋がるものにする
--
-- 依頼者の指摘（実行⑰）――「変数ってお前何のことか理解してんの？
--   それを選択したら、グラフにも反映されるんだぞ？」。
--
-- ★★ **これまでの `variable` はただの文字列だった。** ★★
--   入力者が「応募数」と打っても、システムはその語がどの記録を指すか
--   知らない。だからグラフは**打ち込んだ数を並べていただけ**で、
--   変数を選んでも記録は動かなかった。指摘のとおりである。
--
-- ★ 直し方は、**選べる変数を、数えられるものに限る**こと。
--   `metric_key` は下のマスタにある語だけを受ける。
--   語ごとの数え方は `src/queries/kpi_metrics.ts` に1箇所だけ置く
--   ―― 数え方が2箇所にあると、画面と集計で違う数が出る。
--
-- ★ 既存の `variable`（自由記述）は**残す。**
--   打ち込んだ語を消さない。`metric_key` が空のKPIは
--   「目標だけあって実績を数えられないKPI」として、そのまま扱える。
-- =============================================================

CREATE TABLE kpi_metrics (
    key         text PRIMARY KEY,
    label       text        NOT NULL,
    -- 何を数えるかの説明。画面の選択肢にそのまま出す。
    definition  text        NOT NULL,
    -- 単位（人・件）。**割り算のときに単位が違うものを混ぜないため**に持つ。
    unit        text        NOT NULL,
    sort_order  integer     NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    CONSTRAINT kpi_metrics_sort_key UNIQUE (sort_order),
    CONSTRAINT kpi_metrics_label_not_blank CHECK (btrim(label) <> '')
);

COMMENT ON TABLE kpi_metrics IS
    'KPIの変数。ここにある語だけが、記録から数えられる（C-199）。';

INSERT INTO kpi_metrics (key, label, definition, unit, sort_order) VALUES
  ('candidates',  '候補者数',     'その期に記録された候補者の人数。削除済みは除く。', '人', 1),
  ('applicants',  '応募数',       'その期に応募した人数。取り消した応募は除く。',     '人', 2),
  ('accepted',    '合格者数',     'その期の最終合格者の人数。',                       '人', 3),
  ('touchpoints', '接点数',       'その期に記録された接点の件数。',                   '件', 4),
  ('partners',    '連携団体数',   '登録されている団体の数（期をまたぐ）。',           '件', 5),
  ('special',     '特別選考の人数', 'その期の特別選考リストに載っている人数。',        '人', 6);

-- 改訂ごとに持つ。**変数を変えた履歴も残る**（0047 と同じ作法）。
ALTER TABLE kpi_revisions
    ADD COLUMN metric_key text REFERENCES kpi_metrics(key);

COMMENT ON COLUMN kpi_revisions.metric_key IS
    '数えられる変数。空なら実績を数えない（目標だけのKPI）。C-199。';
