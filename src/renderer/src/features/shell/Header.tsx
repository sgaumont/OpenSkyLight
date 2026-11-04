import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { useBalances, usePeople, useSettings } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { SegmentedControl, IconButton } from '../../components/ui'
import { ChevronLeftIcon, ChevronRightIcon, GameIcon, GearIcon, PencilIcon, PlusIcon } from '../../components/icons'
import { WeatherButton } from '../weather/WeatherHeader'
import { IssueLine } from './IssueLine'
import { UseTimeDialog } from './UseTimeDialog'
import { initials, textOn } from '../../lib/format'
import type { CalendarViewKind } from '@shared/types'
import { eachDay, weekViewRange } from '@shared/dates'

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 20_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Person filter circles: hidden for now — this family doesn't assign events to people. */
const SHOW_PERSON_FILTER = false

/** narrow layouts (the 10" kiosk at 115%+ text): slightly smaller round buttons to leave room */
const NARROW_ICON = 'max-[1300px]:h-11 max-[1300px]:w-11'

function periodLabel(
  view: CalendarViewKind,
  focusedDate: string,
  weekViewStart: 'rolling' | 'fixed',
  weekStartsOn: 0 | 1
): string {
  const d = DateTime.fromISO(focusedDate, { zone: ZONE })
  if (view === 'home' || view === 'lists') return ''
  if (view === 'day' || view === 'chores') return d.toFormat('LLL d')
  if (view === 'month') return d.toFormat('LLLL yyyy')
  if (view === 'agenda') return `From ${d.toFormat('LLL d')}`
  // same range the week grid renders, so the label always matches the columns
  const days = eachDay(weekViewRange(focusedDate, ZONE, weekViewStart, weekStartsOn), ZONE)
  const start = days[0]
  const end = days[days.length - 1]
  return start.month === end.month
    ? `${start.toFormat('LLL d')} – ${end.toFormat('d')}`
    : `${start.toFormat('LLL d')} – ${end.toFormat('LLL d')}`
}

