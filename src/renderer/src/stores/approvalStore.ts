import { create } from 'zustand'

/**
 * Which Video Games sign-off requests are snoozed ("Not now"), and until when. Kept here rather
 * than in the pop-up so a kid's badge or the chores tile can bring a snoozed request straight back.
 */
interface ApprovalState {
  /** request key (`personId:date:round`) → snoozed until (ms) */
  snoozed: Record<string, number>
  /** whose request to show first after `reopen(personId)` */
  focus: string | null
  snooze(key: string, until: number): void
  /** Un-snooze one kid's requests (or everyone's) so the pop-up shows again now. */
  reopen(personId?: string): void
}

export const useApprovals = create<ApprovalState>((set) => ({
  snoozed: {},
  focus: null,
  snooze: (key, until) => set((s) => ({ snoozed: { ...s.snoozed, [key]: until } })),
  reopen: (personId) =>
    set((s) => ({
      snoozed: personId ? Object.fromEntries(Object.entries(s.snoozed).filter(([k]) => !k.startsWith(`${personId}:`))) : {},
      focus: personId ?? null
    }))
}))
