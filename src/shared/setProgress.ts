import type { DayChecklistDto } from './types'

type Person = DayChecklistDto['people'][number]

/**
 * A person's status on a checklist or the Video Games set: "2/3" while under way, then the
 * caller's word for waiting / unlocked. Video Games shows controllers earned instead of
 * "unlocked" ("+10"), and keeps counting them through later sets ("1/3 · +5").
 */
export function setProgressLabel(
  set: Pick<DayChecklistDto, 'kind' | 'stars'>,
  s: Person,
  words: { pending: string; approved: string }
): string {
  const earned = set.kind === 'videogames' ? (s.rounds ?? 0) * (set.stars ?? 0) : 0
  if (s.unlock === 'pending') return words.pending
  if (s.unlock === 'approved') return set.kind === 'videogames' ? `+${earned}` : words.approved
  return earned > 0 ? `${s.done}/${s.total} · +${earned}` : `${s.done}/${s.total}`
}
