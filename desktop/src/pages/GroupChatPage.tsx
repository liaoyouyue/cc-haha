import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, Plus, Search, Send, UsersRound } from 'lucide-react'
import { teamsApi } from '../api/teams'
import { useTeamStore } from '../stores/teamStore'
import { MEMBER_AVATARS, memberAccentColor } from '../components/agentTeams/agentTeamsAvatars'
import { getMemberAvatarKey } from '../components/agentTeams/agentTeamsModel'
import type { TeamMember, TeamSummary, TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../types/team'

const DAY_LABEL = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })

/**
 * 群聊窗：一屏聊天，内容区就是聊天窗本身（群列表在侧栏）。
 * 成员的回答是异步回来的，所以这里轮询，收到就显示。
 */
export function GroupChatPage({ groupName }: { groupName: string }) {
  const teams = useTeamStore((state) => state.teams)
  const [snapshot, setSnapshot] = useState<TeamWorkbenchSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const next = await teamsApi.getWorkbench(groupName)
        if (alive) { setSnapshot(next); setError(null) }
      } catch (err: unknown) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [groupName])

  const active = teams.find((team) => team.name === groupName)

  return (
    <div data-testid="group-chat-page" className="flex h-full min-h-0">
      {error && !snapshot ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-error)]">{error}</div>
      ) : snapshot ? (
        <GroupChat team={active} groupName={groupName} snapshot={snapshot} onSent={setSnapshot} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-tertiary)]">
          这个群还没有成员，先在会话里组建一个团队。
        </div>
      )}
    </div>
  )
}

function GroupChat({ team, groupName, snapshot, onSent }: {
  team: TeamSummary | undefined
  groupName: string
  snapshot: TeamWorkbenchSnapshot
  onSent: (next: TeamWorkbenchSnapshot) => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const members = snapshot.team.members
  const online = members.filter((member) => member.activity === 'active' || member.status === 'running')
  const messages = snapshot.messages.filter((message) => message.kind !== 'system')
  const filtered = useMemo(
    () => (find ? messages.filter((message) => message.text.toLowerCase().includes(find.toLowerCase())) : messages),
    [messages, find],
  )

  // The composer takes the first click: a chat you have to aim at is a chat
  // that feels broken.
  useEffect(() => { inputRef.current?.focus() }, [groupName])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    let to: string | undefined
    let clean = body
    if (body.startsWith('@')) {
      const rest = body.slice(1)
      const space = rest.search(/\s/)
      const token = space === -1 ? rest : rest.slice(0, space)
      const found = members.find((member) => member.name?.toLowerCase() === token.toLowerCase())
      if (found?.name) { to = found.name; clean = (space === -1 ? '' : rest.slice(space + 1)).trim() }
    }
    if (!clean) return
    setSending(true)
    setSendError(null)
    try {
      await useTeamStore.getState().sendTeamMessage(groupName, clean, to)
      setText('')
      onSent(await teamsApi.getWorkbench(groupName))
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const addMember = async () => {
    const name = newName.trim()
    if (!name) return
    setAddError(null)
    try {
      await teamsApi.addMember(groupName, { name, agentType: 'general-purpose' })
      setNewName('')
      setAdding(false)
      onSent(await teamsApi.getWorkbench(team!.name))
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section data-testid="group-chat-window" className="flex min-w-0 flex-1 flex-col">
      <header data-testid="group-chat-header" className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
          <UsersRound size={18} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{team?.name ?? groupName}</span>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]" aria-hidden="true" />
            <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{members.length} 名成员</span>
          </div>
          <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
            {online.length ? `${online.map((m) => m.name).filter(Boolean).join(' · ')} 在线` : `${members.length} 名成员`}
          </div>
        </div>
        <button type="button" data-testid="group-chat-members" aria-label="成员" onClick={() => setShowMembers((v) => !v)} className="rounded p-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">成员</button>
        <button type="button" data-testid="group-chat-search" aria-label="搜索" onClick={() => setFind(find ? '' : ' ')} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Search size={15} aria-hidden="true" /></button>
        <button type="button" data-testid="group-chat-more" aria-label="更多" className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Ellipsis size={15} aria-hidden="true" /></button>
      </header>

      {showMembers ? (
        <div data-testid="group-chat-member-panel" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--color-border)] px-4 py-2">
          {members.map((member) => (
            <span key={member.agentId} className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[11px]">
              <img src={MEMBER_AVATARS[getMemberAvatarKey(member)]} alt="" className="h-4 w-4 rounded-full object-cover" />
              {member.name ?? member.agentId}
              {online.includes(member) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /> : null}
            </span>
          ))}
          {adding ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px]">
              <input
                data-testid="group-chat-new-member-name"
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addMember() } }}
                placeholder="成员名"
                className="w-20 bg-transparent outline-none"
              />
              <button type="button" data-testid="group-chat-new-member-confirm" onClick={() => void addMember()} className="rounded px-1.5 hover:bg-[var(--color-surface-hover)]">加入</button>
            </span>
          ) : (
            <button type="button" data-testid="group-chat-add-member" onClick={() => { setAdding(true); setAddError(null) }} className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
              <Plus size={11} aria-hidden="true" /> 加成员
            </button>
          )}
          {addError ? <span role="alert" className="shrink-0 text-[11px] text-[var(--color-error)]">{addError}</span> : null}
        </div>
      ) : null}

      {find ? (
        <input
          data-testid="group-chat-find-input"
          autoFocus
          value={find.trim()}
          onChange={(event) => setFind(event.target.value)}
          placeholder="搜索群消息"
          className="shrink-0 border-b border-[var(--color-border)] bg-transparent px-4 py-1.5 text-xs outline-none"
        />
      ) : null}

      <div data-testid="group-chat-messages" className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {filtered.map((message, index) => (
          <DayRow key={message.id} message={message} previous={filtered[index - 1]}>
            <Bubble message={message} members={members} />
          </DayRow>
        ))}
        {!filtered.length ? <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">还没有人说话</div> : null}
      </div>

      <div data-testid="group-chat-online" className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-1 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        {online.length ? `${online.map((m) => m.name).filter(Boolean).join(' · ')} 在线` : `${members.length} 名成员`}
      </div>

      <footer data-testid="group-chat-composer" className="shrink-0 border-t border-[var(--color-border)] px-4 py-2.5">
        <textarea
          ref={inputRef}
          data-testid="group-chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
          placeholder="发消息…（@成员 定向，留空发全员）"
          rows={2}
          className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {sendError ? <span role="alert" className="text-xs text-[var(--color-error)]">{sendError}</span> : <span />}
          <button
            type="button"
            data-testid="group-chat-send"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-btn-primary-bg)] px-3 py-1.5 text-xs text-[var(--color-btn-primary-fg)] disabled:opacity-50"
          >
            发送 <Send size={13} />
          </button>
        </div>
      </footer>
    </section>
  )
}

