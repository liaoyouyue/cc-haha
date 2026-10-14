import { describe, expect, it } from 'vitest'
import { buildWorkerRows, classifyProvider, resolveSessionModel, mascotFor, formatDuration, totalTokens, MASCOT_IDS } from './workerBoard'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedProvider } from '../types/provider'
import type { SessionListItem } from '../types/session'

function provider(over: Partial<SavedProvider> & { id: string }): SavedProvider {
  return { presetId: 'custom', name: 'P', apiKey: '', baseUrl: '', apiFormat: 'anthropic', models: {}, ...over } as SavedProvider
}

function session(over: Partial<SessionListItem> & { id: string }): SessionListItem {
  return { title: 't', createdAt: '', modifiedAt: '', messageCount: 0, projectPath: '/p', workDir: '/p', workDirExists: true, ...over } as SessionListItem
}

describe('classifyProvider', () => {
  it('本地免费网关算免费', () => {
    expect(classifyProvider(provider({ id: 'a', name: 'FreeLLMAPI 免费网关', baseUrl: 'http://localhost:3001' }))).toBe('free')
    expect(classifyProvider(provider({ id: 'b', baseUrl: 'http://127.0.0.1:3001/v1' }))).toBe('free')
  })

  it('名字或预设带 free/免费 的算免费', () => {
    expect(classifyProvider(provider({ id: 'c', name: 'OpenCode 免费', baseUrl: 'https://opencode.ai/x' }))).toBe('free')
    expect(classifyProvider(provider({ id: 'd', presetId: 'free-tier', baseUrl: 'https://x.ai' }))).toBe('free')
  })

  it('付费服务商不算免费，未知 provider 不算免费', () => {
    expect(classifyProvider(provider({ id: 'e', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' }))).toBe('paid')
    expect(classifyProvider(undefined)).toBe('unknown')
  })
})

describe('resolveSessionModel', () => {
  it('运行时选择优先于会话快照', () => {
    const s = session({ id: 's', runtimeProviderId: 'old', runtimeModelId: 'old-model' })
    expect(resolveSessionModel(s, { providerId: 'new', modelId: 'new-model' } as never)).toEqual({ providerId: 'new', modelId: 'new-model' })
  })

  it('没有选择时回落会话快照', () => {
    const s = session({ id: 's', runtimeProviderId: 'p', runtimeModelId: 'm' })
    expect(resolveSessionModel(s, undefined)).toEqual({ providerId: 'p', modelId: 'm' })
  })
})

describe('buildWorkerRows', () => {
  it('把免费会话排在前面，并带上服务商名字', () => {
    const free = provider({ id: 'gw', name: 'FreeLLMAPI 免费网关', baseUrl: 'http://localhost:3001' })
    const paid = provider({ id: 'ds', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' })
    const rows = buildWorkerRows(
      [session({ id: '1', title: '贵活', runtimeProviderId: 'ds', runtimeModelId: 'deepseek-v4-pro' }),
       session({ id: '2', title: '便宜活', runtimeProviderId: 'gw', runtimeModelId: 'auto:freeworker' })],
      {},
      [free, paid],
    )
    expect(rows.map((r) => r.title)).toEqual(['便宜活', '贵活'])
    expect(rows[0]).toMatchObject({ providerName: 'FreeLLMAPI 免费网关', modelId: 'auto:freeworker', kind: 'free' })
    expect(rows[1]).toMatchObject({ providerName: 'DeepSeek', kind: 'paid' })
  })

  it('没有 provider 时给出占位而不是崩', () => {
    const rows = buildWorkerRows([session({ id: '1', title: 'x' })], {}, [])
    expect(rows[0]).toMatchObject({ providerName: '—', modelId: '—', kind: 'unknown' })
  })
})

describe('mascotFor', () => {
  it('同一个会话永远同一只，不同会话能分到不同只', () => {
    expect(mascotFor('session-a')).toBe(mascotFor('session-a'))
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(mascotFor)
    expect(new Set(ids).size).toBeGreaterThan(1)
  })

  it('每只吉祥物都有对应图片文件', () => {
    const dir = join(__dirname, '..', 'assets', 'agent-mascots')
    for (const id of MASCOT_IDS) {
      expect(existsSync(join(dir, `agent-mascot-${id}.png`)), `missing asset for ${id}`).toBe(true)
    }
  })
})

describe('formatDuration', () => {
  it('分:秒，过小时补小时段', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(368)).toBe('6:08')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('totalTokens', () => {
  it('输入+输出，缺失算 0', () => {
    expect(totalTokens(undefined)).toBe(0)
    expect(totalTokens({ input_tokens: 69000, output_tokens: 2000 })).toBe(71000)
  })
})
