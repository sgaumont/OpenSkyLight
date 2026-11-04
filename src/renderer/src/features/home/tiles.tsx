import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { GameIcon } from '../../components/icons'
import { createPortal } from 'react-dom'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import mpegts from 'mpegts.js'
import type { DayChoreDto, HomeTile, PersonDto } from '@shared/types'
import { presetById } from '@shared/rss'
import { agendaRange, dayRange, eachDay } from '@shared/dates'
import { withoutEnded } from '@shared/occurrences'
import { HOME_GRID_SCALE } from '@shared/home'
import { ipcInvoke } from '../../api/client'
import {
  useBalances,
  useChecklistsDay,
  useChoresDay,
  useLists,
  useMeals,
  usePeople,
  useSettings,
  useWeather
} from '../../api/hooks'
import { useCalendarData } from '../calendar/useCalendarData'
import { useKioskState } from '../../stores/kioskStore'
import { useTimers } from '../../stores/timerStore'
import { formatDuration } from '@shared/timer'
import { startAlarm, stopAlarm } from '../../lib/alarm'
import { weatherIcon } from '../weather/WeatherHeader'
import { MealsDialog, MealStrip, SLOT_META, useMealsForRange } from '../meals/Meals'
import { useChoreClaim } from '../chores/ClaimChore'
import { ChoreHistoryDialog } from '../chores/ChoreHistory'
import { ZONE } from '../../stores/uiStore'
import { formatTime, initials, textOn } from '../../lib/format'
import { occurrenceColor } from '../../lib/colors'
import { sortDayChores } from '@shared/choreOrder'
import { canAddMore, countLabel, countOf, isCounted } from '@shared/choreCount'

export interface TileProps {
  tile: HomeTile
  /** true when the rendered tile is physically small — show denser content */
  compact: boolean
}

function TileTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 shrink-0 text-xs font-extrabold tracking-wide text-ink-faint uppercase">{children}</div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-2 text-center text-sm font-bold text-ink-faint">
      {children}
    </div>
  )
}

/**
 * Scrolls when its content overflows (bigger text, long lists). The kiosk hides
 * scrollbars, so the bottom edge fades out while there's more below.
 */
function TileScroll({
  children,
  className = '',
  innerClassName = ''
}: {
  children: React.ReactNode
  className?: string
  innerClassName?: string
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = outer.current
    if (!el || !inner.current) return
    const update = (): void => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(inner.current)
    el.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])
  return (
    <div
      ref={outer}
      className={`min-h-0 overflow-y-auto overscroll-contain ${className}`}
      style={more ? { maskImage: 'linear-gradient(to bottom, black calc(100% - 2rem), transparent)' } : undefined}
    >
      <div ref={inner} className={innerClassName}>
        {children}
      </div>
    </div>
  )
}

const today = (): string => DateTime.now().setZone(ZONE).toISODate()!

/** How often the Today tile re-checks for events that have finished. */
const TODAY_REFRESH_MS = 30_000

