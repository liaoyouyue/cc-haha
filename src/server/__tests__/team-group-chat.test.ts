import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { teamService } from '../services/teamService.js'
import { readMailboxHistory } from '../../utils/teammateMailbox.js'

let tmpDir: string

async function writeTeamConfig(
  teamName: string,
  config: Record<string, unknown>,
): Promise<void> {
  const teamDir = path.join(tmpDir, 'teams', teamName)
  await fs.mkdir(teamDir, { recursive: true })
  await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify(config), 'utf-8')
}

async function writeTeamInbox(
  teamName: string,
  recipient: string,
  messages: Record<string, unknown>[],
): Promise<void> {
  const inboxDir = path.join(tmpDir, 'teams', teamName, 'inboxes')
  await fs.mkdir(inboxDir, { recursive: true })
  await fs.writeFile(path.join(inboxDir, `${recipient}.json`), JSON.stringify(messages), 'utf8')
}

function makeTeamConfig(): Record<string, unknown> {
  return {
    name: 'group-team',
    description: 'group chat test',
    createdAt: 1700000000000,
    leadAgentId: 'agent-lead',
    members: [
      {
        agentId: 'team-lead@group-team',
        name: 'team-lead',
        agentType: 'lead',
        joinedAt: 1700000000000,
        tmuxPaneId: '%0',
        cwd: '/tmp/project',
        isActive: true,
      },
      {
        agentId: 'agent-worker',
        name: 'Worker Agent',
        agentType: 'worker',
        joinedAt: 1700000001000,
        tmuxPaneId: '%1',
        cwd: '/tmp/project/src',
        isActive: true,
      },
    ],
  }
}

describe('TeamService.sendTeamMessage (group chat)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'group-chat-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('broadcasts to every teammate and not to team-lead', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    const result = await teamService.sendTeamMessage('group-team', '大家好，开个会')
    expect(result.broadcast).toBe(true)
    expect(result.recipients).toEqual(['Worker Agent'])

    const inbox = await readMailboxHistory('Worker Agent', 'group-team')
    expect(inbox.length).toBe(1)
    expect(inbox[0]!.from).toBe('user')
    // The member sees who is in the room and what was said before it.
    expect(inbox[0]!.text).toContain('[群聊] 一起讨论的成员：Worker Agent')
    expect(inbox[0]!.text).toContain('大家好，开个会')
    expect(inbox[0]!.id).toStartWith('mailbox-')

    const leadInbox = await readMailboxHistory('team-lead', 'group-team')
    expect(leadInbox.length).toBe(0)
  })

  it('targets one member by name with @ stripped', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    const result = await teamService.sendTeamMessage('group-team', '你来分析下', '@Worker Agent')
    expect(result.broadcast).toBe(false)
    expect(result.recipients).toEqual(['Worker Agent'])

    const inbox = await readMailboxHistory('Worker Agent', 'group-team')
    expect(inbox.length).toBe(1)
    expect(inbox[0]!.text).toContain('你来分析下')
  })

  it('throws 404 for an unknown member', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    try {
      await teamService.sendTeamMessage('group-team', 'hi', '@Ghost')
      expect.unreachable()
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(404)
    }
  })

  it('rejects empty content', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    try {
      await teamService.sendTeamMessage('group-team', '   ')
      expect.unreachable()
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(400)
    }
  })

  it('shows only the user words in the workbench, not the machine context', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    await teamService.sendTeamMessage('group-team', '开个会')

    const snapshot = await teamService.getWorkbench('group-team')
    const mine = snapshot.messages.filter((m) => m.from === 'user')
    expect(mine.length).toBe(1)
    expect(mine[0]!.text).toBe('开个会')
  })

  it('gives the next round the earlier discussion so members can build on it', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    await teamService.sendTeamMessage('group-team', '先说方案')

    // A member answers; the answer lands in the team feed.
    await writeTeamInbox('group-team', 'Worker Agent', [{
      id: 'mailbox-reply-1',
      from: 'Worker Agent',
      text: '我建议先做 A',
      timestamp: new Date().toISOString(),
      read: true,
    }])

    await teamService.sendTeamMessage('group-team', '那继续')

    const inbox = await readMailboxHistory('Worker Agent', 'group-team')
    const latest = inbox.at(-1)!
    expect(latest.text).toContain('[群里最近]')
    expect(latest.text).toContain('Worker Agent: 我建议先做 A')
    expect(latest.text).toContain('那继续')
  })

  it('merges duplicate mailbox copies with different ids', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    const timestamp = '2026-11-18T06:20:00.123Z'
    const line = '大家好，我是 planner'
    await writeTeamInbox('group-team', 'Worker Agent', [{
      id: 'mailbox-1',
      from: 'planner',
      text: line,
      timestamp,
      read: true,
    }])
    await writeTeamInbox('group-team', 'team-lead', [{
      id: 'mailbox-2',
      from: 'planner',
      text: line,
      timestamp: '2026-11-18T06:20:00.987Z',
      read: true,
    }])

    const snapshot = await teamService.getWorkbench('group-team')
    const plannerLines = snapshot.messages.filter((m) => m.from === 'planner' && m.text === line)
    expect(plannerLines.length).toBe(1)
    expect(plannerLines[0]!.recipients.length).toBe(2)
  })
})


describe('POST /api/teams/:name/messages', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  let baseUrl = ''

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'group-chat-api-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    const { handleTeamsApi } = await import('../api/teams.js')
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url)
        const segments = url.pathname.split('/').filter(Boolean)
        if (segments[0] === 'api' && segments[1] === 'teams') {
          return handleTeamsApi(req, url, segments)
        }
        return new Response('Not Found', { status: 404 })
      },
    })
    baseUrl = `http://127.0.0.1:${server.port}`
  })

  afterEach(async () => {
    if (server) {
      server.stop(true)
      server = null
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('delivers a group message and reports its recipients', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    const res = await fetch(`${baseUrl}/api/teams/group-team/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '开个会' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; recipients: string[]; broadcast: boolean }
    expect(body.ok).toBe(true)
    expect(body.broadcast).toBe(true)
    expect(body.recipients).toEqual(['Worker Agent'])

    const inbox = await readMailboxHistory('Worker Agent', 'group-team')
    expect(inbox.length).toBe(1)
    expect(inbox[0]!.text).toContain('开个会')
  })

  it('returns 400 for an empty body', async () => {
    await writeTeamConfig('group-team', makeTeamConfig())
    const res = await fetch(`${baseUrl}/api/teams/group-team/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    })
    expect(res.status).toBe(400)
  })
})
