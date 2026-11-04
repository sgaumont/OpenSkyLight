import { app, nativeImage } from 'electron'
import { promises as fs, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsService } from '../services/settingsService'
import { MAX_PHOTO_BYTES, PHONE_FOLDER, PHONE_PHOTO_RE, phonePhotoName, sniffImage } from './photoUpload'

export interface PhonePhoto {
  name: string
  addedAt: string
}

/**
 * Photos added from the companion app, kept in "From phones" inside the screensaver folder
 * (the slideshow already shows that subfolder). With no folder chosen yet, Pictures\OpenSkyLight
 * becomes the screensaver folder so the first upload just works.
 */
export function createPhonePhotos(deps: { settings: SettingsService; onChange: (domain: 'screensaverPhotos' | 'settings') => void }) {
  function dir(create: boolean): string | null {
    let folder = deps.settings.getAll().screensaver.folder
    if (!folder) {
      if (!create) return null
      folder = join(app.getPath('pictures'), 'OpenSkyLight')
      mkdirSync(folder, { recursive: true })
      deps.settings.set({ screensaver: { ...deps.settings.getAll().screensaver, folder } })
      deps.onChange('settings')
    }
    const phoneDir = join(folder, PHONE_FOLDER)
    if (create) mkdirSync(phoneDir, { recursive: true })
    return phoneDir
  }

  async function add(buf: Buffer): Promise<PhonePhoto> {
    if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) throw new Error('Photo is empty or too large')
    const ext = sniffImage(buf)
    if (!ext) throw new Error('Not a JPEG, PNG or WebP photo')
    const now = new Date()
    const name = phonePhotoName(now, ext)
    await fs.writeFile(join(dir(true)!, name), buf, { flag: 'wx' })
    deps.onChange('screensaverPhotos')
    return { name, addedAt: now.toISOString() }
  }

  async function list(): Promise<PhonePhoto[]> {
    const d = dir(false)
    if (!d) return []
    let names: string[]
    try {
      names = await fs.readdir(d)
    } catch {
      return []
    }
    const photos = await Promise.all(
      names.filter((n) => PHONE_PHOTO_RE.test(n)).map(async (name) => ({ name, addedAt: (await fs.stat(join(d, name))).mtime.toISOString() }))
    )
    return photos.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
  }

  /** Small JPEG for the phone's grid, or null for an unknown name. */
  function thumb(name: string): Buffer | null {
    const d = dir(false)
    if (!d || !PHONE_PHOTO_RE.test(name)) return null
    const img = nativeImage.createFromPath(join(d, name))
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const scale = 360 / Math.max(width, height)
    return (scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img).toJPEG(75)
  }

  /** Only photos that came from phones — never the parent's own pictures. */
  async function remove(name: string): Promise<boolean> {
    const d = dir(false)
    if (!d || !PHONE_PHOTO_RE.test(name)) return false
    try {
      await fs.unlink(join(d, name))
    } catch {
      return false
    }
    deps.onChange('screensaverPhotos')
    return true
  }

  return { add, list, thumb, remove }
}

export type PhonePhotos = ReturnType<typeof createPhonePhotos>
