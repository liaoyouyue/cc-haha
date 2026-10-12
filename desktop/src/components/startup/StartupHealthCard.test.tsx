import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { DoctorReport } from '../../api/doctor'
import { runDoctorCheck } from '../../lib/doctorRepair'
import { useSettingsStore } from '../../stores/settingsStore'
import { StartupHealthCard } from './StartupHealthCard'

vi.mock('../../lib/doctorRepair', () => ({
  runDoctorCheck: vi.fn(),
}))

const runDoctorCheckMock = vi.mocked(runDoctorCheck)

function report(missingCount: number, invalidCount: number): DoctorReport {
  return {
    generatedAt: '2026-10-09T02:00:00Z',
    items: [],
    protectedSkips: [],
    summary: {
      total: 4,
      protectedCount: 0,
      neutralCount: 4 - missingCount - invalidCount,
      missingCount,
      invalidCount,
    },
  }
}

describe('StartupHealthCard', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    runDoctorCheckMock.mockReset()
  })

  it('reports all-good quietly when the config is healthy', async () => {
    runDoctorCheckMock.mockResolvedValue(report(0, 0))

    render(<StartupHealthCard />)

    const card = await screen.findByRole('status')
    expect(card).toHaveAttribute('data-startup-health', 'ok')
    expect(card).toHaveTextContent('all good')
  })

  it('raises a warning when config files are missing', async () => {
    runDoctorCheckMock.mockResolvedValue(report(2, 0))

    render(<StartupHealthCard />)

    const card = await screen.findByRole('status')
    expect(card).toHaveAttribute('data-startup-health', 'warn')
    expect(card).toHaveTextContent('2')
  })

  it('says the check service is unreachable when the request fails', async () => {
    runDoctorCheckMock.mockRejectedValue(new Error('offline'))

    render(<StartupHealthCard />)

    const card = await screen.findByRole('status')
    expect(card).toHaveAttribute('data-startup-health', 'error')
    expect(card).toHaveTextContent('unreachable')
  })
})
