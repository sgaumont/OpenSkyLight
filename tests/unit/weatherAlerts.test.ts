import { describe, expect, it } from 'vitest'
import { alertsUrl, parseAlerts } from '../../src/shared/weatherAlerts'

const now = Date.parse('2026-11-04T12:00:00Z')
const feature = (id: string, p: Record<string, unknown>) => ({
  id,
  properties: {
    alert_code: 'SFW',
    alert_type: 'warning',
    alert_name_en: 'snowfall warning',
    alert_text_en: 'Heavy snow.',
    risk_colour_en: 'yellow',
    status_en: 'issued',
    feature_name_en: 'City of Edmonton',
    expiration_datetime: '2026-11-05T00:00:00Z',
    ...p
  }
})

describe('Environment Canada alerts', () => {
  it('keeps current alerts, most serious first, one per alert type', () => {
    const alerts = parseAlerts(
      {
        features: [
          feature('a', { alert_code: 'SPS', alert_type: 'statement', alert_name_en: 'special weather statement', risk_colour_en: null }),
          feature('b', {}),
          feature('c', { feature_name_en: 'St. Albert' }) // same snowfall warning, neighbouring area
        ]
      },
      now
    )
    expect(alerts.map((a) => [a.title, a.kind, a.colour])).toEqual([
      ['Snowfall warning', 'warning', 'yellow'],
      ['Special weather statement', 'statement', null]
    ])
    expect(alerts[0]).toMatchObject({ area: 'City of Edmonton', text: 'Heavy snow.' })
  })

  it('drops ended, cancelled and expired alerts', () => {
    const alerts = parseAlerts(
      {
        features: [
          feature('a', { status_en: 'ended' }),
          feature('b', { alert_code: 'X', status_en: 'cancelled' }),
          feature('c', { alert_code: 'Y', expiration_datetime: '2026-11-04T11:00:00Z' })
        ]
      },
      now
    )
    expect(alerts).toEqual([])
  })

  it('tolerates an empty or odd response', () => {
    expect(parseAlerts({ features: [] }, now)).toEqual([])
    expect(parseAlerts(null, now)).toEqual([])
  })

  it('asks for a small box around the location', () => {
    expect(alertsUrl(53.55, -113.49)).toContain('bbox=-113.500,53.540,-113.480,53.560')
  })
})
