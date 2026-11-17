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
    expect(inbox[0]!.text).toBe('大家好，开个会')
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
    expect(inbox[0]!.text).toBe('你来分析下')
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
    expect(inbox[0]!.text).toBe('开个会')
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
