import { describe, expect, it } from 'vitest'
import { buildWorkerRows, classifyProvider, resolveSessionModel } from './workerBoard'
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
