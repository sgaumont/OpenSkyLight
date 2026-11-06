import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type {
  CalendarDto,
  CalendarViewKind,
  ChoreDto,
  ChoreMode,
  PersonDto,
  PersonRole,
  RewardDto
} from '@shared/types'
import { DEFAULT_SETTINGS, PERSON_COLORS } from '@shared/types'
import {
  stepTextSize,
  tabTextSize,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  withTabTextSize
} from '@shared/textSize'
import { describeRecurrence } from '@shared/recurrence/build'
import {
  useAuthMutations,
  useAuthStatus,
  useSetVideoGamesStars,
  useVideoGamesStars,
  useBackupMutations,
  useBackupStatus,
  useCalendarMutations,
  useCalendars,
  useCompanionMutations,
  useCompanionStatus,
  useChoreMutations,
  useChores,
  useCitySearch,
  useRedemptions,
  useRewardMutations,
  useRewards,
  useGoogleMutations,
  useGoogleStatus,
  useIcsMutations,
  usePeople,
  usePeopleMutations,
  useRemoteCalendars,
  useSettings,
  useSettingsMutation,
  useSyncNow,
  useSyncStatus
} from '../../api/hooks'
import { GameTimeLog } from '../chores/GameTimeLog'
import { CountdownsSection } from '../countdowns/CountdownsSection'
import { TravelSection } from '../travel/TravelSection'
import { ArriveOffsetChip } from '../calendar/ArriveOffset'
import { ClothingSection } from '../weather/Clothing'
import { PinDialog } from '../../components/PinDialog'
import { TimeField } from '../../components/DateTimePickers'
import { ipcInvoke } from '../../api/client'
import { useUi, ZONE } from '../../stores/uiStore'
import { BigButton, Dialog, FieldLabel, SegmentedControl, Sheet, Toggle } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { GameIcon, PlusIcon } from '../../components/icons'
import {
  ChecklistsSection,
  PeoplePicker,
  PendingUnlocks,
  ScheduleField,
  usePendingUnlockCount
} from '../chores/ChoreSettings'
import { anchorOnSave, defaultAssignees, scheduleOf, toRecurrence, type ScheduleKind } from '@shared/choreSchedule'
import { initials, textOn } from '../../lib/format'
import QRCode from 'qrcode'

type Tab = 'family' | 'calendars' | 'chores' | 'general'

export function SettingsSheet() {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  const [tab, setTab] = useState<Tab>('family')
  // opened from the header's issue line: go straight to the tab that explains it
  const requestedTab = useUi((s) => s.settingsTab)
  useEffect(() => {
    if (open && requestedTab) setTab(requestedTab)
  }, [open, requestedTab])
  const [pinError, setPinError] = useState<string | null>(null)
  const { data: auth } = useAuthStatus()
  const authMutations = useAuthMutations()

  const close = (): void => {
    setOpen(false)
    setPinError(null)
    // closing settings re-arms the parental lock immediately
    if (auth?.pinSet) authMutations.lock.mutate(undefined)
  }

  // The PIN gate guards EVERY way into settings (main-side IPC gating is the
  // actual security boundary; this is the matching UX).
  const locked = (auth?.pinSet ?? false) && !(auth?.unlocked ?? false)
  if (open && locked) {
    return (
      <PinDialog
        open
        title="Enter parent PIN"
        autoAccept
        error={pinError}
        onClose={close}
        onSubmit={(pin) =>
          authMutations.verifyPin.mutate(
            { pin },
            {
              onSuccess: (res) => {
                if (!res.valid) setPinError('Wrong PIN — try again')
                else setPinError(null)
              }
            }
          )
        }
      />
    )
  }

  return (
    <Sheet open={open} onClose={close} title="Settings" wide>
      <div className="mb-5">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'family', label: 'Family' },
            { value: 'calendars', label: 'Calendars' },
            { value: 'chores', label: 'Chores' },
            { value: 'general', label: 'General' }
          ]}
        />
      </div>
      {tab === 'family' && <FamilyTab />}
      {tab === 'calendars' && <CalendarsTab />}
      {tab === 'chores' && <ChoresTab />}
      {tab === 'general' && <GeneralTab />}
    </Sheet>
  )
}

