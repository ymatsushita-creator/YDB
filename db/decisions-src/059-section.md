### E-3. `status_histories_no_self_correction`

A-3 で「循環検出は副産物として不要になった」と書いておきながら、
自己訂正（`corrects_history_id = id`）だけは CHECK で明示的に潰している。
判断が変わった形跡が記録に残っていなかった。

理由は、追記専用化が防いでいるのは**長さ2以上の循環**だから。
長さ1の自己ループは、`id` を明示した INSERT なら追記だけで作れてしまう。
UPDATE を禁じても塞がらないので、CHECK が要る。

→ `tests/03_corrections.test.ts`「自分自身を訂正する行は作れない」
