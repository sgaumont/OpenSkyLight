type Sortable = { mode: 'anyone' | 'each' | 'videogames'; title: string }

/** How the day's plain chores are listed: multi-person ("Everyone") first, then A–Z within each kind. */
export function sortDayChores<T extends Sortable>(chores: T[]): T[] {
  return [...chores].sort(
    (a, b) => Number(b.mode !== 'anyone') - Number(a.mode !== 'anyone') || a.title.localeCompare(b.title)
  )
}