export function TodayEventsTile({ compact }: TileProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TODAY_REFRESH_MS)
    return () => clearInterval(t)
  }, [])
  const todayKey = DateTime.fromMillis(now).setZone(ZONE).toISODate()!
  const range = useMemo(() => dayRange(todayKey, ZONE), [todayKey])
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const all = byDay.get(todayKey) ?? []
  const occurrences = withoutEnded(all, now)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* the date ties it to the This week tile, whose list starts with tomorrow */}
      <TileTitle>Today ({DateTime.fromISO(todayKey, { zone: ZONE }).toFormat('ccc d')})</TileTitle>
      {/* events take the space between the title and the meal strip */}
      <div className="flex min-h-0 flex-1 flex-col">
        {occurrences.length === 0 ? (
          <Placeholder>{all.length === 0 ? 'Nothing on the calendar today' : 'Nothing else on the calendar today'}</Placeholder>
        ) : (
          <TileScroll innerClassName="flex flex-col gap-1.5">
            {occurrences.map((occ) => {
              const color = occurrenceColor(occ, peopleById, calendarsById)
              return (
                <div key={occ.key} className="flex items-center gap-2 rounded-lg bg-paper-deep/40 px-2 py-1.5">
                  {/* stretches with a wrapped, multi-line name */}
                  <span className="min-h-7 w-1.5 shrink-0 self-stretch rounded-full" style={{ backgroundColor: color }} />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-bold [overflow-wrap:anywhere] ${compact ? 'text-sm' : 'text-base'}`}>
                      {occ.title}
                    </span>
                    <span className="block text-xs font-bold text-ink-faint">
                      {occ.allDay ? 'All day' : formatTime(occ.start, settings?.timeFormat ?? '12h')}
                    </span>
                  </span>
                </div>
              )
            })}
          </TileScroll>
        )}
      </div>
      <TodayMeals date={todayKey} />
    </div>
  )
}

/** Today's meal strip, as under each Week day; tapping it edits the meals (not the tile's tap). */
function TodayMeals({ date }: { date: string }) {
  const range = useMemo(() => dayRange(date, ZONE), [date])
  const meals = useMealsForRange(range).get(date) ?? []
  const [open, setOpen] = useState(false)
  return (
    // stops taps on the strip, and (via React's portal bubbling) inside the dialog,
    // from also counting as a tap on the tile, which opens the Day view
    <div className="mt-2 shrink-0" onClick={(e) => e.stopPropagation()}>
      <MealStrip date={date} meals={meals} onOpen={() => setOpen(true)} large />
      {/* portal: the dialog must escape the tile's clipping and text-size zoom */}
      {createPortal(<MealsDialog date={open ? date : null} meals={meals} onClose={() => setOpen(false)} />, document.body)}
    </div>
  )
}

/** Today's date key, re-checked every minute so a tile rolls over at midnight. */
function useTodayKey(): string {
  const [key, setKey] = useState(today)
  useEffect(() => {
    const t = setInterval(() => setKey(today()), 60_000)
    return () => clearInterval(t)
  }, [])
  return key
}

export function WeekAgendaTile({ compact }: TileProps) {
  const todayKey = useTodayKey()
  // today has its own tile, so this one covers the 6 days after it
  const range = useMemo(() => {
    const tomorrow = DateTime.fromISO(todayKey, { zone: ZONE }).plus({ days: 1 }).toISODate()!
    return agendaRange(tomorrow, ZONE, 6)
  }, [todayKey])
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const days = eachDay(range, ZONE)
  const empty = days.every((day) => (byDay.get(day.toISODate()!) ?? []).length === 0)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>This week</TileTitle>
      {empty ? (
        <Placeholder>A quiet week ahead</Placeholder>
      ) : (
        // one grid for the whole tile (day | dot | time | title): the auto-sized
        // time column is as wide as the longest entry shown ("All Day" included),
        // so every title lines up. Rows align on the first text baseline, so a
        // wrapped multi-line title keeps day/dot/time level with its first line.
        <TileScroll innerClassName="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-0.5">
          {days.flatMap((day, dayIndex) => {
            const key = day.toISODate()!
            const occs = byDay.get(key) ?? []
            return occs.map((occ, i) => {
              // a little space above each new day
              const gap = i === 0 && dayIndex > 0 ? 'mt-1' : ''
              return (
                <Fragment key={`${key}|${occ.key}`}>
                  <span className={`pr-1 text-xs font-extrabold text-ink-faint uppercase ${gap}`}>
                    {i === 0 ? (dayIndex === 0 ? 'Tmrw' : day.toFormat('ccc')) : ''}
                  </span>
                  {/* the dot sits in a text-sized line so it has a baseline to align on */}
                  <span className={`${compact ? 'text-xs' : 'text-sm'} ${gap}`}>
                    <span
                      className="inline-block h-2 w-2 rounded-full align-middle"
                      style={{ backgroundColor: occurrenceColor(occ, peopleById, calendarsById) }}
                    />
                  </span>
                  <span className={`text-right text-xs font-bold whitespace-nowrap text-ink-faint tabular-nums ${gap}`}>
                    {occ.allDay ? 'All Day' : formatTime(occ.start, settings?.timeFormat ?? '12h')}
                  </span>
                  <span className={`font-bold [overflow-wrap:anywhere] ${compact ? 'text-xs' : 'text-sm'} ${gap}`}>
                    {occ.title}
                  </span>
                </Fragment>
              )
            })
          })}
        </TileScroll>
      )}
    </div>
  )
}

/**
 * A size that follows the weather tile's own box (CSS container units), so the
 * forecast fills whatever size the tile is, between a legible floor and a cap.
 */
const fit = (minPx: number, cqh: number, cqw: number, maxPx: number): string =>
  `clamp(${minPx}px, min(${cqh}cqh, ${cqw}cqw), ${maxPx}px)`

export function WeatherTile({ tile }: TileProps) {
  const { data: settings } = useSettings()
  const { data: weather } = useWeather()
  if (!settings?.weather) return <Placeholder>Set a location in Settings → General</Placeholder>
  if (!weather) return <Placeholder>Loading forecast…</Placeholder>
  // the header already shows the current temperature; this tile is the 5-day outlook:
  // stacked rows in a tall tile, one line per day in a wide 1-row tile, columns otherwise
  // in original grid cells (the fine grid allows fractions)
  const cols = tile.w / HOME_GRID_SCALE
  const rows = tile.h / HOME_GRID_SCALE
  const narrow = cols < 2.5
  // only a true 1-row tile gets the one-line layout; anything taller (the fine grid allows
  // 1⅓, 1⅔ rows…) has room for high-over-low columns, which use the height far better
  const oneRow = rows <= 1
  const layout = tile.h > tile.w ? 'stacked' : oneRow && !narrow ? 'short' : 'columns'
  // a 1-row column only has room for the high
  const highOnly = oneRow
  return (
    <div className="h-full overflow-hidden" style={{ containerType: 'size' }}>
      <div className={`flex h-full ${layout === 'stacked' ? 'flex-col' : ''}`}>
        {/* today's forecast first, then the next 4 days */}
        {weather.daily.slice(0, 5).map((d, i) => {
          const Icon = weatherIcon(d.code, true)
          const label = i === 0 ? 'Today' : DateTime.fromISO(d.date).toFormat('ccc')
          const rainy = d.precipProb !== null && d.precipProb >= 20
          const labelCls = 'font-extrabold text-ink-faint uppercase leading-none'
          const icon = (size: string) => (
            <Icon className="shrink-0 text-ember-deep" style={{ width: size, height: size }} />
          )

          if (layout === 'stacked') {
            return (
              <div key={d.date} className="flex min-h-0 flex-1 items-center gap-[4cqw]">
                <span className={`w-[26cqw] shrink-0 ${labelCls}`} style={{ fontSize: fit(9, 4.5, 6.5, 20) }}>
                  {label}
                </span>
                {icon(fit(18, 11, 16, 56))}
                {rainy && !narrow && (
                  <span className="font-bold text-[#0091FF]" style={{ fontSize: fit(10, 4, 6, 18) }}>
                    {d.precipProb}%
                  </span>
                )}
                <span className="ml-auto font-bold tabular-nums" style={{ fontSize: fit(13, 7, 9, 32) }}>
                  {d.high}°
                </span>
                <span className="font-bold text-ink-faint tabular-nums" style={{ fontSize: fit(11, 6, 7.5, 26) }}>
                  {d.low}°
                </span>
              </div>
            )
          }

          if (layout === 'short') {
            return (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[6cqh]">
                <span className={labelCls} style={{ fontSize: fit(10, 16, 2.6, 18) }}>
                  {label}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  {icon(fit(16, 34, 5, 40))}
                  <span className="font-bold" style={{ fontSize: fit(12, 24, 3, 26) }}>
                    {d.high}°
                  </span>
                  {/* dropped when the tile is too narrow for icon + high + low on one line */}
                  <span className="font-bold text-ink-faint @max-[17rem]:hidden" style={{ fontSize: fit(11, 20, 2.5, 22) }}>
                    {d.low}°
                  </span>
                </span>
              </div>
            )
          }

          // high above, low below: each column is only one value wide, so the
          // width-bound columns can use much larger text. The items take ~80% of the
          // height and justify-between spreads the rest between them, so the
          // forecast runs edge to edge instead of floating with bands above/below.
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-between gap-[1cqh] py-[1.5cqh]">
              <span className="font-bold tabular-nums leading-none" style={{ fontSize: highOnly ? fit(11, 22, 5, 26) : fit(13, 22, 7.5, 64) }}>
                {d.high}°
              </span>
              <span className={labelCls} style={{ fontSize: fit(narrow ? 8 : 10, highOnly ? 16 : 8.5, 3.6, 24) }}>
                {label}
              </span>
              {icon(highOnly ? fit(14, 30, 12, 40) : fit(18, 23, 17, 80))}
              {!highOnly && (
                <span className="font-bold text-ink-faint tabular-nums leading-none" style={{ fontSize: fit(11, 17, 6.2, 52) }}>
                  {d.low}°
                </span>
              )}
              {/* the rain line is always reserved (blank when dry) so every column is
                  the same height and the days line up across the tile */}
              {!highOnly && (
                <span
                  className={`font-bold leading-none text-[#0091FF] ${rainy ? '' : 'invisible'}`}
                  style={{ fontSize: fit(10, 8, 3.2, 20) }}
                >
                  {rainy ? d.precipProb : 0}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniAvatar({ person }: { person: PersonDto }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold"
      style={{ backgroundColor: person.color, color: textOn(person.color) }}
      title={person.name}
    >
      {initials(person.name)}
    </span>
  )
}

const UNLOCK_MARK = { pending: '⏳', approved: '✓' } as const

/** Most circles a counted chore shows; past that it shows the latest doer (+ an open one) and its count. */
const MAX_COUNT_CIRCLES = 5

/**
 * An 'anyone' chore's circles, as who filled each (undefined = still open). A plain chore is
 * one circle; a counted one is one per time (with a cap: e.g. 3/3 → three) or, with no
 * limit, one per time so far plus an open one.
 */
function anyoneSlots(c: DayChoreDto): (string | undefined)[] {
  if (!isCounted(c)) return [c.completedBy ?? undefined]
  if (c.times !== null && c.times <= MAX_COUNT_CIRCLES) {
    return Array.from({ length: c.times }, (_, i) => c.claims[i])
  }
  const open = canAddMore(c) ? [undefined] : []
  const slots = [...c.claims, ...open]
  return slots.length <= MAX_COUNT_CIRCLES ? slots : [c.claims.at(-1), ...open]
}

export function ChoresProgressTile() {
  // a tile left up overnight must move on to the new day's chores
  const todayKey = useTodayKey()
  const { data: chores = [] } = useChoresDay(todayKey)
  const { data: checklists = [] } = useChecklistsDay(todayKey)
  const { data: people = [] } = usePeople()
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const { tap, dialog } = useChoreClaim(todayKey)
  const [historyOpen, setHistoryOpen] = useState(false)
  const all = [...checklists.flatMap((cl) => cl.items), ...chores]
  // every title starts at the same x: the circle column fits the most circles any row has (20px each, 2px gaps)
  const maxCircles = Math.max(1, ...all.map((c) => (c.mode === 'each' ? c.assignees.length : anyoneSlots(c).length)))
  const circleWidth = maxCircles * 22 - 2
  const sorted = sortDayChores(chores)

  // the tile itself is a button (opens Chores), so a row can't be one: it opens "Who did it?" instead
  /**
   * A filled circle with the doer's initial once done; an empty outline (faint initial when we
   * know whose) until then; `partial` (part-way through a count) outlines it in their colour.
   */
  const circle = (key: string, done: PersonDto | undefined, owner?: PersonDto, partial?: boolean) => (
    <span
      key={key}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done || partial ? '' : 'border-line'}`}
      style={
        done
          ? { borderColor: done.color, backgroundColor: done.color }
          : partial && owner
            ? { borderColor: owner.color }
            : undefined
      }
    >
      {(done ?? owner) && (
        <span
          className={`text-[10px] leading-none font-extrabold ${done || partial ? '' : 'text-ink-faint'}`}
          style={done ? { color: textOn(done.color) } : partial && owner ? { color: owner.color } : undefined}
        >
          {initials((done ?? owner)!.name)}
        </span>
      )}
    </span>
  )

  // the tile itself is a button (opens Chores), so a row can't be one: it opens "Who did it?" instead
  const row = (c: DayChoreDto) => (
    <div
      key={c.choreId}
      role="button"
      aria-label={`${c.mode === 'anyone' && c.completed ? 'Uncheck' : 'Claim'} ${c.title}`}
      onClick={(e) => {
        e.stopPropagation()
        tap(c)
      }}
      className="pressable -mx-1 flex items-center gap-2 rounded-lg px-1 py-0.5"
    >
      {/* one circle per person who has to do it; one per time for an anyone chore (a plain one: one) */}
      <span
        className="flex shrink-0 gap-0.5"
        style={{ minWidth: circleWidth }}
        data-circles={c.mode === 'each' ? c.assignees.length : anyoneSlots(c).length}
      >
        {c.mode === 'each'
          ? c.assignees.map((id) => {
              const p = peopleById.get(id)
              return circle(id, c.doneBy.includes(id) ? p : undefined, p, countOf(c, id) > 0)
            })
          : anyoneSlots(c).map((id, i) => circle(`claim${i}`, id ? peopleById.get(id) : undefined))}
      </span>
      <span
        className={`min-w-0 flex-1 text-sm leading-tight font-bold break-words ${c.completed ? 'text-ink-faint line-through' : ''}`}
      >
        {c.title}
        {isCounted(c) && (
          <span className="ml-1.5 inline-block text-xs font-extrabold text-ink-faint" data-count>
            {c.mode === 'each'
              ? c.assignees
                  .map((id) => `${initials(peopleById.get(id)?.name ?? '?')} ${countLabel(c, id)}`)
                  .join(' · ')
              : countLabel(c)}
          </span>
        )}
      </span>
    </div>
  )

  // chores belong to no one: checklists, then every chore — still to do or ticked
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* the title opens the last few days' history (a div: the tile itself is a button) */}
      <div
        role="button"
        aria-label="Chore history"
        onClick={(e) => {
          e.stopPropagation()
          setHistoryOpen(true)
        }}
        className="pressable -mx-1 self-start rounded-lg px-1"
      >
        <TileTitle>Today's chores ›</TileTitle>
      </div>
      {all.length === 0 ? (
        <Placeholder>No chores today</Placeholder>
      ) : (
        <TileScroll className="flex-1" innerClassName="flex flex-col gap-1.5">
          {checklists.map((cl) => (
            <Fragment key={cl.checklistId}>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-extrabold tracking-wide text-ink-faint uppercase">🎮 {cl.title}</span>
                {cl.people.map((s) => {
                  const p = peopleById.get(s.personId)
                  if (!p) return null
                  return (
                    <span
                      key={s.personId}
                      data-unlock={s.unlock}
                      className={`flex items-center gap-1 text-xs font-extrabold ${s.unlock === 'approved' ? 'text-[#46A758]' : 'text-ink-soft'}`}
                    >
                      <MiniAvatar person={p} />
                      {s.unlock === 'locked' ? `${s.done}/${s.total}` : UNLOCK_MARK[s.unlock]}
                    </span>
                  )
                })}
              </div>
              {cl.items.map(row)}
            </Fragment>
          ))}
          {checklists.length > 0 && chores.length > 0 && <div className="mt-0.5 border-t border-line/60" />}
          {sorted.map(row)}
        </TileScroll>
      )}
      {/* outside the tile's zoom; taps in it must not bubble (through React) to the tile's own button */}
      {createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          {dialog}
          <ChoreHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
        </div>,
        document.body
      )}
    </div>
  )
}

export function StarBalancesTile({ compact }: TileProps) {
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const kids = people.filter((p) => p.role === 'child')
  const shown = kids.length > 0 ? kids : people
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Stars</TileTitle>
      {shown.length === 0 ? (
        <Placeholder>Add family members in Settings</Placeholder>
      ) : (
        <TileScroll className="flex-1" innerClassName="flex flex-col gap-1.5">
          {shown.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold"
                style={{ backgroundColor: p.color, color: textOn(p.color) }}
              >
                {initials(p.name)}
              </span>
              {!compact && <span className="min-w-0 flex-1 truncate text-sm font-bold">{p.name}</span>}
              <span className={`font-extrabold text-ember-deep ${compact ? 'ml-auto text-sm' : 'text-base'}`}>
                <GameIcon /> {balances.find((b) => b.personId === p.id)?.balance ?? 0}
              </span>
            </div>
          ))}
        </TileScroll>
      )}
    </div>
  )
}

export function ListTile({ tile, compact }: TileProps) {
  const { data: lists = [] } = useLists()
  const list = lists.find((l) => l.id === tile.config?.listId)
  if (!list) return <Placeholder>List not found — re-add this tile</Placeholder>
  const unchecked = list.items.filter((i) => !i.checked)
  const maxItems = compact ? 4 : 8
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-1.5 flex shrink-0 items-center gap-1.5">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: list.color }} />
        <span className="truncate text-xs font-extrabold tracking-wide text-ink-faint uppercase">{list.name}</span>
      </div>
      {unchecked.length === 0 ? (
        <Placeholder>All done!</Placeholder>
      ) : (
        <TileScroll innerClassName="flex flex-col gap-1">
          {unchecked.slice(0, maxItems).map((item) => (
            <span key={item.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full border-2" style={{ borderColor: list.color }} />
              <span className={`truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{item.text}</span>
            </span>
          ))}
          {unchecked.length > maxItems && (
            <span className="text-xs font-extrabold text-ink-faint">+{unchecked.length - maxItems} more</span>
          )}
        </TileScroll>
      )}
    </div>
  )
}

