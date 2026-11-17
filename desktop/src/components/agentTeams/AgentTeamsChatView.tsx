import { useEffect, useRef } from 'react'
import { UsersRound } from 'lucide-react'
import { MEMBER_AVATARS, memberAccentColor } from './agentTeamsAvatars'
import { getMemberAvatarKey } from './agentTeamsModel'
import { useTranslation } from '../../i18n'
import type { TeamMember, TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'

/**
 * 群聊：微信 PC 端的样子。顶部群名+成员行+在线状态，中间气泡流
 * （成员在左带头像名字、我的在右绿底），日期分隔线，新的滚到底。
 */
export function AgentTeamsChatView({ snapshot }: { snapshot: TeamWorkbenchSnapshot }) {
  const t = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const messages = snapshot.messages.filter((message) => message.kind !== 'system')
  const online = snapshot.team.members.filter((member) => member.activity === 'active')
  const onlineNames = online.map((member) => member.name).filter(Boolean)

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  return (
    <div data-testid="agent-teams-chat" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
          <UsersRound size={18} strokeWidth={1.75} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{snapshot.team.name}</span>
            <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
              {t('agentTeams.chat.memberCount', { count: snapshot.team.members.length })}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            {onlineNames.length ? (
              <>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]" aria-hidden="true" />
                <span className="truncate">{onlineNames.join(' · ')} {t('agentTeams.chat.online')}</span>
              </>
            ) : (
              <span className="truncate">{snapshot.team.members.map(m => m.name).filter(Boolean).join(' · ')}</span>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length ? (
          messages.map((message, index) => (
            <ChatDay key={message.id} message={message} previous={messages[index - 1]}>
              <ChatBubble message={message} members={snapshot.team.members} />
            </ChatDay>
          ))
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('agentTeams.chat.empty')}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

/** 日期分隔线：新的一天先画一条居中的日期。 */
function ChatDay({
  message,
  previous,
  children,
}: {
  message: TeamWorkbenchMessage
  previous: TeamWorkbenchMessage | undefined
  children: React.ReactNode
}) {
  const t = useTranslation()
  const day = message.timestamp.slice(0, 10)
  const showDay = !previous || previous.timestamp.slice(0, 10) !== day
  if (!showDay) return <>{children}</>
  return (
    <>
      <div className="my-3 text-center">
        <span className="rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
          {t('agentTeams.chat.day', { day })}
        </span>
      </div>
      {children}
    </>
  )
}

function ChatBubble({
  message,
  members,
}: {
  message: TeamWorkbenchMessage
  members: TeamMember[]
}) {
  const mine = message.from === 'user'
  const member = members.find((candidate) => candidate.name === message.from)
  const memberIndex = member ? members.indexOf(member) : 0
  const color = member?.color
    ? memberAccentColor(member.color, memberIndex)
    : 'var(--color-text-tertiary)'
  const name = mine ? '我' : message.from

  const avatar = !mine && member ? (
    <img
      src={MEMBER_AVATARS[getMemberAvatarKey(member, member.agentId === snapshotLeadId(members))]}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full object-cover"
    />
  ) : !mine ? (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container)] text-[12px] font-semibold" style={{ color }}>
      {message.from.slice(0, 1).toUpperCase()}
    </div>
  ) : null

  return (
    <div
      data-testid={`agent-teams-chat-${message.id}`}
      data-from={message.from}
      className={mine ? 'mb-3 flex justify-end' : 'mb-3 flex gap-2'}
    >
      {avatar}
      <div className={['flex min-w-0 max-w-[75%] flex-col', mine ? 'items-end' : 'items-start'].join(' ')}>
        {!mine ? (
          <span className="mb-0.5 px-0.5 text-[11px] font-semibold" style={{ color }}>
            {name}
          </span>
        ) : null}
        <div
          className={[
            'whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-3 py-2 text-sm',
            mine
              ? 'bg-[var(--color-surface-user-msg)] text-[var(--color-text-primary)]'
              : 'bg-[var(--color-surface-container)] text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          {message.text}
        </div>
        <span className="mt-0.5 px-0.5 font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  )
}

function snapshotLeadId(members: TeamMember[]): string | undefined {
  return members.find((member) => member.role === 'lead')?.agentId
}

function formatTime(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
