/**
 * Environment Canada weather alerts (MSC GeoMet OGC API, no key):
 * https://api.weather.gc.ca/collections/weather-alerts — GeoJSON features, one per alert per area.
 */

export type AlertKind = 'warning' | 'watch' | 'advisory' | 'statement'

export interface WeatherAlert {
  id: string
  kind: AlertKind
  /** e.g. "Snowfall warning" */
  title: string
  /** Environment Canada's risk colour, when it gives one */
  colour: 'red' | 'orange' | 'yellow' | null
  text: string
  area: string
  /** UTC ISO; when the bulletin lapses unless Environment Canada renews it (not when the weather ends) */
  expires: string | null
}

interface GeoMetProps {
  alert_code?: string
  alert_type?: string
  alert_name_en?: string
  alert_text_en?: string
  risk_colour_en?: string | null
  status_en?: string
  feature_name_en?: string
  expiration_datetime?: string | null
}

const RANK: Record<AlertKind, number> = { warning: 0, watch: 1, advisory: 2, statement: 3 }

/** Alerts URL for a point: a tiny box around it catches every area polygon containing it. */
export function alertsUrl(lat: number, lon: number): string {
  const d = 0.01
  return (
    'https://api.weather.gc.ca/collections/weather-alerts/items?f=json&lang=en&skipGeometry=true&limit=50' +
    `&bbox=${(lon - d).toFixed(3)},${(lat - d).toFixed(3)},${(lon + d).toFixed(3)},${(lat + d).toFixed(3)}`
  )
}

/** Current alerts, most serious first: ended/cancelled/expired dropped, one per alert type. */
export function parseAlerts(body: unknown, nowMs: number): WeatherAlert[] {
  const features = (body as { features?: { id?: string; properties?: GeoMetProps }[] })?.features ?? []
  const byCode = new Map<string, WeatherAlert>()
  for (const f of features) {
    const p = f.properties ?? {}
    const kind = p.alert_type as AlertKind
    if (!(kind in RANK)) continue
    if (p.status_en === 'ended' || p.status_en === 'cancelled') continue
    if (p.expiration_datetime && Date.parse(p.expiration_datetime) < nowMs) continue
    const name = (p.alert_name_en ?? kind).trim()
    const colour = p.risk_colour_en === 'red' || p.risk_colour_en === 'orange' || p.risk_colour_en === 'yellow' ? p.risk_colour_en : null
    const code = p.alert_code ?? name
    if (byCode.has(code)) continue
    byCode.set(code, {
      id: f.id ?? code,
      kind,
      title: name.charAt(0).toUpperCase() + name.slice(1),
      colour,
      text: (p.alert_text_en ?? '').trim(),
      area: p.feature_name_en ?? '',
      expires: p.expiration_datetime ?? null
    })
  }
  return [...byCode.values()].sort((a, b) => RANK[a.kind] - RANK[b.kind])
}
