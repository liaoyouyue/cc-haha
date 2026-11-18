import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamStore } from '../stores/teamStore'
import { useTabStore } from '../stores/tabStore'
import { ContentRouter } from '../components/layout/ContentRouter'
import { GroupChatPage } from './GroupChatPage'

const getWorkbench = vi.fn()
const addMember = vi.fn()

vi.mock('../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getWorkbench: (...args: unknown[]) => getWorkbench(...args),
    getWorkbenchForSession: vi.fn(),
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    sendTeamMessage: vi.fn(),
    addMember: (...args: unknown[]) => addMember(...args),
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
    { id: 'm1', from: 'arch', to: '*', recipients: ['arch'], kind: 'broadcast' as const, text: '架构观点', timestamp: '2026-11-17T18:22:00.000Z' },
    { id: 'm2', from: 'user', to: '*', recipients: ['arch'], kind: 'broadcast' as const, text: '我知道了', timestamp: '2026-11-17T18:23:00.000Z' },
    { id: 's1', from: 'arch', to: 'team-lead', recipients: ['team-lead'], kind: 'system' as const, protocolType: 'idle_notification', text: JSON.stringify({ type: 'idle_notification', result: '收到，我来答' }), timestamp: '2026-11-17T18:23:30.000Z' },
  ],
}

beforeEach(() => {
  getWorkbench.mockReset()
  getWorkbench.mockResolvedValue(SNAPSHOT)
  addMember.mockReset()
  addMember.mockResolvedValue({ ok: true, member: { name: 'newbie' }, planState: 'running' })
  useTeamStore.setState({
    teams: [TEAM],
    sendTeamMessage: vi.fn().mockResolvedValue({ recipients: ['arch'], broadcast: true }),
  } as never)
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('群聊独立页', () => {
  it('打开就是整屏聊天：群列表、群头部、气泡、输入框', async () => {
    useTabStore.getState().openGroupChatTab('demo-group')
    render(<ContentRouter />)

    expect(screen.getByTestId('group-chat-page')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('group-chat-window')).toBeTruthy())
    expect(screen.getByTestId('group-chat-header').textContent).toContain('demo-group')
    expect(screen.getByTestId('group-chat-bubble-m1').textContent).toContain('AI助手')
    expect(screen.getByTestId('group-chat-bubble-m2').getAttribute('data-from')).toBe('user')
    expect(screen.getByTestId('group-chat-bubble-s1').textContent).toContain('收到，我来答')
    expect(screen.queryByTestId('group-chat-bubble-m1')).toBeTruthy()
    expect(screen.getByTestId('group-chat-online').textContent).toContain('在线')
  })

  it('输入框能打字，发送会调用 sendTeamMessage 并刷新消息流', async () => {
    render(<GroupChatPage groupName="demo-group" />)
    await waitFor(() => expect(screen.getByTestId('group-chat-window')).toBeTruthy())
    const send = useTeamStore.getState().sendTeamMessage as ReturnType<typeof vi.fn>

    const input = screen.getByTestId('group-chat-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '开会' } })
    expect(input.value).toBe('开会')
    fireEvent.click(screen.getByTestId('group-chat-send'))

    await waitFor(() => expect(send).toHaveBeenCalledWith('demo-group', '开会', undefined))
    await waitFor(() => expect((screen.getByTestId('group-chat-input') as HTMLTextAreaElement).value).toBe(''))
  })

  it('加成员按钮会调 addMember 接口', async () => {
    render(<GroupChatPage groupName="demo-group" />)
    await waitFor(() => expect(screen.getByTestId('group-chat-window')).toBeTruthy())

    fireEvent.click(screen.getByTestId('group-chat-members'))
    fireEvent.click(screen.getByTestId('group-chat-add-member'))
    fireEvent.change(screen.getByTestId('group-chat-new-member-name'), { target: { value: 'newbie' } })
    fireEvent.click(screen.getByTestId('group-chat-new-member-confirm'))

    await waitFor(() => expect(addMember).toHaveBeenCalledWith('demo-group', { name: 'newbie', agentType: 'general-purpose' }))
  })
})
