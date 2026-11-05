import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ackTaskInbox, listTaskInbox, recordTaskCompletion, resetTaskInboxForTesting } from './taskInboxService.js'

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), 'task-inbox-'))
  resetTaskInboxForTesting()
})

describe('task inbox', () => {
  test('records a completion once per task id', () => {
    expect(recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })).toBe(true)
    expect(recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })).toBe(false)
    const { entries, unreadCount } = listTaskInbox()
    expect(entries).toHaveLength(1)
    expect(unreadCount).toBe(1)
  })

  test('newest first, ack clears unread but keeps entries', () => {
    recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed', finishedAt: 1000 })
    recordTaskCompletion({ taskId: 't2', sessionId: 's1', status: 'failed', finishedAt: 2000 })
    expect(listTaskInbox().entries.map(row => row.taskId)).toEqual(['t2', 't1'])
    ackTaskInbox()
    const { unreadCount, entries } = listTaskInbox()
    expect(unreadCount).toBe(0)
    expect(entries).toHaveLength(2)
  })

  test('entries written after ack count as unread again', () => {
    ackTaskInbox()
    recordTaskCompletion({ taskId: 't3', sessionId: 's2', status: 'completed' })
    expect(listTaskInbox().unreadCount).toBe(1)
  })

  test('inboxes survive a reload from disk', () => {
    recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })
    resetTaskInboxForTesting()
    expect(listTaskInbox().entries.map(row => row.taskId)).toEqual(['t1'])
  })
})