export function Header() {
  const now = useNow()
  const { data: settings } = useSettings()
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const kids = people.filter((p) => p.role === 'child')
  // the kid whose "use your time?" question is open
  const [usingTime, setUsingTime] = useState<string | null>(null)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const focusedDate = useUi((s) => s.focusedDate)
  const step = useUi((s) => s.step)
  const goToday = useUi((s) => s.goToday)
  const hiddenPeople = useUi((s) => s.hiddenPeople)
  const togglePerson = useUi((s) => s.togglePerson)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const requestHomeEdit = useUi((s) => s.requestHomeEdit)
  const weekStartsOn = settings?.weekStartsOn ?? 0
  const weekViewStart = settings?.weekViewStart ?? 'rolling'
  const timeFormat = settings?.timeFormat ?? '12h'
  return (
    <header className="flex items-center gap-2 px-4 pt-5 pb-4 max-[1300px]:gap-1.5 max-[1300px]:px-3 max-[1150px]:gap-1 min-[1500px]:gap-3 min-[1500px]:px-5">
      {/* Today + a big clock (the header is the only clock since the home
          screen dropped its clock tile); scales down so everything still
          fits on narrow layouts too (the 1440px-wide kiosk at 115–130% text ≈ 1250–1110px) */}
      <button
        type="button"
        onClick={goToday}
        className="pressable flex shrink-0 items-center gap-3 text-left max-[1300px]:gap-2 min-[1500px]:gap-4"
      >
        <div className="font-display text-[3.75rem] leading-none font-semibold tracking-tight tabular-nums max-[1300px]:text-[3.125rem] max-[1150px]:text-[2.125rem] min-[1500px]:text-[4rem]">
          {timeFormat === '24h' ? (
            now.toFormat('HH:mm')
          ) : (
            <>
              {now.toFormat('h:mm')}
              <span className="ml-1 text-xl font-bold text-ink-soft max-[1300px]:text-lg max-[1150px]:text-base min-[1500px]:ml-1.5 min-[1500px]:text-2xl">
                {now.toFormat('a').toLowerCase()}
              </span>
            </>
          )}
        </div>
        <div className="w-px self-stretch bg-ink-faint/30" />
        <div>
          <div className="font-display text-[2.05rem] leading-none font-semibold tracking-tight max-[1300px]:text-[1.65rem] min-[1500px]:text-[2.6rem]">
            {now.toFormat('cccc')}
          </div>
          <div className="mt-1 text-base font-bold text-ink-soft max-[1300px]:text-sm min-[1500px]:text-lg">
            {now.toFormat('LLLL d')}
          </div>
        </div>
      </button>

      <WeatherButton />

      {/* problems that need a parent (sign-in expired, calendars not updating, backups) — fills the free space */}
      <IssueLine />

      {/* person filter: compact avatar circles, never clipped (overlap when the family is large) */}
      {SHOW_PERSON_FILTER && people.length > 0 && (
        <div className={`flex shrink-0 items-center ${people.length >= 4 ? '-space-x-2 max-[1150px]:-space-x-3' : 'gap-1.5'}`}>
          {people.map((p) => {
            const hidden = hiddenPeople.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-label={`${hidden ? 'Show' : 'Hide'} ${p.name}`}
                title={p.name}
                onClick={() => togglePerson(p.id)}
                className={`pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ring-2 ring-paper transition-all max-[1300px]:h-10 max-[1300px]:w-10 ${
                  hidden ? 'opacity-35 grayscale' : 'shadow-card'
                }`}
                style={{ backgroundColor: p.color, color: textOn(p.color) }}
              >
                {initials(p.name)}
              </button>
            )
          })}
        </div>
      )}

      {/* period nav (removed from layout where it isn't meaningful — space matters here) */}
      {view !== 'lists' && view !== 'home' && (
        <div className="flex shrink-0 items-center gap-1 rounded-2xl bg-paper-deep/70 p-1">
          <IconButton label="Previous" className={NARROW_ICON} onClick={() => step(-1)}>
            <ChevronLeftIcon />
          </IconButton>
          <button
            type="button"
            onClick={goToday}
            className="pressable min-w-16 rounded-xl px-2 py-2 text-center text-base font-extrabold text-ink min-[1500px]:min-w-24"
          >
            {periodLabel(view, focusedDate, weekViewStart, weekStartsOn)}
          </button>
          <IconButton label="Next" className={NARROW_ICON} onClick={() => step(1)}>
            <ChevronRightIcon />
          </IconButton>
        </div>
      )}

      {/* each child's controller balance, in their colour, beside the screen selector on every screen —
          a tap asks whether they want to use their time (spend it all) */}
      {kids.length > 0 && (
        // a little tighter beside the date controls (Week/Month), where the header is fullest
        <div className={`flex shrink-0 items-center ${view === 'home' || view === 'lists' ? 'gap-4.5' : 'gap-3'}`}>
          {kids.map((p) => {
            const stars = balances.find((b) => b.personId === p.id)?.balance ?? 0
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setUsingTime(p.id)}
                aria-label={`${p.name}: ${stars} game time`}
                title={p.name}
                // as tall as the date + clock block beside them: the banner's full height
                className="pressable flex h-15 w-15 shrink-0 flex-col items-center justify-center rounded-full font-extrabold tabular-nums shadow-card ring-2 ring-paper max-[1300px]:h-12 max-[1300px]:w-12 min-[1500px]:h-16 min-[1500px]:w-16"
                style={{ backgroundColor: p.color, color: textOn(p.color) }}
              >
                <span aria-hidden className="text-sm leading-none max-[1300px]:text-xs">
                  <GameIcon className="align-top" />
                </span>
                <span className="text-xl leading-none max-[1300px]:text-base">{stars}</span>
              </button>
            )
          })}
        </div>
      )}
      <UseTimeDialog
        person={kids.find((k) => k.id === usingTime) ?? null}
        balance={balances.find((b) => b.personId === usingTime)?.balance ?? 0}
        onClose={() => setUsingTime(null)}
      />

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'home', label: 'Home' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'lists', label: 'Lists' }
        ]}
      />

      {view === 'home' && (
        <IconButton label="Customize home screen" className={NARROW_ICON} onClick={requestHomeEdit}>
          <PencilIcon size={22} />
        </IconButton>
      )}

      <IconButton label="Settings" className={NARROW_ICON} onClick={() => setSettingsOpen(true)}>
        <GearIcon size={26} />
      </IconButton>
    </header>
  )
}

export function Fab() {
  const openCreate = useUi((s) => s.openCreate)
  return (
    <button
      type="button"
      aria-label="Add event"
      onClick={() => openCreate()}
      className="pressable fixed right-7 bottom-7 z-30 flex h-18 w-18 items-center justify-center rounded-full bg-ember text-white shadow-float hover:bg-ember-deep"
    >
      <PlusIcon size={32} />
    </button>
  )
}
