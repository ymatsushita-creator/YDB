import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { checkDeployTarget, fingerprint } from '../scripts/deploy-target.ts'

/**
 * デプロイ先の照合（C-124）。
 *
 * ★ 同じリポジトリに Vercel プロジェクトが2つあり、依頼者が見ていた画面は
 *   3日前で止まっていた（C-123）。繋ぎ替えは `vercel link` 一発で起き、
 *   **起きたことは出力に出ない。** `.vercel/project.json` は gitignore 済みで
 *   リポジトリから見えないので、**期待する側をここで固定する。**
 *
 * ★ ここで確かめるのは判定そのものである。実際に繋がっている先は
 *   環境ごとに違ってよい（他の人の手元では別の先かもしれない）ので、
 *   **手元の `.vercel/project.json` があるときだけ**それも見る。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

const linkJson = (o: Record<string, unknown>) => JSON.stringify(o)

/** 検査用の約束（本番の約束＝EXPECTED は書き換えない）。 */
const testOrg = 'team_検査のアカウント'
const testProject = 'prj_検査のプロジェクト'
const testExpected = {
  projectName: '検査用',
  orgFingerprint: fingerprint(testOrg),
  projectFingerprint: fingerprint(testProject),
}

describe('デプロイ先の照合（C-124）', () => {
  test('約束した先なら通り、名前をそのまま返す', () => {
    const r = checkDeployTarget(linkJson({
      orgId: testOrg, projectId: testProject, projectName: '検査用',
    }), testExpected)
    assert.equal(r.ok, true, r.ok === false ? r.reason : '')
    assert.equal(r.ok === true ? r.projectName : '', '検査用')
  })

  test('別のアカウントを向いていたら止める', () => {
    const r = checkDeployTarget(linkJson({
      orgId: 'team_ほかのアカウント', projectId: 'prj_なにか', projectName: 'ydb',
    }), testExpected)
    assert.equal(r.ok, false)
    assert.match(r.ok === false ? r.reason : '', /別のアカウント/)
    assert.match(r.ok === false ? r.reason : '', /ydb/, '向いていた先の名前を言う')
  })

  test('同じアカウントの別プロジェクトでも止める（名前だけでは足りない）', () => {
    // orgId は合うが projectId が違う場合。**名前が同じでも別物**がありうる。
    const r = checkDeployTarget(linkJson({
      orgId: testOrg, projectId: 'prj_べつ', projectName: '検査用',
    }), testExpected)
    assert.equal(r.ok, false, '名前が同じでも、指紋が違えば通してはいけない')
    assert.match(r.ok === false ? r.reason : '', /別のプロジェクト/)
  })

  test('読めない・無いときは止める（迷ったら出さない）', () => {
    for (const raw of [null, '{壊れている', '{}', linkJson({ orgId: 1, projectId: 2 })]) {
      const r = checkDeployTarget(raw, testExpected)
      assert.equal(r.ok, false, `通してはいけない入力を通した: ${String(raw)}`)
    }
  })

  test('★ この手元が向いている先は、約束した先である', async () => {
    // `.vercel/` は gitignore 済み。無い環境（他の人の手元・CI）では飛ばす。
    const raw = await readFile(join(ROOT, '.vercel', 'project.json'), 'utf8').catch(() => null)
    if (raw === null) return
    const r = checkDeployTarget(raw)
    assert.equal(r.ok, true,
      `手元が約束と違う先を向いている: ${r.ok === false ? r.reason : ''}`)
  })
})
