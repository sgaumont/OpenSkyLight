/** Counting for chores that can be done more than once a day — shared by the kiosk and the companion. */
type Counted = { mode: 'anyone' | 'each' | 'videogames'; times: number | null; claims: string[] }

/** Done more than once a day (a count, or no limit) rather than a plain tick. */
export function isCounted(c: Counted): boolean {
  return c.times !== 1
}

/** Times done today: by everyone for 'anyone', by `personId` for 'each'. */
export function countOf(c: Counted, personId?: string): number {
  // per person for 'each' and Video Games tasks, whose ticks are everyone's own
  return c.mode !== 'anyone' && personId ? c.claims.filter((p) => p === personId).length : c.claims.length
}

/** Room for one more today (for `personId`, on an 'each' chore). */
export function canAddMore(c: Counted, personId?: string): boolean {
  return c.times === null || countOf(c, personId) < c.times
}

/** "2/3", or "×2" when there's no limit. */
export function countLabel(c: Counted, personId?: string): string {
  const n = countOf(c, personId)
  return c.times === null ? `×${n}` : `${n}/${c.times}`
}

/** Who did it, folded: "Emma ×2, Tom". */
export function claimSummary(claims: string[], nameOf: (id: string) => string | undefined): string {
  const counts = new Map<string, number>()
  for (const id of claims) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts]
    .map(([id, n]) => `${nameOf(id) ?? 'Someone'}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ')
}
