import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Db } from './client.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url))
const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds/', import.meta.url))

export interface Migration {
  name: string
  sql: string
  checksum: string
}

async function loadSqlDir(dir: string): Promise<Migration[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const files = names.filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) }
    }),
  )
}

export const loadMigrations = () => loadSqlDir(MIGRATIONS_DIR)
export const loadSeeds = () => loadSqlDir(SEEDS_DIR)

/**
 * マイグレーションを順に適用する。
 *
 * SQL はクライアント側で文に分割せず、ファイル全体をそのままサーバへ渡す。
 * ドル引用符で囲まれた関数本体にはセミコロンが含まれるため、
 * 素朴なセミコロン分割は関数定義を途中で断ち切る。分割はサーバの仕事。
 *
 * 適用済みマイグレーションのチェックサムが変わっていたら止める。
 * 適用済みの定義を書き換えると、環境ごとにスキーマが分岐して
 * 「手元では通るのに本番で落ちる」が起きる。
 */
export async function migrate(db: Db, opts: { verbose?: boolean } = {}): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `)

  const applied = new Map<string, string>()
  const { rows } = await db.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM schema_migrations`,
  )
  for (const r of rows) applied.set(r.name, r.checksum)

  const migrations = await loadMigrations()
  const run: string[] = []

  for (const m of migrations) {
    const prior = applied.get(m.name)
    if (prior !== undefined) {
      if (prior !== m.checksum) {
        throw new Error(
          `migration ${m.name} was modified after it was applied ` +
            `(${prior} -> ${m.checksum}). Add a new migration instead of editing this one.`,
        )
      }
      continue
    }
    try {
      await db.exec(m.sql)
    } catch (e) {
      throw new Error(`migration ${m.name} failed: ${(e as Error).message}`, { cause: e })
    }
    await db.query(`INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)`, [
      m.name,
      m.checksum,
    ])
    run.push(m.name)
    if (opts.verbose) console.log(`  applied ${m.name}`)
  }

  return run
}

/** 参照データの投入。マイグレーションとは分ける（何度でも流し直せる想定）。 */
export async function seed(db: Db, opts: { verbose?: boolean } = {}): Promise<string[]> {
  const seeds = await loadSeeds()
  for (const s of seeds) {
    try {
      await db.exec(s.sql)
    } catch (e) {
      throw new Error(`seed ${s.name} failed: ${(e as Error).message}`, { cause: e })
    }
    if (opts.verbose) console.log(`  seeded ${s.name}`)
  }
  return seeds.map((s) => s.name)
}
