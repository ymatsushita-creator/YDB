import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

/**
 * 構成基準（`.consultant/STRUCTURE.md`）を機械で確かめる。
 *
 * ★ なぜ要るか:
 *   基準を文書に書いただけでは守られない。実際このリポジトリでは
 *   `CLAUDE.md` の「完了条件」が**強制する機械を1つも持たないまま**運用され、
 *   887件のテストが1度も回らずにマージできる状態だった。
 *
 * ★ 初版は「文字列が含まれるか」で判定しており、独立レビュー（2026-08-19）に
 *   **S1・S1b・S2・S4・S6・S7 のすべてを素通りする偽リポジトリ**を作られた。
 *   例: quality.yml の実ステップを全部消してもコメントに `pnpm test` が残っていれば ✔、
 *       deny を1件の長い文字列に潰しても ✔、`&&` を `;` に変えても ✔。
 *   **含まれるかではなく、効いているかを見る。** 以下はその作り直しである。
 *
 * ★ 外部ツール `consultant analyze` との分担:
 *   外部ツールが見るのは C01〜C07 の**存在確認**だけ（在るか / 無いか）。
 *   このリポジトリ固有の条件はここで見る。
 *
 * ★ この検査を通すためにこの検査を緩めない。基準が現実に合わないなら
 *   `.consultant/STRUCTURE.md` を先に直し、その差分を人間が読む。
 *   —— ただし**それを強制する機械は無い**。本ファイルは `.audit/MANIFEST.sha256` の
 *   対象外であり、条件を消せば検査は黙る。ここは運用に依存している。
 */

const run = promisify(execFile)
// `new URL().pathname` はパーセントエンコード済みで、日本語や空白を含むパスで壊れる。
// `fileURLToPath` を使う（レビュー指摘）。
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const at = (...p: string[]) => join(ROOT, ...p)
const read = (...p: string[]) => readFileSync(at(...p), 'utf8')
const readIf = (...p: string[]) => (existsSync(at(...p)) ? read(...p) : null)

type Result = { id: string; ok: boolean; label: string; detail: string }
const results: Result[] = []
const check = (id: string, label: string, ok: boolean, detail: string) =>
  results.push({ id, ok, label, detail })

/** YAML からコメントを落とす。コメントに書いた文字列で検査を通させない。 */
const stripYamlComments = (body: string) =>
  body.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n')

/** ディレクトリを再帰的に歩く。生成物と外部依存は見ない。 */
function walk(dir: string, skip: Set<string>): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path, skip))
    else out.push(path)
  }
  return out
}
const SKIP = new Set(['node_modules', '.next', '.git', '.pgdata', '.pgdata-pilot', '.tmp',
  '.claude-tmp', '.vercel', 'tsconfig.tsbuildinfo'])

// ── S1 完了条件が1本のコマンドで、途中の失敗が止める ──────────────────────
{
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
  const verify = pkg.scripts?.verify ?? ''
  // `structure`（この検査自身）も必須にする。初版は自分を必須段から落としていた。
  const stages = ['typecheck', 'test', 'decisions:index', 'structure', 'build']
  const missing = stages.filter((s) => !verify.includes(s))
  // `;` で繋ぐと最後の段の終了コードしか残らず、型検査とテストの失敗が握り潰される。
  const segments = verify.split('&&').length
  const chained = segments >= stages.length
  check('S1', '完了条件は `pnpm verify` 1本（失敗が止まる）', missing.length === 0 && chained,
    missing.length > 0 ? `verify に含まれない段: ${missing.join(', ')}`
      : chained ? `${segments} 段を && で連結`
        : '`&&` で連結されていない。途中の失敗が握り潰される')
}

