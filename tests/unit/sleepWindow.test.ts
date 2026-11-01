import { describe, expect, it } from 'vitest'
import { isInSleepWindow, parseHhMm, stillAwake, WAKE_IDLE_SECONDS } from '../../src/shared/sleepWindow'

const m = (h: number, min = 0): number => h * 60 + min

describe('parseHhMm', () => {
  it('parses valid times', () => {
    expect(parseHhMm('21:30')).toBe(m(21, 30))
    expect(parseHhMm('06:05')).toBe(m(6, 5))
    expect(parseHhMm('0:00')).toBe(0)
  })
  it('rejects garbage', () => {
    expect(parseHhMm('25:00')).toBeNull()
    expect(parseHhMm('12:60')).toBeNull()
    expect(parseHhMm('noon')).toBeNull()
  })
})

describe('isInSleepWindow', () => {
  it('handles same-day windows', () => {
    expect(isInSleepWindow(m(13), '12:00', '14:00')).toBe(true)
    expect(isInSleepWindow(m(11, 59), '12:00', '14:00')).toBe(false)
    expect(isInSleepWindow(m(14), '12:00', '14:00')).toBe(false)
  })

  it('handles overnight windows (21:30 -> 06:30)', () => {
    expect(isInSleepWindow(m(23), '21:30', '06:30')).toBe(true)
    expect(isInSleepWindow(m(3), '21:30', '06:30')).toBe(true)
    expect(isInSleepWindow(m(6, 29), '21:30', '06:30')).toBe(true)
    expect(isInSleepWindow(m(6, 30), '21:30', '06:30')).toBe(false)
    expect(isInSleepWindow(m(12), '21:30', '06:30')).toBe(false)
    expect(isInSleepWindow(m(21, 30), '21:30', '06:30')).toBe(true)
  })

  it('never sleeps on a zero-length or invalid window', () => {
    expect(isInSleepWindow(m(12), '12:00', '12:00')).toBe(false)
    expect(isInSleepWindow(m(12), 'bad', '14:00')).toBe(false)
  })
})

describe('stillAwake', () => {
  it('stays awake while the screen keeps being used, however long', () => {
    expect(stillAwake(true, true, 0)).toBe(true)
    expect(stillAwake(true, true, WAKE_IDLE_SECONDS - 1)).toBe(true)
  })
  it('goes back to sleep after the idle limit untouched', () => {
    expect(stillAwake(true, true, WAKE_IDLE_SECONDS)).toBe(false)
  })
  it('ends when the sleep window ends', () => {
    expect(stillAwake(true, false, 0)).toBe(false)
  })
  it('never starts on its own', () => {
    expect(stillAwake(false, true, 0)).toBe(false)
  })
})
