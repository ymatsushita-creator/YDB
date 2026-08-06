import type { NextConfig } from 'next'

const config: NextConfig = {
  // PGlite は WASM を同梱するため、バンドラに通さずそのまま require させる。
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default config
