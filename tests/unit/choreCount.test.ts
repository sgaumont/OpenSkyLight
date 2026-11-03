import { describe, expect, it } from 'vitest'
import { canAddMore, claimSummary, countLabel, countOf, isCounted } from '../../src/shared/choreCount'

describe('choreCount', () => {
  const anyone = (times: number | null, claims: string[]) => ({ mode: 'anyone' as const, times, claims })
  const each = (times: number | null, claims: string[]) => ({ mode: 'each' as const, times, claims })

  it('a plain chore (times 1) is a tick, not a count', () => {
    expect(isCounted(anyone(1, []))).toBe(false)
    expect(isCounted(anyone(3, []))).toBe(true)
    expect(isCounted(anyone(null, []))).toBe(true)
  })

  it("'anyone' counts everyone's ticks; 'each' counts one person's", () => {
    expect(countOf(anyone(3, ['a', 'b', 'a']))).toBe(3)
    expect(countOf(each(3, ['a', 'b', 'a']), 'a')).toBe(2)
    expect(countOf(each(3, ['a', 'b', 'a']), 'b')).toBe(1)
  })

  it('room for more until the cap; always with no limit', () => {
    expect(canAddMore(anyone(2, ['a']))).toBe(true)
    expect(canAddMore(anyone(2, ['a', 'b']))).toBe(false)
    expect(canAddMore(each(2, ['a', 'a', 'b']), 'a')).toBe(false)
    expect(canAddMore(each(2, ['a', 'a', 'b']), 'b')).toBe(true)
    expect(canAddMore(anyone(null, Array(50).fill('a')))).toBe(true)
  })

  it('labels: "2/3", or "×2" with no limit; who did it, folded', () => {
    expect(countLabel(anyone(3, ['a', 'b']))).toBe('2/3')
    expect(countLabel(anyone(null, ['a', 'b']))).toBe('×2')
    expect(countLabel(each(2, ['a', 'b', 'a']), 'a')).toBe('2/2')
    const names: Record<string, string> = { a: 'Emma', b: 'Tom' }
    expect(claimSummary(['a', 'b', 'a'], (id) => names[id])).toBe('Emma ×2, Tom')
  })
})
