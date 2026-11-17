import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamMember } from '../../types/team'
import { AgentTeamsGroupComposer } from './AgentTeamsGroupComposer'

const sendTeamMessage = vi.fn()

const MEMBERS: TeamMember[] = [
  { agentId: 'lead@team-a', name: 'lead', role: 'orchestrator', status: 'running' },
  { agentId: 'builder@team-a', name: 'builder', role: 'server engineer', status: 'running' },
]

beforeEach(() => {
  sendTeamMessage.mockReset()
  sendTeamMessage.mockResolvedValue({ recipients: ['builder'], broadcast: true })
  useTeamStore.setState({ sendTeamMessage } as never)
})

describe('AgentTeamsGroupComposer', () => {
  it('broadcasts to everyone when the message has no @name', async () => {
    render(<AgentTeamsGroupComposer teamName="team-a" members={MEMBERS} />)

    fireEvent.change(screen.getByTestId('agent-teams-group-input'), {
      target: { value: '开个会' },
    })
    fireEvent.click(screen.getByTestId('agent-teams-group-send'))

    await waitFor(() => expect(sendTeamMessage).toHaveBeenCalledTimes(1))
    expect(sendTeamMessage).toHaveBeenCalledWith('team-a', '开个会', undefined)
  })

  it('targets one member when the message starts with @name', async () => {
    render(<AgentTeamsGroupComposer teamName="team-a" members={MEMBERS} />)

    fireEvent.change(screen.getByTestId('agent-teams-group-input'), {
      target: { value: '@builder 你来' },
    })
    fireEvent.click(screen.getByTestId('agent-teams-group-send'))

    await waitFor(() => expect(sendTeamMessage).toHaveBeenCalledTimes(1))
    expect(sendTeamMessage).toHaveBeenCalledWith('team-a', '你来', 'builder')
  })

  it('sends on Enter and clears the input', async () => {
    render(<AgentTeamsGroupComposer teamName="team-a" members={MEMBERS} />)

    const input = screen.getByTestId('agent-teams-group-input')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(sendTeamMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''))
  })

  it('keeps an unknown @name as plain text and broadcasts', async () => {
    render(<AgentTeamsGroupComposer teamName="team-a" members={MEMBERS} />)

    fireEvent.change(screen.getByTestId('agent-teams-group-input'), {
      target: { value: '@nobody hi' },
    })
    fireEvent.click(screen.getByTestId('agent-teams-group-send'))

    await waitFor(() => expect(sendTeamMessage).toHaveBeenCalledTimes(1))
    expect(sendTeamMessage).toHaveBeenCalledWith('team-a', '@nobody hi', undefined)
  })

  it('shows the failure and keeps the draft when the send fails', async () => {
    sendTeamMessage.mockRejectedValue(new Error('mailbox down'))
    render(<AgentTeamsGroupComposer teamName="team-a" members={MEMBERS} />)

    const input = screen.getByTestId('agent-teams-group-input')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.click(screen.getByTestId('agent-teams-group-send'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('mailbox down'))
    expect((input as HTMLTextAreaElement).value).toBe('hi')
  })
})
