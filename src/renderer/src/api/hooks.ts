import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ipcInvoke } from './client'
import type {
  CalendarCreateInput,
  CalendarUpdateInput,
  EventCreateInput,
  EventDeleteInput,
  EventUpdateInput,
  PersonCreateInput,
  PersonUpdateInput,
  AppSettings,
  CountdownInput
} from '@shared/types'
import type { DateRange } from '@shared/dates'
import { useToasts } from '../stores/toastStore'

export function useAppInfo() {
  return useQuery({ queryKey: ['appInfo'], queryFn: () => ipcInvoke('app:getInfo', undefined), staleTime: Infinity })
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => ipcInvoke('settings:getAll', undefined) })
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => ipcInvoke('people:list', undefined) })
}

export function useCalendars() {
  return useQuery({ queryKey: ['calendars'], queryFn: () => ipcInvoke('calendars:list', undefined) })
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => ipcInvoke('events:get', { id: id! }),
    enabled: id !== null
  })
}

export function useOccurrences(range: DateRange) {
  return useQuery({
    queryKey: ['occurrences', range.start, range.end],
    queryFn: () => ipcInvoke('events:getOccurrences', { start: range.start, end: range.end }),
    placeholderData: (prev) => prev
  })
}

function useInvalidatingMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  keys: string[][]
) {
  const queryClient = useQueryClient()
  const pushToast = useToasts((s) => s.push)
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err: Error) => pushToast(err.message)
  })
}

export function useEventMutations() {
  const create = useInvalidatingMutation((input: EventCreateInput) => ipcInvoke('events:create', input), [
    ['occurrences']
  ])
  const update = useInvalidatingMutation((input: EventUpdateInput) => ipcInvoke('events:update', input), [
    ['occurrences']
  ])
  const remove = useInvalidatingMutation((input: EventDeleteInput) => ipcInvoke('events:delete', input), [
    ['occurrences']
  ])
  return { create, update, remove }
}

export function usePeopleMutations() {
  const keys = [['people'], ['occurrences']]
  return {
    create: useInvalidatingMutation((input: PersonCreateInput) => ipcInvoke('people:create', input), keys),
    update: useInvalidatingMutation((input: PersonUpdateInput) => ipcInvoke('people:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('people:delete', input), keys)
  }
}

export function useCalendarMutations() {
  const keys = [['calendars'], ['occurrences']]
  return {
    create: useInvalidatingMutation((input: CalendarCreateInput) => ipcInvoke('calendars:create', input), keys),
    update: useInvalidatingMutation((input: CalendarUpdateInput) => ipcInvoke('calendars:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('calendars:delete', input), keys)
  }
}

export function useSettingsMutation() {
  return useInvalidatingMutation(
    (patch: Partial<AppSettings>) => ipcInvoke('settings:set', { patch }),
    [['settings'], ['occurrences'], ['weather']]
  )
}

export function useGoogleStatus() {
  // polled so the header's issue line notices a sign-in expiring (or being fixed) without a restart
  return useQuery({ queryKey: ['googleStatus'], queryFn: () => ipcInvoke('google:getStatus', undefined), refetchInterval: 60_000 })
}

export function useRemoteCalendars(accountId: string | null) {
  return useQuery({
    queryKey: ['remoteCalendars', accountId],
    queryFn: () => ipcInvoke('google:listRemoteCalendars', { accountId: accountId! }),
    enabled: accountId !== null,
    staleTime: 60_000
  })
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ['syncStatus'],
    queryFn: () => ipcInvoke('sync:getStatus', undefined),
    refetchInterval: 15_000
  })
}

export function useGoogleMutations() {
  const calendarKeys = [['googleStatus'], ['remoteCalendars'], ['calendars'], ['occurrences'], ['syncStatus']]
  return {
    setCredentials: useInvalidatingMutation(
      (input: { clientId: string; clientSecret: string }) => ipcInvoke('google:setCredentials', input),
      [['googleStatus']]
    ),
    connect: useInvalidatingMutation(() => ipcInvoke('google:connect', undefined), calendarKeys),
    disconnect: useInvalidatingMutation(
      (input: { accountId: string }) => ipcInvoke('google:disconnect', input),
      calendarKeys
    ),
    setCalendarSelected: useInvalidatingMutation(
      (input: {
        accountId: string
        googleCalendarId: string
        name: string
        color: string
        readOnly: boolean
        selected: boolean
      }) => ipcInvoke('google:setCalendarSelected', input),
      calendarKeys
    )
  }
}

export function useIcsMutations() {
  return {
    add: useInvalidatingMutation(
      (input: { url: string; name: string; color: string }) => ipcInvoke('ics:add', input),
      [['calendars'], ['occurrences'], ['syncStatus']]
    )
  }
}

export function useSyncNow() {
  return useInvalidatingMutation(() => ipcInvoke('sync:now', undefined), [['syncStatus']])
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => ipcInvoke('chores:list', undefined) })
}

