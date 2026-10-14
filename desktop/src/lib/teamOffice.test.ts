import { describe, expect, it } from 'vitest'
import { assignDesks, memberPose, memberTask, taskHeadline, teamProgress } from './teamOffice'
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

  it('待重试的算出错，压过 activity', () => {
    expect(memberPose(member({ status: 'running', activity: 'active', autoRetry: { attempt: 1, max: 3, nextAt: 0 } }))).toBe('error')
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
