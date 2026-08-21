import { createHash } from 'node:crypto'

/**
 * デプロイ先が**約束した1つ**であることを確かめる（C-124）。
 *
 * ★ なぜ要るか ―― 同じリポジトリに Vercel プロジェクトが2つあった（C-123）。
 *   依頼者が見ていた `yujis / ydb` は3日前で止まり、こちらが流していたのは
 *   `yuzy742's projects / youthdb` だった。**繋ぎ替えは `vercel link` 一発で起き、
 *   起きたことは画面に出ない。** `.vercel/project.json` は gitignore 済みなので、
 *   リポジトリからは見えない ―― だから**期待する側をリポジトリに置く。**
 *
 * ★ 置くのは**指紋**である。projectId / orgId をそのまま書けば、
 *   公開リポジトリに識別子が載る。**照合には指紋で足りる**ので、
 *   足りるほうを選ぶ（合言葉を記録に書きかけた C-112 と同じ精神）。
 *
 * ★ 名前だけでは足りない。**別のアカウントに同じ名前のプロジェクトを作れる**
 *   ―― まさに今回の `ydb` / `youthdb` がその形だった。だから orgId も見る。
 */

/** 約束したデプロイ先。**ここを書き換えるときは、書き換える理由を DECISIONS に残す。** */
export const EXPECTED = {
  projectName: 'youthdb',
  /** yuzy742's projects。sha256 の先頭12桁。 */
  orgFingerprint: '48551b685373',
  /** youthdb。sha256 の先頭12桁。 */
  projectFingerprint: 'f40f66a0061a',
} as const

export const fingerprint = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 12)

export type TargetCheck =
  | { ok: true; projectName: string }
  | { ok: false; reason: string }

/**
 * `.vercel/project.json` の中身（読めなければ null）を照合する。
 *
 * **迷ったら止める。** 読めない・壊れている・違う先を向いている、のどれでも
 * デプロイしない ―― 間違った本番へ出すより、出ないほうが害が小さい。
 */
export function checkDeployTarget(
  raw: string | null,
  expected: { projectName: string; orgFingerprint: string; projectFingerprint: string } = EXPECTED,
): TargetCheck {
  if (raw === null) {
    return {
      ok: false,
      reason: '.vercel/project.json が無い。どこへ出るのか決まっていない（vercel link で繋ぐ）。',
    }
  }

  let link: { projectId?: unknown; orgId?: unknown; projectName?: unknown }
  try {
    link = JSON.parse(raw) as typeof link
  } catch {
    return { ok: false, reason: '.vercel/project.json が読めない（壊れている）。' }
  }

  const { projectId, orgId, projectName } = link
  if (typeof projectId !== 'string' || typeof orgId !== 'string') {
    return { ok: false, reason: '.vercel/project.json に projectId / orgId が無い。' }
  }

  // 名前は人が読むためのもので、照合の主役ではない（改名できる）。
  // ずれていたら理由に添えるが、判定は指紋で行う。
  const name = typeof projectName === 'string' ? projectName : '(名前なし)'

  if (fingerprint(orgId) !== expected.orgFingerprint) {
    return {
      ok: false,
      reason: `**別のアカウント**を向いている（プロジェクト名 ${name}）。` +
        `約束した先は ${expected.projectName}（C-123）。`,
    }
  }
  if (fingerprint(projectId) !== expected.projectFingerprint) {
    return {
      ok: false,
      reason: `同じアカウントの**別のプロジェクト**を向いている（${name}）。` +
        `約束した先は ${expected.projectName}（C-123）。`,
    }
  }
  return { ok: true, projectName: name }
}