// ── S1b 品質CIが実際に回す（コメントではなく run: を見る）────────────────
{
  const body = readIf('.github/workflows/quality.yml')
  if (body === null) {
    check('S1b', '品質CIが完了条件を回す', false, '.github/workflows/quality.yml が無い')
  } else {
    const live = stripYamlComments(body)
    // ★ `decisions:index` を落とさない。S1 は verify 側でこの段を要求しているのに、
    //   S1b は CI 側で要求していなかった。**CI からこの段だけ消しても S1b は ✔ のまま**で、
    //   `CLAUDE.md` の「同じものが CI で走る」が保証されていなかった（2026-08-19 再検証）。
    const need = ['pnpm typecheck', 'pnpm test', 'pnpm decisions:index', 'pnpm structure', 'pnpm build']
    // `run:` の行だけを対象にする。ヘッダの説明文で通させない。
    const commands = live.split('\n').filter((l) => /^\s*(-\s*)?run:/.test(l) || /^\s{6,}\S/.test(l)).join('\n')
    const missing = need.filter((c) => !commands.includes(c))
    const weakened = /continue-on-error|if:\s*false/.test(live)
    check('S1b', '品質CIが完了条件を回す', missing.length === 0 && !weakened,
      weakened ? 'quality.yml に検査を無効化する記述がある'
        : missing.length === 0 ? `run: に ${need.length} 段すべて`
          : `run: に無い: ${missing.join(', ')}`)
  }
}

// ── S2 ルート直下は着手時に読む物だけ（在ることも見る）─────────────────────
{
  const ALLOWED = ['README.md', 'AGENTS.md', 'SUPERVISOR.md', 'vision.md', 'director.md',
    'domain.md', 'CLAUDE.md', 'process.md', 'HANDOFF.md']
  // 読み物の拡張子を広く見る。`.md` だけだと `TODO.txt` や `NOTES.mdx` で趣旨を破れる。
  const DOCEXT = /\.(md|mdx|markdown|txt|org|rst|adoc)$/i
  const found = readdirSync(ROOT).filter((f) => DOCEXT.test(f))
  const extra = found.filter((f) => !ALLOWED.includes(f))
  // 規律文書が消えていないことも見る。初版は「0本」でも ✔ になった。
  const gone = ALLOWED.filter((f) => !existsSync(at(f)))
  check('S2', 'ルート直下は規律文書9本だけ', extra.length === 0 && gone.length === 0,
    gone.length > 0 ? `規律文書が無い: ${gone.join(', ')}`
      : extra.length > 0 ? `着手時に読まない物がルートにある: ${extra.join(', ')} → docs/ へ`
        : `${found.length} 本（既定どおり）`)
}

// ── S3 番号で参照する物に索引がある ─────────────────────────────────────────
{
  const body = readIf('db/DECISIONS-INDEX.md')
  check('S3', '設計判断の索引が在る', body !== null && body.includes('生成物'),
    body === null ? 'db/DECISIONS-INDEX.md が無い（pnpm decisions:index）'
      : body.includes('生成物') ? '在る（生成物と明示されている）' : '生成物である旨の記載が無い')
}

