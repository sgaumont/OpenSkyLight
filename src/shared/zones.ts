import { IANAZone, Zone } from 'luxon'

/**
 * Alberta stopped changing clocks: its Official Time Act (June 2026) kept it on UTC−6 from
 * 2026-11-01 on ("Alberta Time"). Electron's bundled tz rules (2024b) still fall back to UTC−7,
 * so repeating America/Edmonton events would land an hour late while Google places them right.
 * Remove once the bundled ICU knows about it.
 */
const ALBERTA_CUTOVER_MS = Date.UTC(2026, 10, 1, 8) // 2 am MDT, when the old rules fell back

class AlbertaZone extends Zone {
  private readonly old = IANAZone.create('America/Edmonton')
  get type(): string {
    return 'alberta'
  }
  get name(): string {
    return 'America/Edmonton'
  }
  get ianaName(): string {
    return 'America/Edmonton'
  }
  get isUniversal(): boolean {
    return false
  }
  get isValid(): boolean {
    return true
  }
  offset(ts: number): number {
    return ts >= ALBERTA_CUTOVER_MS ? -360 : this.old.offset(ts)
  }
  offsetName(ts: number, opts: { format?: 'short' | 'long'; locale?: string }): string | null {
    return ts >= ALBERTA_CUTOVER_MS ? (opts.format === 'long' ? 'Alberta Time' : 'ABT') : this.old.offsetName(ts, opts)
  }
  formatOffset(ts: number, format: 'narrow' | 'short' | 'techie'): string {
    return ts >= ALBERTA_CUTOVER_MS ? IANAZone.create('America/Regina').formatOffset(ts, format) : this.old.formatOffset(ts, format)
  }
  equals(other: Zone): boolean {
    return other instanceof AlbertaZone
  }
}

const alberta = new AlbertaZone()
const ALBERTA_NAMES = new Set(['America/Edmonton', 'America/Yellowknife', 'Canada/Mountain'])

/** The Luxon zone to use for an IANA name, with rule changes newer than the bundled tz data. */
export function zoneFor(name: string): Zone | string {
  return ALBERTA_NAMES.has(name) ? alberta : name
}
