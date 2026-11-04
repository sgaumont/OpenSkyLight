import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanionTokens } from '../../src/main/companion/companionTokens'
import { createCompanionServer, type CompanionServer } from '../../src/main/companion/companionServer'
import { PHONE_PHOTO_RE, phonePhotoName, sniffImage } from '../../src/main/companion/photoUpload'
import type { SettingsService } from '../../src/main/services/settingsService'
import { ShuffleDeck } from '../../src/shared/shuffleDeck'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])

describe('phone photo checks', () => {
  it('recognises JPEG, PNG and WebP by their bytes, nothing else', () => {
    expect(sniffImage(JPEG)).toBe('jpg')
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(WEBP)).toBe('webp')
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull()
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull()
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
  })

  it('names photos by arrival time; only those names count as phone photos', () => {
    const name = phonePhotoName(new Date(2026, 10, 4, 9, 30, 15), 'jpg', () => 0.5)
    expect(name).toBe('phone-20261104-093015-800000.jpg')
    expect(PHONE_PHOTO_RE.test(name)).toBe(true)
    for (const bad of ['beach.jpg', '../phone-20261104-093015-800000.jpg', 'phone-20261104-093015-800000.jpg.exe'])
      expect(PHONE_PHOTO_RE.test(bad)).toBe(false)
  })
})

describe('slideshow deck', () => {
  it('a newly added photo leads the next pass; the first load is shuffled as usual', () => {
    const deck = new ShuffleDeck<string>(() => 0.3)
    deck.setItems(['a', 'b', 'c'])
    deck.next()
    deck.setItems(['a', 'b', 'c', 'new'])
    expect(deck.next()).toBe('new')
    const rest = [deck.next(), deck.next(), deck.next()]
    expect(rest.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('companion photo routes', () => {
  let server: CompanionServer | null = null
  let staticRoot: string | null = null
  afterEach(() => {
    server?.stop()
    server = null
    if (staticRoot) rmSync(staticRoot, { recursive: true, force: true })
  })

  async function boot() {
    staticRoot = mkdtempSync(join(tmpdir(), 'osl-photos-'))
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>')
    const store = new Map<string, Buffer>()
    const settings = {
      getRaw: () => null,
      setRaw: () => {},
      deleteRaw: () => {},
      getAll: () => ({ companion: { enabled: true, port: 0 } }) as never,
      set: () => ({}) as never
    } as unknown as SettingsService
    const tokens = createCompanionTokens(settingsMemory())
    server = createCompanionServer({
      settings,
      tokens,
      dispatch: async () => ({ ok: true, data: null }),
      version: 'test',
      staticRoot,
      photos: {
        add: async (buf) => {
          if (!sniffImage(buf)) throw new Error('Not a JPEG, PNG or WebP photo')
          const name = phonePhotoName(new Date(), 'jpg')
          store.set(name, buf)
          return { name, addedAt: new Date().toISOString() }
        },
        list: async () => [...store.keys()].map((name) => ({ name, addedAt: '' })),
        thumb: (name) => store.get(name) ?? null,
        remove: async (name) => PHONE_PHOTO_RE.test(name) && store.delete(name)
      }
    })
    server.applySettings()
    for (let i = 0; i < 100 && !server.getStatus().running; i++) await new Promise((r) => setTimeout(r, 10))
    const url = server.issueToken().url
    return { base: `http://127.0.0.1:${new URL(url).port}`, auth: { Authorization: `Bearer ${url.split('#t=')[1]}` }, store }
  }

  function settingsMemory(): SettingsService {
    const m = new Map<string, string>()
    return {
      getRaw: (k: string) => m.get(k) ?? null,
      setRaw: (k: string, v: string) => void m.set(k, v),
      deleteRaw: (k: string) => void m.delete(k)
    } as unknown as SettingsService
  }

  it('needs a paired phone for every photo route', async () => {
    const { base } = await boot()
    expect((await fetch(`${base}/api/photos`)).status).toBe(401)
    expect((await fetch(`${base}/api/photos`, { method: 'POST', body: JPEG })).status).toBe(401)
    expect((await fetch(`${base}/api/photos/phone-20261104-093015-800000.jpg`, { method: 'DELETE' })).status).toBe(401)
  })

  it('uploads, lists, serves a thumbnail and deletes', async () => {
    const { base, auth, store } = await boot()
    const up = (await (await fetch(`${base}/api/photos`, { method: 'POST', headers: auth, body: JPEG })).json()) as { ok: boolean; data: { name: string } }
    expect(up.ok).toBe(true)
    expect(store.get(up.data.name)?.equals(JPEG)).toBe(true)

    const list = (await (await fetch(`${base}/api/photos`, { headers: auth })).json()) as { data: { name: string }[] }
    expect(list.data.map((p) => p.name)).toEqual([up.data.name])

    const thumb = await fetch(`${base}/api/photos/${up.data.name}/thumb`, { headers: auth })
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('content-type')).toBe('image/jpeg')

    expect((await fetch(`${base}/api/photos/${up.data.name}`, { method: 'DELETE', headers: auth })).status).toBe(200)
    expect(store.size).toBe(0)
  })

  it('refuses non-images, oversize uploads and deleting anything but phone photos', async () => {
    const { base, auth } = await boot()
    const svg = await fetch(`${base}/api/photos`, { method: 'POST', headers: auth, body: '<svg/>' })
    expect(svg.status).toBe(400)
    const huge = await fetch(`${base}/api/photos`, { method: 'POST', headers: auth, body: Buffer.alloc(11 * 1024 * 1024) }).catch(() => null)
    expect(huge === null || huge.status === 413).toBe(true)
    expect((await fetch(`${base}/api/photos/beach.jpg`, { method: 'DELETE', headers: auth })).status).toBe(404)
    expect((await fetch(`${base}/api/photos/..%2Fsecret.jpg`, { method: 'DELETE', headers: auth })).status).toBe(404)
  })
})
