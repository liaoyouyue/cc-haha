import { describe, expect, it } from 'vitest'
import {
  pushRateSample,
  RATE_WINDOW_MS,
  streamRate,
  type RateSample,
} from './streamRate'

/** One sample per second: the char counts stand for tokens at 4 chars each. */
const feed = (chars: number[], start = 10_000) =>
  chars.reduce<RateSample[]>(
    (samples, value, index) => pushRateSample(samples, { at: start + index * 1000, chars: value }),
    [],
  )

describe('pushRateSample', () => {
  it('keeps only the newest sample for one timestamp', () => {
    let samples = pushRateSample([], { at: 1000, chars: 40 })
    samples = pushRateSample(samples, { at: 1000, chars: 80 })
    expect(samples).toEqual([{ at: 1000, chars: 80 }])
  })

  it('restarts when the counter falls (a new turn or a resync)', () => {
    const samples = pushRateSample(feed([40, 80, 120]), { at: 13_000, chars: 10 })
    expect(samples).toEqual([{ at: 13_000, chars: 10 }])
  })

  it('restarts when the clock goes backwards', () => {
    const samples = pushRateSample(feed([40, 80]), { at: 5000, chars: 120 })
    expect(samples).toEqual([{ at: 5000, chars: 120 }])
  })

  it('ignores invalid samples instead of poisoning the window', () => {
    const base = feed([40, 80])
    expect(pushRateSample(base, { at: Number.NaN, chars: 1 })).toEqual(base)
    expect(pushRateSample(base, { at: 99_999, chars: -1 })).toEqual(base)
  })

  it('drops samples outside the window and caps the series length', () => {
    const long = feed(Array.from({ length: 200 }, (_, i) => i * 10))
    expect(long.length).toBeLessThanOrEqual(24)
  })
})

describe('streamRate', () => {
  it('reports nothing without enough history', () => {
    expect(streamRate([], 10_000)).toBeNull()
    expect(streamRate(feed([400]), 10_000)).toBeNull()
  })

  it('reports nothing when the window is shorter than a second', () => {
    const samples = pushRateSample(pushRateSample([], { at: 10_000, chars: 0 }), { at: 10_900, chars: 400 })
    expect(streamRate(samples, 10_900)).toBeNull()
  })

  it('converts characters to tokens at four characters each', () => {
    // 400 chars over one second = 100 tokens per second.
    expect(streamRate(feed([0, 400]), 11_000)).toBe(100)
  })

  it('measures the recent window, not the turn average', () => {
    // 40 chars per second for ten seconds, then 1000 chars per second.
    const chars = [0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 1400, 2400, 3400, 4400, 5400, 6400]
    const rate = streamRate(feed(chars), 10_000 + 16_000)!
    // The last five seconds hold 5000 chars: 5000/4 tokens over 5s = 250 tok/s.
    // The turn average would be far lower.
    expect(rate).toBe(250)
  })

  it('reports nothing once the model has stalled', () => {
    const samples = feed([0, 400, 800, 1200, 1200, 1200, 1200])
    expect(streamRate(samples, 10_000 + 6000)).toBeNull()
  })

  it('decays during a short stall instead of freezing the last reading', () => {
    const growing = feed([0, 400, 800, 1200])
    const afterOne = feed([0, 400, 800, 1200, 1200])
    const afterTwo = feed([0, 400, 800, 1200, 1200, 1200])
    const a = streamRate(growing, 13_000)!
    const b = streamRate(afterOne, 14_000)!
    const c = streamRate(afterTwo, 15_000)!
    // 400 chars per second = 100 tokens per second.
    expect(a).toBe(100)
    expect(b).toBeLessThan(a)
    expect(c).toBeLessThan(b)
    expect(c).toBeGreaterThan(0)
  })

  it('reports nothing when the sampler itself stopped', () => {
    expect(streamRate(feed([0, 400, 800]), 12_000 + 3001)).toBeNull()
  })

  it('reports nothing when the clock went backwards', () => {
    expect(streamRate(feed([0, 400, 800]), 11_000)).toBeNull()
  })

  it('reports nothing when the window shows no growth', () => {
    expect(streamRate(feed([2000, 2000, 2000]), 12_000)).toBeNull()
  })

  it('does not carry an old reading across a reset', () => {
    const samples = pushRateSample(feed([0, 400, 800]), { at: 13_000, chars: 20 })
    expect(streamRate(samples, 13_000)).toBeNull()
  })

  it('ignores output that arrived before the window opened', () => {
    // The first sample already carries 20000 chars; only later growth counts.
    expect(streamRate(feed([20_000, 20_200, 20_400]), 12_000)).toBe(50)
  })

  it('never exceeds the window it claims to measure', () => {
    const samples = feed([0, 0, 0, 0, 0, 0, 400, 800])
    // The window holds 800 chars over 5s: 800/4 tokens over 5s = 40 tok/s.
    expect(streamRate(samples, 10_000 + 7000)).toBe(40)
    expect(RATE_WINDOW_MS).toBe(5_000)
  })
})
