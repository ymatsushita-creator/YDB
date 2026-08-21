import { maybeOne, type Db } from '../db/client.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 一覧とは分けて顔写真を1枚だけ読む。削除済みの人は返さない。 */
export const getPersonPhoto = (db: Db, personId: string | undefined) => {
  if (!personId || !UUID.test(personId)) return Promise.resolve(null)
  return maybeOne<{ photo_data_url: string }>(db, `
    SELECT photo_data_url
      FROM persons
     WHERE id = $1
       AND deleted_at IS NULL
       AND anonymized_at IS NULL
       AND photo_data_url IS NOT NULL`, [personId])
}