export function MealsTile({ compact }: TileProps) {
  const todayKey = useTodayKey()
  const { data: meals = [] } = useMeals(todayKey, todayKey)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Meals today</TileTitle>
      {meals.length === 0 ? (
        <Placeholder>No meals planned</Placeholder>
      ) : (
        <TileScroll className="flex-1" innerClassName="flex flex-col gap-1.5">
          {meals.map((m) => (
            <span key={m.slot} className="flex items-center gap-2">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                style={{ backgroundColor: SLOT_META[m.slot].color }}
              >
                {SLOT_META[m.slot].letter}
              </span>
              <span className={`truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{m.text}</span>
            </span>
          ))}
        </TileScroll>
      )}
    </div>
  )
}

export function ClockTile({ compact }: TileProps) {
  const { data: settings } = useSettings()
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 10_000)
    return () => clearInterval(t)
  }, [])
  const timeFormat = settings?.timeFormat ?? '12h'
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-hidden">
      <span className={`font-display leading-none ${compact ? 'text-4xl' : 'text-5xl'}`}>
        {timeFormat === '24h' ? now.toFormat('HH:mm') : now.toFormat('h:mm')}
      </span>
      <span className="mt-1 text-sm font-bold text-ink-soft">{now.toFormat('ccc, LLL d')}</span>
    </div>
  )
}

export function NewsTile({ tile, compact }: TileProps) {
  const preset = tile.config?.feedId ? presetById(tile.config.feedId) : undefined
  const { data: feed, isError } = useQuery({
    queryKey: ['rss', tile.config?.feedId],
    queryFn: () => ipcInvoke('rss:getFeed', { feedId: tile.config!.feedId! }),
    enabled: !!preset,
    refetchInterval: 15 * 60_000,
    retry: 2
  })
  if (!preset) return <Placeholder>Feed not found — re-add this tile</Placeholder>

  const maxItems = compact ? 3 : Math.max(3, tile.h * 2 - 1)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>{preset.label}</TileTitle>
      {isError && !feed ? (
        <Placeholder>Couldn't load headlines — will retry</Placeholder>
      ) : !feed ? (
        <Placeholder>Loading headlines…</Placeholder>
      ) : (
        <TileScroll innerClassName="flex flex-col gap-1.5">
          {feed.items.slice(0, maxItems).map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ember" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block overflow-hidden font-bold text-ellipsis ${compact ? 'text-xs whitespace-nowrap' : 'line-clamp-2 text-sm'}`}
                >
                  {item.title}
                </span>
                {item.publishedAt && !compact && (
                  <span className="block text-[11px] font-bold text-ink-faint">
                    {DateTime.fromISO(item.publishedAt).toRelative()}
                  </span>
                )}
              </span>
            </div>
          ))}
        </TileScroll>
      )}
    </div>
  )
}

