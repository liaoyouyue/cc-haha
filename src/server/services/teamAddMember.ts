/**
 * 群聊加成员：把一个人放进正在运行的团队。
 *
 * 走团队计划现有的链路（stageMember → 加任务 → submit → approve），所以启动、
 * 校验、审批记录和 CLI 里组队是同一条路，不另造一套。
 */
import {
  mutateTeamPlan,
  readTeamPlan,
  stageMember,
  submitTeamPlan,
  type TeamPlanIdentity,
} from '../../utils/swarm/teamPlanStore.js'
import { teamPlanService } from './teamPlanService.js'
import { ApiError } from '../middleware/errorHandler.js'
import type { TeamPlanMember, TeamPlanTask } from '../../shared/teamPlan.js'

export type AddTeamMemberInput = {
  name: string
  agentType: string
  prompt?: string
  model?: string
  providerId?: string
  effortLevel?: string
}

export async function addTeamMember(
  teamName: string,
  input: AddTeamMemberInput,
  options: { startLeader?: (sessionId: string) => Promise<void> } = {},
): Promise<{ member: TeamPlanMember; planState: string }> {
  const plan = await readTeamPlan(teamName)
  if (!plan) throw ApiError.notFound(`Team plan not found: ${teamName}`)
  if (plan.state !== 'running' && plan.state !== 'review_pending' && plan.state !== 'draft') {
    throw ApiError.conflict(`Team plan is ${plan.state}; add a member while the team runs`)
  }

  const name = input.name.trim()
  if (!name) throw ApiError.badRequest('name is required')

  const preset = plan.agentCatalog?.[input.agentType]
  if (!preset) throw ApiError.badRequest(`Unknown agent preset: ${input.agentType}`)

  const runtime = {
    providerId: input.providerId ?? plan.leaderRuntime.providerId,
    modelId: input.model ?? plan.leaderRuntime.modelId,
    ...(input.effortLevel ?? plan.leaderRuntime.effortLevel
      ? { effortLevel: input.effortLevel ?? plan.leaderRuntime.effortLevel }
      : {}),
  }

  const member: TeamPlanMember = {
    id: name,
    name,
    agentType: input.agentType,
    prompt: input.prompt?.trim()
      || `You are ${name}, a member of the ${teamName} group chat. Take part in the discussion and reply when it is your turn.`,
    runtime,
    suggestedRuntime: runtime,
    agentSnapshot: preset,
  }

  // stageMember 在团队已运行时开一份新计划（parentPlanId），旧计划归档。
  const staged = await stageMember(teamName, member)
  const identity = (revision: number): TeamPlanIdentity => ({
    planId: staged.planId,
    sessionId: staged.sessionId,
    incarnationId: staged.incarnationId,
    expectedRevision: revision,
  })

  // 每个成员要有一件自己的活，否则这份计划跑不起来。
  const task: TeamPlanTask = {
    id: `join-${name}`,
    subject: `加入 ${teamName} 群聊`,
    description: '在群里报到，说明自己能做什么，然后等群里的问题。',
    ownerId: name,
    dependencies: [],
  }
  const withTask = await mutateTeamPlan(teamName, identity(staged.revision), (current) => ({
    ...current,
    tasks: [...current.tasks, task],
  }))

  const submitted = await submitTeamPlan(teamName, identity(withTask.revision))
  const approved = await teamPlanService.approve(teamName, {
    ...identity(submitted.revision),
    requestId: `add-member-${teamName}-${name}-${submitted.revision}`,
  }, options)
  return { member, planState: approved.state }
}
