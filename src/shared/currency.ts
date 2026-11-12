import type { Currency } from './types'

/** "1 star", "5 stars", "1 coin", "3 coins". */
export function amountLabel(n: number, currency: Currency): string {
  const one = currency === 'coins' ? 'coin' : 'star'
  return `${n} ${Math.abs(n) === 1 ? one : `${one}s`}`
}
