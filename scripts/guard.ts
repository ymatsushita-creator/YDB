import { createConnection } from 'node:net'

/**
 * 指定ポートで何かが listen しているか。
 *
 * db:reset が開発サーバ（next dev, port 3111）と衝突しないための検査に使う。
 * PGlite の dataDir にはプロセス間ロックが無く、開発サーバを起動したまま
 * db:reset を実行するとエラーも警告も出さずに壊れる（HANDOFF.md 実測）。
 */
export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const finish = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}
