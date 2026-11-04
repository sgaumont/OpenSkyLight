import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChecklistInput, ChoreCreateInput, ChoreUpdateInput, NoteInput } from '@shared/types'
import { rpc } from './client'

/** Phone tabs get suspended constantly — focus/reconnect refetch is the real
 * freshness mechanism; the 20s interval covers a phone left on the counter. */
const LIVE = { refetchInterval: 20_000, refetchOnWindowFocus: true, refetchOnReconnect: true } as const

const todayIso = (): string => DateTime.now().toISODate()!

/** Today's date, re-checked every minute so a page left open rolls over at midnight. */
export function useToday(): string {
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60_000)
    return () => clearInterval(t)
  }, [])
  return today
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => rpc('people:list', undefined), ...LIVE })
}

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: () => rpc('lists:getAll', undefined), ...LIVE })
}

export function useMeals(start: string, end: string) {
  return useQuery({
    queryKey: ['meals', start, end],
    queryFn: () => rpc('meals:getRange', { start, end }),
    ...LIVE
  })
}

export function useChoresDay(date: string) {
  return useQuery({ queryKey: ['choresDay', date], queryFn: () => rpc('chores:getDay', { date }), ...LIVE })
}

export function useChecklistsDay(date: string) {
  return useQuery({ queryKey: ['checklistsDay', date], queryFn: () => rpc('chores:checklistsDay', { date }), ...LIVE })
}

export function useChecklists() {
  return useQuery({ queryKey: ['checklists'], queryFn: () => rpc('chores:checklists', undefined), ...LIVE })
}

/** Finished checklists waiting for a parent to sign off on `date`. */
export function usePendingUnlocks(date: string) {
  return useQuery({ queryKey: ['pendingUnlocks', date], queryFn: () => rpc('chores:pendingUnlocks', { date }), ...LIVE })
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => rpc('chores:list', undefined), ...LIVE })
}

export function useBalances() {
  return useQuery({ queryKey: ['balances'], queryFn: () => rpc('stars:balances', undefined), ...LIVE })
}

export function useOccurrences(start: string, end: string) {
  return useQuery({
    queryKey: ['occurrences', start, end],
    queryFn: () => rpc('events:getOccurrences', { start, end }),
    ...LIVE
  })
}

export function useInvalidatingMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  keys: string[][]
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    }
  })
}

export function useListMutations() {
  const keys = [['lists']]
  return {
    create: useInvalidatingMutation(
      (input: { name: string; color: string; kind: 'grocery' | 'todo' | 'custom' }) => rpc('lists:create', input),
      keys
    ),
    addItem: useInvalidatingMutation((input: { listId: string; text: string }) => rpc('listItems:add', input), keys),
    toggleItem: useInvalidatingMutation((input: { id: string }) => rpc('listItems:toggle', input), keys),
    clearChecked: useInvalidatingMutation((input: { listId: string }) => rpc('listItems:clearChecked', input), keys)
  }
}

export function useNotes() {
  return useQuery({ queryKey: ['notes'], queryFn: () => rpc('notes:list', undefined), ...LIVE })
}

export function useNoteMutations() {
  const keys = [['notes']]
  return {
    add: useInvalidatingMutation((input: NoteInput) => rpc('notes:add', input), keys),
    done: useInvalidatingMutation((input: { id: string }) => rpc('notes:done', input), keys)
  }
}

export function useMealMutations() {
  return {
    set: useInvalidatingMutation(
      (input: { date: string; slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; text: string | null }) =>
        rpc('meals:set', input),
      [['meals']]
    )
  }
}

export function useAdjustStars() {
  return useInvalidatingMutation(
    (input: { personId: string; delta: number }) => rpc('stars:adjust', input),
    [['balances']]
  )
}

export function useChoreMutations() {
  const keys = [['choresDay'], ['chores'], ['balances'], ['checklistsDay'], ['pendingUnlocks']]
  return {
    create: useInvalidatingMutation((input: ChoreCreateInput) => rpc('chores:create', input), keys),
    update: useInvalidatingMutation((input: ChoreUpdateInput) => rpc('chores:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => rpc('chores:delete', input), keys),
    complete: useInvalidatingMutation((input: { choreId: string; date: string; personId: string }) => rpc('chores:complete', input), keys),
    uncomplete: useInvalidatingMutation(
      (input: { choreId: string; date: string; personId?: string }) => rpc('chores:uncomplete', input),
      keys
    )
  }
}

export function useChecklistMutations() {
  const keys = [['checklists'], ['checklistsDay'], ['pendingUnlocks'], ['choresDay']]
  return {
    create: useInvalidatingMutation((input: ChecklistInput) => rpc('chores:checklistCreate', input), keys),
    update: useInvalidatingMutation((input: ChecklistInput & { id: string }) => rpc('chores:checklistUpdate', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => rpc('chores:checklistDelete', input), keys),
    approve: useInvalidatingMutation(
      (input: { checklistId: string; personId: string; date: string; round?: number }) => rpc('chores:approveUnlock', input),
      [...keys, ['balances']]
    )
  }
}

/** Controllers paid for each finished Video Games set. */
export function useVideoGamesStars() {
  return useQuery({ queryKey: ['videoGamesStars'], queryFn: () => rpc('chores:videoGamesStars', undefined), ...LIVE })
}
