import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Workers } from './Workers'
import { useSessionStore } from '../stores/sessionStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useProviderStore } from '../stores/providerStore'
import { useChatStore, type PerSessionState } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { SavedProvider } from '../types/provider'
import type { SessionListItem } from '../types/session'

function session(id: string, title: string, providerId: string, modelId: string): SessionListItem {
  return {
    id, title, createdAt: new Date(Date.now() - 6 * 60_000).toISOString(), modifiedAt: '', messageCount: 0,
    projectPath: '/p', workDir: `/p/${title}`, workDirExists: true,
    runtimeProviderId: providerId, runtimeModelId: modelId,
  } as SessionListItem
}

function chat(over: Partial<PerSessionState>): PerSessionState {
  return {
    chatState: 'idle',
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    streamingText: '',
    messages: [],
    ...over,
  } as unknown as PerSessionState
}

afterEach(() => {
  useSessionStore.setState({ sessions: [] })
  useSessionRuntimeStore.setState({ selections: {} })
  useProviderStore.setState({ providers: [] })
  useChatStore.setState({ sessions: {} })
})

describe('Workers office', () => {
  it('每个会话一个工位，底部有会话条', () => {
    useSettingsStore.setState({ locale: 'zh' })
    useProviderStore.setState({
      providers: [
        { id: 'gw', name: 'FreeLLMAPI 免费网关', baseUrl: 'http://localhost:3001', presetId: 'custom', apiKey: '', apiFormat: 'anthropic', models: {} } as SavedProvider,
        { id: 'ds', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', presetId: 'deepseek', apiKey: '', apiFormat: 'anthropic', models: {} } as SavedProvider,
      ],
    })
    useSessionStore.setState({
      sessions: [
        session('a', '怎么启动windows', 'ds', 'deepseek-v4.1-flash'),
        session('b', 'buddy-office', 'gw', 'auto:freeworker'),
      ],
    })
    useChatStore.setState({
      sessions: {
        a: chat({ chatState: 'streaming', tokenUsage: { input_tokens: 69000, output_tokens: 2000, cache_read_tokens: 269000, cache_creation_tokens: 0 } }),
        b: chat({}),
      },
    })

    render(<Workers />)

    expect(screen.getByTestId('worker-desk-a')).toBeTruthy()
    expect(screen.getByTestId('worker-desk-b')).toBeTruthy()
    expect(screen.getByTestId('worker-chip-a').textContent).toContain('运行中')
    expect(screen.getByTestId('worker-chip-a').textContent).toContain('71k tck')
    expect(screen.getByTestId('worker-chip-b').textContent).toContain('空闲')
    expect(screen.getByText('共 2 个会话 · 1 个走免费模型')).toBeTruthy()
  })

  it('悬停工位弹出详情卡，含终端模型与缓存读写', () => {
    useSettingsStore.setState({ locale: 'zh' })
    useProviderStore.setState({
      providers: [
        { id: 'ds', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', presetId: 'deepseek', apiKey: '', apiFormat: 'anthropic', models: {} } as SavedProvider,
      ],
    })
    useSessionStore.setState({ sessions: [session('a', '怎么启动windows', 'ds', 'deepseek-v4.1-flash')] })
    useChatStore.setState({
      sessions: {
        a: chat({ chatState: 'streaming', tokenUsage: { input_tokens: 69000, output_tokens: 2000, cache_read_tokens: 269000, cache_creation_tokens: 0 } }),
      },
    })

    render(<Workers />)
    fireEvent.mouseEnter(screen.getByTestId('worker-chip-a'))

    const detail = screen.getByTestId('worker-detail-a')
    expect(detail.textContent).toContain('终端')
    expect(detail.textContent).toContain('deepseek-v4.1-flash')
    expect(detail.textContent).toContain('缓存读 269k')
    expect(detail.textContent).toContain('付费')
    expect(detail.textContent).toContain('会话已开')
  })
})
