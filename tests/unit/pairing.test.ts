import { describe, expect, it } from 'vitest'
import { kioskBases, parsePairingLink } from '../../src/shared/pairing'

describe('Android app pairing (Family Skyview)', () => {
  it('reads the kiosk address and token from the QR link', () => {
    expect(parsePairingLink('http://192.168.1.20:8420/#t=abc_DEF-123')).toEqual({ base: 'http://192.168.1.20:8420', token: 'abc_DEF-123' })
    expect(parsePairingLink(' https://surface.tail1234.ts.net/#t=xyz ')).toEqual({ base: 'https://surface.tail1234.ts.net', token: 'xyz' })
  })

  it('anything else is not a pairing code', () => {
    expect(parsePairingLink('http://192.168.1.20:8420/')).toBeNull()
    expect(parsePairingLink('hello')).toBeNull()
    expect(parsePairingLink('ftp://x/#t=abc')).toBeNull()
  })

  it('tries home Wi-Fi first, then Tailscale, then where it was scanned from', () => {
    expect(
      kioskBases('https://surface.tail1234.ts.net', { lan: ['http://192.168.1.20:8420/'], secure: 'https://surface.tail1234.ts.net/' })
    ).toEqual(['http://192.168.1.20:8420', 'https://surface.tail1234.ts.net'])
    expect(kioskBases('http://10.0.2.2:8420', { lan: ['http://192.168.1.20:8420/'], secure: null })).toEqual([
      'http://192.168.1.20:8420',
      'http://10.0.2.2:8420'
    ])
    expect(kioskBases('http://192.168.1.20:8420', null)).toEqual(['http://192.168.1.20:8420'])
  })
})
