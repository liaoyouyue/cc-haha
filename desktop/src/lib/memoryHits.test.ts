import { describe, expect, it } from 'vitest'
import { buildMemoryHitsByMessageId, isMemoryMarkdownPath, memoryFileLabel } from './memoryHits'
import type { UIMessage } from '../types/chat'

const T0 = new Date('2026-10-09T02:00:00Z').getTime()
const SECOND = 1000
const RUN_LOG = 'C:/Users/Administrator/.claude/projects/x/memory/run_log.md'
const USER_PREF = 'C:/Users/Administrator/.claude/projects/x/memory/user_pref.md'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${seq}`
}

function user(content = 'prompt'): UIMessage {
  return { id: nextId('u'), type: 'user_text', content, timestamp: T0 + seq * SECOND }
}

function assistant(content = 'done'): UIMessage {
  return { id: nextId('a'), type: 'assistant_text', content, timestamp: T0 + seq * SECOND }
}

function toolUse(toolName: string, path: string, pending = false): UIMessage {
  return {
    id: nextId('tu'),
    type: 'tool_use',
    toolName,
    toolUseId: nextId('id'),
    input: { file_path: path },
    isPending: pending,
    timestamp: T0 + seq * SECOND,
  }
}

function memoryEvent(event: 'saved' | 'updated' | 'loaded' | 'failed', paths: string[]): UIMessage {
  return {
    id: nextId('m'),
    type: 'memory_event',
    event,
    files: paths.map((path) => ({ path })),
    timestamp: T0 + seq * SECOND,
  }
}

describe('memory path helpers', () => {
  it('recognizes memory markdown and labels by basename', () => {
    expect(isMemoryMarkdownPath(RUN_LOG)).toBe(true)
    expect(isMemoryMarkdownPath('C:/repo/README.md')).toBe(false)
    expect(memoryFileLabel(RUN_LOG)).toBe('run_log.md')
  })
})

describe('buildMemoryHitsByMessageId', () => {
  it('records a memory file read in the turn that closes with a reply', () => {
    const closing = assistant()
    const hits = buildMemoryHitsByMessageId([user(), toolUse('Read', RUN_LOG), closing])

    expect(hits.get(closing.id)).toEqual({ referenced: [RUN_LOG], saved: [], loaded: 0, failed: 0 })
  })

  it('merges a memory write and a matching memory_event without double counting', () => {
    const closing = assistant()
    const hits = buildMemoryHitsByMessageId([
      user(),
      toolUse('Edit', USER_PREF),
      memoryEvent('saved', [USER_PREF]),
      closing,
    ])

    expect(hits.get(closing.id)).toEqual({ referenced: [], saved: [USER_PREF], loaded: 0, failed: 0 })
  })

  it('counts loaded and failed memory events', () => {
    const closing = assistant()
    const hits = buildMemoryHitsByMessageId([
      user(),
      memoryEvent('loaded', [RUN_LOG, USER_PREF]),
      memoryEvent('failed', [RUN_LOG]),
      closing,
    ])

    expect(hits.get(closing.id)).toEqual({ referenced: [], saved: [], loaded: 2, failed: 1 })
  })

  it('ignores reads of non-memory markdown', () => {
    const hits = buildMemoryHitsByMessageId([user(), toolUse('Read', 'C:/repo/README.md'), assistant()])

    expect(hits.size).toBe(0)
  })

  it('ignores pending tool calls and a turn with no closing reply', () => {
    expect(buildMemoryHitsByMessageId([user(), toolUse('Read', RUN_LOG, true), assistant()]).size).toBe(0)
    expect(buildMemoryHitsByMessageId([user(), memoryEvent('loaded', [RUN_LOG])]).size).toBe(0)
  })

  it('skips the still-running last turn when turnActive', () => {
    const messages = [user(), toolUse('Read', RUN_LOG), assistant()]

    expect(buildMemoryHitsByMessageId(messages, { turnActive: true }).size).toBe(0)
    expect(buildMemoryHitsByMessageId(messages, { turnActive: false }).size).toBe(1)
  })

  it('keeps each turn separate', () => {
    const first = assistant()
    const second = assistant()
    const hits = buildMemoryHitsByMessageId([
      user(),
      toolUse('Read', RUN_LOG),
      first,
      user(),
      toolUse('Write', USER_PREF),
      second,
    ])

    expect(hits.get(first.id)).toEqual({ referenced: [RUN_LOG], saved: [], loaded: 0, failed: 0 })
    expect(hits.get(second.id)).toEqual({ referenced: [], saved: [USER_PREF], loaded: 0, failed: 0 })
  })
})
