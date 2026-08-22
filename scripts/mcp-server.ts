import { createInterface } from 'node:readline'
import { openPostgres } from '../src/db/postgres.ts'
import { openPglite } from '../src/db/pglite.ts'
import { addCandidate, type NewCandidateInput } from '../src/commands/intake.ts'
import { listKpis } from '../src/queries/kpi.ts'
import { defaultSeason, listSeasons } from '../src/queries/dashboard.ts'
import { getIntakeOptions } from '../src/queries/intake.ts'

async function getMcpDb() {
  if (process.env.DATABASE_URL) {
    return openPostgres(process.env.DATABASE_URL)
  }
  return openPglite('.pgdata')
}

/**
 * YouthDB Claude MCP (Model Context Protocol) Server
 *
 * Claude や Claude Desktop からメモ・テキスト・エクセル貼り付けデータを
 * 直接 YouthDB の各テーブル（候補者・接点・面接・KPI）へ取り込むための MCP サーバー。
 */

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, any>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: any
  error?: { code: number; message: string; data?: any }
}

const TOOLS = [
  {
    name: 'youthdb_add_candidate_from_note',
    description: '非構造化メモやテキストから新しい候補者を YouthDB へ登録します。',
    inputSchema: {
      type: 'object',
      properties: {
        familyName: { type: 'string', description: '姓' },
        givenName: { type: 'string', description: '名' },
        familyNameKana: { type: 'string', description: '姓（かな）' },
        givenNameKana: { type: 'string', description: '名（かな）' },
        schoolName: { type: 'string', description: '大学・学校名' },
        faculty: { type: 'string', description: '学部・学科' },
        email: { type: 'string', description: 'メールアドレス' },
        phone: { type: 'string', description: '電話番号' },
        note: { type: 'string', description: '面談メモ・メモ書き本文' },
        channelName: { type: 'string', description: '流入チャネル（イベント/説明会/スカウト等）' },
        staffName: { type: 'string', description: '担当スタッフ名' },
      },
      required: ['familyName', 'givenName'],
    },
  },
  {
    name: 'youthdb_ingest_excel_rows',
    description: 'エクセルやCSVからコピーした複数行データを一括解析して YouthDB へ取り込みます。',
    inputSchema: {
      type: 'object',
      properties: {
        rawText: { type: 'string', description: 'エクセルやCSVからコピーしたタブ区切り/カンマ区切りテキスト' },
        staffName: { type: 'string', description: '担当スタッフ名' },
      },
      required: ['rawText'],
    },
  },
  {
    name: 'youthdb_add_touchpoint',
    description: '候補者の接触・イベント参加・LINE面談などの接点ログを記録します。',
    inputSchema: {
      type: 'object',
      properties: {
        personId: { type: 'string', description: '候補者ID' },
        channelName: { type: 'string', description: '接触チャネル名' },
        contactedOn: { type: 'string', description: '接触日（YYYY-MM-DD）' },
        note: { type: 'string', description: '接触メモ' },
      },
      required: ['personId', 'channelName'],
    },
  },
  {
    name: 'youthdb_search_candidates',
    description: 'YouthDB の候補者（氏名・学校・メモ）を検索します。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード（氏名・学校など）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'youthdb_get_kpis',
    description: 'YouthDB の最新KPIと進捗状況を取得します。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

async function handleToolCall(name: string, args: Record<string, any>) {
  const db = await getMcpDb()
  const seasons = await listSeasons(db)
  const season = defaultSeason(seasons)
  if (!season) throw new Error('期が設定されていません')

  const { schools, channels, staffs } = await getIntakeOptions(db)

  const findSchoolId = (name?: string) => {
    if (!name) return schools[0]?.id ?? ''
    const match = schools.find((s) => s.label.includes(name) || name.includes(s.label))
    return match ? match.id : schools[0]?.id ?? ''
  }

  const findChannelId = (name?: string) => {
    if (!name) return channels[0]?.id ?? ''
    const match = channels.find((c) => c.label.includes(name) || name.includes(c.label))
    return match ? match.id : channels[0]?.id ?? ''
  }

  const findStaffId = (name?: string) => {
    if (!name) return staffs[0]?.id ?? ''
    const match = staffs.find((s) => s.label.includes(name) || name.includes(s.label))
    return match ? match.id : staffs[0]?.id ?? ''
  }

  if (name === 'youthdb_add_candidate_from_note') {
    const input: NewCandidateInput = {
      seasonId: season.id,
      familyName: args.familyName,
      givenName: args.givenName,
      familyNameKana: args.familyNameKana ?? '',
      givenNameKana: args.givenNameKana ?? '',
      birthDate: '',
      schoolId: findSchoolId(args.schoolName),
      faculty: args.faculty ?? '',
      email: args.email ?? '',
      phone: args.phone ?? '',
      lineUserId: '',
      note: args.note ?? '',
      channelId: findChannelId(args.channelName),
      contactedOn: new Date().toISOString().slice(0, 10),
      staffId: findStaffId(args.staffName),
      formResponseId: '',
    }
    const res = await addCandidate(db, input)
    if (!res.ok) return { success: false, reason: res.reason }
    return {
      success: true,
      message: `候補者「${args.familyName} ${args.givenName}」を YouthDB に登録しました。`,
      personId: res.personId,
      candidateNumber: res.number,
    }
  }

  if (name === 'youthdb_ingest_excel_rows') {
    const lines = String(args.rawText).split('\n').filter((l) => l.trim().length > 0)
    const results = []
    for (const line of lines) {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',')
      if (parts.length >= 2) {
        const familyName = parts[0]?.trim() ?? ''
        const givenName = parts[1]?.trim() ?? ''
        const schoolName = parts[2]?.trim() ?? ''
        const email = parts[3]?.trim() ?? ''

        if (familyName && givenName) {
          const input: NewCandidateInput = {
            seasonId: season.id,
            familyName,
            givenName,
            familyNameKana: '',
            givenNameKana: '',
            birthDate: '',
            schoolId: findSchoolId(schoolName),
            faculty: '',
            email,
            phone: '',
            lineUserId: '',
            note: 'エクセル/CSV一括取り込みデータ',
            channelId: findChannelId(),
            contactedOn: new Date().toISOString().slice(0, 10),
            staffId: findStaffId(args.staffName),
            formResponseId: '',
          }
          const res = await addCandidate(db, input)
          results.push({ name: `${familyName} ${givenName}`, res })
        }
      }
    }
    return {
      success: true,
      count: results.length,
      details: results,
    }
  }

  if (name === 'youthdb_add_touchpoint') {
    const channelId = findChannelId(args.channelName)
    const contactedOn = args.contactedOn ?? new Date().toISOString().slice(0, 10)
    const note = args.note ?? ''
    await db.query(
      `INSERT INTO touchpoints (person_id, channel_id, occurred_at, note) VALUES ($1, $2, $3, $4)`,
      [args.personId, channelId, contactedOn, note]
    )
    return { success: true, message: '接触ログ（接点）を記録しました。' }
  }

  if (name === 'youthdb_search_candidates') {
    const q = `%${args.query ?? ''}%`
    const { rows } = await db.query<{ id: string; name: string; school: string; note: string }>(
      `SELECT p.id, (p.family_name || ' ' || p.given_name) AS name, coalesce(sc.name, '') AS school, coalesce(p.note, '') AS note
       FROM persons p
       LEFT JOIN schools sc ON sc.id = p.school_id
       WHERE (p.family_name || p.given_name LIKE $1 OR sc.name LIKE $1 OR p.note LIKE $1) AND p.deleted_at IS NULL
       LIMIT 10`,
      [q]
    )
    return {
      count: rows.length,
      candidates: rows,
    }
  }

  if (name === 'youthdb_get_kpis') {
    const kpis = await listKpis(db, season.id)
    return { season: season.id, kpis }
  }

  throw new Error(`Unknown tool: ${name}`)
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })

  rl.on('line', async (line) => {
    if (!line.trim()) return
    try {
      const req: JsonRpcRequest = JSON.parse(line)

      if (req.method === 'initialize') {
        const resp: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'youthdb-mcp', version: '1.0.0' },
          },
        }
        console.log(JSON.stringify(resp))
        return
      }

      if (req.method === 'tools/list') {
        const resp: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: TOOLS },
        }
        console.log(JSON.stringify(resp))
        return
      }

      if (req.method === 'tools/call') {
        const toolName = req.params?.name
        const toolArgs = req.params?.arguments ?? {}
        const output = await handleToolCall(toolName, toolArgs)

        const resp: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          },
        }
        console.log(JSON.stringify(resp))
        return
      }
    } catch (err: any) {
      console.error('MCP Error:', err)
    }
  })
}

main().catch(console.error)
