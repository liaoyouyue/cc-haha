import { describe, expect, it } from 'vitest'
import { summarizeStartupHealth } from './startupHealth'
import type { DoctorReport } from '../api/doctor'

function report(missingCount: number, invalidCount: number): DoctorReport {
  return {
    generatedAt: '2026-10-09T02:00:00Z',
    items: [],
    protectedSkips: [],
    summary: {
      total: 5,
      protectedCount: 0,
      neutralCount: 5 - missingCount - invalidCount,
      missingCount,
      invalidCount,
    },
  }
}

describe('summarizeStartupHealth', () => {
  it('is ok when nothing is missing or broken', () => {
    expect(summarizeStartupHealth(report(0, 0))).toEqual({ level: 'ok', missing: 0, invalid: 0, unavailable: false })
  })

  it('warns on missing config but does not fail', () => {
    expect(summarizeStartupHealth(report(3, 0)).level).toBe('warn')
  })

  it('fails on a corrupt config file even alongside missing ones', () => {
    const summary = summarizeStartupHealth(report(2, 1))
    expect(summary.level).toBe('error')
    expect(summary).toMatchObject({ missing: 2, invalid: 1 })
  })

  it('reports the check service itself being unreachable', () => {
    expect(summarizeStartupHealth(null, true)).toEqual({ level: 'error', missing: 0, invalid: 0, unavailable: true })
  })

  it('treats an absent report as unavailable rather than healthy', () => {
    expect(summarizeStartupHealth(null).unavailable).toBe(true)
  })
})
