import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { maybeOne, type Db } from '../db/client.ts'

const SECRET_NAME = 'anthropic_api_key'
const CONTEXT = 'youthdb:app-secret:v1:'

export type SaveAnthropicKeyResult =
  | { ok: true }
  | { ok: false; reason: 'key_required' | 'encryption_secret_missing' }

const encryptionKey = (secret: string | undefined): Buffer | null => {
  const value = secret?.trim()
  return value ? createHash('sha256').update(CONTEXT).update(value).digest() : null
}

/** APIキーをAES-256-GCMで暗号化して保存する。平文はSQL引数にも渡さない。 */
export async function saveAnthropicApiKey(
  db: Db, apiKey: string, secret: string | undefined,
): Promise<SaveAnthropicKeyResult> {
  const plain = apiKey.trim()
  if (!plain) return { ok: false, reason: 'key_required' }
  const key = encryptionKey(secret)
  if (!key) return { ok: false, reason: 'encryption_secret_missing' }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  await db.query(`
    INSERT INTO app_secrets (name, ciphertext, iv, auth_tag, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (name) DO UPDATE
      SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv,
          auth_tag = EXCLUDED.auth_tag, updated_at = EXCLUDED.updated_at`,
  [SECRET_NAME, ciphertext.toString('base64'), iv.toString('base64'),
    authTag.toString('base64')])
  return { ok: true }
}

/** 復号値はサーバ内部だけへ返す。画面・Cookie・URLには渡さない。 */
export async function loadAnthropicApiKey(
  db: Db, secret: string | undefined,
): Promise<string | null> {
  const key = encryptionKey(secret)
  if (!key) return null
  const row = await maybeOne<{ ciphertext: string; iv: string; auth_tag: string }>(db, `
    SELECT ciphertext, iv, auth_tag FROM app_secrets WHERE name = $1`, [SECRET_NAME])
  if (!row) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

export const hasAnthropicApiKey = async (db: Db): Promise<boolean> =>
  Boolean(await maybeOne(db, `SELECT 1 FROM app_secrets WHERE name = $1`, [SECRET_NAME]))
