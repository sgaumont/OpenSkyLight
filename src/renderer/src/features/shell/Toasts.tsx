import { useToasts } from '../../stores/toastStore'
import { useGameTimers } from '../../api/hooks'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  // game time pills sit at the bottom centre: messages go above them while any are showing
  const { data: timers = [] } = useGameTimers()
  if (toasts.length === 0) return null
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-[84] flex flex-col items-center gap-2 ${timers.length > 0 ? 'bottom-28' : 'bottom-8'}`}>
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="animate-pop pointer-events-auto max-w-xl rounded-2xl bg-ink px-5 py-3 text-base font-bold text-paper shadow-float"
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
