import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryHitNotice } from './MemoryHitNotice'
import { useSettingsStore } from '../../stores/settingsStore'

describe('MemoryHitNotice', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('summarizes the memory files the turn touched', () => {
    render(
      <MemoryHitNotice
        summary={{
          referenced: ['C:/x/memory/run_log.md', 'C:/x/memory/user_pref.md'],
          saved: ['C:/x/memory/session_notes.md'],
          loaded: 0,
          failed: 0,
        }}
      />,
    )

    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('data-memory-hits')
    expect(notice).toHaveTextContent('2 hit')
    expect(notice).toHaveTextContent('1 written')
    expect(notice).toHaveTextContent('run_log.md')
    // Zero buckets stay out of the line instead of printing "0 loaded".
    expect(notice).not.toHaveTextContent('loaded')
  })
})