function ColorGrid({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERSON_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`pressable h-12 w-12 rounded-full ${value === c ? 'ring-4 ring-ink ring-offset-2 ring-offset-card' : ''}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

function FamilyTab() {
  const { data: people = [] } = usePeople()
  const mutations = usePeopleMutations()
  const [editing, setEditing] = useState<PersonDto | 'new' | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PERSON_COLORS[0])
  const [role, setRole] = useState<PersonRole>('child')

  const openEditor = (p: PersonDto | 'new'): void => {
    setEditing(p)
    if (p === 'new') {
      setName('')
      setColor(PERSON_COLORS[people.length % PERSON_COLORS.length])
      setRole('child')
    } else {
      setName(p.name)
      setColor(p.color)
      setRole(p.role)
    }
  }

  const save = (): void => {
    if (!name.trim()) return
    if (editing === 'new') mutations.create.mutate({ name: name.trim(), color, role })
    else if (editing) mutations.update.mutate({ id: editing.id, name: name.trim(), color, role })
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => openEditor(p)}
          className="pressable flex items-center gap-4 rounded-2xl bg-paper-deep/50 p-3 text-left hover:bg-paper-deep"
        >
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-extrabold"
            style={{ backgroundColor: p.color, color: textOn(p.color) }}
          >
            {initials(p.name)}
          </span>
          <span className="flex-1">
            <span className="block text-xl font-bold">{p.name}</span>
            <span className="block text-sm font-bold text-ink-faint capitalize">{p.role}</span>
          </span>
        </button>
      ))}
      <BigButton variant="ghost" onClick={() => openEditor('new')}>
        <span className="flex items-center justify-center gap-2">
          <PlusIcon size={20} /> Add family member
        </span>
      </BigButton>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add family member' : 'Edit family member'}
      >
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <OskInput value={name} onChange={setName} placeholder="Name" autoFocus={editing === 'new'} />
          </div>
          <div>
            <FieldLabel>Color</FieldLabel>
            <ColorGrid value={color} onChange={setColor} />
          </div>
          <div>
            <FieldLabel>Role</FieldLabel>
            <SegmentedControl
              value={role}
              onChange={setRole}
              options={[
                { value: 'parent', label: 'Parent' },
                { value: 'child', label: 'Child' }
              ]}
            />
          </div>
          <div className="mt-2 flex gap-3">
            {editing !== 'new' && editing && (
              <BigButton
                variant="danger"
                onClick={() => {
                  mutations.remove.mutate({ id: editing.id })
                  setEditing(null)
                }}
              >
                Remove
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={save} disabled={!name.trim()}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function SyncStatusRow() {
  const { data: status } = useSyncStatus()
  const syncNow = useSyncNow()
  if (!status) return null
  const dot = status.state === 'error' ? 'bg-ember' : status.state === 'syncing' ? 'bg-sun' : 'bg-[#46A758]'
  const label =
    status.state === 'syncing' ? 'Syncing…' : status.state === 'error' ? (status.lastError ?? 'Sync error') : 'Up to date'
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-paper-deep/50 px-4 py-3">
      <span className={`h-3.5 w-3.5 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-soft">{label}</span>
      <button
        type="button"
        onClick={() => syncNow.mutate(undefined)}
        className="pressable rounded-full border-2 border-line bg-card px-4 py-1.5 text-sm font-bold text-ink-soft"
      >
        Sync now
      </button>
    </div>
  )
}

