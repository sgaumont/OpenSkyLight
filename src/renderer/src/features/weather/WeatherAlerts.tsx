import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DateTime } from 'luxon'
import type { WeatherAlert } from '@shared/weatherAlerts'
import { Dialog } from '../../components/ui'
import { AlertIcon } from '../../components/icons'
import { ZONE } from '../../stores/uiStore'

/** Environment Canada's risk colours; statements (no colour) are a quiet grey. */
export function alertColours(colour: WeatherAlert['colour']): { bg: string; fg: string } {
  if (colour === 'red') return { bg: '#E5484D', fg: '#FFFFFF' }
  if (colour === 'orange') return { bg: '#F76B15', fg: '#FFFFFF' }
  if (colour === 'yellow') return { bg: '#FFC53D', fg: '#2A1E06' }
  return { bg: '#8B8D98', fg: '#FFFFFF' }
}

/** Title of the most serious alert, "+N more" for the rest. */
export function alertSummary(alerts: WeatherAlert[]): string {
  return alerts.length > 1 ? `${alerts[0].title} +${alerts.length - 1}` : alerts[0].title
}

/** Every alert in full, most serious first — the body of the alerts dialog and the forecast dialog. */
export function AlertDetails({ alerts }: { alerts: WeatherAlert[] }) {
  return (
    <div className="flex flex-col gap-3">
      {alerts.map((a) => {
        const c = alertColours(a.colour)
        return (
          <div key={a.id} className="overflow-hidden rounded-2xl bg-paper-deep/50">
            <div className="flex items-center gap-2 px-4 py-2 text-lg font-extrabold" style={{ backgroundColor: c.bg, color: c.fg }}>
              <AlertIcon size={22} />
              {a.title}
            </div>
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-ink-faint">
                {a.area}
                {a.expires && ` · next update by ${DateTime.fromISO(a.expires).setZone(ZONE).toFormat('ccc h:mm a')}`}
              </p>
              {a.text && <p className="mt-2 text-base whitespace-pre-line text-ink-soft">{a.text}</p>}
            </div>
          </div>
        )
      })}
      <p className="text-xs font-bold text-ink-faint">From Environment and Climate Change Canada</p>
    </div>
  )
}

/** Coloured strip naming the current alerts; a tap shows them in full. Kept slim: it shares the weather tile with the forecast. */
export function AlertStrip({ alerts, className = '' }: { alerts: WeatherAlert[]; className?: string }) {
  const [open, setOpen] = useState(false)
  if (alerts.length === 0) return null
  const c = alertColours(alerts[0].colour)
  return (
    // the strip's taps (and, via the portal, the dialog's) must not count as a tap on the tile
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex w-full min-w-0 items-center gap-[0.35em] rounded-lg px-[0.6em] py-[0.2em] text-left leading-tight font-extrabold"
        // 12px, but never more than 11% of the tile's height (container units ignore the tile's
        // text-size zoom), so a big text size can't let the strip crowd out the forecast
        style={{ backgroundColor: c.bg, color: c.fg, fontSize: 'min(0.75rem, 11cqh)' }}
        aria-label={`Weather alerts: ${alerts.map((a) => a.title).join(', ')}`}
      >
        <AlertIcon size={13} className="h-[1.1em] w-[1.1em] shrink-0" />
        <span className="truncate">{alertSummary(alerts)}</span>
      </button>
      {/* portal: the dialog must escape the tile's clipping and text-size zoom */}
      {createPortal(
        <Dialog open={open} onClose={() => setOpen(false)} title="Weather alerts">
          <AlertDetails alerts={alerts} />
        </Dialog>,
        document.body
      )}
    </div>
  )
}
