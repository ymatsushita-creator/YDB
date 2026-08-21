import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Db } from './client.ts'

// new URL(..., import.meta.url) は Turbopack がモジュール参照として
// 静的解決しようとして失敗する（src/db/server.ts の DATA_DIR と同じ罠）。
// 実行時のパスとして組み立てる。cwd はリポジトリのルートを前提にする ――
// テストも scripts/ も Next のサーバも、すべてそこから動く。
const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')
const SEEDS_DIR = join(process.cwd(), 'db', 'seeds')

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

/** dir はテスト専用。壊れたマイグレーションに対する挙動を実際に確かめるため。 */
export const loadMigrations = (dir = MIGRATIONS_DIR) => loadSqlDir(dir)

/**
 * 参照データを読む。
 *
 * 種類が3つある。**混ぜてよい組み合わせは決まっている。**
 *
 *   0001_reference.sql              どちらの環境にも入る（辞退理由など）
 *   *.example.sql                   サンプルの環境にだけ入る
 *   *.production.sql                本番の環境にだけ入る
 *
 * `*.example.sql` は作り物のサンプルで、本番には入れない。
 * 集計に関わるマスタは追加と非活性化でしか運用できない（原則3）ため、
 * 最初に入った値が事実上の初期値として固定化される。
 * サンプルと本番が同じ入口から入る構造になっていると、
 * 誰かが一度流した時点で創作物が正式なマスタになる。
 *
 * `*.production.sql` は逆向きの禁止である ―― **実在する年度が入る。**
 * src/seed/demo.ts は 2024〜2027 を創作しており 2026 が重なる。
 * 同じ DB に入れれば UNIQUE で衝突し、衝突を避ければ創作の応募が
 * 実在の年度にぶら下がる。**後者のほうが悪い**（C-28）。
 * したがってサンプルを入れると言った環境には、実年度を入れない。
 */
export async function loadSeeds(opts: { includeExamples?: boolean } = {}) {
  const all = await loadSqlDir(SEEDS_DIR)
  const excluded = opts.includeExamples ? '.production.sql' : '.example.sql'
  return all.filter((s) => !s.name.endsWith(excluded))
}

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
 *
 * 適用と記録は同一トランザクションで行う。別々にすると、SQL は通ったが
 * 記録する前にプロセスが落ちた場合に、スキーマは変わっているのに
 * schema_migrations には無いという状態ができる。次回の migrate() は
 * その同じファイルをもう一度流そうとして「already exists」で止まり、
 * 手で schema_migrations を埋めるまで動かなくなる。
 * 事実と記録が食い違う状態を作らないのは、このプロジェクトが
 * 記録層に対して一貫して求めてきたことでもある。
 */

