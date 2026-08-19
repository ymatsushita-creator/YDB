import { closeSync, openSync, readSync, writeSync } from 'node:fs'

/**
 * 不可逆な操作の前に、**端末から**人間の承認を取る。
 *
 * ★ 環境変数による解除口を作らない。AIは自分で環境変数を立てられるので、
 *   それは解除ではなく素通りになる（.audit/IRREVERSIBLE_OPS.md）。
 * ★ 承認は「書き込み先の名前をそのまま打つ」形にする。Enter 連打では通らない。
 * ★ 端末を開けない環境（AIの実行環境・CI・パイプ越し）では承認を取れないので
 *   false を返す。呼び出し側はそこで実行しない。
 *   ―― `existsSync('/dev/tty')` だけでは足りない。デバイスノードは在っても
 *      開けないことがある（実測: AI実行環境で "Device not configured"）。
 */
export async function confirmDestructive(action: string, target: string): Promise<boolean> {
  let fd: number
  try {
    fd = openSync('/dev/tty', 'r+')
  } catch {
    console.error(`承認を取れない（端末を開けない）―― ${action} を実行しない。`)
    return false
  }
  try {
    writeSync(fd, `\n■ 人間の承認が必要 ―― ${action}\n`)
    writeSync(fd, `  書き込み先: ${target}\n`)
    writeSync(fd, `  続行するには書き込み先の名前をそのまま入力（中止は Enter のみ）:\n  > `)
    const buf = Buffer.alloc(256)
    let acc = ''
    while (!acc.includes('\n')) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      acc += buf.subarray(0, n).toString('utf8')
    }
    const ok = acc.trim() === target
    writeSync(fd, ok ? '  承認を記録して続行する。\n' : `  一致しない。${action} を中止する。\n`)
    return ok
  } finally {
    closeSync(fd)
  }
}
