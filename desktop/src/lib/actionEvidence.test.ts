import { describe, expect, it } from 'vitest'
import { buildActionEvidenceByMessageId, extractCompletionClaims } from './actionEvidence'
import type { UIMessage } from '../types/chat'

const T0 = new Date('2026-10-09T02:00:00Z').getTime()
const SECOND = 1000

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${seq}`
}

function user(content = 'prompt'): UIMessage {
  return { id: nextId('u'), type: 'user_text', content, timestamp: T0 + seq * SECOND }
}

function assistant(content: string): UIMessage {
  return { id: nextId('a'), type: 'assistant_text', content, timestamp: T0 + seq * SECOND }
}

function toolUse(toolName: string, toolUseId: string): UIMessage {
  return { id: nextId('tu'), type: 'tool_use', toolName, toolUseId, input: {}, timestamp: T0 + seq * SECOND }
}

function toolResult(toolUseId: string, isError = false): UIMessage {
  return { id: nextId('tr'), type: 'tool_result', toolUseId, content: 'ok', isError, timestamp: T0 + seq * SECOND }
}

describe('extractCompletionClaims', () => {
  it('picks up Chinese completed-action phrasing', () => {
    expect(extractCompletionClaims('已经把文件写好了，配置也已更新')).toEqual(['已更新', '写好了'])
  })

  it('ignores bare status words that are not claims of an action', () => {
    expect(extractCompletionClaims('这个功能的完成度约为 80%')).toEqual([])
  })

  it('needs first-person completion for English, not a plain past tense', () => {
    expect(extractCompletionClaims('I have created the config file').length).toBeGreaterThan(0)
    // A pure Q&A answer describing history must not read as a claim.
    expect(extractCompletionClaims('This flag was added in v2.3')).toEqual([])
  })

  it('does not treat a negated English sentence as a claim', () => {
    expect(extractCompletionClaims("I haven't created anything yet")).toEqual([])
  })
})

describe('buildActionEvidenceByMessageId', () => {
  it('flags a closing reply that claims completion while only reads ran', () => {
    const closing = assistant('已把配置改好了')
    const issues = buildActionEvidenceByMessageId([
      user(),
      toolUse('Read', 'r1'),
      toolResult('r1'),
      closing,
    ])

    expect(issues.get(closing.id)).toEqual({ claims: ['改好了'], evidenceTools: [] })
  })

  it('flags a turn where the write tool errored', () => {
    const closing = assistant('文件已创建')
    const issues = buildActionEvidenceByMessageId([
      user(),
      toolUse('Write', 'w1'),
      toolResult('w1', true),
      closing,
    ])

    expect(issues.has(closing.id)).toBe(true)
  })

  it('stays quiet when a write tool succeeded', () => {
    const issues = buildActionEvidenceByMessageId([
      user(),
      toolUse('Write', 'w1'),
      toolResult('w1'),
      assistant('文件已创建'),
    ])

    expect(issues.size).toBe(0)
  })

  it('stays quiet when the reply makes no completion claim', () => {
    const issues = buildActionEvidenceByMessageId([user(), assistant('这里只是解释，没有动手')])

    expect(issues.size).toBe(0)
  })

  it('does not judge a mid-turn aside that has work after it', () => {
    const issues = buildActionEvidenceByMessageId([
      user(),
      assistant('已删除旧文件'),
      toolUse('Bash', 'b1'),
      toolResult('b1'),
    ])

    expect(issues.size).toBe(0)
  })

  it('skips the still-running last turn when turnActive', () => {
    const messages = [user(), assistant('已全部搞定')]

    expect(buildActionEvidenceByMessageId(messages, { turnActive: true }).size).toBe(0)
    expect(buildActionEvidenceByMessageId(messages, { turnActive: false }).size).toBe(1)
  })

  it('finds the issue in an earlier turn even when a later turn is running', () => {
    const first = assistant('已安装依赖')
    const issues = buildActionEvidenceByMessageId(
      [user(), first, user(), assistant('正在检查')],
      { turnActive: true },
    )

    expect(issues.get(first.id)).toEqual({ claims: ['已安装'], evidenceTools: [] })
  })
})
