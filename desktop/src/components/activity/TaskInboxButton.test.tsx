import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TaskInboxButton } from './TaskInboxButton'
import { useTaskInboxStore } from '../../stores/taskInboxStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { sessionsApi } from '../../api/sessions'

vi.mock('../../api/sessions', () => ({ sessionsApi: { getSummary: vi.fn() } }))
const ack = vi.fn(async () => {})
const openSession = vi.fn()
beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useTabStore.setState({ tabs: [] })
  useSessionStore.setState({ sessions: [], openHistoricalSession: openSession })
  useTaskInboxStore.setState({
    entries: [{ taskId: 't1', sessionId: 's1', status: 'completed', summary: 'Finished build', finishedAt: 1000 }],
    unreadCount: 1, loaded: true, ack, refresh: vi.fn(async () => {}), startPolling: vi.fn(), stopPolling: vi.fn(),
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('does not dismiss when pressing inside the portal', () => {
  render(<TaskInboxButton />)
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  const dialog = screen.getByRole('dialog')
  const markRead = dialog.querySelector('button')!
  fireEvent.pointerDown(markRead)
  expect(dialog).toBeInTheDocument()
  fireEvent.click(markRead)
  expect(ack).toHaveBeenCalledTimes(1)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('opens an archived session instead of silently ignoring the task', async () => {
  const summary = { id: 's1', title: 'Archived session' }
  vi.mocked(sessionsApi.getSummary).mockResolvedValue(summary as Awaited<ReturnType<typeof sessionsApi.getSummary>>)
  render(<TaskInboxButton />)
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  fireEvent.click(screen.getByRole('button', { name: /Finished build/ }))
  await waitFor(() => expect(openSession).toHaveBeenCalledWith(summary, expect.any(Object)))
  expect(ack).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
