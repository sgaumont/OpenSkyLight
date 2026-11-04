import { RpcError, authedFetch } from './client'

/** Longest side sent to the kiosk: its screen is 2160×1440, so this stays sharp there. */
const MAX_SIDE = 2560
const JPEG_QUALITY = 0.85

export interface PhonePhoto {
  name: string
  addedAt: string
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
  if (!body.ok) throw new RpcError(body.error.code, body.error.message)
  return body.data
}

/**
 * Re-draws the photo at screen size as a JPEG: quick to send, easy on the tablet, and —
 * because only the pixels are copied — free of its location and camera details.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`Couldn't read ${file.name || 'that photo'}`)
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo'))), 'image/jpeg', JPEG_QUALITY)
  )
}

export async function uploadPhoto(blob: Blob): Promise<PhonePhoto> {
  return json(await authedFetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }))
}

export async function listPhotos(): Promise<PhonePhoto[]> {
  return json(await authedFetch('/api/photos'))
}

export async function deletePhoto(name: string): Promise<void> {
  await json(await authedFetch(`/api/photos/${encodeURIComponent(name)}`, { method: 'DELETE' }))
}

/** Thumbnails need the token, so they're fetched and shown as blob: URLs. */
export async function thumbUrl(name: string): Promise<string> {
  const res = await authedFetch(`/api/photos/${encodeURIComponent(name)}/thumb`)
  if (!res.ok) throw new Error('No thumbnail')
  return URL.createObjectURL(await res.blob())
}
