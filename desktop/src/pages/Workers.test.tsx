import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Workers } from './Workers'
import { useProviderStore } from '../stores/providerStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { TeamWorkbenchSnapshot } from '../types/team'

const office = vi.hoisted(() => ({
  state: { snapshot: null, loading: false, error: null } as {
    snapshot: TeamWorkbenchSnapshot | null
    loading: boolean
    error: string | null
  },
}))

vi.mock('../hooks/useTeamWorkbench', () => ({
  useTeamWorkbench: () => office.state,
}))

function snapshot(): TeamWorkbenchSnapshot {
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    team: {
      name: 'dev-team',
      leadAgentId: 'lead',
      members: [
        { agentId: 'lead', name: '队长', role: 'team-lead', status: 'running', activity: 'active', currentTask: '1', model: 'opus' },
        { agentId: 'worker', name: '后端', role: 'server-engineer', status: 'idle', activity: 'idle', currentTask: '2', model: 'auto:freeworker' },
      ],
    },
    tasks: [
      { id: '1', subject: '实现动态办公室', description: '把团队状态放进真实办公室', activeForm: '正在实现动态办公室', owner: 'lead', status: 'in_progress', blocks: [], blockedBy: [], taskListId: 'L' },
      { id: '2', subject: '运行测试', description: '', owner: 'worker', status: 'pending', blocks: [], blockedBy: ['1'], taskListId: 'L' },
    ],
    messages: [
      { id: 'm1', from: 'lead', to: 'worker', recipients: ['worker'], kind: 'direct', text: '{"type":"idle_notification","idleReason":"先跑测试"}', timestamp: new Date().toISOString() },
    ],
  }
}

beforeEach(() => {
  useProviderStore.setState({ providers: [{ id: 'paid', name: 'Paid', baseUrl: 'https://example.invalid', presetId: 'x', apiKey: '', apiFormat: 'anthropic', models: {} } as never] })
})

afterEach(() => {
  office.state = { snapshot: null, loading: false, error: null }
  vi.useRealTimers()
})

describe('Workers team office', () => {
  it('把真实团队成员放到工位，运行中屏幕显示当前任务', () => {
    useSettingsStore.setState({ locale: 'zh' })
    office.state = { snapshot: snapshot(), loading: false, error: null }

    render(<Workers />)

    expect(screen.getByTestId('workers-room')).toBeTruthy()
    expect(screen.getByTestId('worker-desk-lead')).toBeTruthy()
    expect(screen.getByTestId('worker-desk-worker')).toBeTruthy()
    expect(screen.getByTestId('worker-person-lead')).toBeTruthy()
    expect(screen.getAllByText('正在实现动态办公室').length).toBeGreaterThan(0)
    expect(screen.getByText(/dev-team · 2 人 · 1 人工作/)).toBeTruthy()
  })

  it('四人同时工作，各占椅子，四台电脑分别打开自己的任务', () => {
    const live = snapshot()
    live.team.members = Array.from({ length: 4 }, (_, index) => ({ agentId: `m${index}`, name: `成员${index}`, role: 'engineer', status: 'running', activity: 'active', currentTask: `t${index}` }))
    live.tasks = live.team.members.map((member, index) => ({ ...live.tasks[0]!, id: `t${index}`, owner: member.agentId, subject: `任务${index}`, activeForm: `正在做任务${index}` }))
    office.state = { snapshot: live, loading: false, error: null }
    render(<Workers />)
    const positions = new Set<string>()
    for (const member of live.team.members) {
      const person = screen.getByTestId(`worker-person-${member.agentId}`)
      const desk = screen.getByTestId(`worker-desk-${member.agentId}`)
      positions.add(`${person.style.left},${person.style.top}`)
      expect(parseFloat(person.style.top)).toBeGreaterThan(parseFloat(desk.style.top) + parseFloat(desk.style.height))
      expect(person.getAttribute('data-pose')).toBe('sit')
      fireEvent.click(desk)
      expect(screen.getByTestId('worker-inspector').textContent).toContain(live.tasks.find((task) => task.owner === member.agentId)!.subject)
    }
    expect(positions.size).toBe(4)
  })

  it('待命成员走到休息区才站着聊天，接到工作后沿过道回椅子', () => {
    vi.useFakeTimers()
    office.state = { snapshot: snapshot(), loading: false, error: null }
    const { rerender, unmount } = render(<Workers />)
    act(() => { vi.advanceTimersByTime(36_000) })
    act(() => { vi.advanceTimersByTime(50) })
    const worker = screen.getByTestId('worker-person-worker')
    expect(worker.getAttribute('data-pose')).toBe('walk')
    expect(screen.getByTestId('worker-person-lead').getAttribute('data-pose')).toBe('sit')
    act(() => { vi.advanceTimersByTime(25_000) })
    expect(worker.getAttribute('data-pose')).toBe('talk')
    expect(worker.style.top).toBe('37%')

    office.state.snapshot!.team.members[1]!.activity = 'active'
    rerender(<Workers />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(worker.getAttribute('data-pose')).toBe('walk')
    expect(worker.style.top).not.toBe('52.5%')
    act(() => { vi.advanceTimersByTime(25_000) })
    expect(worker.getAttribute('data-pose')).toBe('sit')
    expect(worker.style.top).toBe('52.5%')
    unmount()
  })

  it('点电脑打开成员当前任务和最近消息', () => {
    useSettingsStore.setState({ locale: 'zh' })
    office.state = { snapshot: snapshot(), loading: false, error: null }

    render(<Workers />)
    fireEvent.click(screen.getByTestId('worker-desk-lead'))

    const inspector = screen.getByTestId('worker-inspector')
    expect(inspector.textContent).toContain('队长')
    expect(inspector.textContent).toContain('实现动态办公室')
    expect(inspector.textContent).toContain('先跑测试')
  })
})
