/** Fisher–Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Deals items in random order, every item once per pass, then reshuffles for the
 * next pass. A new pass never starts with the item that ended the previous one,
 * so nothing shows twice in a row.
 */
export class ShuffleDeck<T> {
  private items: T[] = []
  private order: T[] = []
  private pos = -1
  /** the following pass, dealt early so peek() works across the boundary */
  private upcoming: T[] | null = null

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * Replaces the items; an identical list keeps the current pass going. Items that weren't there
   * before (a photo just sent from a phone) lead the new pass, so they show up right away.
   */
  setItems(items: readonly T[]): void {
    if (items.length === this.items.length && items.every((item, i) => item === this.items[i])) return
    const known = new Set(this.items)
    const added = this.items.length > 0 ? items.filter((item) => !known.has(item)) : []
    this.items = [...items]
    this.order = this.newPass(this.order[this.pos])
    if (added.length > 0) {
      const first = new Set(added)
      this.order = [...added, ...this.order.filter((item) => !first.has(item))]
    }
    this.pos = -1
    this.upcoming = null
  }

  /** Advances and returns the next item (undefined when there are none). */
  next(): T | undefined {
    if (this.items.length === 0) return undefined
    if (this.pos + 1 >= this.order.length) {
      this.order = this.upcoming ?? this.newPass(this.order[this.pos])
      this.upcoming = null
      this.pos = -1
    }
    this.pos++
    return this.order[this.pos]
  }

  /** The item next() will return, without advancing (for preloading). */
  peek(): T | undefined {
    if (this.items.length === 0) return undefined
    if (this.pos + 1 < this.order.length) return this.order[this.pos + 1]
    this.upcoming ??= this.newPass(this.order[this.pos])
    return this.upcoming[0]
  }

  private newPass(last: T | undefined): T[] {
    const order = shuffled(this.items, this.random)
    if (order.length > 1 && order[0] === last) {
      ;[order[0], order[order.length - 1]] = [order[order.length - 1], order[0]]
    }
    return order
  }
}
