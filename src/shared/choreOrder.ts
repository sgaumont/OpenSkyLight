type Sortable = { mode: 'anyone' | 'each'; title: string }

/** How the day's plain chores are listed: multi-person ("Everyone") first, then A–Z within each kind. */
export function sortDayChores<T extends Sortable>(chores: T[]): T[] {
  return [...chores].sort(
    (a, b) => Number(b.mode === 'each') - Number(a.mode === 'each') || a.title.localeCompare(b.title)
  )
}
