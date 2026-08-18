#!/usr/bin/env node
// Codex など外部エージェントから Claude のモデルへ仕事を委譲するための MCP サーバ。
//
// claude mcp serve は道具だけを公開し、モデルは呼べない（Task ツールはエージェント定義が
// 空で必ず失敗する。実測済み）。そこで非対話モードの `claude -p` を1つの道具として包む。
//
// 会話は session_id で継続できる。呼び出し元は戻り値の session_id を次回 resume_session_id
// に渡すこと。
//
// このファイルは YouthDB の実装物ではない。開発環境の道具として同居しているだけで、
// アプリのコードからは参照されない。

import { spawn } from 'node:child_process'

const CLAUDE_BIN = process.env.CLAUDE_DELEGATE_BIN || '/Users/yuji/.local/bin/claude'
const DEFAULT_TIMEOUT_SEC = 900
const DEFAULT_BUDGET_USD = 5

const TOOL = {
  name: 'claude_delegate',
  description:
    'Claude（Anthropic のモデル）に仕事を委譲し、結果を受け取る。Claude Code の全道具' +
    '（ファイル読み書き・Bash・検索・Web）を持った状態で、指定したディレクトリ上で自律的に' +
    '作業する。調査・実装・レビューなど、まとまった単位で渡すほど効果が高い。' +
    '戻り値の session_id を resume_session_id に渡せば、同じ文脈で会話を続けられる。',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '委譲する内容。背景・成果物・完了条件まで書くこと。',
      },
      cwd: {
        type: 'string',
        description: '作業ディレクトリの絶対パス。省略時はこのサーバの起動ディレクトリ。',
      },
      model: {
        type: 'string',
        enum: ['opus', 'sonnet', 'haiku'],
        description: '省略時は Claude Code の既定。単純作業は haiku、難所は opus。',
      },
      permission_mode: {
        type: 'string',
        enum: ['default', 'acceptEdits', 'plan'],
        description:
          '既定は acceptEdits（ファイル編集を自動承認）。plan は読むだけで計画を返す。' +
          'default は承認が要る操作を拒否して報告する。',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description: '事前許可する道具。例: ["Bash(git:*)", "Bash(pnpm test)", "Edit"]',
      },
      disallowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description: '禁止する道具。例: ["Bash(psql:*)", "WebFetch"]',
      },
      resume_session_id: {
        type: 'string',
        description: '前回の戻り値に入っていた session_id。会話を継続する場合に指定。',
      },
      max_budget_usd: {
        type: 'number',
        description: `API 費用の上限。既定 ${DEFAULT_BUDGET_USD} ドル。`,
      },
      timeout_sec: {
        type: 'number',
        description: `打ち切りまでの秒数。既定 ${DEFAULT_TIMEOUT_SEC} 秒。`,
      },
    },
    required: ['prompt'],
  },
}

function runClaude(a) {
  const args = ['-p', a.prompt, '--output-format', 'json']

  args.push('--permission-mode', a.permission_mode || 'acceptEdits')
  args.push('--max-budget-usd', String(a.max_budget_usd ?? DEFAULT_BUDGET_USD))
  if (a.model) args.push('--model', a.model)
  if (a.resume_session_id) args.push('--resume', a.resume_session_id)
  if (a.allowed_tools?.length) args.push('--allowedTools', ...a.allowed_tools)
  if (a.disallowed_tools?.length) args.push('--disallowedTools', ...a.disallowed_tools)

  // 入れ子検知を避ける。呼び出し元が Claude Code 由来でも起動できるようにする。
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: a.cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))

    const timer = setTimeout(
      () => {
        child.kill('SIGKILL')
        resolve({ timedOut: true, out, err })
      },
      (a.timeout_sec ?? DEFAULT_TIMEOUT_SEC) * 1000,
    )

    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ spawnError: e.message, out, err })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

// -p --output-format json は1つの JSON を返すが、警告等が前置される場合に備えて最後の行を採る。
function lastJson(s) {
  const t = s.trim()
  if (t.startsWith('{')) return t
  const lines = t.split('\n').filter((l) => l.trim().startsWith('{'))
  return lines[lines.length - 1] ?? t
}

function formatResult(a, r) {
  if (r.spawnError) return { isError: true, text: `claude を起動できない: ${r.spawnError}` }
  if (r.timedOut) {
    return {
      isError: true,
      text: `${a.timeout_sec ?? DEFAULT_TIMEOUT_SEC} 秒で打ち切った。作業は完了していない。`,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(lastJson(r.out))
  } catch {
    return {
      isError: true,
      text: `出力を解釈できない (exit ${r.code})\nstdout: ${r.out.slice(0, 2000)}\nstderr: ${r.err.slice(0, 1000)}`,
    }
  }

  const lines = [parsed.result ?? '(結果テキストなし)', '', '---']
  if (parsed.session_id) lines.push(`session_id: ${parsed.session_id}  ← 継続する場合に渡す`)
  if (typeof parsed.total_cost_usd === 'number') lines.push(`cost: $${parsed.total_cost_usd.toFixed(4)}`)
  if (typeof parsed.num_turns === 'number') lines.push(`turns: ${parsed.num_turns}`)
  if (parsed.permission_denials?.length) {
    lines.push(`拒否された操作: ${parsed.permission_denials.length} 件（allowed_tools を検討）`)
  }

  return { isError: Boolean(parsed.is_error), text: lines.join('\n') }
}

// ---- MCP (JSON-RPC over stdio) ----

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // 通知は握りつぶす

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'claude-delegate', version: '1.0.0' },
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: [TOOL] })
    case 'tools/call': {
      if (params?.name !== TOOL.name) return fail(id, -32602, `unknown tool: ${params?.name}`)
      const a = params.arguments ?? {}
      if (!a.prompt) return fail(id, -32602, 'prompt は必須')
      const r = await runClaude(a)
      const { isError, text } = formatResult(a, r)
      return reply(id, { content: [{ type: 'text', text }], isError })
    }
    default:
      return fail(id, -32601, `method not found: ${method}`)
  }
}

let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    handle(msg).catch((e) => {
      if (msg.id !== undefined) fail(msg.id, -32603, String(e?.message ?? e))
    })
  }
})