/** 日期分隔线：新的一天先画一条居中的日期。 */
function DayRow({ message, previous, children }: {
  message: TeamWorkbenchMessage
  previous: TeamWorkbenchMessage | undefined
  children: React.ReactNode
}) {
  const day = message.timestamp.slice(0, 10)
  if (previous && previous.timestamp.slice(0, 10) === day) return <>{children}</>
  return (
    <>
      <div data-testid="group-chat-day" className="my-3 text-center text-[11px] text-[var(--color-text-tertiary)]">{relativeDay(day)}</div>
      {children}
    </>
  )
}

function Bubble({ message, members }: { message: TeamWorkbenchMessage; members: TeamMember[] }) {
  const mine = message.from === 'user'
  const member = members.find((candidate) => candidate.name === message.from)
  const color = member ? memberAccentColor(member.color, members.indexOf(member)) : 'var(--color-text-tertiary)'
  const avatar = member
    ? <img src={MEMBER_AVATARS[getMemberAvatarKey(member)]} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
    : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container)] text-xs font-semibold" style={{ color }}>{message.from.slice(0, 1).toUpperCase()}</div>
  return (
    <div data-testid={`group-chat-bubble-${message.id}`} data-from={message.from} className={mine ? 'mb-3 flex justify-end' : 'mb-3 flex gap-2'}>
      {!mine && avatar}
      <div className={['flex max-w-[72%] min-w-0 flex-col', mine ? 'items-end' : 'items-start'].join(' ')}>
        <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
          {!mine ? <><span className="text-[12px] font-semibold" style={{ color }}>{message.from}</span><span className="text-[10px] text-[var(--color-text-tertiary)]">AI助手</span></> : null}
          <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{timeLabel(message.timestamp)}</span>
        </div>
        <div className={['whitespace-pre-wrap break-words rounded-[var(--radius-lg)] px-3 py-2 text-sm', mine ? 'bg-[var(--color-surface-user-msg)]' : 'bg-[var(--color-surface-container-lowest)]'].join(' ')}>
          {message.text}
        </div>
      </div>
    </div>
  )
}

function timeLabel(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function relativeDay(day: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (day === today) return '今天'
  if (day === yesterday) return '昨天'
  return DAY_LABEL.format(new Date(`${day}T00:00:00`))
}
