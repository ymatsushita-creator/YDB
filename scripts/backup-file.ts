import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { intakeWritePath } from './intake-dir.ts'
import { dump } from '../src/db/backup.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 控えを1つ取って **リポジトリの外**（`<受領ディレクトリ>/db-private/backups/<時刻>/`）に置く。
 *
 * ★ 以前は `db/private/backups/` に置き、`.gitignore` の1行だけが防壁だった。
 *   監査 2026-08-19 の D2-01 で「ignore 単独防壁」を所見とされ、外へ出した。
 *   実在の候補者の氏名と評価が入るので、追跡されうる場所へは絶対に置かない。
 *
 * ★ 取るのは**書き込みの前**である。実行⑬は本番へ適用した**後**に
 *   `pnpm db:backup` を打っており、控えは適用前の姿を持っていなかった（C-121）。
 *   順番を人の記憶に委ねないために、書き込む道具がここを自分で呼ぶ。
 */
export async function saveSnapshot(db: Db, host: string, database: string): Promise<{
  dir: string
  tables: number
  rows: number
}> {
  const snapshot = await dump(db)
  const stamp = snapshot.takenAt.replace(/[:.]/g, '-')
  const dir = intakeWritePath('db-private', 'backups', stamp)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'dump.json'), JSON.stringify(snapshot), 'utf8')

  const counts = snapshot.tables
    .map((t) => ({ table: t.table, rows: t.rows.length }))
    .filter((t) => t.rows > 0)
    .sort((a, b) => b.rows - a.rows)

  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify({
    takenAt: snapshot.takenAt,
    host,
    database,
    tables: snapshot.tables.length,
    rows: counts,
  }, null, 2)}\n`, 'utf8')

  return {
    dir,
    tables: snapshot.tables.length,
    rows: counts.reduce((n, c) => n + c.rows, 0),
  }
}