// ── S4 危険操作が deny で落ちる（両方の設定を、種別ごとに見る）──────────────
{
  /** `Tool(pattern)` を分解する。種別を無視した部分一致で通させない。 */
  const parse = (entries: string[]) => entries.flatMap((e) => {
    const m = /^(\w+)\((.*)\)$/.exec(e.trim())
    return m ? [{ tool: m[1]!, pattern: m[2]! }] : []
  })
  const files = ['.claude/settings.json', '.claude/settings.local.json']
  const present = files.filter((f) => existsSync(at(f)))
  if (!present.includes('.claude/settings.json')) {
    check('S4', '危険操作が deny で落ちる', false, '.claude/settings.json が無い')
  } else {
    const deny = parse(files.flatMap((f) =>
      existsSync(at(f)) ? (JSON.parse(read(f))?.permissions?.deny ?? []) as string[] : []))
    const allow = parse(files.flatMap((f) =>
      existsSync(at(f)) ? (JSON.parse(read(f))?.permissions?.allow ?? []) as string[] : []))
    // 種別と対象の組で要求する。`Bash(echo .env .audit/ …)` 1件では満たせない。
    const REQUIRED: Array<{ tool: string; needle: string; why: string }> = [
      { tool: 'Read', needle: '.env', why: '平文の秘密' },
      { tool: 'Edit', needle: '.audit', why: '監査法人の管轄' },
      { tool: 'Edit', needle: '.githooks', why: '監査法人の管轄' },
      { tool: 'Read', needle: 'YouthDB-private', why: '実在の候補者データ' },
      { tool: 'Bash', needle: 'git push', why: '公開は不可逆' },
      { tool: 'Bash', needle: 'deploy:production', why: '本番は不可逆' },
      { tool: 'Bash', needle: '--no-verify', why: '検査の迂回' },
    ]
    const missing = REQUIRED
      .filter((r) => !deny.some((d) => d.tool === r.tool && d.pattern.includes(r.needle)))
      .map((r) => `${r.tool}(…${r.needle}…)（${r.why}）`)
    // 任意コード実行の allow は、deny 全項目を無効化する。見つけたら言う。
    // ★ ワイルドカードを伴うものだけが穴である。
    //   `python3 -c "import openpyxl; print(...)"` のような**固定コマンド**は
    //   中身が確定しているので任意実行にならない。区別せずに落とすと、
    //   検査が過剰になって「うるさいから緩める」圧力を生む。
    const ARBITRARY = [/\bnode\s+-e\b/, /\bpython3?\s+-c\b/, /\bpnpm\s+exec\b/, /\bnpx\b/, /\beval\b/]
    const holes = allow.filter((a) =>
      a.tool === 'Bash' && a.pattern.includes('*') && ARBITRARY.some((re) => re.test(a.pattern)))
    check('S4', '危険操作が deny で落ちる', missing.length === 0 && holes.length === 0,
      missing.length > 0 ? `deny に無い: ${missing.join(' / ')}`
        : holes.length > 0
          ? `allow に任意コード実行がある（deny 全項目を無効化する）: ${holes.map((h) => h.pattern).join(' / ')}`
          : `deny ${deny.length} 件 / 設定 ${present.length} 本を照合`)
  }
}

// ── S5 調査とレビューの役割が分かれている ───────────────────────────────────
{
  const need = ['investigator.md', 'reviewer.md']
  const have = existsSync(at('.claude/agents')) ? readdirSync(at('.claude/agents')) : []
  const missing = need.filter((f) => !have.includes(f))
  check('S5', '調査とレビューが分離されている', missing.length === 0,
    missing.length === 0 ? `.claude/agents: ${have.join(', ')}` : `無い: ${missing.join(', ')}`)
}

