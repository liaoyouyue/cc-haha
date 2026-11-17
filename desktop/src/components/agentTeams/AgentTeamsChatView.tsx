import { useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'
import type { TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'

/**
 * 群聊：一屏消息流。谁说的、什么时候、说了什么，从上往下滚，新的在底部。
 */
export function AgentTeamsChatView({ snapshot }: { snapshot: TeamWorkbenchSnapshot }) {
  const t = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const messages = snapshot.messages.filter((message) => message.kind !== 'system')

  useEffect(() => {
    // jsdom has no scrollIntoView; tests still need the page to mount.
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  if (!messages.length) {
    return (
      <div
        data-testid="agent-teams-chat"
        className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--color-text-tertiary)]"
      >
        {t('agentTeams.chat.empty')}
      </div>
    )
  }

  return (
    <div data-testid="agent-teams-chat" className="h-full overflow-y-auto px-3 py-3">
      {messages.map((message) => (
        <ChatBubble key={message.id} message={message} members={snapshot.team.members} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

function ChatBubble({
  message,
  members,
}: {
  message: TeamWorkbenchMessage
  members: TeamWorkbenchSnapshot['team']['members']
}) {
  const mine = message.from === 'user'
  const member = members.find((candidate) => candidate.name === message.from)
  const color = message.color ?? member?.color ?? 'var(--color-text-tertiary)'
  const name = mine ? '你' : message.from
  const time = formatTime(message.timestamp)

  return (
    <div
      data-testid={`agent-teams-chat-${message.id}`}
      data-from={message.from}
      className={mine ? 'mb-3 flex flex-col items-end' : 'mb-3 flex flex-col items-start'}
    >
      <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
        <span className="text-[11px] font-semibold" style={{ color }}>
          {name}
        </span>
        {message.to !== '*' && !mine && message.to !== message.from ? (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">→ {message.to}</span>
        ) : null}
        <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{time}</span>
      </div>
      <div
        className={[
          'max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm',
          mine
            ? 'bg-[var(--color-info-container)] text-[var(--color-on-info-container)]'
            : 'bg-[var(--color-surface-container)] text-[var(--color-text-primary)]',
        ].join(' ')}
      >
        {message.text}
      </div>
    </div>
  )
}

function formatTime(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
