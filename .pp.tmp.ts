import { join } from 'node:path'
import { Workbook } from './src/import/xlsx.ts'
const book = new Workbook(join(process.cwd(), '2期応募管理.xlsx'))
const rows = book.rows('011_提携団体(学校ゼミ)リスト')
const head = 3
const body = rows.slice(head + 1).filter((r) => (r[2] ?? '').trim())
console.log(`団体名称がある行: ${body.length}`)
const col = (i: number) => body.filter((r) => (r[i] ?? '').trim()).length
console.log(`  ステイタス ${col(0)} / 担当者 ${col(3)} / 部署 ${col(4)} / 社内担当 ${col(5)}`)
console.log(`  提携期日 ${col(6)} / 推薦可能人数 ${col(7)} / 連絡先 ${col(9)} / 連携方法 ${col(10)}`)
console.log(`  所在地 ${col(15)} / SNS ${col(17)} / 関連URL ${col(18)}`)
const statuses = new Map<string, number>()
for (const r of body) { const v=(r[0]??'').trim()||'(空)'; statuses.set(v,(statuses.get(v)??0)+1) }
console.log('ステイタスの値:', [...statuses].map(([k,v])=>`${k}=${v}`).join(' / '))
