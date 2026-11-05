import type { OccurrenceDto, PersonDto } from '@shared/types'
import { formatTime, textOn } from '../../lib/format'
import { MapPinIcon, RepeatIcon } from '../../components/icons'
import { useLeaveTime } from '../../api/hooks'

/** "🚗 Leave 3:40" (or "· 18 min" too on a big card), for events with a known drive from home. */
export function LeaveBy({ occKey, timeFormat, long = false, className = '' }: { occKey: string; timeFormat: '12h' | '24h'; long?: boolean; className?: string }) {
  const t = useLeaveTime(occKey)
  if (!t) return null
  return (
    <div className={`truncate font-bold text-ink-soft ${className}`} data-leave-by>
      🚗 Leave {formatTime(t.leaveAt, timeFormat)}
      {long && <span className="font-semibold text-ink-faint"> · {t.driveMinutes} min drive</span>}
    </div>
  )
}

export function PersonDots({ personIds, peopleById }: { personIds: string[]; peopleById: Map<string, PersonDto> }) {
  if (personIds.length < 2) return null
  return (
    <span className="ml-auto flex shrink-0 -space-x-1.5">
      {personIds.slice(0, 4).map((id) => {
        const p = peopleById.get(id)
        if (!p) return null
        return (
          <span
            key={id}
            className="h-3.5 w-3.5 rounded-full ring-2 ring-card"
            style={{ backgroundColor: p.color }}
          />
        )
      })}
    </span>
  )
}

export function EventCard({
  occ,
  color,
  timeFormat,
  peopleById,
  onTap,
  size = 'md',
  wrap = false
}: {
  occ: OccurrenceDto
  color: string
  timeFormat: '12h' | '24h'
  peopleById: Map<string, PersonDto>
  onTap: () => void
  size?: 'md' | 'lg'
  /** show the whole title over as many lines as needed instead of cutting it off with "…" */
  wrap?: boolean
}) {
  // overflow-wrap:anywhere also breaks a single long word (e.g. a URL) inside narrow columns
  const titleFit = wrap ? '[overflow-wrap:anywhere]' : 'truncate'
  if (occ.allDay) {
    return (
      <button
        type="button"
        onClick={onTap}
        className={`pressable flex w-full items-center gap-2 rounded-xl px-3 text-left font-bold shadow-card ${
          size === 'lg' ? 'min-h-14 text-lg' : 'min-h-11 text-[15px]'
        } ${wrap ? 'py-2' : ''}`}
        style={{ backgroundColor: color, color: textOn(color) }}
      >
        <span className={`min-w-0 ${titleFit}`}>{occ.title}</span>
        {occ.isRecurring && <RepeatIcon size={14} className="shrink-0 opacity-70" />}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onTap}
      className={`pressable w-full rounded-xl bg-card text-left shadow-card ${
        size === 'lg' ? 'p-4' : 'px-3 py-2'
      }`}
      style={{ borderLeft: `5px solid ${color}` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`font-extrabold ${size === 'lg' ? 'text-base' : 'text-[13px]'}`} style={{ color }}>
          {formatTime(occ.start, timeFormat)}
        </span>
        {occ.isRecurring && <RepeatIcon size={13} className="shrink-0 text-ink-faint" />}
        <PersonDots personIds={occ.personIds} peopleById={peopleById} />
      </div>
      <div className={`${titleFit} font-bold text-ink ${size === 'lg' ? 'text-xl' : 'text-[15px]'}`}>{occ.title}</div>
      <LeaveBy occKey={occ.key} timeFormat={timeFormat} long={size === 'lg'} className={size === 'lg' ? 'mt-1 text-sm' : 'text-[12px]'} />
      {size === 'lg' && occ.location && (
        <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-ink-soft">
          <MapPinIcon size={14} />
          <span className="truncate">{occ.location}</span>
        </div>
      )}
    </button>
  )
}
