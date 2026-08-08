import type { NextConfig } from 'next'

const config: NextConfig = {
  // AGENTS.md は CLAUDE.md へのポインタに限定し、生成規則の重複を防ぐ。
  agentRules: false,

  // PGlite は WASM を同梱するため、バンドラに通さずそのまま require させる。
  serverExternalPackages: ['@electric-sql/pglite'],

  // マイグレーションとシードの SQL は実行時に fs で読む（import ではない）。
  // 参照が静的に辿れないので、明示しないとサーバレスの束に入らず、
  // デモモードの起動時に「ファイルが無い」で落ちる。
  outputFileTracingIncludes: {
    '/**/*': ['./db/migrations/**/*.sql', './db/seeds/**/*.sql'],
  },
}

export default config
