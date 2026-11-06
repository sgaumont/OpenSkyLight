import { useState, type ComponentType, type SVGProps } from 'react'
import { DateTime } from 'luxon'
import { useWeather } from '../../api/hooks'
import { Dialog } from '../../components/ui'
import { AlertDetails, alertColours } from './WeatherAlerts'
import { ClothingEmoji } from './Clothing'
import {
  AlertIcon,
  CloudIcon,
  CloudSunIcon,
  FogIcon,
  MoonIcon,
  RainIcon,
  SnowIcon,
  StormIcon,
  SunIcon
} from '../../components/icons'

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>

/** WMO weather code → icon */
export function weatherIcon(code: number, isDay: boolean): Icon {
  if (code === 0) return isDay ? SunIcon : MoonIcon
  if (code <= 2) return isDay ? CloudSunIcon : MoonIcon
  if (code === 3) return CloudIcon
  if (code === 45 || code === 48) return FogIcon
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return RainIcon
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return SnowIcon
  if (code >= 95) return StormIcon
  return CloudIcon
}

export function WeatherButton() {
  const { data: weather } = useWeather()
  const [open, setOpen] = useState(false)
  if (!weather) return null
  const Icon = weatherIcon(weather.code, weather.isDay)
  const today = weather.daily[0]
  const alert = weather.alerts[0]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex shrink-0 items-center gap-2 rounded-2xl px-3 py-0.5 hover:bg-paper-deep/70 max-[1300px]:gap-1.5 max-[1300px]:px-2 max-[1300px]:py-1.5"
        aria-label={alert ? `Weather forecast — ${weather.alerts.map((a) => a.title).join(', ')}` : 'Weather forecast'}
      >
        {/* an Environment Canada alert: a badge in its risk colour; the dialog has the details */}
        {alert && (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full max-[1300px]:h-7 max-[1300px]:w-7"
            style={{ backgroundColor: alertColours(alert.colour).bg, color: alertColours(alert.colour).fg }}
          >
            <AlertIcon size={20} />
          </span>
        )}
        <Icon size={34} className="h-14 w-14 text-ember-deep max-[1300px]:h-10 max-[1300px]:w-10 max-[1150px]:h-[34px] max-[1150px]:w-[34px] min-[1500px]:h-16 min-[1500px]:w-16" />
        <span className="font-display text-[3.5rem] leading-none max-[1300px]:text-[2.5rem] max-[1150px]:text-3xl min-[1500px]:text-[3.75rem]">{weather.temperature}°</span>
        {/* today's expected high over low, like the weather tile — stacked to stay narrow */}
        {today && (
          <span
            className="flex flex-col items-end gap-0.5 text-xl leading-none font-bold tabular-nums"
            aria-label={`Today: high ${today.high}°, low ${today.low}°`}
          >
            <span>{today.high}°</span>
            <span className="text-ink-faint">{today.low}°</span>
          </span>
        )}
        {/* hidden on narrow displays — the tap-for-forecast dialog still has all 5 days */}
        {weather.daily.length > 1 && (
          <span className="ml-1 hidden items-center gap-2.5 border-l border-ink-faint/30 pl-3 min-[1500px]:flex">
            {weather.daily.slice(1, 3).map((d) => {
              const DayIcon = weatherIcon(d.code, true)
              return (
                <span key={d.date} className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] leading-none font-extrabold text-ink-faint uppercase">
                    {DateTime.fromISO(d.date).toFormat('ccc')}
                  </span>
                  <DayIcon size={17} className="text-ember-deep" />
                  <span className="text-[11px] leading-none font-bold">
                    {d.high}°<span className="text-ink-faint"> {d.low}°</span>
                  </span>
                </span>
              )
            })}
          </span>
        )}
        {/* today's shorts / pants / jacket, right of the forecast (when that's on); a light disc
            because Windows draws the jacket dark grey, lost on the dark theme otherwise */}
        <ClothingEmoji className="ml-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-[2.1rem] leading-none shadow-card max-[1300px]:h-11 max-[1300px]:w-11 max-[1300px]:text-[1.6rem] max-[1150px]:h-9 max-[1150px]:w-9 max-[1150px]:text-[1.3rem]" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={weather.label}>
        {weather.alerts.length > 0 && (
          <div className="mb-4">
            <AlertDetails alerts={weather.alerts} />
          </div>
        )}
        <div className="grid grid-cols-5 gap-2">
          {/* today + 4: the 6th fetched day is only for the Home weather tile */}
          {weather.daily.slice(0, 5).map((d, i) => {
            const DayIcon = weatherIcon(d.code, true)
            return (
              <div key={d.date} className="flex flex-col items-center gap-1.5 rounded-2xl bg-paper-deep/50 px-1 py-3">
                <span className="text-sm font-extrabold text-ink-faint uppercase">
                  {i === 0 ? 'Today' : DateTime.fromISO(d.date).toFormat('ccc')}
                </span>
                <DayIcon size={30} className="text-ember-deep" />
                <span className="text-lg font-bold">{d.high}°</span>
                <span className="text-base font-bold text-ink-faint">{d.low}°</span>
                {d.precipProb !== null && d.precipProb > 20 && (
                  <span className="text-xs font-extrabold text-[#0091FF]">{d.precipProb}%</span>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-center text-sm font-semibold text-ink-faint">
          Updated {DateTime.fromISO(weather.fetchedAt).toRelative()} · change location in Settings
        </p>
      </Dialog>
    </>
  )
}
