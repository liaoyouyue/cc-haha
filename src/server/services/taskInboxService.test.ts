import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ackTaskInbox, listTaskInbox, recordTaskCompletion, resetTaskInboxForTesting } from './taskInboxService.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  resetTaskInboxForTesting()
})

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

  test('entries at the same timestamp after ack remain unread across reload', () => {
    recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed', finishedAt: 1000 })
    ackTaskInbox()
    recordTaskCompletion({ taskId: 't3', sessionId: 's2', status: 'completed', finishedAt: 1000 })
    resetTaskInboxForTesting()
    expect(listTaskInbox().unreadCount).toBe(1)
  })

  test('identical task IDs in different sessions do not collide', () => {
    for (const sessionId of ['s1', 's2']) {
      expect(recordTaskCompletion({ taskId: '__proto__', sessionId, status: 'completed' })).toBe(true)
    }
    expect(listTaskInbox().entries).toHaveLength(2)
    expect(listTaskInbox().unreadCount).toBe(2)
  })

  test('disk failures do not escape into task lifecycle handling', () => {
    const directory = process.env.CLAUDE_CONFIG_DIR!
    const blocked = path.join(directory, 'blocked')
    writeFileSync(blocked, 'not a directory')
    process.env.CLAUDE_CONFIG_DIR = blocked
    expect(recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })).toBe(false)
    process.env.CLAUDE_CONFIG_DIR = directory
    expect(recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })).toBe(true)
    expect(listTaskInbox().unreadCount).toBe(1)
  })

  test('migrates old timestamp acknowledgements without dropping entries', () => {
    const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'cc-haha')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'task-inbox.json'), JSON.stringify({ version: 1, order: ['t1'], seen: { t1: { taskId: 't1', sessionId: 's1', status: 'completed', finishedAt: 1000 } } }))
    writeFileSync(path.join(dir, 'task-inbox.json.ack'), '1000')
    expect(listTaskInbox().unreadCount).toBe(0)
    expect(listTaskInbox().entries).toHaveLength(1)
    expect(recordTaskCompletion({ taskId: 't1', sessionId: 's2', status: 'completed', finishedAt: 1000 })).toBe(true)
    resetTaskInboxForTesting()
    expect(listTaskInbox().unreadCount).toBe(1)
  })

  test('inboxes survive a reload from disk', () => {
    recordTaskCompletion({ taskId: 't1', sessionId: 's1', status: 'completed' })
    resetTaskInboxForTesting()
    expect(listTaskInbox().entries.map(row => row.taskId)).toEqual(['t1'])
  })
})
