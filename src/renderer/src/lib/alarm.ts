/**
 * A gentle repeating chime via the Web Audio API — no bundled sound file. Each loop is
 * reference-counted, so several ringing timers share one; loops share the audio context.
 */
let ctx: AudioContext | null = null

function chime(): void {
  if (!ctx) return
  const now = ctx.currentTime
  // a two-note ding, soft attack/release so it isn't harsh on a kitchen wall
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + i * 0.18
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.22, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.55)
  }
}

/** A chime that rings now and then every `intervalMs` while anything holds it. */
function chimeLoop(intervalMs: number): { start(): void; stop(): void } {
  let loop: number | undefined
  let refs = 0
  return {
    start() {
      refs += 1
      if (loop !== undefined) return
      try {
        ctx = ctx ?? new AudioContext()
        void ctx.resume()
      } catch {
        return
      }
      chime()
      loop = window.setInterval(chime, intervalMs)
    },
    stop() {
      refs = Math.max(0, refs - 1)
      if (refs > 0 || loop === undefined) return
      window.clearInterval(loop)
      loop = undefined
    }
  }
}

/** Finished kitchen timers: insistent. */
const timerAlarm = chimeLoop(1500)
export const startAlarm = timerAlarm.start
export const stopAlarm = timerAlarm.stop

/** A family note waiting on the kiosk: a ding every 10 seconds until it's marked done. */
export const NOTE_CHIME_MS = 10_000
const noteChime = chimeLoop(NOTE_CHIME_MS)
export const startNoteChime = noteChime.start
export const stopNoteChime = noteChime.stop
