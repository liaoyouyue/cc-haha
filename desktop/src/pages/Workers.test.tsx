import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Workers } from './Workers'
import { useSessionStore } from '../stores/sessionStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useProviderStore } from '../stores/providerStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { SavedProvider } from '../types/provider'
import type { SessionListItem } from '../types/session'

function session(id: string, title: string, providerId: string, modelId: string): SessionListItem {
  return {
    id, title, createdAt: '', modifiedAt: '', messageCount: 0,
    projectPath: '/p', workDir: `/p/${title}`, workDirExists: true,
    runtimeProviderId: providerId, runtimeModelId: modelId,
  } as SessionListItem
}

afterEach(() => {
  useSessionStore.setState({ sessions: [] })
  useSessionRuntimeStore.setState({ selections: {} })
  useProviderStore.setState({ providers: [] })
})

describe('Workers page', () => {
  it('每个会话一张卡，并标出免费/付费', () => {
    useSettingsStore.setState({ locale: 'zh' })
    useProviderStore.setState({
      providers: [
        { id: 'gw', name: 'FreeLLMAPI 免费网关', baseUrl: 'http://localhost:3001', presetId: 'custom', apiKey: '', apiFormat: 'anthropic', models: {} } as SavedProvider,
        { id: 'ds', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', presetId: 'deepseek', apiKey: '', apiFormat: 'anthropic', models: {} } as SavedProvider,
      ],
    })
    useSessionStore.setState({
      sessions: [
        session('a', '便宜活', 'gw', 'auto:freeworker'),
        session('b', '贵活', 'ds', 'deepseek-v4-pro'),
      ],
    })

    render(<Workers />)

    expect(screen.getByTestId('worker-card-a').textContent).toContain('免费')
    expect(screen.getByTestId('worker-card-a').textContent).toContain('auto:freeworker')
    expect(screen.getByTestId('worker-card-b').textContent).toContain('付费')
    expect(screen.getByText('共 2 个会话 · 1 个走免费模型')).toBeTruthy()
  })
})
