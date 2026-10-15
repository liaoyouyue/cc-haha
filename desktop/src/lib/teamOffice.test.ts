import { describe, expect, it } from 'vitest'
import { assignDesks, memberPose, memberTask, officeRoute, taskHeadline, teamProgress } from './teamOffice'
import type { TeamMember, TeamWorkbenchTask } from '../types/team'

function member(over: Partial<TeamMember>): TeamMember {
  return { agentId: 'a', role: 'server-engineer', status: 'idle', ...over }
}

function task(over: Partial<TeamWorkbenchTask>): TeamWorkbenchTask {
  return { id: 't1', subject: 's', description: '', status: 'pending', blocks: [], blockedBy: [], taskListId: 'L', ...over }
}

describe('memberPose', () => {
  it('活动中才算干活，跑完一轮但没退队是待命', () => {
    expect(memberPose(member({ status: 'running', activity: 'active' }))).toBe('working')
    expect(memberPose(member({ status: 'running', activity: 'idle' }))).toBe('idle')
  })

  it('进程没了和退队不是一回事', () => {
    expect(memberPose(member({ activity: 'stopped' }))).toBe('away')
    expect(memberPose(member({ activity: 'exited' }))).toBe('gone')
  })

  it('活跃新一轮压过旧重试记录，停下来后才显示出错', () => {
    expect(memberPose(member({ status: 'running', activity: 'active', autoRetry: { attempt: 1, max: 3, nextAt: 0 } }))).toBe('working')
    expect(memberPose(member({ status: 'error' }))).toBe('error')
  })
})

describe('memberTask / taskHeadline', () => {
  it('currentTask 存的是 id，要接回任务表', () => {
    const tasks = [task({ id: 't7', subject: '迁移数据库', activeForm: '正在迁移数据库' })]
    expect(memberTask(member({ currentTask: 't7' }), tasks)?.subject).toBe('迁移数据库')
    expect(taskHeadline(memberTask(member({ currentTask: 't7' }), tasks))).toBe('正在迁移数据库')
  })

  it('没有 currentTask 时不该瞎指一个任务', () => {
    expect(memberTask(member({}), [task({})])).toBeUndefined()
    expect(taskHeadline(undefined)).toBe('')
  })
})

describe('officeRoute', () => {
  it('从前排去会议室走左侧过道和门口，不横穿两排桌子', () => {
    const from = { x: 49, y: 73.5, scale: .9 }
    const to = { x: 51.8, y: 35, scale: .62 }
    const route = officeRoute(from, to)
    expect(route.map(({ x, y }) => [x, y])).toEqual([
      [49, 73.5], [49, 78], [4, 78], [4, 37], [34, 37], [36, 35.5], [51.8, 35],
    ])
    expect(officeRoute(to, from)).toEqual([...route].reverse())
    expect(officeRoute(to, to)).toEqual([to])
  })

  it('任务变化时从当前过道位置回工位，不瞬移', () => {
    const from = { x: 4, y: 63, scale: .8 }
    const to = { x: 42, y: 56.5, scale: .68 }
    const route = officeRoute(from, to)
    expect(route[0]).toEqual(from)
    expect(route[route.length - 1]).toEqual(to)
    expect(route.slice(0, -2).every((point) => point.x === 4)).toBe(true)
  })
})

describe('assignDesks', () => {
  it('按快照顺序发工位，不会两个人挤一张', () => {
    const seats = assignDesks([{ agentId: 'x' }, { agentId: 'y' }, { agentId: 'z' }], 2)
    expect([...seats.values()].sort()).toEqual([0, 0, 1])
    expect(seats.get('x')).not.toBe(seats.get('y'))
  })

  it('没有工位就返回空表', () => {
    expect(assignDesks([{ agentId: 'x' }], 0).size).toBe(0)
  })
})

describe('teamProgress', () => {
  it('数得出在干活的、做完的、卡住的', () => {
    const members = [
      member({ agentId: 'a', status: 'running', activity: 'active' }),
      member({ agentId: 'b' }),
    ]
    const tasks = [
      task({ id: 't1', status: 'completed' }),
      task({ id: 't2', blockedBy: ['t1'] }),
      task({ id: 't3', blockedBy: ['t9'] }),
    ]
    expect(teamProgress(members, tasks)).toEqual({ total: 2, working: 1, done: 1, blocked: 1 })
  })
})
