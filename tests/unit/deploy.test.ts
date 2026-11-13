import { describe, expect, it } from 'vitest'
import { parseManifest, prevPath, psQuote, shouldApply, swapScript } from '../../src/main/deploy/deployFiles'

const SHA = 'a'.repeat(64)

describe('network deploy to the tablet (v0.8.183)', () => {
  it('reads a deploy manifest', () => {
    expect(parseManifest(JSON.stringify({ version: '0.8.183', file: 'OpenSkyLight-next.exe', sha256: SHA.toUpperCase() }))).toEqual({
      version: '0.8.183',
      file: 'OpenSkyLight-next.exe',
      sha256: SHA,
      force: false
    })
  })

  it('refuses anything odd: paths, non-exe files, bad versions or checksums', () => {
    const ok = { version: '0.8.183', file: 'OpenSkyLight-next.exe', sha256: SHA }
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, file: '..\\evil.exe' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, file: 'C:\\Windows\\x.exe' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, file: 'sub/x.exe' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, file: 'next.bat' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, version: '0.8' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...ok, sha256: 'abc' }))).toBeNull()
  })

  it('installs only a newer version, unless forced', () => {
    const m = (version: string, force = false) => ({ version, file: 'x.exe', sha256: SHA, force })
    expect(shouldApply('0.8.182', m('0.8.183'))).toBe(true)
    expect(shouldApply('0.8.183', m('0.8.183'))).toBe(false)
    expect(shouldApply('0.8.183', m('0.8.170'))).toBe(false)
    expect(shouldApply('0.8.183', m('0.8.170', true))).toBe(true)
  })

  it('keeps the old exe beside the new one for rollback, under the autorun name', () => {
    expect(prevPath('C:\\Kiosk\\dist\\OpenSkyLight 0.8.0.exe')).toBe('C:\\Kiosk\\dist\\OpenSkyLight 0.8.0.prev.exe')
  })

  it('the swap script quotes every path for PowerShell', () => {
    expect(psQuote("C:\\Bob's kiosk\\a.exe")).toBe("'C:\\Bob''s kiosk\\a.exe'")
    const s = swapScript({
      exe: "C:\\Bob's\\OpenSkyLight 0.8.0.exe",
      next: 'C:\\x\\OpenSkyLight-next.exe',
      manifest: 'C:\\x\\next.json',
      okFile: 'C:\\u\\deploy-ok.json',
      log: 'C:\\u\\deploy.log',
      version: '0.8.183'
    })
    expect(s).toContain("$exe = 'C:\\Bob''s\\OpenSkyLight 0.8.0.exe'")
    expect(s).toContain("$prev = 'C:\\Bob''s\\OpenSkyLight 0.8.0.prev.exe'")
    expect(s).toContain("$version = '0.8.183'")
    // waits for the new version to report in, else puts the old one back
    expect(s).toMatch(/ConvertFrom-Json\)\.version -eq \$version/)
    expect(s).toContain('rolling back')
  })
})
