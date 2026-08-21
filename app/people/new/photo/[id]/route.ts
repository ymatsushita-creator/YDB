import { getDb } from '../../../../../src/db/server.ts'
import { getPersonPhoto } from '../../../../../src/queries/photo.ts'

export const dynamic = 'force-dynamic'

const DATA_IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/

/** 顔写真を一覧の本文から分け、画面に入った行だけブラウザが取得する。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await getPersonPhoto(await getDb(), id)
  const match = row?.photo_data_url.match(DATA_IMAGE)
  if (!match) return new Response(null, { status: 404 })

  return new Response(Buffer.from(match[2]!, 'base64'), {
    headers: {
      'Content-Type': match[1]!,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
