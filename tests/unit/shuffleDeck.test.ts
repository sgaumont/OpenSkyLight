import { describe, expect, it } from 'vitest'
import { ShuffleDeck, shuffled } from '../../src/shared/shuffleDeck'

/** Deterministic PRNG so failures reproduce. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const deal = <T>(deck: ShuffleDeck<T>, n: number): T[] => Array.from({ length: n }, () => deck.next()!)

describe('shuffled', () => {
  it('is a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const out = shuffled(input, seeded(1))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('ShuffleDeck', () => {
  const photos = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  it('shows every item exactly once per pass, over many passes', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const deck = new ShuffleDeck<string>(seeded(seed))
      deck.setItems(photos)
      for (let pass = 0; pass < 5; pass++) {
        expect(deal(deck, photos.length).sort()).toEqual(photos)
      }
    }
  })

  it('never repeats a photo back-to-back across a pass boundary', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const deck = new ShuffleDeck<string>(seeded(seed))
      deck.setItems(['x', 'y', 'z'])
      const seq = deal(deck, 30)
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1])
    }
  })

  it('actually varies the order between passes', () => {
    const deck = new ShuffleDeck<string>(seeded(7))
    deck.setItems(photos)
    const passes = new Set(Array.from({ length: 6 }, () => deal(deck, photos.length).join('')))
    expect(passes.size).toBeGreaterThan(1)
  })

  it('peek() matches the next item, including across a pass boundary', () => {
    const deck = new ShuffleDeck<string>(seeded(3))
    deck.setItems(photos)
    for (let i = 0; i < 25; i++) {
      const peeked = deck.peek()
      expect(deck.next()).toBe(peeked)
    }
  })

  it('setting the same list keeps the pass going; a changed list reshuffles', () => {
    const deck = new ShuffleDeck<string>(seeded(5))
    deck.setItems(photos)
    const firstHalf = deal(deck, 3)
    deck.setItems([...photos]) // same contents (e.g. a refetch) — no restart
    const rest = deal(deck, 4)
    expect([...firstHalf, ...rest].sort()).toEqual(photos)

    deck.setItems(['new1', 'new2'])
    expect(deal(deck, 2).sort()).toEqual(['new1', 'new2'])
  })

  it('handles empty and single-item lists', () => {
    const deck = new ShuffleDeck<string>()
    expect(deck.next()).toBeUndefined()
    expect(deck.peek()).toBeUndefined()
    deck.setItems(['only'])
    expect(deal(deck, 3)).toEqual(['only', 'only', 'only'])
  })
})
