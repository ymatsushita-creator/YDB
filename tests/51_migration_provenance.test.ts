import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db/pglite.ts'
import { migrate, ledgerTail } from '../src/db/migrate.ts'
import { all, scalar } from '../src/db/client.ts'

/**
 * 「誰が適用したか」を記録に残す（C-121）。
 *
 * 実行⑬の最後、本番へ 0033〜0035 が**説明のつかないまま**適用されていた。
 * 実行⑭が突き止めた答えは「依頼者の手元から `pnpm db:migrate:production` が
 * 走った」―― コマンドを実行できる塊で渡した時点で、それは押せるボタンだった。
 *
 * ★ 特定に使えた手掛かりは `applied_at` と `xmin` だけで、**どのプロセスが
 *   書いたかは記録に無かった。** 同じ調べ方を次も繰り返さないために、
 *   接続に名乗らせた名前（application_name）をその場で残す。
 *
 * ★ これは犯人探しの仕掛けではない。**同じ機械の同じコマンドでも、
 *   別のプロセスなら別の名前になる**（pid を含む）ので、
 *   「自分が流したのか、他の誰かが流したのか」がその場で分かる。
 */

describe('schema_migrations は適用したプロセスを残す（C-121）', () => {
  test('接続が名乗った名前が applied_by に入る', async () => {
    const db = await openPglite()
    // ★ application_name は**印字可能なASCIIしか通らない**（それ以外は
    //   PostgreSQL が \xNN のC形式へ置き換える）。名乗りに日本語を使わない。
    await db.exec(`SET application_name = 'youthdb test#1@here'`)
    await migrate(db)

    const rows = await all<{ name: string; applied_by: string }>(
      db, `SELECT name, applied_by FROM schema_migrations ORDER BY name`)
    assert.ok(rows.length > 0, 'マイグレーションが1件も適用されていない')
    assert.ok(
      rows.every((r) => r.applied_by === 'youthdb test#1@here'),
      `名乗りが残っていない: ${JSON.stringify(rows.slice(0, 3))}`,
    )
    await db.close()
  })

  test('名乗りが無い接続でも適用できる（空文字で残る）', async () => {
    // 名乗りは接続側の善意で、記録層の必須条件ではない。
    // ここで NOT NULL 違反にすると、名乗らない経路が全部止まる。
    const db = await openPglite()
    await migrate(db)
    assert.equal(
      Number(await scalar(db, `SELECT count(*) FROM schema_migrations WHERE applied_by IS NULL`)),
      0, 'applied_by が NULL になっている')
    await db.close()
  })

  test('列を持たない古いDBでも、列を足して先へ進む', async () => {
    // ★ 本番はすでに 0035 まで適用済みで、その時点の schema_migrations は
    //   2列（name, checksum）＋ applied_at しか持たない。
    //   **schema_migrations は migrate() 自身の帳簿なので、
    //   マイグレーション番号で育てられない**（新しい DB では
    //   帳簿を作ってから 0001 を流すため、列がまだ無い状態で INSERT が走る）。
    //   だから足すのは migrate() の起動処理そのものである。
    const db = await openPglite()
    await db.exec(`
      CREATE TABLE schema_migrations (
          name        text PRIMARY KEY,
          checksum    text        NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `)
    await db.exec(`SET application_name = 'youthdb old-book#2@here'`)
    const applied = await migrate(db)
    assert.ok(applied.length > 0, '古い帳簿のDBで適用できていない')

    const by = await all<{ applied_by: string }>(
      db, `SELECT DISTINCT applied_by FROM schema_migrations`)
    assert.deepEqual(by.map((r) => r.applied_by), ['youthdb old-book#2@here'])
    await db.close()
  })

  test('★ 帳簿の末尾は、applied_by がまだ無いDBでも読める', async () => {
    // ★ 実行⑭で**出力を1回間違えた。** 適用前の状態を読む場面では
    //   applied_by がまだ足されていない（足すのは migrate() の中）。
    //   素直に SELECT applied_by と書いたので「列が無い」で落ち、
    //   本番の帳簿（0035まで35行）を「帳簿がまだ無い」と表示した。
    //   **状態を伝える道具が嘘をつくのは、状態を読まないより悪い。**
    const db = await openPglite()
    await db.exec(`
      CREATE TABLE schema_migrations (
          name        text PRIMARY KEY,
          checksum    text        NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO schema_migrations (name, checksum) VALUES ('0035_partner_recommendation.sql', 'x');
    `)
    const tail = await ledgerTail(db)
    assert.equal(tail?.name, '0035_partner_recommendation.sql', '古い帳簿を読めていない')
    assert.equal(tail?.by, '', '名乗りの列が無いのだから、名乗りは空である')
    await db.close()
  })

  test('帳簿そのものが無いDBでは null（「無い」と「空」を作り分けない）', async () => {
    const db = await openPglite()
    assert.equal(await ledgerTail(db), null)
    await db.close()
  })
})
