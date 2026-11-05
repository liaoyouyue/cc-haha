/**
 * 后台任务收件箱。
 *
 * 任务完成事件已在 handler.ts 的 trackCliBackgroundTaskLifecycle 里被识别
 * （getCliBackgroundTaskLifecycle 返回 running:false 的终态）。收件箱不重复
 * 解析 CLI 消息，而是由 handler 在该点调用 recordTaskCompletion，这里只负责：
 * 落盘 JSONL（进程重启不丢）+ 内存去重 + 列表/清除。
 *
 * 手机推送不加在这里：手机端已通过 listMobileSessionActivity + mobilePushService
 * 的 completed 事件收到会话级通知；收件箱是桌面端的跨会话台账。
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
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

type Stored = { version: 1; seen: Record<string, TaskInboxEntry>; order: string[] }

const MAX_ENTRIES = 200

let stored: Stored | undefined
let file: string | undefined

function inboxFile(): string {
  if (!file) {
    const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'cc-haha')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    file = path.join(dir, 'task-inbox.json')
  }
  return file
}

function load(): Stored {
  if (stored) return stored
  let raw: unknown = {}
  try { raw = JSON.parse(readFileSync(inboxFile(), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const value = raw as Partial<Stored>
  stored = {
    version: 1,
    seen: value.version === 1 && value.seen && typeof value.seen === 'object' ? value.seen : {},
    order: value.version === 1 && Array.isArray(value.order) ? value.order : [],
  }
  return stored
}

function persist(): void {
  mkdirSync(path.dirname(inboxFile()), { recursive: true, mode: 0o700 })
  const temporary = `${inboxFile()}.${Math.random().toString(16).slice(2, 8)}.tmp`
  writeFileSync(temporary, JSON.stringify(stored))
  renameSync(temporary, inboxFile())
}

/** handler 在任务终态时调用。同一 taskId 只记一次。 */
export function recordTaskCompletion(entry: Omit<TaskInboxEntry, 'finishedAt'> & { finishedAt?: number }): boolean {
  const store = load()
  if (store.seen[entry.taskId]) return false
  const full: TaskInboxEntry = { ...entry, finishedAt: entry.finishedAt ?? Date.now() }
  store.seen[full.taskId] = full
  store.order.push(full.taskId)
  while (store.order.length > MAX_ENTRIES) {
    const dropped = store.order.shift()!
    delete store.seen[dropped]
  }
  persist()
  return true
}

/** 新到未读（finishedAt 晚于 ack 水位）+ 已读全量。 */
export function listTaskInbox(): { unreadCount: number; entries: TaskInboxEntry[] } {
  const store = load()
  const entries = store.order.map(id => store.seen[id]!).filter(Boolean).sort((a, b) => b.finishedAt - a.finishedAt)
  const watermark = readWatermark()
  const unreadCount = entries.filter(row => row.finishedAt > watermark).length
  return { unreadCount, entries }
}

/** 读水位：sessionStorage 存全局 ack 时间戳，持久且每端一致。 */
let watermark = 0
export function ackTaskInbox(): void {
  watermark = Date.now()
  try {
    const ackFile = `${inboxFile()}.ack`
    writeFileSync(ackFile, String(watermark))
  } catch { /* 读不到就只影响本次 unread 计数 */ }
}

function readWatermark(): number {
  if (watermark) return watermark
  try { watermark = Number(readFileSync(`${inboxFile()}.ack`, 'utf8')) || 0 } catch { watermark = 0 }
  return watermark
}

/** 测试用。 */
export function resetTaskInboxForTesting(): void {
  stored = undefined
  watermark = 0
  file = undefined
}
