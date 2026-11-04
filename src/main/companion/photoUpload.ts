/**
 * Photos sent from the companion app — checks with no Electron imports, so they're unit-testable.
 * The phone shrinks each photo to screen size (and drops its location data) before sending.
 */

/** Subfolder of the screensaver photo folder that phone uploads go into. */
export const PHONE_FOLDER = 'From phones'
/** Far above a phone-shrunk photo (~0.5 MB); stops a stray full-size upload or worse. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export type PhotoExt = 'jpg' | 'png' | 'webp'

/** Names this app gives phone photos — the only files phones may fetch or delete. */
export const PHONE_PHOTO_RE = /^phone-\d{8}-\d{6}-[0-9a-f]{6}\.(jpg|png|webp)$/

/** The image type from the file's first bytes (never trusts a name or Content-Type). */
export function sniffImage(buf: Buffer): PhotoExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** e.g. phone-20261104-093015-a1b2c3.jpg — sorts by arrival, never collides in practice. */
export function phonePhotoName(now: Date, ext: PhotoExt, random: () => number = Math.random): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const tag = Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')
  return `phone-${stamp}-${tag}.${ext}`
}
