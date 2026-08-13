import { openPostgres } from '../src/db/postgres.ts'
import { openPglite } from '../src/db/pglite.ts'
import { all } from '../src/db/client.ts'
import { setStaffPassphrase } from '../src/commands/staff_auth.ts'
import { PASSPHRASE_MIN_LENGTH } from '../src/auth/credential.ts'

/**
 * 職員の合言葉を設定する（0038。依頼者の許可。実行⑮）。
 *
 *   pnpm staff:list                                    誰が合言葉を持っているかを見る
 *   YOUTHDB_NEW_PASSPHRASE=… pnpm staff:passphrase <職員id> <層>
 *
 * ★★ **合言葉は引数で渡さない。** 引数はシェルの履歴と `ps` に残る。
 *   環境変数で渡し、**画面にも記録にも出さない。**
 *
 * ★ 既定は手元（`.pgdata`）。本番へ設定するときは `--remote` を明示する
 *   ―― 架空データを入れる道具と同じ規律（C-88）。**既定で本番を向かせない。**
 *
 * ★ **平文は保存されない。** 記録に入るのは塩・反復回数・派生鍵だけで、
 *   思い出す道は無い。忘れたらこの道具で入れ替える。
 *
 * ★ 層（all / personal / input）を配るのは運営の判断である。こちらは決めない。
 */

const remote = process.argv.includes('--remote')
const args = process.argv.slice(2).filter((a) => a !== '--remote')
const listOnly = args[0] === '--list'

const url = remote ? process.env.DATABASE_URL : undefined
if (remote && !url) {
  console.error('--remote を指定したが DATABASE_URL が無い。接続先が決まらない。')
  process.exit(1)
}

const db = url
  ? await openPostgres(url)
  : await openPglite(new URL('../.pgdata/', import.meta.url).pathname)

console.log(url ? '★ DATABASE_URL の接続先（本番かもしれない）' : '手元の .pgdata')

if (listOnly) {
  const rows = await all<Record<string, unknown>>(db, `
    SELECT display_name, has_passphrase, tier,
           to_char(last_sign_in_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS last_at,
           sign_in_count
      FROM v_staff_last_sign_in ORDER BY display_name`)
  console.log(`職員 ${rows.length}`)
  for (const r of rows) {
    console.log(`  ${String(r.display_name).padEnd(16)} ` +
      `合言葉 ${r.has_passphrase ? `あり(${String(r.tier)})` : 'なし'} ・ ` +
      `入場 ${r.sign_in_count} 回 ・ 最後 ${r.last_at ?? '—'}`)
  }
  await db.close()
  process.exit(0)
}

const staffId = args[0] ?? ''
const tier = args[1] ?? ''
const passphrase = process.env.YOUTHDB_NEW_PASSPHRASE ?? ''

if (!staffId || !tier) {
  console.error('使い方: YOUTHDB_NEW_PASSPHRASE=… pnpm staff:passphrase <職員id> <all|personal|input> [--remote]')
  console.error('        pnpm staff:passphrase --list [--remote]')
  await db.close()
  process.exit(1)
}
if (!passphrase) {
  console.error('YOUTHDB_NEW_PASSPHRASE が空。**引数では渡さない**（履歴と ps に残る）。')
  await db.close()
  process.exit(1)
}

const result = await setStaffPassphrase(db, { staffId, passphrase, tier })
await db.close()

if (!result.ok) {
  // ★ 理由は**設定する人にだけ**返す（入口では分けない）。合言葉自体は出さない。
  const why = {
    blank: '合言葉が空である',
    too_short: `合言葉が短い（${PASSPHRASE_MIN_LENGTH}文字以上）`,
    bad_tier: '層は all / personal / input のどれか',
    staff_not_found: 'その職員が居ない（または停止している）',
  }[result.reason]
  console.error(`設定しなかった ―― ${why}`)
  process.exit(1)
}

console.log(result.created ? '設定した（新規）' : '入れ替えた')
console.log('★ 平文は保存していない。忘れたらこの道具で入れ替える。')