const TIMER_PRESETS_SEC = [60, 180, 300, 600, 900]

export function TimerTile({ compact }: TileProps) {
  const timers = useTimers((s) => s.timers)
  const add = useTimers((s) => s.add)
  const cancel = useTimers((s) => s.cancel)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const anyRinging = timers.some((t) => now >= t.endsAt)
  useEffect(() => {
    if (!anyRinging) return
    startAlarm()
    return () => stopAlarm()
  }, [anyRinging])

  const preset = (sec: number): string => (sec >= 60 ? `${sec / 60}m` : `${sec}s`)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Timers</TileTitle>

      <div className="mb-2 flex shrink-0 flex-wrap gap-1.5">
        {TIMER_PRESETS_SEC.map((sec) => (
          <button
            key={sec}
            type="button"
            aria-label={`Start a ${preset(sec)} timer`}
            onClick={() => add(sec)}
            className="pressable rounded-lg bg-paper-deep px-2.5 py-1 text-sm font-extrabold text-ink-soft"
          >
            {preset(sec)}
          </button>
        ))}
      </div>

      {timers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-sm font-bold text-ink-faint">
          Tap a preset, or say “set a timer for 5 minutes”
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {timers.map((t) => {
            const remaining = Math.max(0, Math.ceil((t.endsAt - now) / 1000))
            const ringing = remaining <= 0
            const pct = Math.min(100, Math.max(0, (1 - remaining / t.durationSec) * 100))
            return (
              <div
                key={t.id}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 ${
                  ringing ? 'animate-pulse bg-ember text-white' : 'bg-paper-deep/60'
                }`}
              >
                <span className="min-w-0 flex-1">
                  {t.label && (
                    <span className={`block truncate text-xs font-extrabold ${ringing ? 'text-white/90' : 'text-ink-faint'}`}>
                      {t.label}
                    </span>
                  )}
                  <span className={`block font-display tabular-nums ${compact ? 'text-xl' : 'text-2xl'} leading-none`}>
                    {ringing ? 'Done!' : formatDuration(remaining)}
                  </span>
                  {!ringing && !compact && (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-paper-deep">
                      <span className="block h-full rounded-full bg-ember transition-all" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={ringing ? `Dismiss ${t.label ?? 'timer'}` : `Cancel ${t.label ?? 'timer'}`}
                  onClick={() => cancel(t.id)}
                  className={`pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                    ringing ? 'bg-white/25 text-white' : 'text-ink-faint hover:bg-paper-deep'
                  }`}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function BirdNetTile({ tile, compact }: TileProps) {
  const url = tile.config?.birdnetUrl
  const covered = useKioskState((s) => s.covered)
  const { data, isError } = useQuery({
    queryKey: ['birdnet', url],
    queryFn: () => ipcInvoke('birdnet:getDetections', { url: url! }),
    enabled: !!url && !covered,
    refetchInterval: 20_000
  })

  if (!url) return <Placeholder>Add your BirdNET-Go URL — re-add this tile</Placeholder>

  const maxItems = compact ? 3 : Math.max(2, tile.h * 2 - 1)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Birds</TileTitle>
      {isError && !data ? (
        <Placeholder>Couldn&apos;t reach BirdNET — will retry</Placeholder>
      ) : !data ? (
        <Placeholder>Loading detections…</Placeholder>
      ) : data.detections.length === 0 ? (
        <Placeholder>No detections yet</Placeholder>
      ) : (
        <TileScroll innerClassName="flex flex-col gap-1.5">
          {data.detections.slice(0, maxItems).map((det) => (
            <div key={`${det.id}-${det.timestamp}`} className="flex min-w-0 items-center gap-2">
              {det.image && (
                <img
                  src={det.image}
                  alt=""
                  loading="lazy"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                  className={`shrink-0 rounded-lg object-cover ${compact ? 'h-7 w-7' : 'h-9 w-9'}`}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>
                  {det.commonName}
                </span>
                <span className="block text-[11px] font-bold text-ink-faint">
                  {Math.round(det.confidence * 100)}% · {DateTime.fromISO(det.timestamp).toRelative()}
                </span>
              </span>
            </div>
          ))}
        </TileScroll>
      )}
    </div>
  )
}

/**
 * Edge-to-edge media: pinned to the tile's own edges (the tile is absolutely
 * positioned, so it's the containing block), ignoring its padding at any size.
 */
const BLEED: React.CSSProperties = { position: 'absolute', inset: 0 }

const CAMERA_RETRY_MS = 10_000

export function CameraTile({ tile }: TileProps) {
  const cameraId = tile.config?.cameraId ?? null
  const { data: cameras, isPending: camerasLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => ipcInvoke('camera:list', undefined)
  })
  const camera = (cameras ?? []).find((c) => c.id === cameraId)
  // depend on stable scalars, not the array entry — unrelated cache refreshes
  // must not tear down a live stream
  const cameraFound = camera !== undefined
  const covered = useKioskState((s) => s.covered)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!cameraId || !cameraFound || !video || covered) return
    if (!mpegts.isSupported()) {
      setStatus('error')
      return
    }
    let player: mpegts.Player | null = null
    let stopped = false
    let sessionId: string | null = null
    let wentLive = false
    let retryTimer: number | undefined
    setStatus('connecting')

    const fail = (): void => {
      if (stopped || retryTimer !== undefined) return
      setStatus('error')
      retryTimer = window.setTimeout(() => setRetryKey((k) => k + 1), CAMERA_RETRY_MS)
    }
    // a stream that never produces media within 15s is dead — retry
    const watchdog = window.setTimeout(() => {
      if (!wentLive) fail()
    }, 15_000)
    // the <video> element rendering frames is the ground truth for liveness:
    // some streams (e.g. UniFi Protect) play fine without mpegts.js ever
    // emitting MEDIA_INFO, and the watchdog must not kill those
    const goLive = (): void => {
      if (stopped) return
      wentLive = true
      setStatus('live')
    }
    video.addEventListener('playing', goLive)

    ipcInvoke('camera:start', { cameraId })
      .then((res) => {
        if (stopped) {
          void ipcInvoke('camera:stop', { sessionId: res.sessionId })
          return
        }
        sessionId = res.sessionId
        player = mpegts.createPlayer(
          { type: 'mpegts', isLive: true, url: res.wsUrl },
          { enableStashBuffer: false, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true }
        )
        player.attachMediaElement(video)
        player.on(mpegts.Events.ERROR, fail)
        player.on(mpegts.Events.MEDIA_INFO, goLive)
        player.load()
        void player.play()?.catch(() => undefined)
      })
      .catch(fail)

    return () => {
      stopped = true
      video.removeEventListener('playing', goLive)
      window.clearTimeout(watchdog)
      if (retryTimer) window.clearTimeout(retryTimer)
      try {
        player?.destroy()
      } catch {
        // already torn down
      }
      if (sessionId) void ipcInvoke('camera:stop', { sessionId })
    }
  }, [cameraId, cameraFound, covered, retryKey])

  if (!cameraId || camerasLoading) return <Placeholder>Connecting…</Placeholder>
  if (!camera) return <Placeholder>Camera not found — re-add this tile</Placeholder>

  return (
    <div className="overflow-hidden bg-black/90" style={BLEED}>
      <video ref={videoRef} muted autoPlay playsInline className="h-full w-full object-cover" />
      <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-extrabold text-white/90">
        {camera.name}
        {status === 'live' && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#e5484d] align-middle" />}
      </span>
      {status !== 'live' && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/70">
          {status === 'connecting' ? 'Connecting…' : 'Camera unavailable — retrying'}
        </span>
      )}
    </div>
  )
}

const PHOTO_TILE_MS = 10_000

export function PhotoTile({ tile }: TileProps) {
  const { data: photos = [] } = useQuery({
    queryKey: ['screensaverPhotos'],
    queryFn: () => ipcInvoke('screensaver:listPhotos', undefined),
    staleTime: 60_000
  })
  const [index, setIndex] = useState(0)
  // re-armed on every change, so a tapped photo gets its full time on screen
  useEffect(() => {
    if (photos.length < 2) return
    const t = setTimeout(() => setIndex((i) => i + 1), PHOTO_TILE_MS)
    return () => clearTimeout(t)
  }, [photos.length, index])
  if (photos.length === 0) return <Placeholder>Pick a photo folder in Settings → General</Placeholder>
  const src = photos[(index + tile.id.length) % photos.length]
  return (
    <div
      className="overflow-hidden"
      style={BLEED}
      onClick={photos.length > 1 ? () => setIndex((i) => i + 1) : undefined}
    >
      <img key={src} src={src} alt="" className="h-full w-full object-cover" style={{ animation: 'fade-in 1s ease backwards' }} />
    </div>
  )
}
