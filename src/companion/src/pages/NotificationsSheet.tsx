import { useEffect, useState } from 'react'
import { NO_PUSH, PUSH_KINDS, PUSH_LABELS, type PushPrefs } from '@shared/pushAlerts'
import { rpc } from '../api/client'
import { usePeople } from '../api/hooks'
import { currentSubscription, disablePush, enablePush, pushSupported, savePush } from '../api/push'
import { GhostButton, PersonAvatar, PrimaryButton } from '../components/ui'

/** Whose phone this is — shared with Chat's "From", so it's usually already set. */
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
  const { data: people = [] } = usePeople()
  const [sub, setSub] = useState<PushSubscription | null>(null)
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
            {people.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-extrabold tracking-wide text-ink-faint uppercase">Whose phone is this?</div>
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={personId === p.id}
                      onClick={() => update(prefs, personId === p.id ? null : p.id)}
                      className={`pressable flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-bold ${
                        personId === p.id ? 'bg-ink text-paper' : 'bg-paper-deep text-ink-soft'
                      }`}
                    >
                      <PersonAvatar name={p.name} color={p.color} size="sm" />
                      {p.name}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs font-bold text-ink-faint">So it isn't told about its own chat messages.</p>
              </div>
            )}
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
