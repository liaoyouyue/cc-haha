import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type TaskInboxEntry = {
  taskId: string
  sessionId: string
  status: 'completed' | 'failed' | 'stopped'
  description?: string
  summary?: string
  taskType?: string
  finishedAt: number
}

type Stored = { version: 2; entries: TaskInboxEntry[]; read: string[] }
const MAX_ENTRIES = 200
const entryKey = (entry: Pick<TaskInboxEntry, 'sessionId' | 'taskId'>) => JSON.stringify([entry.sessionId, entry.taskId])
let stored: Stored | undefined
let file: string | undefined

function inboxFile(): string {
  const next = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'cc-haha', 'task-inbox.json')
  if (next !== file) { file = next; stored = undefined }
  return next
}

function validEntry(value: unknown): value is TaskInboxEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as TaskInboxEntry
  return typeof entry.taskId === 'string' && typeof entry.sessionId === 'string' &&
    ['completed', 'failed', 'stopped'].includes(entry.status) && Number.isFinite(entry.finishedAt) &&
    [entry.description, entry.summary, entry.taskType].every(value => value === undefined || typeof value === 'string')
}

function load(): Stored {
  const filename = inboxFile()
  if (stored) return stored
  let raw: any = {}
  try { raw = JSON.parse(readFileSync(filename, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1 && raw.version !== 2)) throw new Error('Unsupported task inbox store')
  const source = raw.version === 1 ? Object.values(raw.seen ?? {}) : raw.entries ?? []
  if (!Array.isArray(source)) throw new Error('Invalid task inbox entries')
  const entries = source.filter(validEntry).slice(-MAX_ENTRIES)
  let read: string[] = Array.isArray(raw.read) ? raw.read.filter((key: unknown) => typeof key === 'string') : []
  if (raw.version === 1) {
    let watermark = 0
    try { watermark = Number(readFileSync(`${filename}.ack`, 'utf8')) || 0 } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    read = entries.filter(entry => entry.finishedAt <= watermark).map(entryKey)
  }
  stored = { version: 2, entries, read }
  return stored
}

function persist(next: Stored): void {
  const filename = inboxFile()
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${Math.random().toString(16).slice(2, 8)}.tmp`
  writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
  renameSync(temporary, filename)
  stored = next
}

/** 收件箱故障不能打断任务终态处理；写失败不占用去重键。 */
export function recordTaskCompletion(entry: Omit<TaskInboxEntry, 'finishedAt'> & { finishedAt?: number }): boolean {
  try {
    const store = load()
    if (store.entries.some(existing => entryKey(existing) === entryKey(entry))) return false
    const full: TaskInboxEntry = { ...entry, finishedAt: entry.finishedAt ?? Date.now() }
    const entries = [...store.entries, full].slice(-MAX_ENTRIES)
    const keys = new Set(entries.map(entryKey))
    persist({ version: 2, entries, read: store.read.filter(key => keys.has(key)) })
    return true
  } catch {
    console.warn('[task-inbox] 无法保存任务完成记录')
    return false
  }
}

export function listTaskInbox(): { unreadCount: number; entries: TaskInboxEntry[] } {
  const store = load()
  const read = new Set(store.read)
  return {
    unreadCount: store.entries.filter(entry => !read.has(entryKey(entry))).length,
    entries: [...store.entries].sort((a, b) => b.finishedAt - a.finishedAt),
  }
}

export function ackTaskInbox(): void {
  const store = load()
  persist({ ...store, read: store.entries.map(entryKey) })
}

export function resetTaskInboxForTesting(): void {
  stored = undefined
  file = undefined
}
