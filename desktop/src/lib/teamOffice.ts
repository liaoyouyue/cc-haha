import { getMemberWorkState } from '../components/agentTeams/agentTeamsModel'
import type { TeamMember, TeamWorkbenchTask } from '../types/team'

/**
 * 办公室里一个成员该摆什么姿势。
 *
 * 语义来自 types/team.ts 的注释：`activity` 说的是"这一轮在不在跑"，`status`
 * 说的是"还在不在队里"，两者不是一回事，所以分开判。`stopped` 是进程没了但人还在
 * 队里（发条消息能叫回来），跟真正离队的 `exited` 不是一回事 —— 前者显示成"离席"。
 */
export type MemberPose = 'working' | 'idle' | 'away' | 'error' | 'gone'
export type OfficePoint = { x: number; y: number; scale: number }

// ponytail: lanes follow this fixed room artwork; remeasure them if the room changes.
export function officeRoute(from: OfficePoint, to: OfficePoint): OfficePoint[] {
  if (from.x === to.x && from.y === to.y) return [to]
  const lane = (point: OfficePoint) => point.x <= 4 ? point.y : point.y >= 65 ? 78 : point.y >= 40 ? 57 : 37
  const fromLane = lane(from)
  const toLane = lane(to)
  const inMeeting = (point: OfficePoint) => point.x >= 36 && point.y < 37
  if (inMeeting(from) && inMeeting(to)) return [from, to]
  const exit = (point: OfficePoint, y: number): OfficePoint[] => inMeeting(point)
    ? [{ x: 36, y: 35.5, scale: .65 }, { x: 34, y: 37, scale: .68 }]
    : [{ x: point.x, y, scale: y >= 65 ? .94 : y >= 40 ? .78 : .68 }]
  const route = [from, ...exit(from, fromLane)]
  if (fromLane !== toLane) {
    route.push(
      { x: 4, y: fromLane, scale: route[route.length - 1]!.scale },
      { x: 4, y: toLane, scale: toLane >= 65 ? .94 : toLane >= 40 ? .78 : .68 },
    )
  }
  route.push(...exit(to, toLane).reverse(), to)
  return route.filter((point, index) => index === 0 || point.x !== route[index - 1]!.x || point.y !== route[index - 1]!.y)
}

export function memberPose(member: TeamMember): MemberPose {
  const state = getMemberWorkState(member)
  if (state === 'working') return 'working'
  if (state === 'stopped') return 'away'
  if (state === 'exited') return 'gone'
  if (state === 'error' || state === 'retrying') return 'error'
  return 'idle'
}

/** 成员手上那个任务：currentTask 存的是任务 id，得接回任务表才拿到标题。 */
export function memberTask(
  member: TeamMember,
  tasks: readonly TeamWorkbenchTask[],
): TeamWorkbenchTask | undefined {
  const id = member.currentTask
  if (!id) return undefined
  return tasks.find((task) => task.id === id)
}

/** 任务卡片上那行"正在做什么"：优先用 activeForm，没有就退回 subject。 */
export function taskHeadline(task: TeamWorkbenchTask | undefined): string {
  if (!task) return ''
  return task.activeForm?.trim() || task.subject
}

/**
 * 给每个成员发一个工位号。按快照里的原始顺序发，不做哈希 ——
 * 哈希会撞车（两个人挤一张桌子），顺序至少是稳定的。
 */
export function assignDesks<T extends { agentId: string }>(
  members: readonly T[],
  deskCount: number,
): Map<string, number> {
  const assigned = new Map<string, number>()
  if (deskCount <= 0) return assigned
  members.forEach((member, index) => {
    if (!assigned.has(member.agentId)) assigned.set(member.agentId, index % deskCount)
  })
  return assigned
}

/** 顶栏那句进度：几个人在干活、几个任务做完了、几个卡住。 */
export function teamProgress(
  members: readonly TeamMember[],
  tasks: readonly TeamWorkbenchTask[],
): { total: number; working: number; done: number; blocked: number } {
  const doneById = new Map(tasks.map((task) => [task.id, task.status === 'completed']))
  return {
    total: members.length,
    working: members.filter((member) => memberPose(member) === 'working').length,
    done: tasks.filter((task) => task.status === 'completed').length,
    // 卡住 = 有前置任务还没做完的
    blocked: tasks.filter((task) => task.blockedBy.some((id) => !doneById.get(id))).length,
  }
}
