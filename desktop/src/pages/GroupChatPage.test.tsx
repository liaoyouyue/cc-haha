import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamStore } from '../stores/teamStore'
import { useTabStore } from '../stores/tabStore'
import { ContentRouter } from '../components/layout/ContentRouter'
import { GROUP_CHAT_TAB_ID } from '../stores/tabStore'
import { GroupChatPage } from './GroupChatPage'

const getWorkbench = vi.fn()

vi.mock('../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getWorkbench: (...args: unknown[]) => getWorkbench(...args),
    getWorkbenchForSession: vi.fn(),
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    sendTeamMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

const TEAM = {
  name: 'demo-group',
  memberCount: 3,
  updatedAt: '2026-11-17T18:24:00.000Z',
  lastMessage: { from: 'pm', text: '一句话结论', timestamp: '2026-11-17T18:24:00.000Z' },
}

const SNAPSHOT = {
  version: 'v1',
  generatedAt: '2026-11-17T18:24:00.000Z',
  team: {
    name: 'demo-group',
    leadAgentId: 'team-lead@demo-group',
    leadSessionId: 'lead-1',
    members: [
      { agentId: 'team-lead@demo-group', name: 'team-lead', role: 'lead', status: 'running' as const },
      { agentId: 'arch@demo-group', name: 'arch', role: 'architect', status: 'running' as const },
      { agentId: 'pm@demo-group', name: 'pm', role: 'pm', status: 'idle' as const },
    ],
  },
  tasks: [],
  messages: [
    { id: 'm1', from: 'arch', to: '*', recipients: ['arch'], kind: 'broadcast' as const, text: '我先说', timestamp: '2026-11-17T18:22:00.000Z' },
    { id: 'm2', from: 'user', to: '*', recipients: ['arch'], kind: 'broadcast' as const, text: '我知道了', timestamp: '2026-11-17T18:23:00.000Z' },
  ],
}

beforeEach(() => {
  getWorkbench.mockReset()
  getWorkbench.mockResolvedValue(SNAPSHOT)
  useTeamStore.setState({ teams: [TEAM], sendTeamMessage: vi.fn().mockResolvedValue({ recipients: ['arch'], broadcast: true }) } as never)
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('独立群聊页', () => {
  it('侧栏开群聊后显示群列表、群头部、微信式气泡和输入条', async () => {
    useTabStore.getState().openTab(GROUP_CHAT_TAB_ID, '开群聊', 'group-chat')
    render(<ContentRouter />)

    expect(screen.getByTestId('group-chat-page')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('group-chat-window')).toBeTruthy())
    expect(screen.getByTestId('group-chat-list').textContent).toContain('demo-group')
    expect(screen.getByTestId('group-chat-header').textContent).toContain('demo-group')
    expect(screen.getByTestId('group-chat-bubble-m1').textContent).toContain('AI助手')
    expect(screen.getByTestId('group-chat-bubble-m2').getAttribute('data-from')).toBe('user')
    expect(screen.getByTestId('group-chat-input')).toBeTruthy()
    expect(screen.getByTestId('group-chat-send')).toBeTruthy()
    expect(screen.getByTestId('group-chat-online')).toBeTruthy()
    expect(screen.getByTestId('group-chat-day')).toBeTruthy()
  })

  it('输入一条消息会调用 sendTeamMessage 并刷新消息流', async () => {
    render(<GroupChatPage />)
    await waitFor(() => expect(screen.getByTestId('group-chat-window')).toBeTruthy())
    const send = useTeamStore.getState().sendTeamMessage as ReturnType<typeof vi.fn>

    fireEvent.change(screen.getByTestId('group-chat-input'), { target: { value: '开会' } })
    fireEvent.click(screen.getByTestId('group-chat-send'))

    await waitFor(() => expect(send).toHaveBeenCalledWith('demo-group', '开会', undefined))
    await waitFor(() => expect(screen.getByTestId('group-chat-input')).toHaveProperty('value', ''))
  })
})