// ── S6 実データがリポジトリの中に無い（全域＋防壁の実挙動）──────────────────
{
  const problems: string[] = []

  // 表・資料・名簿になりうる形式を、深さを問わず全域で探す。
  // `.gitignore` は `*.xlsx` を全階層で無視している。検査の守備範囲がそれより狭くては意味がない。
  const DATA = /\.(pptx|xlsx|xlsm|xlsb|csv|tsv|numbers|accdb|mdb|sqlite|dump)$/i
  const strays = walk(ROOT, SKIP)
    .filter((p) => DATA.test(p))
    // `db/seeds/*.sql` のような追跡下の参照マスタは対象外（監査 D2-02 の管轄）。
    .map((p) => relative(ROOT, p))
  if (strays.length > 0) problems.push(`表形式のファイル: ${strays.slice(0, 5).join(', ')}${strays.length > 5 ? ` ほか${strays.length - 5}件` : ''}`)
  if (existsSync(at('db/private'))) problems.push('db/private/（外部ディレクトリへ移す）')
  if (existsSync(at('お顔データ'))) problems.push('お顔データ/')
  if (!existsSync(at('.env.example'))) problems.push('.env.example が無い（環境変数の契約）')

  // ★ 防壁は**実際に動かして**確かめる。
  //   初版はソースに特定の文字列があるかを見ていたので、コメント1行で満たせた。
  //   実証された3つの回避（cwd依存・シンボリックリンク・大小文字）を、ここで毎回試す。
  //
  // ★★ 第2版は「動かして落ちた」を「防壁が拒否した」と読んでいた。これが誤りだった
  //    （2026-08-19 の再検証で実証）。`import()` の失敗も exit 1 なので、
  //    **`intake-dir.ts` が消えても・壊れても S6 は ✔ を出していた。**
  //    検査対象が存在しないのに「防壁は3通りの回避を実際に拒否した」と表示する状態である。
  //    負のテストは防壁を壊す方向しか試しておらず、**探査を壊す方向**を試していなかった。
  //
  //    そこで拒否を `assertOutsideRepo` 固有のメッセージで同定する。
  //    それ以外の失敗は「検査できなかった」として ✘ にする。**合格の側へ倒さない。**
  const REJECTION = '受け入れ口をリポジトリの中へ向けられない'
  const probe = `import(${JSON.stringify(pathToFileURL(at('scripts/intake-dir.ts')).href)})`
    + `.then(m => { m.intakeDir(); console.log('ACCEPTED') })`

  /** 探査を1回走らせ、終了コードと出力をそのまま返す。例外を握り潰さない。 */
  const attempt = async (dir: string): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const { stdout, stderr } = await run(process.execPath, ['--input-type=module', '-e', probe],
        { env: { ...process.env, YOUTHDB_INTAKE_DIR: dir }, cwd: at('scripts') })
      return { code: 0, stdout, stderr }
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string }
      return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
    }
  }
  const lastLine = (s: string) => s.trim().split('\n').pop() ?? '(出力なし)'

  // 負の対照 —— リポジトリの中を指す3通り。すべて**防壁の拒否で**落ちねばならない。
  for (const [name, dir] of [
    ['直指定', at('db', 'private')],
    ['大小文字違い', at('db', 'private').replace('/YouthDB/', '/youthdb/')],
    ['リポジトリ自身', ROOT],
  ] as const) {
    const r = await attempt(dir)
    if (r.code === 0) {
      problems.push(`受け入れ口の防壁が抜ける（${name}: ${dir}）`)
    } else if (!r.stderr.includes(REJECTION)) {
      // ここが第2版で ✔ になっていた経路である。
      problems.push(`防壁を検査できなかった（${name}: exit ${r.code}・拒否メッセージが出ていない）`
        + ` ―― ${lastLine(r.stderr)}`)
    }
  }

  // 正の対照 —— 正当な外部ディレクトリは**受理されねばならない**。
  // これが通らないなら探査系そのものが壊れており、上の3件が「落ちた」ことは何の根拠にもならない。
  const outside = join(ROOT, '..', 'YouthDB-private')
  const positive = await attempt(outside)
  if (!positive.stdout.includes('ACCEPTED')) {
    problems.push(`探査系が壊れている（正当な外部 ${outside} すら受理されない: exit ${positive.code}）`
      + ` ―― ${lastLine(positive.stderr)}`)
  }

  check('S6', '実データがリポジトリの外にある', problems.length === 0,
    problems.length === 0
      ? '実データ・受け入れ口とも無し。防壁は3通りの回避を拒否メッセージ付きで拒み、正当な外部は受理した'
      : problems.join(' / '))
}

// ── S7 検査を緩める記述が無い（全ワークフロー＋スクリプト定義）───────────────
{
  const targets = [
    ...(existsSync(at('.github/workflows'))
      ? readdirSync(at('.github/workflows')).map((f) => `.github/workflows/${f}`) : []),
    'package.json',
  ]
  const PATTERNS: Array<[RegExp, string]> = [
    [/continue-on-error/, 'continue-on-error'],
    [/--no-verify/, '--no-verify'],
    [/\|\|\s*(true|:)\b/, '|| true / || :'],
    [/;\s*true\b/, '; true'],
    [/set\s+\+e/, 'set +e'],
    [/if:\s*false/, 'if: false'],
    [/--passWithNoTests/, '--passWithNoTests'],
  ]
  const hits: string[] = []
  for (const t of targets) {
    const body = readIf(t)
    if (body === null) continue
    // audit.yml は監査法人の管轄。読むが、そこの記述をこちらの所見にはしない。
    if (t.endsWith('audit.yml')) continue
    const live = t.endsWith('.yml') ? stripYamlComments(body) : body
    for (const [re, name] of PATTERNS) if (re.test(live)) hits.push(`${t}: ${name}`)
  }
  check('S7', '検査を緩める記述が無い', hits.length === 0,
    hits.length === 0 ? `${targets.length} 本を照合` : hits.join(' / '))
}

