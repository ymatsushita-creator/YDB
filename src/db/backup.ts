import type { Db } from './client.ts'

/**
 * 取って、戻す。
 *
 * Pilot の成功条件は「**障害や誤操作が起きてもデータを復旧できること**」
 * （`docs/pilot/DEPLOY-READINESS.md` の B-4）。
 * 取るだけでは満たさない ―― **戻せることを確かめた記録**までが要件である。
 *
 * ★ `pg_dump` を使わない。手元に入っていなかった（`pg_dump not found`）ので、
 *   要る道具が増えると「取り忘れ」の理由が1つ増える。
 *   `Db` は query/exec/close の3つしか無いので、**同じ口で PGlite にも繋がる。**
 *   おかげで**往復をテストで確かめられる**（本番を触らずに）。
 *
 * ★ 保存先は `db/private/`（gitignore 済み）。**両リモートは公開である。**
 */

export interface TableDump {
  table: string
  /** 列の並び。**戻すときもこの順で入れる。** */
  columns: string[]
  /** 列の型（`information_schema.columns.udt_name`）。戻すときの変換に使う。 */
  types: string[]
  rows: unknown[][]
}

export interface Dump {
  /** いつ取ったか。ISO 8601。 */
  takenAt: string
  /**
   * 表の並び。**参照される側が先**（外部キーの向きに沿う）。
   * 戻すときはこの順に入れれば、参照先が居ないという失敗が起きない。
   */
  tables: TableDump[]
}

/**
 * 表の並びを、外部キーの向きから決める。
 *
 * ★ 自己参照（訂正チェーンの `corrects_*_id` など）は**辺として数えない。**
 *   数えると自分より先に自分を入れることになり、並びが決まらなくなる。
 *   同じ表の中の前後は、行の並び（取った順）がそのまま効く。
 */
export async function tableOrder(db: Db): Promise<string[]> {
  const { rows: tables } = await db.query<{ name: string }>(`
    SELECT table_name AS name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `)
  const names = tables.map((t) => t.name)

  const { rows: edges } = await db.query<{ child: string, parent: string }>(`
    SELECT c.conrelid::regclass::text  AS child,
           c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND c.conrelid <> c.confrelid
  `)

  // 親（参照される側）を先に出す深さ優先。既に出したものは飛ばす。
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    // regclass の text は引用符が付くことがある（大文字や予約語の表名）。
    const child = e.child.replace(/^"|"$/g, '')
    const parent = e.parent.replace(/^"|"$/g, '')
    if (!names.includes(child) || !names.includes(parent)) continue
    parents.set(child, [...(parents.get(child) ?? []), parent])
  }

  const ordered: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (name: string): void => {
    if (state.get(name) === 'done') return
    // 表をまたぐ循環参照があっても止まらない。並びは決められないので、
    // **見つけた順で置く**（そこは戻すときに気づく。黙って落とさない）。
    if (state.get(name) === 'visiting') return
    state.set(name, 'visiting')
    for (const p of parents.get(name) ?? []) visit(p)
    state.set(name, 'done')
    ordered.push(name)
  }
  for (const n of names) visit(n)
  return ordered
}

const columnsOf = async (db: Db, table: string) => {
  const { rows } = await db.query<{ name: string, udt: string }>(`
    SELECT column_name AS name, udt_name AS udt
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position
  `, [table])
  return rows
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`

/** 表1つを取る。列を明示するので、戻すときに並びがずれない。 */
export async function dumpTable(db: Db, table: string): Promise<TableDump> {
  const cols = await columnsOf(db, table)
  const list = cols.map((c) => quote(c.name)).join(', ')
  // 並びを決めておく。取り直したときに差分が読めるようにするため。
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${list} FROM ${quote(table)}`,
  )
  return {
    table,
    columns: cols.map((c) => c.name),
    types: cols.map((c) => c.udt),
    rows: rows.map((r) => cols.map((c) => normalize(r[c.name]))),
  }
}

/**
 * JSON に載る形へ落とす。
 *
 * ★ 日付は ISO 文字列にする。`Date` を JSON に通すと同じ形になるが、
 *   **通す前と後で型が変わる**ので、ここで1回だけ決めておく。
 */
const normalize = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) throw new Error('bytea は未対応（いまの記録層に無い）')
  return v
}

export async function dump(db: Db): Promise<Dump> {
  const order = await tableOrder(db)
  const tables: TableDump[] = []
  for (const t of order) tables.push(await dumpTable(db, t))
  return { takenAt: new Date().toISOString(), tables }
}

/**
 * 戻す。
 *
 * ★ **全部消してから全部入れる。** 表ごとに消すと、外部キーの向きに縛られて
 *   順番の失敗が起きる。`TRUNCATE a, b, c` は1文で済むので縛りが消える。
 *   追記専用の表（0003）の行トリガは UPDATE / DELETE を拒むが、
 *   **TRUNCATE は行トリガを通らない**ので拒まれない。
 *
 * ★ 1つのトランザクションで行う。途中で落ちたら**取る前の状態に戻る** ――
 *   「消えたが戻っていない」という最悪の中間状態を作らない。
 */
export async function restore(db: Db, snapshot: Dump): Promise<{ table: string, rows: number }[]> {
  const names = snapshot.tables.map((t) => quote(t.table)).join(', ')
  const written: { table: string, rows: number }[] = []

  await db.exec('BEGIN')
  try {
    if (names) await db.exec(`TRUNCATE ${names} CASCADE`)
    for (const t of snapshot.tables) {
      if (t.rows.length === 0) { written.push({ table: t.table, rows: 0 }); continue }
      const cols = t.columns.map(quote).join(', ')
      // 1文に載せるパラメータを区切る。多すぎると PostgreSQL が受け取らない。
      const perRow = t.columns.length
      const chunk = Math.max(1, Math.floor(20_000 / perRow))
      for (let i = 0; i < t.rows.length; i += chunk) {
        const slice = t.rows.slice(i, i + chunk)
        const params: unknown[] = []
        const values = slice.map((row) => {
          const marks = row.map((v, j) => {
            params.push(toParam(v, t.types[j] ?? 'text'))
            return `$${params.length}`
          })
          return `(${marks.join(', ')})`
        })
        await db.query(
          `INSERT INTO ${quote(t.table)} (${cols}) VALUES ${values.join(', ')}`,
          params,
        )
      }
      written.push({ table: t.table, rows: t.rows.length })
    }
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
  return written
}

/**
 * 取ったときの形から、入れられる形へ戻す。
 *
 * ★ `jsonb` は**文字列にして渡す。** オブジェクトのまま渡すと
 *   ドライバが「その型の値」として扱わず、`invalid input syntax` になる。
 */
const toParam = (v: unknown, udt: string): unknown => {
  if (v === null || v === undefined) return null
  if ((udt === 'json' || udt === 'jsonb') && typeof v !== 'string') return JSON.stringify(v)
  return v
}

/**
 * 戻ったかを、件数で突き合わせる。
 *
 * ★ 件数だけを見る。**中身の照合はここでは名乗らない** ――
 *   「確かめた」と言える範囲を、確かめた範囲より広げない。
 */
export async function verify(db: Db, snapshot: Dump): Promise<{ table: string, expected: number, actual: number }[]> {
  const out: { table: string, expected: number, actual: number }[] = []
  for (const t of snapshot.tables) {
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${quote(t.table)}`)
    out.push({ table: t.table, expected: t.rows.length, actual: Number(rows[0]?.n ?? -1) })
  }
  return out
}