export function useChoresDay(date: string) {
  return useQuery({
    queryKey: ['choresDay', date],
    queryFn: () => ipcInvoke('chores:getDay', { date }),
    placeholderData: (prev) => prev
  })
}

export function useBalances() {
  return useQuery({ queryKey: ['balances'], queryFn: () => ipcInvoke('stars:balances', undefined) })
}

/** The game time log (newest first): one kid, or everyone. */
export function useGameTimeLog(personId: string | null, limit: number) {
  return useQuery({
    queryKey: ['gameTimeLog', personId, limit],
    queryFn: () => ipcInvoke('stars:log', { personId, limit }),
    placeholderData: (prev) => prev
  })
}

/** Game timers counting down (and finished ones waiting for an OK). */
export function useGameTimers() {
  return useQuery({ queryKey: ['gameTimers'], queryFn: () => ipcInvoke('stars:timers', undefined) })
}

export function useStopGameTimer() {
  return useInvalidatingMutation((input: { id: string }) => ipcInvoke('stars:stopTimer', input), [['gameTimers'], ['balances']])
}

/** A kid spends all their controllers on game time (balance → 0). */
export function useUseTime() {
  return useInvalidatingMutation((input: { personId: string }) => ipcInvoke('stars:useTime', input), [['balances'], ['gameTimers']])
}

export function useChecklists() {
  return useQuery({ queryKey: ['checklists'], queryFn: () => ipcInvoke('chores:checklists', undefined) })
}

export function useChecklistsDay(date: string) {
  return useQuery({
    queryKey: ['checklistsDay', date],
    queryFn: () => ipcInvoke('chores:checklistsDay', { date }),
    placeholderData: (prev) => prev
  })
}

export function usePendingUnlocks(date: string) {
  return useQuery({ queryKey: ['pendingUnlocks', date], queryFn: () => ipcInvoke('chores:pendingUnlocks', { date }) })
}

export function useChecklistMutations() {
  const keys = [['checklists'], ['checklistsDay'], ['pendingUnlocks']]
  return {
    create: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:checklistCreate'>>[1]) => ipcInvoke('chores:checklistCreate', input),
      keys
    ),
    update: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:checklistUpdate'>>[1]) => ipcInvoke('chores:checklistUpdate', input),
      keys
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('chores:checklistDelete', input), keys),
    approve: useInvalidatingMutation(
      (input: { checklistId: string; personId: string; date: string; round?: number }) => ipcInvoke('chores:approveUnlock', input),
      [...keys, ['balances']]
    )
  }
}

/** Controllers paid for each finished Video Games set. */
export function useVideoGamesStars() {
  return useQuery({ queryKey: ['videoGamesStars'], queryFn: () => ipcInvoke('chores:videoGamesStars', undefined) })
}

export function useSetVideoGamesStars() {
  return useInvalidatingMutation(
    (input: { stars: number }) => ipcInvoke('chores:setVideoGamesStars', input),
    [['videoGamesStars'], ['checklistsDay']]
  )
}

export function useChoreMutations() {
  const defKeys = [['chores'], ['choresDay']]
  // a tick can finish (or undo) a checklist, so its views refresh too
  const checkKeys = [['choresDay'], ['balances'], ['checklistsDay'], ['pendingUnlocks']]
  return {
    create: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:create'>>[1]) => ipcInvoke('chores:create', input),
      defKeys
    ),
    update: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:update'>>[1]) => ipcInvoke('chores:update', input),
      defKeys
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('chores:delete', input), defKeys),
    complete: useInvalidatingMutation(
      (input: { choreId: string; date: string; personId: string }) => ipcInvoke('chores:complete', input),
      checkKeys
    ),
    uncomplete: useInvalidatingMutation(
      (input: { choreId: string; date: string; personId?: string }) => ipcInvoke('chores:uncomplete', input),
      checkKeys
    )
  }
}

