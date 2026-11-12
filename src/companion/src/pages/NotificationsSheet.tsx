import { useEffect, useState } from 'react'
import { NO_PUSH, PUSH_KINDS, PUSH_LABELS, type PushPrefs } from '@shared/pushAlerts'
import { rpc } from '../api/client'
import { currentSubscription, disablePush, enablePush, pushSupported, savePush, type PushHandle } from '../api/push'
import { isNativeApp } from '../api/base'
import { NativePush } from '../api/nativePush'
import { GhostButton, PrimaryButton } from '../components/ui'
import { getPhoneName, PHONE_NAME_MAX, setPhoneName } from '../lib/phoneName'

/** Whose phone this was (from the old Chat "From"); kept for phones that turned notifications on before names. */
const AUTHOR_KEY = 'osl.noteAuthor'

function rememberedPerson(): string | null {
  try {
    return localStorage.getItem(AUTHOR_KEY)
  } catch {
    return null
  }
}

/**
 * Phone notifications: every alert is off until this phone picks it. Saved on the kiosk per
 * phone; changes after turning on save straight away.
 */
export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  const [sub, setSub] = useState<PushHandle | null>(null)
  const [loaded, setLoaded] = useState(!pushSupported())
  const [prefs, setPrefs] = useState<PushPrefs>(NO_PUSH)
  const [personId, setPersonId] = useState<string | null>(rememberedPerson)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!pushSupported()) return
    void (async () => {
      const s = await currentSubscription()
      if (s) {
        const saved = await rpc('notify:get', { endpoint: s.endpoint }).catch(() => null)
        if (saved) {
          setPrefs(saved.prefs)
          setPersonId(saved.personId)
        }
        setSub(saved ? s : null)
        // on for the kiosk, but blocked on the phone since: say so, or it just looks broken
        if (saved && isNativeApp()) {
          const { notifications } = await NativePush.checkPermissions().catch(() => ({ notifications: 'granted' as const }))
          if (notifications !== 'granted') {
            setMessage("Notifications are off for Family Skyview in the phone's Settings → Apps → Family Skyview → Notifications.")
          }
        }
      }
      setLoaded(true)
    })()
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // once on, every change is saved right away
  const update = (nextPrefs: PushPrefs, nextPerson: string | null): void => {
    setPrefs(nextPrefs)
    setPersonId(nextPerson)
    if (sub) void run(() => savePush(sub, nextPerson, nextPrefs))
  }

  const anyOn = PUSH_KINDS.some((k) => prefs[k])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[90%] w-full overflow-y-auto rounded-t-3xl bg-card p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        data-notifications-sheet
      >
        <h2 className="font-display text-xl font-semibold">🔔 Notifications</h2>
        <PhoneNameField />
        {!pushSupported() ? (
          <p className="mt-2 mb-4 text-base font-semibold text-ink-soft">
            Notifications only work when this app is opened from the kiosk's <b>Tailscale (https)</b> address. On the
            kiosk, open Settings → Phone app, switch the QR code to Tailscale, and scan it with this phone.
          </p>
        ) : !loaded ? (
          <p className="mt-2 mb-4 text-base font-semibold text-ink-faint">Loading…</p>
        ) : (
          <>
            <p className="mt-1 mb-3 text-sm font-semibold text-ink-soft">
              {sub ? 'On for this phone. Pick what it tells you about:' : 'Pick what this phone should tell you about, then turn them on.'}
            </p>
            <div className="mb-4 flex flex-col gap-1">
              {PUSH_KINDS.map((k) => (
                <label key={k} className="flex min-h-12 items-center gap-3 rounded-xl px-1 text-base font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={prefs[k]}
                    onChange={(e) => update({ ...prefs, [k]: e.target.checked }, personId)}
                    className="h-6 w-6 shrink-0 accent-ember"
                  />
                  {PUSH_LABELS[k]}
                </label>
              ))}
            </div>
            {message && <p className="mb-3 text-sm font-bold text-ember-deep">{message}</p>}
            <div className="flex flex-wrap gap-2 [&>*]:flex-1">
              {sub ? (
                <>
                  <PrimaryButton
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const { delivered } = await rpc('notify:test', { endpoint: sub.endpoint })
                        setMessage(delivered ? 'Test sent — it should pop up in a moment.' : "The test didn't go through.")
                      })
                    }
                  >
                    Send a test
                  </PrimaryButton>
                  <GhostButton
                    onClick={() =>
                      void run(async () => {
                        await disablePush(sub)
                        setSub(null)
                      })
                    }
                  >
                    Turn off
                  </GhostButton>
                </>
              ) : (
                <PrimaryButton
                  disabled={busy || !anyOn}
                  onClick={() => void run(async () => setSub(await enablePush(personId, prefs)))}
                >
                  {busy ? 'Turning on…' : 'Turn on notifications'}
                </PrimaryButton>
              )}
            </div>
          </>
        )}
        <div className="mt-3 flex [&>*]:flex-1">
          <GhostButton onClick={onClose}>Close</GhostButton>
        </div>
      </div>
    </div>
  )
}

/** "This phone's name": shown on the messages it sends and in their notifications. Changeable any time. */
function PhoneNameField() {
  const [saved, setSaved] = useState(getPhoneName)
  const [draft, setDraft] = useState(saved)
  const changed = draft.trim() !== saved
  return (
    <div className="mt-3 mb-4" data-phone-name>
      <div className="mb-1.5 text-xs font-extrabold tracking-wide text-ink-faint uppercase">This phone's name</div>
      <div className="flex gap-2">
        <input
          value={draft}
          maxLength={PHONE_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Sean's phone"
          className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-line bg-paper px-3 text-base font-semibold outline-none placeholder:text-ink-faint focus:border-ember"
        />
        {changed && (
          <PrimaryButton
            onClick={() => {
              setPhoneName(draft)
              setSaved(getPhoneName())
            }}
          >
            Save
          </PrimaryButton>
        )}
      </div>
      <p className="mt-1 text-xs font-bold text-ink-faint">Shown on the chat messages this phone sends.</p>
    </div>
  )
}
