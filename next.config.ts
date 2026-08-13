import type { NextConfig } from 'next'

const config: NextConfig = {
  // AGENTS.md は CLAUDE.md へのポインタに限定し、生成規則の重複を防ぐ。
  agentRules: false,

  // PGlite は WASM を同梱するため、バンドラに通さずそのまま require させる。
  serverExternalPackages: ['@electric-sql/pglite'],

  /**
   * タブを押し直したときに、**サーバへ聞き直さない**（実行⑮。C-141）。
   *
   * 画面はすべて `force-dynamic` なので、既定では**戻るたびに往復**する。
   * 30秒はブラウザ側の控えを使い、押した瞬間に前の画面が出る。
   *
   * ★ 書き込みのあとは古いものを見せない ―― 各アクションが
   *   `revalidatePath()` を呼んでおり、これが控えごと捨てる。
   *   **読むだけの往復を減らす指定であって、書いた結果を古くする指定ではない。**
   *
   * ★ 30秒より長くしない。運営は2人以上で同じ期を触るので、
   *   隣の人が入れた値が出るまでの待ちがそのまま長くなる。
   */
  experimental: {
    staleTimes: { dynamic: 30 },
  },

  // マイグレーションとシードの SQL は実行時に fs で読む（import ではない）。
  // 参照が静的に辿れないので、明示しないとサーバレスの束に入らず、
  // デモモードの起動時に「ファイルが無い」で落ちる。
  outputFileTracingIncludes: {
    '/**/*': ['./db/migrations/**/*.sql', './db/seeds/**/*.sql'],
  },
}

export default config