export function useRewards() {
  return useQuery({ queryKey: ['rewards'], queryFn: () => ipcInvoke('rewards:list', undefined) })
}

export function useRedemptions() {
  return useQuery({ queryKey: ['redemptions'], queryFn: () => ipcInvoke('rewards:redemptions', undefined) })
}

export function useRewardMutations() {
  return {
    create: useInvalidatingMutation(
      (input: { title: string; costStars: number }) => ipcInvoke('rewards:create', input),
      [['rewards']]
    ),
    update: useInvalidatingMutation(
      (input: { id: string; title?: string; costStars?: number; active?: boolean }) =>
        ipcInvoke('rewards:update', input),
      [['rewards']]
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('rewards:delete', input), [['rewards']]),
    redeem: useInvalidatingMutation(
      (input: { rewardId: string; personId: string }) => ipcInvoke('rewards:redeem', input),
      [['balances'], ['redemptions']]
    ),
    grant: useInvalidatingMutation(
      (input: { redemptionId: string }) => ipcInvoke('rewards:grant', input),
      [['redemptions']]
    )
  }
}

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: () => ipcInvoke('lists:getAll', undefined) })
}

export function useListMutations() {
  const keys = [['lists']]
  return {
    create: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'lists:create'>>[1]) => ipcInvoke('lists:create', input),
      keys
    ),
    update: useInvalidatingMutation(
      (input: { id: string; name?: string; color?: string }) => ipcInvoke('lists:update', input),
      keys
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('lists:delete', input), keys),
    addItem: useInvalidatingMutation(
      (input: { listId: string; text: string }) => ipcInvoke('listItems:add', input),
      keys
    ),
    toggleItem: useInvalidatingMutation((input: { id: string }) => ipcInvoke('listItems:toggle', input), keys),
    removeItem: useInvalidatingMutation((input: { id: string }) => ipcInvoke('listItems:delete', input), keys),
    clearChecked: useInvalidatingMutation(
      (input: { listId: string }) => ipcInvoke('listItems:clearChecked', input),
      keys
    )
  }
}

export function useMeals(start: string, end: string) {
  return useQuery({
    queryKey: ['meals', start, end],
    queryFn: () => ipcInvoke('meals:getRange', { start, end }),
    placeholderData: (prev) => prev
  })
}

export function useMealMutations() {
  return {
    set: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'meals:set'>>[1]) => ipcInvoke('meals:set', input),
      [['meals']]
    )
  }
}

export function useWeather() {
  return useQuery({
    queryKey: ['weather'],
    queryFn: () => ipcInvoke('weather:get', undefined),
    refetchInterval: 10 * 60_000,
    retry: 2
  })
}

export function useCitySearch() {
  return useMutation({
    mutationFn: (query: string) => ipcInvoke('weather:searchCity', { query })
  })
}

export function useAuthStatus() {
  return useQuery({ queryKey: ['authStatus'], queryFn: () => ipcInvoke('auth:getStatus', undefined) })
}

export function useAuthMutations() {
  const keys = [['authStatus']]
  return {
    verifyPin: useInvalidatingMutation((input: { pin: string }) => ipcInvoke('auth:verifyPin', input), keys),
    setPin: useInvalidatingMutation((input: { pin: string | null }) => ipcInvoke('auth:setPin', input), keys),
    lock: useInvalidatingMutation(() => ipcInvoke('auth:lock', undefined), keys)
  }
}

export function useCountdowns() {
  // re-read hourly so one that has passed drops off even with nothing else changing
  return useQuery({ queryKey: ['countdowns'], queryFn: () => ipcInvoke('countdowns:list', undefined), refetchInterval: 60 * 60_000 })
}

