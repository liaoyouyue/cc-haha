import type { UIMessage } from '../types/chat'

/**
 * 「记忆命中可视化」：一轮里到底碰过哪些记忆文件 —— 读到的（命中）、写进去的、
 * 系统上报加载/失败的。抄白龙马（BaiLongma）的 memory-injector /
 * information-signals：让「这轮用到了记忆」一眼可见，而不是埋在工具分组里
 * 要展开才知道。
 *
 * 与 ToolCallGroup 的 MemoryToolActivityGroup（单个工具分组的记忆卡片）互补：
 * 这里只出**整轮**的汇总，挂在收尾回复下面。回合切分与 actionEvidence /
 * turnCompletion 同一套，不另立规则。
 */
export type MemoryHitSummary = {
  /** 本轮读到的记忆文件（按首次出现顺序，已去重）。 */
  referenced: string[]
  /** 本轮写入/更新的记忆文件（按首次出现顺序，已去重）。 */
  saved: string[]
  /** memory_event 里系统上报「已加载」的条数。 */
  loaded: number
  /** memory_event 里系统上报「失败」的条数。 */
  failed: number
}

export function isEmptyMemoryHit(summary: MemoryHitSummary): boolean {
  return (
    summary.referenced.length === 0 &&
    summary.saved.length === 0 &&
    summary.loaded === 0 &&
    summary.failed === 0
  )
}

/** 记忆文件的判定：`.md` 且落在 `memory/` 目录下。 */
export function isMemoryMarkdownPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.endsWith('.md') && normalized.includes('/memory/')
}

/** 界面上只显示文件名，完整路径留给 title/tooltip。 */
export function memoryFileLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

function getToolFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const filePath = record.file_path ?? record.path
  return typeof filePath === 'string' ? filePath : null
}

type OpenTurn = {
  lastAssistantTextId: string | null
  referenced: string[]
  saved: string[]
  loaded: number
  failed: number
}

function startTurn(): OpenTurn {
  return { lastAssistantTextId: null, referenced: [], saved: [], loaded: 0, failed: 0 }
}

function isTurnStart(message: UIMessage): boolean {
  return message.type === 'user_text' && message.pending !== true && message.optimisticQueued !== true
}

/** 挂在回合尾巴上的附加卡片不是回合进展（与 turnCompletion 一致）。 */
function isTrailingCard(message: UIMessage): boolean {
  return message.type === 'task_summary' || message.type === 'background_task'
}

function addOnce(list: string[], path: string): void {
  if (!list.includes(path)) list.push(path)
}

function flushTurn(turn: OpenTurn, hits: Map<string, MemoryHitSummary>): void {
  if (!turn.lastAssistantTextId) return
  const summary: MemoryHitSummary = {
    referenced: turn.referenced,
    saved: turn.saved,
    loaded: turn.loaded,
    failed: turn.failed,
  }
  if (isEmptyMemoryHit(summary)) return
  hits.set(turn.lastAssistantTextId, summary)
}

/**
 * 找出每一轮碰过记忆的收尾回复，把该轮的记忆汇总挂到那条回复的 id 上。
 * `turnActive` 为真时最后一轮不产出：它还在跑，此刻的计数会随时变。
 */
export function buildMemoryHitsByMessageId(
  messages: UIMessage[],
  options: { turnActive?: boolean } = {},
): Map<string, MemoryHitSummary> {
  const hits = new Map<string, MemoryHitSummary>()
  let current: OpenTurn | null = null

  for (const message of messages) {
    if (isTurnStart(message)) {
      if (current) flushTurn(current, hits)
      current = startTurn()
      continue
    }
    if (!current) continue
    if (isTrailingCard(message)) continue

    switch (message.type) {
      case 'assistant_text':
        current.lastAssistantTextId = message.id
        break
      case 'tool_use': {
        if (message.isPending) break
        const path = getToolFilePath(message.input)
        if (!path || !isMemoryMarkdownPath(path)) break
        if (message.toolName === 'Read') addOnce(current.referenced, path)
        else if (
          message.toolName === 'Write' ||
          message.toolName === 'Edit' ||
          message.toolName === 'MultiEdit'
        ) {
          addOnce(current.saved, path)
        }
        break
      }
      case 'memory_event': {
        for (const file of message.files) {
          const action = file.action ?? message.event
          if (action === 'loaded') current.loaded += 1
          else if (action === 'failed') current.failed += 1
          else if (file.path) addOnce(current.saved, file.path)
        }
        break
      }
      default:
        break
    }
  }

  if (current && options.turnActive !== true) flushTurn(current, hits)
  return hits
}