function GoogleSection() {
  const { data: status } = useGoogleStatus()
  const google = useGoogleMutations()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null)
  const { data: remoteCals = [], isLoading: remoteLoading } = useRemoteCalendars(expandedAccount)

  if (!status) return null

  const saveAndConnect = (): void => {
    google.setCredentials.mutate(
      { clientId, clientSecret },
      { onSuccess: () => google.connect.mutate(undefined) }
    )
  }

  return (
    <div>
      <FieldLabel>Google Calendar</FieldLabel>
      {!status.configured ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
          <p className="text-base font-semibold text-ink-soft">
            Two-way sync uses your own (free) Google Cloud project. Create a{' '}
            <span className="font-extrabold">Desktop app</span> OAuth client in the Google Cloud console, enable the
            Calendar API, and paste the credentials here.
          </p>
          <OskInput value={clientId} onChange={setClientId} placeholder="OAuth client ID" />
          <OskInput value={clientSecret} onChange={setClientSecret} placeholder="OAuth client secret" />
          <BigButton onClick={saveAndConnect} disabled={clientId.trim().length < 10 || clientSecret.trim().length < 5}>
            {google.connect.isPending ? 'Waiting for browser sign-in…' : 'Save & connect Google'}
          </BigButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {status.accounts.map((account) => (
            <div key={account.id} className="rounded-2xl bg-paper-deep/50 p-3">
              <div className="flex items-center gap-3">
                <span className="flex-1">
                  <span className="block text-lg font-bold">{account.email}</span>
                  {account.error && <span className="block text-sm font-bold text-ember-deep">{account.error}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setExpandedAccount(expandedAccount === account.id ? null : account.id)}
                  className="pressable rounded-full border-2 border-line bg-card px-4 py-1.5 text-sm font-bold text-ink-soft"
                >
                  {expandedAccount === account.id ? 'Hide calendars' : 'Choose calendars'}
                </button>
                <button
                  type="button"
                  onClick={() => google.disconnect.mutate({ accountId: account.id })}
                  className="pressable rounded-full border-2 border-ember-soft px-4 py-1.5 text-sm font-bold text-ember-deep"
                >
                  Disconnect
                </button>
              </div>
              {expandedAccount === account.id && (
                <div className="mt-3 flex flex-col gap-2">
                  {remoteLoading && <p className="text-sm font-bold text-ink-faint">Loading calendars…</p>}
                  {remoteCals.map((rc) => (
                    <div key={rc.id} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2">
                      <span className="h-5 w-5 rounded-full" style={{ backgroundColor: rc.color }} />
                      <span className="min-w-0 flex-1 truncate text-base font-bold">
                        {rc.name}
                        {rc.readOnly && <span className="ml-2 text-xs font-extrabold text-ink-faint">READ-ONLY</span>}
                      </span>
                      <Toggle
                        checked={rc.selected}
                        onChange={(selected) =>
                          google.setCalendarSelected.mutate({
                            accountId: account.id,
                            googleCalendarId: rc.id,
                            name: rc.name,
                            color: rc.color,
                            readOnly: rc.readOnly,
                            selected
                          })
                        }
                        label={`Sync ${rc.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <BigButton variant="ghost" onClick={() => google.connect.mutate(undefined)} disabled={google.connect.isPending}>
            {google.connect.isPending ? 'Waiting for browser sign-in…' : 'Add Google account'}
          </BigButton>
        </div>
      )}
    </div>
  )
}

function IcsSection() {
  const { data: calendars = [] } = useCalendars()
  const calendarMutations = useCalendarMutations()
  const ics = useIcsMutations()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const feeds = calendars.filter((c) => c.provider === 'ics')

  const add = (): void => {
    ics.add.mutate(
      { url: url.trim(), name: name.trim() || 'Subscribed calendar', color: PERSON_COLORS[9] },
      {
        onSuccess: () => {
          setUrl('')
          setName('')
        }
      }
    )
  }

  return (
    <div>
      <FieldLabel>Subscribed feeds (ICS)</FieldLabel>
      <div className="flex flex-col gap-2">
        {feeds.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3">
            <span className="h-6 w-6 rounded-full" style={{ backgroundColor: c.color }} />
            <span className="min-w-0 flex-1 truncate text-lg font-bold">{c.name}</span>
            <ArriveOffsetChip calendar={c} />
            <Toggle
              checked={c.visible}
              onChange={(visible) => calendarMutations.update.mutate({ id: c.id, visible })}
              label="Visible"
            />
            <button
              type="button"
              onClick={() => calendarMutations.remove.mutate({ id: c.id })}
              className="pressable rounded-full border-2 border-ember-soft px-4 py-1.5 text-sm font-bold text-ember-deep"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex flex-col gap-2 rounded-2xl bg-paper-deep/50 p-3 sm:flex-row">
          <OskInput value={url} onChange={setUrl} placeholder="https://… .ics feed URL" className="flex-[2]" />
          <OskInput value={name} onChange={setName} placeholder="Name" className="flex-1" />
          <BigButton variant="ghost" onClick={add} disabled={!/^https?:\/\/.+/.test(url.trim()) || ics.add.isPending}>
            Add
          </BigButton>
        </div>
      </div>
    </div>
  )
}

function CalendarsTab() {
  const { data: calendars = [] } = useCalendars()
  const mutations = useCalendarMutations()
  const [editing, setEditing] = useState<CalendarDto | 'new' | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PERSON_COLORS[5])
  const manageable = calendars.filter((c) => c.provider !== 'ics')

  const openEditor = (c: CalendarDto | 'new'): void => {
    setEditing(c)
    setName(c === 'new' ? '' : c.name)
    setColor(c === 'new' ? PERSON_COLORS[5] : c.color)
  }

  const save = (): void => {
    if (!name.trim()) return
    if (editing === 'new') mutations.create.mutate({ name: name.trim(), color })
    else if (editing) mutations.update.mutate({ id: editing.id, name: name.trim(), color })
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <SyncStatusRow />
      <GoogleSection />
      <IcsSection />
      <div>
        <FieldLabel>Calendars on this display</FieldLabel>
        <div className="flex flex-col gap-2">
          {manageable.map((c) => (
            <div key={c.id} className="flex items-center gap-4 rounded-2xl bg-paper-deep/50 p-3">
              <button
                type="button"
                onClick={() => openEditor(c)}
                className="pressable flex flex-1 items-center gap-4 text-left"
              >
                <span className="h-8 w-8 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="flex-1">
                  <span className="block text-xl font-bold">{c.name}</span>
                  <span className="block text-sm font-bold text-ink-faint capitalize">{c.provider}</span>
                </span>
              </button>
              <ArriveOffsetChip calendar={c} />
              <Toggle
                checked={c.visible}
                onChange={(visible) => mutations.update.mutate({ id: c.id, visible })}
                label="Visible"
              />
            </div>
          ))}
          <BigButton variant="ghost" onClick={() => openEditor('new')}>
            <span className="flex items-center justify-center gap-2">
              <PlusIcon size={20} /> Add local calendar
            </span>
          </BigButton>
        </div>
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add calendar' : 'Edit calendar'}>
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <OskInput value={name} onChange={setName} placeholder="Calendar name" autoFocus={editing === 'new'} />
          </div>
          <div>
            <FieldLabel>Color</FieldLabel>
            <ColorGrid value={color} onChange={setColor} />
          </div>
          <div className="mt-2 flex gap-3">
            {editing !== 'new' && editing && (
              <BigButton
                variant="danger"
                onClick={() => {
                  mutations.remove.mutate({ id: editing.id })
                  setEditing(null)
                }}
              >
                Delete
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={save} disabled={!name.trim()}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
      <TravelSection />
    </div>
  )
}

/** Video Games tasks pay nothing alone — shown instead of the stars field. */
function VideoGamesStarsNote() {
  const { data } = useVideoGamesStars()
  return (
    <div className="max-w-60">
      <FieldLabel>Game time</FieldLabel>
      <p className="text-sm font-bold text-ink-soft">
        None alone — the whole day's set pays <GameIcon /> {data?.stars ?? '…'}, once a parent approves.
      </p>
    </div>
  )
}

/** The Video Games set reward: controllers for each finished set (each time through, if repeatable). */
function VideoGamesReward() {
  const { data } = useVideoGamesStars()
  const set = useSetVideoGamesStars()
  if (!data) return null
  return (
    <div>
      <FieldLabel>🎮 Video Games reward</FieldLabel>
      <div className="flex items-center gap-4 rounded-2xl bg-paper-deep/50 p-4">
        <span className="flex-1 text-base font-semibold text-ink-soft">
          Game time for finishing all of a day's Video Games chores — again for each full set, if they can be done more
          than once that day.
        </span>
        <Stepper value={data.stars} onChange={(stars) => set.mutate({ stars })} min={0} max={99} />
      </div>
    </div>
  )
}

function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="pressable flex h-12 w-12 items-center justify-center rounded-full bg-paper-deep text-2xl font-bold"
      >
        −
      </button>
      <span className="w-12 text-center text-2xl font-extrabold">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="pressable flex h-12 w-12 items-center justify-center rounded-full bg-paper-deep text-2xl font-bold"
      >
        +
      </button>
    </div>
  )
}

function ChoresTab() {
  const { data: people = [] } = usePeople()
  const { data: chores = [] } = useChores()
  const { data: rewards = [] } = useRewards()
  const { data: redemptions = [] } = useRedemptions()
  const choreMutations = useChoreMutations()
  const rewardMutations = useRewardMutations()
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const pendingUnlocks = usePendingUnlockCount()

  const [editingChore, setEditingChore] = useState<ChoreDto | 'new' | null>(null)
  const [choreTitle, setChoreTitle] = useState('')
  const [choreStars, setChoreStars] = useState(1)
  const [schedule, setSchedule] = useState<ScheduleKind>('daily')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [routine, setRoutine] = useState<'any' | 'morning' | 'evening'>('any')
  const [mode, setMode] = useState<ChoreMode>('anyone')
  const [assignees, setAssignees] = useState<string[]>([])
  const [times, setTimes] = useState(1)
  const [noLimit, setNoLimit] = useState(false)

  const [editingReward, setEditingReward] = useState<RewardDto | 'new' | null>(null)
  const [rewardTitle, setRewardTitle] = useState('')
  const [rewardCost, setRewardCost] = useState(10)

  const openChoreEditor = (c: ChoreDto | 'new'): void => {
    setEditingChore(c)
    if (c === 'new') {
      setChoreTitle('')
      setChoreStars(1)
      setSchedule('daily')
      setWeekdays([])
      setRoutine('any')
      setMode('anyone')
      setAssignees(defaultAssignees(people))
      setTimes(1)
      setNoLimit(false)
    } else {
      setChoreTitle(c.title)
      setChoreStars(c.starsValue)
      setSchedule(scheduleOf(c.recurrence))
      setWeekdays(c.recurrence?.byWeekdays ?? [])
      setRoutine(c.routine ?? 'any')
      setMode(c.mode)
      setAssignees(c.mode !== 'anyone' ? c.assignees : defaultAssignees(people))
      setTimes(c.times ?? 1)
      setNoLimit(c.times === null)
    }
  }

  const choreValid = choreTitle.trim() !== '' && (mode === 'anyone' || assignees.length > 0)

  const saveChore = (): void => {
    if (!choreValid) return
    const common = {
      title: choreTitle.trim(),
      starsValue: choreStars,
      recurrence: toRecurrence(schedule, weekdays),
      routine: routine === 'any' ? null : routine,
      mode,
      ...(mode !== 'anyone' ? { assignees } : {}),
      // only weekly and one-time chores can be done more than once on their day
      times: schedule === 'daily' ? 1 : noLimit ? null : times
    }
    if (editingChore === 'new') choreMutations.create.mutate(common)
    else if (editingChore) {
      const anchorDate = anchorOnSave(editingChore.recurrence, schedule, DateTime.now().setZone(ZONE).toISODate()!)
      choreMutations.update.mutate({ id: editingChore.id, ...common, ...(anchorDate ? { anchorDate } : {}) })
    }
    setEditingChore(null)
  }

  const saveReward = (): void => {
    if (!rewardTitle.trim()) return
    if (editingReward === 'new') rewardMutations.create.mutate({ title: rewardTitle.trim(), costStars: rewardCost })
    else if (editingReward) rewardMutations.update.mutate({ id: editingReward.id, title: rewardTitle.trim(), costStars: rewardCost })
    setEditingReward(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {(redemptions.length > 0 || pendingUnlocks > 0) && (
        <div>
          <FieldLabel>Waiting for approval</FieldLabel>
          <div className="flex flex-col gap-2">
            <PendingUnlocks />
            {redemptions.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-sun-soft p-3">
                <span className="min-w-0 flex-1 truncate text-lg font-bold">
                  {peopleById.get(r.personId)?.name ?? 'Someone'} → {r.rewardTitle}
                </span>
                <span className="text-base font-extrabold text-ember-deep"><GameIcon /> {r.starsSpent}</span>
                <BigButton onClick={() => rewardMutations.grant.mutate({ redemptionId: r.id })}>Grant</BigButton>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* who earned, lost and used game time, and when */}
      <GameTimeLog />

      <div>
        <FieldLabel>Chores & routines</FieldLabel>
        <div className="flex flex-col gap-2">
          {chores.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => openChoreEditor(c)}
              className="pressable flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold">{c.title}</span>
                <span className="block text-sm font-bold text-ink-faint">
                  {c.mode !== 'anyone'
                    ? `${c.mode === 'videogames' ? '🎮 Video Games' : 'Everyone'}: ${c.assignees
                        .map((id) => peopleById.get(id)?.name)
                        .filter(Boolean)
                        .join(', ')} · `
                    : ''}
                  {c.recurrence ? describeRecurrence(c.recurrence) : 'One time'}
                  {c.times === null ? ' · no limit' : c.times > 1 ? ` · ${c.times}×` : ''}
                  {c.routine ? ` · ${c.routine}` : ''}
                </span>
              </span>
              {c.starsValue > 0 && <span className="text-base font-extrabold text-ember-deep"><GameIcon /> {c.starsValue}</span>}
            </button>
          ))}
          <BigButton variant="ghost" onClick={() => openChoreEditor('new')}>
            <span className="flex items-center justify-center gap-2">
              <PlusIcon size={20} /> Add chore
            </span>
          </BigButton>
          <p className="text-sm font-semibold text-ink-faint">
            "Whoever does it" chores aren't assigned: the first to finish claims it (and its game time). "Video Games"
            chores are done by each person picked, but pay nothing alone: finishing all of the day's Video Games
            chores earns the reward below, once a parent approves.
          </p>
        </div>
      </div>

      <VideoGamesReward />

      <ChecklistsSection />

      <div>
        <FieldLabel>Rewards</FieldLabel>
        <div className="flex flex-col gap-2">
          {rewards.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setEditingReward(r)
                setRewardTitle(r.title)
                setRewardCost(r.costStars)
              }}
              className="pressable flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-lg font-bold">{r.title}</span>
              <span className="text-base font-extrabold text-ember-deep"><GameIcon /> {r.costStars}</span>
            </button>
          ))}
          <BigButton
            variant="ghost"
            onClick={() => {
              setEditingReward('new')
              setRewardTitle('')
              setRewardCost(10)
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <PlusIcon size={20} /> Add reward
            </span>
          </BigButton>
        </div>
      </div>

      <Dialog
        open={editingChore !== null}
        onClose={() => setEditingChore(null)}
        title={editingChore === 'new' ? 'Add chore' : 'Edit chore'}
      >
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Chore</FieldLabel>
            <OskInput value={choreTitle} onChange={setChoreTitle} placeholder="e.g. Make your bed" autoFocus={editingChore === 'new'} />
          </div>
          <div>
            <FieldLabel>Who does it</FieldLabel>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              // "Everyone" is no longer offered for new chores; an existing one keeps it so it isn't changed by accident
              options={[
                { value: 'anyone', label: 'Whoever does it' },
                ...(editingChore !== 'new' && editingChore?.mode === 'each' ? [{ value: 'each' as const, label: 'Everyone' }] : []),
                { value: 'videogames', label: '🎮 Video Games' }
              ]}
            />
            {mode !== 'anyone' && (
              <div className="mt-3">
                <PeoplePicker people={people} selected={assignees} onChange={setAssignees} />
              </div>
            )}
          </div>
          <div className="flex items-end gap-6">
            {mode === 'videogames' ? (
              <VideoGamesStarsNote />
            ) : (
              <div>
                <FieldLabel>Game time</FieldLabel>
                <Stepper value={choreStars} onChange={setChoreStars} max={20} />
              </div>
            )}
            <div className="flex-1">
              <FieldLabel>Routine</FieldLabel>
              <SegmentedControl
                value={routine}
                onChange={setRoutine}
                options={[
                  { value: 'any', label: 'Anytime' },
                  { value: 'morning', label: 'Morning' },
                  { value: 'evening', label: 'Evening' }
                ]}
              />
            </div>
          </div>
          <ScheduleField schedule={schedule} weekdays={weekdays} onSchedule={setSchedule} onWeekdays={setWeekdays} />
          {schedule !== 'daily' && (
            <div>
              <FieldLabel>{mode !== 'anyone' ? 'Times that day, each' : 'Times that day'}</FieldLabel>
              <div className="flex items-center gap-4">
                {!noLimit && <Stepper value={times} onChange={setTimes} min={1} max={10} />}
                <button
                  type="button"
                  aria-pressed={noLimit}
                  onClick={() => setNoLimit(!noLimit)}
                  className={`pressable min-h-12 rounded-full px-5 text-lg font-bold ${
                    noLimit ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'
                  }`}
                >
                  No limit
                </button>
              </div>
            </div>
          )}
          <div className="mt-1 flex gap-3">
            {editingChore !== 'new' && editingChore && (
              <BigButton
                variant="danger"
                onClick={() => {
                  choreMutations.remove.mutate({ id: editingChore.id })
                  setEditingChore(null)
                }}
              >
                Delete
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditingChore(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={saveChore} disabled={!choreValid}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={editingReward !== null}
        onClose={() => setEditingReward(null)}
        title={editingReward === 'new' ? 'Add reward' : 'Edit reward'}
      >
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Reward</FieldLabel>
            <OskInput value={rewardTitle} onChange={setRewardTitle} placeholder="e.g. Movie night pick" autoFocus={editingReward === 'new'} />
          </div>
          <div>
            <FieldLabel>Cost in game time</FieldLabel>
            <Stepper value={rewardCost} onChange={setRewardCost} min={1} max={999} />
          </div>
          <div className="mt-1 flex gap-3">
            {editingReward !== 'new' && editingReward && (
              <BigButton
                variant="danger"
                onClick={() => {
                  rewardMutations.remove.mutate({ id: editingReward.id })
                  setEditingReward(null)
                }}
              >
                Delete
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditingReward(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={saveReward} disabled={!rewardTitle.trim()}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function WeatherSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  const search = useCitySearch()
  const [query, setQuery] = useState('')
  if (!settings) return null

  return (
    <div>
      <FieldLabel>Weather</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        {settings.weather ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-lg font-bold">{settings.weather.label}</span>
            <button
              type="button"
              onClick={() => mutation.mutate({ weather: null })}
              className="pressable rounded-full border-2 border-ember-soft px-4 py-1.5 text-sm font-bold text-ember-deep"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="text-base font-semibold text-ink-soft">Pick a location to show the forecast in the header.</p>
        )}
        <div className="flex gap-2">
          <OskInput value={query} onChange={setQuery} placeholder="Search city…" className="flex-1" />
          <BigButton variant="ghost" onClick={() => search.mutate(query)} disabled={query.trim().length < 2 || search.isPending}>
            Search
          </BigButton>
        </div>
        {search.data && (
          <div className="flex flex-col gap-1.5">
            {search.data.length === 0 && <p className="text-sm font-bold text-ink-faint">No places found</p>}
            {search.data.map((city) => (
              <button
                key={`${city.lat},${city.lon}`}
                type="button"
                onClick={() => {
                  mutation.mutate({ weather: city })
                  search.reset()
                  setQuery('')
                }}
                className="pressable rounded-xl bg-card px-4 py-2.5 text-left text-base font-bold hover:bg-sun-soft"
              >
                {city.label}
              </button>
            ))}
          </div>
        )}
        <div>
          <FieldLabel>Units</FieldLabel>
          <SegmentedControl
            value={settings.temperatureUnit}
            onChange={(temperatureUnit) => mutation.mutate({ temperatureUnit })}
            options={[
              { value: 'f', label: '°F' },
              { value: 'c', label: '°C' }
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function ParentalLockSection() {
  const { data: auth } = useAuthStatus()
  const authMutations = useAuthMutations()
  const [step, setStep] = useState<null | 'new' | 'confirm'>(null)
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!auth) return null

  return (
    <div>
      <FieldLabel>Parental lock</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <p className="text-base font-semibold text-ink-soft">
          {auth.pinSet
            ? 'A PIN is required to open settings and manage calendars, people, and sync.'
            : 'Set a PIN so kids can use the calendar but not change settings.'}
        </p>
        <div className="flex gap-3">
          <BigButton
            variant="ghost"
            onClick={() => {
              setError(null)
              setStep('new')
            }}
          >
            {auth.pinSet ? 'Change PIN' : 'Set PIN'}
          </BigButton>
          {auth.pinSet && (
            <BigButton variant="danger" onClick={() => authMutations.setPin.mutate({ pin: null })}>
              Remove PIN
            </BigButton>
          )}
        </div>
      </div>

      <PinDialog
        open={step !== null}
        title={step === 'confirm' ? 'Enter it once more' : 'Choose a PIN (4–8 digits)'}
        error={error}
        onClose={() => setStep(null)}
        onSubmit={(pin) => {
          if (step === 'new') {
            setFirstPin(pin)
            setError(null)
            setStep('confirm')
          } else if (pin === firstPin) {
            authMutations.setPin.mutate({ pin })
            setStep(null)
          } else {
            setError("PINs didn't match — start again")
            setStep('new')
          }
        }}
      />
    </div>
  )
}

function CompanionSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  const { data: status } = useCompanionStatus()
  const companionMutations = useCompanionMutations()
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null)
  const [portDraft, setPortDraft] = useState<string | null>(null)
  if (!settings) return null
  const companion = settings.companion

  const pair = async (): Promise<void> => {
    const { url } = await companionMutations.issueToken.mutateAsync(undefined)
    await showQr(url)
  }
  const showQr = async (url: string): Promise<void> => {
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1 })
    setQr({ url, dataUrl })
  }
  // the same pairing link at another of this computer's addresses (e.g. Tailscale instead of home Wi-Fi)
  const switchTo = (host: string): void => {
    if (!qr) return
    const next = new URL(qr.url)
    next.hostname = host
    void showQr(next.toString())
  }
  const qrHost = qr ? new URL(qr.url).hostname : null
  const otherHosts = (status?.urls ?? []).map((u) => new URL(u).hostname).filter((h) => h !== qrHost)

  const draftPort = portDraft === null ? companion.port : Number(portDraft)
  const portValid = Number.isInteger(draftPort) && draftPort >= 1024 && draftPort <= 65535

  return (
    <div>
      <FieldLabel>Companion app</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            Let phones on your home Wi-Fi edit lists, meals, and chores
          </span>
          <Toggle
            checked={companion.enabled}
            onChange={(enabled) => mutation.mutate({ companion: { ...companion, enabled } })}
            label="Companion app"
          />
        </div>

        {companion.enabled && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-ink-soft">Port</span>
              <div className="w-28">
                <OskInput
                  value={portDraft ?? String(companion.port)}
                  onChange={(v) => setPortDraft(v.replace(/\D/g, '').slice(0, 5))}
                  placeholder="8420"
                />
              </div>
              {portDraft !== null && draftPort !== companion.port && (
                <BigButton
                  variant="ghost"
                  disabled={!portValid}
                  onClick={() => {
                    mutation.mutate({ companion: { ...companion, port: draftPort } })
                    setPortDraft(null)
                  }}
                >
                  Apply
                </BigButton>
              )}
              <span className="flex-1 text-right text-sm font-semibold text-ink-faint">
                {status?.running
                  ? `Serving${status.urls[0] ? ` at ${status.urls[0]}` : ''}`
                  : (status?.lastError ?? 'Starting…')}
              </span>
            </div>

            <div className="flex gap-3">
              <BigButton onClick={() => void pair()} disabled={!status?.running}>
                Pair a phone
              </BigButton>
              {(status?.pairedCount ?? 0) > 0 && (
                <BigButton variant="danger" onClick={() => companionMutations.unpairAll.mutate(undefined)}>
                  Unpair all devices ({status?.pairedCount})
                </BigButton>
              )}
            </div>
            <p className="text-sm font-semibold text-ink-faint">
              If phones can't connect, allow OpenSkyLight through Windows Firewall (Private networks).
            </p>
          </>
        )}
      </div>

      <Dialog open={qr !== null} onClose={() => setQr(null)} title="Scan with the phone's camera">
        {qr && (
          <div className="flex flex-col items-center gap-3">
            <img src={qr.dataUrl} alt="Pairing QR code" className="h-64 w-64 rounded-xl bg-white p-2" />
            <p className="max-w-sm text-center text-sm font-semibold break-all text-ink-faint">{qr.url}</p>
            {qrHost && (
              <p className="text-sm font-bold text-ink-soft" data-qr-network>
                This code uses {networkLabel(qrHost)}
                {networkLabel(qrHost) === 'Tailscale' && ' — works at home and away'}
              </p>
            )}
            {otherHosts.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2" data-switch-address>
                <span className="text-sm font-semibold text-ink-faint">Wrong network?</span>
                {otherHosts.map((h) => (
                  <BigButton key={h} variant="ghost" onClick={() => switchTo(h)}>
                    Use {networkLabel(h)}
                    <span className="ml-2 text-sm font-semibold opacity-60">{h}</span>
                  </BigButton>
                ))}
              </div>
            )}
            <p className="max-w-sm text-center text-sm font-semibold text-ink-soft">
              Then use the phone browser's “Add to Home Screen” to keep it like an app. Each scan pairs one
              device — close this and pair again for the next phone.
            </p>
            <BigButton onClick={() => setQr(null)}>Done</BigButton>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** Which network an address belongs to: Tailscale hands out 100.64.0.0/10. */
function networkLabel(host: string): string {
  const [a, b] = host.split('.').map(Number)
  if (a === 100 && b >= 64 && b <= 127) return 'Tailscale'
  if (a === 10 || a === 192 || (a === 172 && b >= 16 && b <= 31)) return 'home Wi-Fi'
  return host
}

function minutesToHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function hhMmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function ScreensaverSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  if (!settings) return null
  const ss = settings.screensaver

  const pickFolder = async (): Promise<void> => {
    await ipcInvoke('screensaver:pickFolder', undefined)
    // folder is stored main-side; refresh settings
    mutation.mutate({})
  }

  return (
    <div>
      <FieldLabel>Photo screensaver</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-soft">
            {ss.folder ?? 'No photo folder chosen'}
          </span>
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="pressable rounded-full border-2 border-line bg-card px-4 py-1.5 text-sm font-bold text-ink-soft"
          >
            Choose folder
          </button>
        </div>
        <div className="flex items-end gap-6">
          <div>
            <FieldLabel>Starts after (minutes idle)</FieldLabel>
            <Stepper
              value={ss.idleMinutes}
              min={1}
              max={120}
              onChange={(idleMinutes) => mutation.mutate({ screensaver: { ...ss, idleMinutes } })}
            />
          </div>
          <div className="flex-1" />
          <BigButton
            variant="ghost"
            disabled={!ss.folder}
            onClick={() => void ipcInvoke('kiosk:previewScreensaver', undefined)}
          >
            Preview
          </BigButton>
        </div>
      </div>
    </div>
  )
}

function SleepSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  if (!settings) return null
  const sleep = settings.sleep
  return (
    <div>
      <FieldLabel>Sleep schedule</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            Turn the screen dark overnight; tap to wake.
          </span>
          <Toggle checked={sleep.enabled} onChange={(enabled) => mutation.mutate({ sleep: { ...sleep, enabled } })} label="Sleep mode" />
        </div>
        {sleep.enabled && (
          <div className="grid grid-cols-2 gap-4">
            <TimeField
              label="Sleep at"
              minutes={hhMmToMinutes(sleep.start)}
              timeFormat={settings.timeFormat}
              onChange={(m) => mutation.mutate({ sleep: { ...sleep, start: minutesToHhMm(m) } })}
            />
            <TimeField
              label="Wake at"
              minutes={hhMmToMinutes(sleep.end)}
              timeFormat={settings.timeFormat}
              onChange={(m) => mutation.mutate({ sleep: { ...sleep, end: minutesToHhMm(m) } })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** "today 3:02 am", "Mon 3:02 am", "Oct 12, 3:02 am" */
function backupWhen(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const days = Math.round(DateTime.now().setZone(ZONE).startOf('day').diff(t.startOf('day'), 'days').days)
  const time = t.toFormat('h:mm a').toLowerCase()
  if (days === 0) return `today ${time}`
  if (days === 1) return `yesterday ${time}`
  return days < 7 ? `${t.toFormat('ccc')} ${time}` : `${t.toFormat('LLL d')}, ${time}`
}

function BackupSection() {
  const { data: status } = useBackupStatus()
  const backup = useBackupMutations()
  const [confirming, setConfirming] = useState<string | null>(null)
  if (!status) return null
  const problem = status.lastError ?? status.folderError ?? (status.stale ? 'No backup in the last few days.' : null)
  return (
    <div>
      <FieldLabel>Backups</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">
            {status.lastAt ? `Last backup ${backupWhen(status.lastAt)}` : 'No backup yet'}
            <span className="block text-sm text-ink-faint">
              Family, chores, game time, lists, meals and settings — every night. Google events come back from Google.
            </span>
          </span>
          <BigButton variant="ghost" disabled={backup.backupNow.isPending} onClick={() => backup.backupNow.mutate(undefined)}>
            {backup.backupNow.isPending ? 'Backing up…' : 'Back up now'}
          </BigButton>
        </div>
        {problem && (
          <p role="alert" className="rounded-xl bg-ember/15 px-3 py-2 text-sm font-bold text-ember-deep">
            ⚠ {problem}
          </p>
        )}

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm font-bold text-ink-soft">
            Extra copy: <span className="break-all">{status.folder ?? 'none (copies stay on this tablet)'}</span>
            <span className="block font-semibold text-ink-faint">A USB stick or network folder keeps them safe if the tablet dies.</span>
          </span>
          {status.folder && (
            <button
              type="button"
              onClick={() => backup.clearFolder.mutate(undefined)}
              className="pressable rounded-full px-3 py-1.5 text-sm font-bold text-ink-faint"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => backup.pickFolder.mutate(undefined)}
            className="pressable shrink-0 rounded-full border-2 border-line bg-card px-4 py-1.5 text-sm font-bold text-ink-soft"
          >
            Choose folder
          </button>
        </div>

        {status.backups.length > 0 && (
          <div>
            <FieldLabel>Restore</FieldLabel>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {status.backups.map((b) => (
                <div key={b.name} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2">
                  <span className="min-w-0 flex-1 text-base font-bold text-ink-soft">
                    {backupWhen(b.takenAt)}
                    {b.beforeRestore && <span className="ml-2 text-sm text-ink-faint">(saved before a restore)</span>}
                  </span>
                  <span className="text-sm text-ink-faint tabular-nums">{b.sizeKb} KB</span>
                  {confirming === b.name ? (
                    <button
                      type="button"
                      onClick={() => backup.restore.mutate({ name: b.name })}
                      className="pressable rounded-full bg-ember px-4 py-1.5 text-sm font-extrabold text-white"
                    >
                      Tap again — app restarts
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(b.name)}
                      className="pressable rounded-full border-2 border-line px-4 py-1.5 text-sm font-bold text-ink-soft"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-ink-faint">
              Restoring replaces everything with that day's copy (today's data is saved first, as "saved before a restore").
              If the app won't open: close it, then copy a backup from{' '}
              {String.raw`%APPDATA%\OpenSkyLight\backups`} over {String.raw`%APPDATA%\OpenSkyLight\openskylight.db`}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function TextSizeStepper({ value, onChange, label }: { value: number; onChange: (pct: number) => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center rounded-2xl bg-paper-deep p-1">
      <button
        type="button"
        aria-label={`Smaller text: ${label}`}
        disabled={value <= TEXT_SIZE_MIN}
        onClick={() => onChange(stepTextSize(value, -1))}
        className="pressable flex h-11 w-12 items-center justify-center rounded-xl text-base font-extrabold text-ink-soft disabled:opacity-30"
      >
        A−
      </button>
      <span className="min-w-16 text-center text-base font-bold tabular-nums">{value}%</span>
      <button
        type="button"
        aria-label={`Larger text: ${label}`}
        disabled={value >= TEXT_SIZE_MAX}
        onClick={() => onChange(stepTextSize(value, 1))}
        className="pressable flex h-11 w-12 items-center justify-center rounded-xl text-xl font-extrabold text-ink-soft disabled:opacity-30"
      >
        A+
      </button>
    </div>
  )
}

const TEXT_SIZE_TABS: { view: CalendarViewKind; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
  { view: 'agenda', label: 'Agenda' },
  { view: 'chores', label: 'Chores' },
  { view: 'lists', label: 'Lists' }
]

function TextSizeSection() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  if (!settings) return null
  const sizes = settings.textSize ?? DEFAULT_SETTINGS.textSize
  return (
    <div>
      <FieldLabel>Text size</FieldLabel>
      <div className="flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <span className="flex-1 text-base font-semibold text-ink-soft">Everything (header included)</span>
        <TextSizeStepper
          label="everything"
          value={sizes.global}
          onChange={(global) => mutation.mutate({ textSize: { ...sizes, global } })}
        />
      </div>
      <div className="mt-2 flex flex-col gap-1 rounded-2xl bg-paper-deep/50 p-4">
        {TEXT_SIZE_TABS.map(({ view, label }) => {
          const overridden = sizes.tabs[view] !== undefined
          return (
            <div key={view} className="flex items-center gap-3">
              <span className="flex-1 text-base font-semibold text-ink-soft">
                {label}
                {!overridden && <span className="ml-2 text-sm text-ink-faint">same as everything</span>}
              </span>
              {overridden && (
                <button
                  type="button"
                  onClick={() => mutation.mutate({ textSize: withTabTextSize(sizes, view, sizes.global) })}
                  className="pressable rounded-xl px-3 py-2 text-sm font-bold text-ink-faint"
                >
                  Reset
                </button>
              )}
              <TextSizeStepper
                label={label}
                value={tabTextSize(sizes, view)}
                onChange={(pct) => mutation.mutate({ textSize: withTabTextSize(sizes, view, pct) })}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <span className="flex-1 text-base font-semibold text-ink-soft">
          Week meals
          <span className="ml-2 text-sm text-ink-faint">meals under each day, relative to Week</span>
        </span>
        {(sizes.weekMeals ?? 100) !== 100 && (
          <button
            type="button"
            onClick={() => mutation.mutate({ textSize: { ...sizes, weekMeals: undefined } })}
            className="pressable rounded-xl px-3 py-2 text-sm font-bold text-ink-faint"
          >
            Reset
          </button>
        )}
        <TextSizeStepper
          label="Week meals"
          value={sizes.weekMeals ?? 100}
          onChange={(pct) => mutation.mutate({ textSize: { ...sizes, weekMeals: pct === 100 ? undefined : pct } })}
        />
      </div>
      <p className="mt-2 text-sm font-semibold text-ink-faint">
        Home tiles can be sized one by one too: tap the pencil on Home, then A− / A+ on a tile.
      </p>
    </div>
  )
}

function GeneralTab() {
  const { data: settings } = useSettings()
  const mutation = useSettingsMutation()
  if (!settings) return null
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <FieldLabel>Appearance</FieldLabel>
        <SegmentedControl
          value={settings.theme}
          onChange={(theme) => mutation.mutate({ theme })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Sunset to sunrise' }
          ]}
        />
        {settings.theme === 'auto' && (
          <p className="mt-2 text-sm font-semibold text-ink-faint">
            {settings.weather
              ? `Sun times computed for ${settings.weather.label}.`
              : 'No location set — using 7:00 pm to 7:00 am. Pick a weather location below for real sun times.'}
          </p>
        )}
      </div>
      <TextSizeSection />
      <WeatherSection />
      <ClothingSection />
      <ScreensaverSection />
      <SleepSection />
      <CountdownsSection />
      <BackupSection />
      <ParentalLockSection />
      <CompanionSection />
      <div>
        <FieldLabel>Default screen</FieldLabel>
        <SegmentedControl
          value={settings.defaultView === 'home' ? 'home' : 'week'}
          onChange={(defaultView) => mutation.mutate({ defaultView })}
          options={[
            { value: 'home', label: 'Home' },
            { value: 'week', label: 'Week' }
          ]}
        />
      </div>
      <div>
        <FieldLabel>Week starts on</FieldLabel>
        <SegmentedControl
          value={String(settings.weekStartsOn) as '0' | '1'}
          onChange={(v) => mutation.mutate({ weekStartsOn: Number(v) as 0 | 1 })}
          options={[
            { value: '0', label: 'Sunday' },
            { value: '1', label: 'Monday' }
          ]}
        />
      </div>
      <div>
        <FieldLabel>Week view</FieldLabel>
        <SegmentedControl
          value={settings.weekViewStart}
          onChange={(weekViewStart) => mutation.mutate({ weekViewStart })}
          options={[
            { value: 'rolling', label: 'Rolling (starts today)' },
            { value: 'fixed', label: 'Fixed start day' }
          ]}
        />
      </div>
      <div>
        <FieldLabel>Time format</FieldLabel>
        <SegmentedControl
          value={settings.timeFormat}
          onChange={(timeFormat) => mutation.mutate({ timeFormat })}
          options={[
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' }
          ]}
        />
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <span className="flex-1 text-base font-semibold text-ink-soft">
          Launch OpenSkyLight when the computer starts (installed app only)
        </span>
        <Toggle
          checked={settings.launchOnStartup}
          onChange={(launchOnStartup) => mutation.mutate({ launchOnStartup })}
          label="Launch on startup"
        />
      </div>
    </div>
  )
}
