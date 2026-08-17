-- 書類選考は10点満点。論理力4点、残り3軸を各2点にする。
UPDATE evaluation_criteria c
   SET scale_max = CASE c.name
     WHEN '論理力' THEN 4
     WHEN 'NEOとの親和性' THEN 2
     WHEN 'やり遂げた実績' THEN 2
     WHEN 'コミットする意志' THEN 2
   END
  FROM selection_steps s
 WHERE s.id = c.selection_step_id
   AND s.name = '書類選考'
   AND c.name IN ('論理力', 'NEOとの親和性', 'やり遂げた実績', 'コミットする意志');
