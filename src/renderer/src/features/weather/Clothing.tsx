import { useState } from 'react'
import { CLOTHING_EMOJI, CLOTHING_LABEL, fromCelsius, pickClothing, toCelsius, type Clothing } from '@shared/clothing'
import { useSettings, useSettingsMutation, useWeather } from '../../api/hooks'
import { BigButton, FieldLabel, Toggle } from '../../components/ui'
import { OskInput } from '../../components/Osk'

/** Today's shorts or pants, or null when it's off or there's no forecast. */
export function useTodaysClothing(): Clothing | null {
  const { data: settings } = useSettings()
  const { data: weather } = useWeather()
  const today = weather?.daily[0]
  if (!settings?.clothing.enabled || !today) return null
  return pickClothing(today.high, settings.temperatureUnit, settings.clothing)
}

/** The emoji itself, sized by the caller. */
export function ClothingEmoji({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const clothing = useTodaysClothing()
  if (!clothing) return null
  return (
    <span role="img" aria-label={`${CLOTHING_LABEL[clothing]} today`} title={`${CLOTHING_LABEL[clothing]} today`} className={className} style={style} data-clothing={clothing}>
      {CLOTHING_EMOJI[clothing]}
    </span>
  )
}

/** Settings → General: turn the clothing icon on, and the minimum high for shorts (pants below it). */
export function ClothingSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  const [shorts, setShorts] = useState<string | null>(null)
  if (!settings) return null
  const unit = settings.temperatureUnit
  const c = settings.clothing
  const shortsDraft = shorts ?? String(fromCelsius(c.shortsMinC, unit))
  const num = (s: string): number => (/^-?\d{1,3}$/.test(s) ? Number(s) : NaN)
  const changed = shorts !== null
  const valid = Number.isFinite(num(shortsDraft))
  const save = (): void => {
    mutation.mutate({ clothing: { enabled: c.enabled, shortsMinC: toCelsius(num(shortsDraft), unit) } })
    setShorts(null)
  }
  return (
    <div data-clothing-section>
      <FieldLabel>👕 What to wear</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            Show shorts or pants from today's forecast high, on the screensaver and in the header beside the forecast
          </span>
          <Toggle checked={c.enabled} onChange={(enabled) => mutation.mutate({ clothing: { ...c, enabled } })} label="What to wear" />
        </div>
        {c.enabled && (
          <>
            <div className="grid grid-cols-[2rem_auto_5rem_1fr] items-center gap-x-3 gap-y-3" data-clothing-rows>
              <span className="text-2xl">{CLOTHING_EMOJI.shorts}</span>
              <span className="text-base font-bold text-ink-soft">Shorts when the high is at least</span>
              <div className="w-20">
                <OskInput value={shortsDraft} onChange={(v) => setShorts(v.replace(/[^\d-]/g, '').slice(0, 4))} />
              </div>
              <span className="text-base font-bold text-ink-soft">°{unit.toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-2xl">{CLOTHING_EMOJI.pants}</span>
              <span className="flex-1 text-base font-bold text-ink-soft">Pants below that</span>
              {changed && (
                <BigButton disabled={!valid} onClick={save}>
                  Save
                </BigButton>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
