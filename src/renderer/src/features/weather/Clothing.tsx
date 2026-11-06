import { useState } from 'react'
import { CLOTHING_EMOJI, CLOTHING_LABEL, fromCelsius, pickClothing, toCelsius, type Clothing } from '@shared/clothing'
import { useSettings, useSettingsMutation, useWeather } from '../../api/hooks'
import { BigButton, FieldLabel, Toggle } from '../../components/ui'
import { OskInput } from '../../components/Osk'

/** Today's shorts / pants / jacket, or null when it's off or there's no forecast. */
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

/** Settings → General: turn the clothing icon on, and the minimum high for shorts and for pants. */
export function ClothingSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  const [shorts, setShorts] = useState<string | null>(null)
  const [pants, setPants] = useState<string | null>(null)
  if (!settings) return null
  const unit = settings.temperatureUnit
  const c = settings.clothing
  const shortsDraft = shorts ?? String(fromCelsius(c.shortsMinC, unit))
  const pantsDraft = pants ?? String(fromCelsius(c.pantsMinC, unit))
  const num = (s: string): number => (/^-?\d{1,3}$/.test(s) ? Number(s) : NaN)
  const changed = shorts !== null || pants !== null
  const valid = Number.isFinite(num(shortsDraft)) && Number.isFinite(num(pantsDraft)) && num(shortsDraft) > num(pantsDraft)
  const save = (): void => {
    mutation.mutate({
      clothing: { ...c, shortsMinC: toCelsius(num(shortsDraft), unit), pantsMinC: toCelsius(num(pantsDraft), unit) }
    })
    setShorts(null)
    setPants(null)
  }
  // one grid for both rows, so the number boxes line up whatever the label length
  const row = (emoji: string, label: string, value: string, set: (v: string) => void) => (
    <>
      <span className="text-2xl">{emoji}</span>
      <span className="text-base font-bold text-ink-soft">{label} when the high is at least</span>
      <div className="w-20">
        <OskInput value={value} onChange={(v) => set(v.replace(/[^\d-]/g, '').slice(0, 4))} />
      </div>
      <span className="text-base font-bold text-ink-soft">°{unit.toUpperCase()}</span>
    </>
  )
  return (
    <div data-clothing-section>
      <FieldLabel>👕 What to wear</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            Show shorts, pants or a jacket from today's forecast high, on the screensaver and in the header beside the forecast
          </span>
          <Toggle checked={c.enabled} onChange={(enabled) => mutation.mutate({ clothing: { ...c, enabled } })} label="What to wear" />
        </div>
        {c.enabled && (
          <>
            <div className="grid grid-cols-[2rem_auto_5rem_1fr] items-center gap-x-3 gap-y-3" data-clothing-rows>
              {row(CLOTHING_EMOJI.shorts, 'Shorts', shortsDraft, setShorts)}
              {row(CLOTHING_EMOJI.pants, 'Pants', pantsDraft, setPants)}
            </div>
            <div className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-2xl">{CLOTHING_EMOJI.jacket}</span>
              <span className="flex-1 text-base font-bold text-ink-soft">Jacket below that</span>
              {changed && (
                <BigButton disabled={!valid} onClick={save}>
                  Save
                </BigButton>
              )}
            </div>
            {changed && !valid && <p className="text-sm font-bold text-ember-deep">Shorts need a higher minimum than pants.</p>}
          </>
        )}
      </div>
    </div>
  )
}