// ── S8 テストが実際に走る構成になっている ───────────────────────────────────
{
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
  const script = pkg.scripts?.test ?? ''
  // `sh` に globstar は無い。引用符が外れるとサブディレクトリ出現時に
  // 直下のテストが丸ごと node へ渡らなくなる（レビューで実証済み）。
  const quoted = /["'][^"']*\*\*[^"']*["']/.test(script)
  const guarded = script.includes('test-preflight')
  const count = existsSync(at('tests')) ? walk(at('tests'), SKIP).filter((p) => p.endsWith('.test.ts')).length : 0
  const bad = [
    !quoted && 'グロブが引用符で囲まれていない（sh が展開してしまう）',
    !guarded && '対象0件を検知する前段（test-preflight）が無い',
    count === 0 && 'テストが1件も無い',
  ].filter(Boolean) as string[]
  check('S8', 'テストが実際に走る', bad.length === 0,
    bad.length === 0 ? `${count} ファイル・グロブは node が展開する` : bad.join(' / '))
}

// ── C01〜C07 外部ツール（存在確認）──────────────────────────────────────────
// 解決できないときは「検査していない」と言う。「問題なし」と言い換えない
// （`.consultant/CHARTER.md` §1 / `.audit/AUDIT_CHARTER.md` §1 と同じ立場）。
let consultantNote = ''
{
  const pinned = readIf('.consultant/TOOL_PATH')?.trim() ?? ''
  // ★ TOOL_PATH に置かれた任意の実行ファイルを無条件で走らせない（レビュー指摘）。
  //   リポジトリの中を指していたら、実装セッションが自分で書いた物を
  //   `pnpm verify` の中で実行できてしまう。
  const usable = pinned !== '' && !pinned.startsWith(ROOT)
  let output: string | null = null
  for (const bin of [usable ? pinned : '', 'consultant'].filter(Boolean)) {
    try {
      const { stdout } = await run(bin, ['analyze', '--repo', ROOT])
      output = stdout
      break
    } catch { /* 次の候補へ */ }
  }
  if (output === null) {
    consultantNote = pinned !== '' && !usable
      ? '⚠ TOOL_PATH がリポジトリ内を指しているため実行しない。**検査していない**'
      : '⚠ ツールを解決できず**実行していない**。安全だという意味ではない'
    check('C0x', 'コンサル診断（C01〜C07）', true, consultantNote)
  } else {
    try {
      const r = JSON.parse(output) as { score: number; findings: Array<{ id: string; title: string }> }
      check('C0x', 'コンサル診断（C01〜C07）', r.findings.length === 0,
        r.findings.length === 0 ? `score ${r.score}/100・所見なし`
          : `score ${r.score}/100 ―― ${r.findings.map((f) => `${f.id} ${f.title}`).join(' / ')}`)
    } catch {
      // 壊れた出力で検査全体を落とさない。読めなかったことを所見にする。
      check('C0x', 'コンサル診断（C01〜C07）', false,
        'ツールの出力を JSON として読めなかった。道具か TOOL_PATH を確かめること')
    }
  }
}

// ── 出力 ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✘'} ${r.id.padEnd(4)} ${r.label}\n       ${r.detail}`)
}
console.log('')
if (failed.length > 0) {
  console.error(`構成基準に反している ―― ${failed.length} 件（${failed.map((f) => f.id).join(', ')}）`)
  console.error('`.consultant/STRUCTURE.md` の該当節を読んで直すこと。')
  console.error('**この検査の側を緩めて通さない。** 基準が現実に合わないなら基準を直し、差分を人間が読む。')
  process.exit(1)
}
console.log(consultantNote === ''
  ? '構成基準を満たしている。'
  : '構成基準（このリポジトリ固有の分）を満たしている。C01〜C07 は未実行。')
