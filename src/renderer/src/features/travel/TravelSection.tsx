import { useState } from 'react'
import { useSettings, useSettingsMutation, useTravelMutations, useTravelStatus } from '../../api/hooks'
import { BigButton, FieldLabel, SegmentedControl, Toggle } from '../../components/ui'
import { OskInput } from '../../components/Osk'

const BUFFERS = ['0', '5', '10', '15'] as const

/**
 * Settings → Calendars: "Leave by" drive times. Home address, a buffer for getting out the door,
 * the Google Maps API key (stored encrypted on this tablet), a test lookup, and this month's usage.
 */
export function TravelSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  const { data: status } = useTravelStatus()
  const travelMutations = useTravelMutations()
  const [address, setAddress] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  if (!settings) return null
  const travel = settings.travel
  const save = (patch: Partial<typeof travel>): void => mutation.mutate({ travel: { ...travel, ...patch } })
  const addressDraft = address ?? travel.homeAddress

  const runTest = (): void => {
    setTestResult('Checking…')
    travelMutations.test.mutate(
      { destination: testTo.trim() },
      {
        onSuccess: (r) => setTestResult(r.minutes === null ? "Google couldn't find a drive there" : `${r.minutes} min drive right now`),
        onError: (e) => setTestResult(e instanceof Error ? e.message : 'That did not work')
      }
    )
  }

  return (
    <div className="mt-6" data-travel-section>
      <FieldLabel>🚗 Leave-by times</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            Show when to leave for events with a location, with a chime and banner when it's time to go
          </span>
          <Toggle checked={travel.enabled} onChange={(enabled) => save({ enabled })} label="Leave-by times" />
        </div>

        {travel.enabled && (
          <>
            <div>
              <div className="mb-1 text-sm font-bold text-ink-soft">Home address (where trips start)</div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <OskInput value={addressDraft} onChange={setAddress} placeholder="e.g. 123 Main St NW, Edmonton, AB" />
                </div>
                {address !== null && address.trim() !== travel.homeAddress && (
                  <BigButton
                    onClick={() => {
                      save({ homeAddress: address.trim() })
                      setAddress(null)
                    }}
                  >
                    Save
                  </BigButton>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-ink-soft">Extra time to get out the door</span>
              <SegmentedControl
                value={String(travel.bufferMinutes) as (typeof BUFFERS)[number]}
                onChange={(v) => save({ bufferMinutes: Number(v) })}
                options={BUFFERS.map((b) => ({ value: b, label: `${b} min` }))}
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-bold text-ink-soft">Google Maps API key (Routes API)</div>
              {status?.keySet ? (
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-base font-bold text-ink" data-travel-key-saved>
                    ✓ Key saved on this tablet
                  </span>
                  <BigButton variant="ghost" onClick={() => travelMutations.setApiKey.mutate({ apiKey: null })}>
                    Remove key
                  </BigButton>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <OskInput value={key} onChange={setKey} placeholder="Paste the API key (starts with AIza…)" />
                  </div>
                  <BigButton
                    disabled={key.trim().length < 20}
                    onClick={() => {
                      travelMutations.setApiKey.mutate({ apiKey: key.trim() })
                      setKey('')
                    }}
                  >
                    Save key
                  </BigButton>
                </div>
              )}
            </div>

            {status?.keySet && travel.homeAddress && (
              <div>
                <div className="mb-1 text-sm font-bold text-ink-soft">Test a drive from home</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <OskInput value={testTo} onChange={setTestTo} placeholder="e.g. Terwillegar Rec Centre" />
                  </div>
                  <BigButton variant="ghost" disabled={testTo.trim().length < 3 || travelMutations.test.isPending} onClick={runTest}>
                    Test
                  </BigButton>
                </div>
                {testResult && (
                  <p className="mt-1 text-base font-bold text-ink" data-travel-test-result>
                    {testResult}
                  </p>
                )}
              </div>
            )}

            {status && (
              <p className="text-sm font-semibold text-ink-faint" data-travel-usage>
                Lookups: {status.callsToday} today, {status.callsThisMonth} this month (stops at {status.dailyCap}/day and{' '}
                {status.monthlyCap.toLocaleString()}/month — Google's free amount is 5,000/month).
              </p>
            )}
            {status?.lastError && <p className="text-sm font-bold text-ember-deep">⚠ {status.lastError}</p>}
          </>
        )}
      </div>
    </div>
  )
}
