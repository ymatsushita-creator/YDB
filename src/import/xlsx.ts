import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/**
 * `.xlsx` を読む最小の道具（実行⑫。依頼者から実データの表を受領）。
 *
 * ★ **依存を増やしていない。** xlsx は ZIP に XML を詰めたものなので、
 *   ZIP の索引を読んで `zlib.inflateRawSync` で開き、必要な XML だけを拾う。
 *   表計算のライブラリを入れると、この製品の依存が1つ増えて、
 *   **取り込みのためだけに本番の依存が太る。**
 *
 * ★ 読むだけである。書き込みも書式も扱わない。
 *
 * ★ 値は**文字列のまま**返す。日付の連番も数値も、解釈は呼ぶ側に置く ――
 *   ここで日付に直すと、表計算の基準日（1900/1904）の取り違えが
 *   このファイルの中に隠れる。
 */

/**
 * ★ 圧縮方式と圧縮後の大きさは**索引（中央ディレクトリ）から取る。**
 *   ローカルヘッダ側は 0 のことがある（データ記述子を使うエントリ）。
 *   ローカル側を信じて開こうとして `Z_BUF_ERROR` で落ちた。
 */
interface Entry { name: string; offset: number; method: number; size: number }

const U16 = (b: Buffer, i: number) => b.readUInt16LE(i)
const U32 = (b: Buffer, i: number) => b.readUInt32LE(i)

/** ZIP の索引（中央ディレクトリ）を読む。 */
function entries(buf: Buffer): Map<string, Entry> {
  // 末尾から EOCD（0x06054b50）を探す。コメントは通常空なので後ろ数十バイト。
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65_557; i--) {
    if (U32(buf, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP の索引が見つからない（xlsx ではない）')

  const count = U16(buf, eocd + 10)
  let p = U32(buf, eocd + 16)
  const out = new Map<string, Entry>()
  for (let n = 0; n < count; n++) {
    if (U32(buf, p) !== 0x02014b50) break
    const nameLen = U16(buf, p + 28)
    const extraLen = U16(buf, p + 30)
    const commentLen = U16(buf, p + 32)
    const offset = U32(buf, p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    out.set(name, { name, offset, method: U16(buf, p + 10), size: U32(buf, p + 20) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 1つのファイルを取り出す。 */
function read(buf: Buffer, e: Entry): string {
  if (U32(buf, e.offset) !== 0x04034b50) throw new Error(`壊れている: ${e.name}`)
  const nameLen = U16(buf, e.offset + 26)
  const extraLen = U16(buf, e.offset + 28)
  const start = e.offset + 30 + nameLen + extraLen
  const body = buf.subarray(start, start + e.size)
  if (e.method === 0) return body.toString('utf8')
  if (e.method === 8) return inflateRawSync(body).toString('utf8')
  throw new Error(`未知の圧縮方式 ${e.method}: ${e.name}`)
}

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&')

/** `<t>` の中身をつないだもの（`<si>` 1つ分）。 */
const texts = (xml: string): string =>
  [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('')

/** 列参照（`BC12`）を 0 始まりの列番号にする。 */
export const columnIndex = (ref: string): number => {
  const m = /^([A-Z]+)/.exec(ref)
  if (!m) return 0
  let n = 0
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * シートの XML を行の配列にする。**ZIP を通さずに試せるよう外へ出してある。**
 *
 * ★★ **自己終了のセルを、開始タグと読み違えてはいけない。** ★★
 *   `<c r="A7" s="83"/>` を `<c ...>` として拾うと、`[^>]*` が末尾の `/` を
 *   飲み込み、**次のセルの `<v>` を自分の値として持って行く。**
 *   実際、482 行が 458 行になり、チェックの数が 186 → 91 に化けた
 *   （python で数え直して食い違いに気づいた）。
 *   **1つの型で「自己終了か、閉じタグか」を先に分岐する。**
 */
export const parseSheet = (xml: string, shared: string[]): string[][] => {
  const out: string[][] = []
  // ★ 行も同じ形にする。`[^>]*` を貪欲にすると `/` を飲み込み、
  //   `<row r="2"/>` を開始タグと読んで**次の行を丸ごと自分の中身にする。**
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const inner = rowMatch[1] ?? ''
    const cells = new Map<number, string>()
    for (const cell of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? ''
      const body = cell[2] ?? ''
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null
      let text = ''
      if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
      else if (type === 's' && v !== null) text = shared[Number(v)] ?? ''
      else if (type === 'inlineStr' || type === 'str') text = texts(body) || unescapeXml(v ?? '')
      else if (v !== null) text = unescapeXml(v)
      if (text !== '' && ref !== '') cells.set(columnIndex(ref), text)
    }
    const width = cells.size === 0 ? 0 : Math.max(...cells.keys()) + 1
    out.push(Array.from({ length: width }, (_, i) => cells.get(i) ?? ''))
  }
  return out
}

export class Workbook {
  private readonly buf: Buffer
  private readonly zip: Map<string, Entry>
  private readonly shared: string[]
  /** シート名 → ZIP の中のパス。 */
  readonly sheets: Map<string, string>

  constructor(path: string) {
    this.buf = readFileSync(path)
    this.zip = entries(this.buf)

    const ss = this.zip.get('xl/sharedStrings.xml')
    this.shared = ss
      ? [...read(this.buf, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!))
      : []

    // シート名は workbook.xml、実体の場所は _rels が持つ。**名前で引けるようにする。**
    const wb = read(this.buf, this.zip.get('xl/workbook.xml')!)
    const rels = new Map(
      [...read(this.buf, this.zip.get('xl/_rels/workbook.xml.rels')!)
        .matchAll(/<Relationship\b[^>]*\/>/g)]
        .map((m) => {
          const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? ''
          const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? ''
          return [id, target] as const
        }))
    this.sheets = new Map(
      [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => {
        const name = unescapeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '')
        const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? ''
        const target = (rels.get(rid) ?? '').replace(/^\//, '').replace(/^xl\//, '')
        return [name, `xl/${target}`] as const
      }))
  }

  /**
   * 1シートを行の配列で返す。**空のセルは空文字**で埋める。
   *
   * ★ チェックボックス（真偽値）は `TRUE` / `FALSE` の文字列で返す。
   *   **「値が無い」と「FALSE」は別物**なので、無い列は空文字のままにする ――
   *   この違いが、そのまま「去年か今年か」の判定に効く。
   */
  rows(sheetName: string): string[][] {
    const path = this.sheets.get(sheetName)
    if (!path) throw new Error(`シートが無い: ${sheetName}`)
    return parseSheet(read(this.buf, this.zip.get(path)!), this.shared)
  }

  /**
   * そのセルに**値が入っているか**（空文字と区別する）。
   * `rows()` は空を空文字に潰すので、有無を見たい列はこちらで数える。
   */
  hasValue(row: string[], index: number): boolean {
    return index < row.length && row[index] !== ''
  }
}

/**
 * 表計算の日付連番を JST の暦日（`YYYY-MM-DD`）にする。
 *
 * ★ 基準は 1899-12-30（Excel の 1900 年方式）。**1904 年方式は扱わない** ――
 *   受け取った表は 1900 年方式である（他の列の日付と突き合わせて確かめた）。
 *   読めない値は `null` を返す。**近い日付に寄せない。**
 */
export const serialToDate = (value: string): string | null => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1 || n > 80_000) return null
  const ms = Math.round((n - 25_569) * 86_400_000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}