/** SQL 文字列リテラルとして安全に埋め込む。 */
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`

export interface LedgerTail {
  name: string
  /** JST の 'YYYY-MM-DD HH24:MI:SS'。 */
  at: string
  /** 適用した接続の名乗り。空文字は「名乗っていない」。 */
  by: string
}

/**
 * 帳簿の末尾を1件返す。行が無い（または帳簿そのものが無い）ときは null。
 *
 * ★ **列がまだ無い DB でも読めること**が要件である。適用前の状態を読む
 *   場面では applied_by がまだ足されていない（足すのは migrate() の中）。
 *   素直に `SELECT applied_by` と書くと「列が無い」で落ち、呼び出し側は
 *   それを「帳簿が無い」と読み違える ―― 実行⑭で実際に出力を1回間違えた。
 *   `to_jsonb(m)->>'applied_by'` は列が無ければ NULL を返す。
 *
 * ★ 行数を数えて段数を推測しない（C-121）。**末尾の名前をそのまま返す。**
 */
export async function ledgerTail(db: Db): Promise<LedgerTail | null> {
  try {
    const { rows } = await db.query<{ name: string; at: string; by: string | null }>(`
      SELECT m.name,
             to_char(m.applied_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS') AS at,
             to_jsonb(m)->>'applied_by' AS by
        FROM schema_migrations m ORDER BY m.name DESC LIMIT 1`)
    const r = rows[0]
    if (r === undefined) return null
    return { name: r.name, at: r.at, by: r.by ?? '' }
  } catch {
    return null
  }
}

export async function migrate(
  db: Db,
  opts: { verbose?: boolean; migrationsDir?: string; actor?: string } = {},
): Promise<string[]> {
  // applied_by は「この接続が名乗った名前」（application_name）である。
  // ★ 帳簿そのものはマイグレーション番号で育てられない ―― 新しい DB では
  //   帳簿を作ってから 0001 を流すので、番号で足すと列が無いまま INSERT が走る。
  //   したがって足すのは起動処理のここで、既存の DB には ALTER で追いつかせる。
  // ★ NOT NULL DEFAULT '' にしてある。名乗りは接続側の善意であって
  //   記録層の必須条件ではない（名乗らない経路を止めない）。
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        applied_by  text        NOT NULL DEFAULT ''
    );
    ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS applied_by text NOT NULL DEFAULT '';
  `)

  const applied = new Map<string, string>()
  const { rows } = await db.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM schema_migrations`,
  )
  for (const r of rows) applied.set(r.name, r.checksum)

  const migrations = await loadMigrations(opts.migrationsDir)
  const known = new Set(migrations.map((m) => m.name))

  // 適用済みなのにファイルが無い。誤って消したか、別のブランチを見ている。
  // 素通りさせると、そのマイグレーションが入っている前提で以降が進む。
  const missing = [...applied.keys()].filter((n) => !known.has(n)).sort()
  if (missing.length > 0) {
    throw new Error(
      `applied migration(s) missing from db/migrations/: ${missing.join(', ')}. ` +
        `The database has changes this checkout does not describe.`,
    )
  }

  const lastApplied = [...applied.keys()].sort().at(-1)
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

    // 適用済みより前に並ぶ新しいファイル。番号を採り違えている。
    // 順序が入れ替わると、手元と本番でスキーマの作られ方が変わる。
    if (lastApplied !== undefined && m.name < lastApplied) {
      throw new Error(
        `migration ${m.name} sorts before the last applied migration (${lastApplied}). ` +
          `Renumber it so migrations always move forward.`,
      )
    }

    try {
      // 1回の exec にまとめてサーバへ渡す。途中で失敗すれば COMMIT に
      // 到達せず、スキーマの変更も記録も両方が巻き戻る。
      //
      // PostgreSQL は複数文を1回で受け取ると暗黙のトランザクションで包むが、
      // それに頼らず BEGIN / COMMIT を明示する。ドライバが文を分割して
      // 送る実装に替わったときに、原子性だけが静かに失われるのを避けたい。
      // ★ 名乗りは**呼び出し側から渡す**（C-145）。接続の `application_name` に
      //   頼っていたが、**本番のプーラ（Supavisor）が上書きしていた** ――
      //   道具の名前が残らず、記録は「Supavisor」だけを覚えていた。
      //   経路の途中にあるものが書き換えられる値を、記録の当てにしない。
      const by = opts.actor ?? ''
      await db.exec(
        `BEGIN;\n${m.sql}\n;\nINSERT INTO schema_migrations (name, checksum, applied_by) ` +
          `VALUES (${quote(m.name)}, ${quote(m.checksum)}, ` +
          `coalesce(nullif(${quote(by)}, ''), ` +
          `current_setting('application_name', true), ''));\nCOMMIT;`,
      )
    } catch (e) {
      // 明示 BEGIN の中で失敗すると、トランザクションは**中断状態のまま開いている**。
      // COMMIT にも ROLLBACK にも到達していないので、同じコネクションでの
      // 以降のクエリはすべて "current transaction is aborted" で弾かれる。
      // ここで畳んでおかないと、呼び出し側は本当の失敗理由を見失う。
      await db.exec('ROLLBACK').catch(() => {})
      throw new Error(`migration ${m.name} failed: ${(e as Error).message}`, { cause: e })
    }

    run.push(m.name)
    if (opts.verbose) console.log(`  applied ${m.name}`)
  }

  return run
}

/**
 * 参照データの投入。マイグレーションとは分ける（何度でも流し直せる想定）。
 * includeExamples はデモ環境専用。本番では絶対に立てない。
 */
export async function seed(
  db: Db,
  opts: { verbose?: boolean; includeExamples?: boolean } = {},
): Promise<string[]> {
  const seeds = await loadSeeds({ includeExamples: opts.includeExamples })
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
