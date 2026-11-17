import { describe, expect, it } from 'vitest'
import { estimateDailyCost, pickTodayEntries } from './DailyReport'

describe('estimateDailyCost', () => {
  const daily = [
    { date: '2026-11-16', tokensByModel: { 'deepseek-flash': 100, 'gpt-6': 50 } },
    { date: '2026-11-17', tokensByModel: { 'deepseek-flash': 300, 'gpt-6': 150 } },
  ]
  const usage = {
    'deepseek-flash': { costUSD: 4 },
    'gpt-6': { costUSD: 6 },
  }

  it('splits a model cost across the days by that model\'s token share', () => {
    // deepseek-flash: $4 over 400 tokens → $1 on the 100-token day.
    // gpt-6: $6 over 200 tokens → $1.50 on the 50-token day.
    expect(estimateDailyCost('2026-11-16', daily, usage)).toBeCloseTo(2.5, 6)
    expect(estimateDailyCost('2026-11-17', daily, usage)).toBeCloseTo(7.5, 6)
  })

  it('returns zero for a day with no tokens', () => {
    expect(estimateDailyCost('2026-11-18', daily, usage)).toBe(0)
  })

  it('ignores a model whose daily tokens exceed its recorded total', () => {
    const over = [{ date: '2026-11-17', tokensByModel: { 'deepseek-flash': 900 } }]
    expect(estimateDailyCost('2026-11-17', over, usage)).toBeCloseTo(4, 6)
  })
})

describe('pickTodayEntries', () => {
  const now = new Date('2026-11-17T12:00:00')
  const entries = [
    { taskId: 'a', sessionId: 's', status: 'completed' as const, finishedAt: new Date('2026-11-17T09:00:00').getTime() },
    { taskId: 'b', sessionId: 's', status: 'failed' as const, finishedAt: new Date('2026-11-17T10:00:00').getTime() },
    { taskId: 'c', sessionId: 's', status: 'completed' as const, finishedAt: new Date('2026-11-16T10:00:00').getTime() },
  ]

  it('keeps only the entries finished on the given day', () => {
    expect(pickTodayEntries(entries, now).map(e => e.taskId)).toEqual(['b', 'a'])
  })

  it('counts the failures among them', () => {
    expect(pickTodayEntries(entries, now).filter(e => e.status === 'failed')).toHaveLength(1)
  })
})