export function useCountdownMutations() {
  const keys = [['countdowns']]
  return {
    create: useInvalidatingMutation((input: CountdownInput) => ipcInvoke('countdowns:create', input), keys),
    update: useInvalidatingMutation((input: CountdownInput & { id: string }) => ipcInvoke('countdowns:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('countdowns:delete', input), keys)
  }
}

/** "Leave by" times for the next day's located events; re-read every few minutes as they refresh. */
export function useLeaveTimes() {
  return useQuery({ queryKey: ['travel', 'leaveTimes'], queryFn: () => ipcInvoke('travel:leaveTimes', undefined), refetchInterval: 5 * 60_000 })
}

/** The leave-by time for one occurrence, if there is one. */
export function useLeaveTime(occurrenceKey: string) {
  const { data } = useLeaveTimes()
  return data?.find((t) => t.key === occurrenceKey) ?? null
}

export function useTravelStatus() {
  return useQuery({ queryKey: ['travel', 'status'], queryFn: () => ipcInvoke('travel:status', undefined), refetchInterval: 60_000 })
}

export function useTravelMutations() {
  const keys = [['travel']]
  return {
    setApiKey: useInvalidatingMutation((input: { apiKey: string | null }) => ipcInvoke('travel:setApiKey', input), keys),
    test: useInvalidatingMutation((input: { destination: string }) => ipcInvoke('travel:test', input), keys)
  }
}

export function useNotes() {
  // re-checked every minute so "until tonight" notes drop off at midnight
  return useQuery({ queryKey: ['notes'], queryFn: () => ipcInvoke('notes:list', undefined), refetchInterval: 60_000 })
}

export function useNoteMutations() {
  return {
    done: useInvalidatingMutation((input: { id: string }) => ipcInvoke('notes:done', input), [['notes']]),
    reply: useInvalidatingMutation(
      (input: { noteId: string; text: string }) => ipcInvoke('notes:kioskReply', input),
      [['notes']]
    )
  }
}

export function useBackupStatus() {
  // re-checked every few minutes so the gear's warning follows the nightly run
  return useQuery({ queryKey: ['backupStatus'], queryFn: () => ipcInvoke('backup:status', undefined), refetchInterval: 5 * 60_000 })
}

export function useBackupMutations() {
  const keys = [['backupStatus']]
  return {
    backupNow: useInvalidatingMutation(() => ipcInvoke('backup:now', undefined), keys),
    pickFolder: useInvalidatingMutation(() => ipcInvoke('backup:pickFolder', undefined), keys),
    clearFolder: useInvalidatingMutation(() => ipcInvoke('backup:clearFolder', undefined), keys),
    restore: useInvalidatingMutation((input: { name: string }) => ipcInvoke('backup:restore', input), keys)
  }
}

export function useCompanionStatus() {
  return useQuery({
    queryKey: ['companionStatus'],
    queryFn: () => ipcInvoke('companion:getStatus', undefined),
    refetchInterval: 5_000 // cheap local IPC; tracks server start/stop + pair count
  })
}

export function useCompanionMutations() {
  const keys = [['companionStatus']]
  return {
    issueToken: useInvalidatingMutation(() => ipcInvoke('companion:issueToken', undefined), keys),
    unpairAll: useInvalidatingMutation(() => ipcInvoke('companion:unpairAll', undefined), keys)
  }
}

/** Refetch when the main process announces data changes (sync engine, other windows). */
export function usePushInvalidation(): void {
  const queryClient = useQueryClient()
  const pushToast = useToasts((s) => s.push)
  useEffect(() => {
    const offData = window.osl.on('push:dataChanged', (data) => {
      const domain = (data as { domain?: string })?.domain
      if (domain === 'events') void queryClient.invalidateQueries({ queryKey: ['occurrences'] })
      else if (domain) void queryClient.invalidateQueries({ queryKey: [domain] })
      if (domain === 'calendars') void queryClient.invalidateQueries({ queryKey: ['occurrences'] })
      // leave-by times follow event and travel-settings changes
      if (domain === 'events' || domain === 'calendars' || domain === 'settings') {
        void queryClient.invalidateQueries({ queryKey: ['travel'] })
      }
      if (domain === 'chores') {
        // chore day views and star balances key off their own roots
        for (const key of ['choresDay', 'balances', 'checklists', 'checklistsDay', 'pendingUnlocks', 'videoGamesStars', 'gameTimeLog', 'gameTimers']) {
          void queryClient.invalidateQueries({ queryKey: [key] })
        }
      }
    })
    const offStatus = window.osl.on('push:syncStatus', () => {
      void queryClient.invalidateQueries({ queryKey: ['syncStatus'] })
    })
    const offConflict = window.osl.on('push:syncConflict', (data) => {
      const title = (data as { title?: string })?.title ?? 'An event'
      pushToast(`"${title}" was changed elsewhere — showing the latest version`)
    })
    return () => {
      offData()
      offStatus()
      offConflict()
    }
  }, [queryClient, pushToast])
}
