### A-5. `is_correction` とチェーンが食い違いうる

原典は「`is_correction = true` なら `corrects_history_id` が必要」の片側しか
縛っていなかった。`corrects_history_id` を持ちながら `is_correction = false`
の行が作れる。有効性判定は `corrects_history_id` しか見ないため、
食い違うとフラグのほうが嘘になる。

**対応**: 逆向きの CHECK を追加し、両者を同値にした。

→ `tests/03_corrections.test.ts`
