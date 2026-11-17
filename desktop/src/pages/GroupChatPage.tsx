import { useEffect, useState } from 'react'
import { Ellipsis, Image, Paperclip, Search, Send, Smile, UsersRound } from 'lucide-react'
import { teamsApi } from '../api/teams'
import { useTeamStore } from '../stores/teamStore'
import { useSettingsStore } from '../stores/settingsStore'
import { MEMBER_AVATARS, memberAccentColor } from '../components/agentTeams/agentTeamsAvatars'
import { getMemberAvatarKey } from '../components/agentTeams/agentTeamsModel'
import type { TeamMember, TeamSummary, TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../types/team'

const DAY_LABEL = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })

/** 群聊独立页：左群列表，右微信式聊天窗。 */
export function GroupChatPage({ groupId = '__group-chat__' }: { groupId?: string }) {
  const teams = useTeamStore((state) => state.teams)
  const [selected, setSelected] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<TeamWorkbenchSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useTeamStore.getState().fetchTeams()
  }, [])

  useEffect(() => {
    if (!teams.length) return
    // Keep a chosen group; otherwise open the one with the newest line.
    const found = selected && teams.some((team) => team.name === selected)
      ? selected
      : teams.reduce((a, b) => ((b.updatedAt ?? '') > (a.updatedAt ?? '') ? b : a)).name
    if (!found) return
    setSelected(found)
    let alive = true
    void teamsApi.getWorkbench(found).then((next) => {
      if (alive) { setSnapshot(next); setError(null) }
    }).catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { alive = false }
  }, [teams, selected])

  const active = teams.find((team) => team.name === selected) ?? null

  return (
    <div data-testid="group-chat-page" className="flex h-full min-h-0">
      <GroupList teams={teams} selected={selected} onSelect={setSelected} />
      {error && !snapshot ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-error)]">{error}</div>
      ) : active && snapshot ? (
        <GroupChat team={active} snapshot={snapshot} onSent={(next) => setSnapshot(next)} groupId={groupId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-tertiary)]">
          没有群聊，先在会话里组建一个团队
        </div>
      )}
    </div>
  )
}

function GroupList({ teams, selected, onSelect }: {
  teams: TeamSummary[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  return (
    <aside data-testid="group-chat-list" className="flex w-[260px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2.5 text-[13px] font-semibold">群聊</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {teams.map((team) => (
          <button
            key={team.name}
            type="button"
            data-testid={`group-chat-row-${team.name}`}
            onClick={() => onSelect(team.name)}
            aria-pressed={selected === team.name}
            className={`flex w-full items-center gap-2.5 border-b border-[var(--color-border)] px-3 py-2.5 text-left ${selected === team.name ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'}`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
              <UsersRound size={18} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{team.name}</span>
                {team.updatedAt ? <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{timeLabel(team.updatedAt)}</span> : null}
              </div>
              <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
                {team.lastMessage ? `${team.lastMessage.from}: ${team.lastMessage.text}` : `${team.memberCount} 名成员`}
              </div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function GroupChat({ team, snapshot, onSent, groupId }: {
  team: TeamSummary
  snapshot: TeamWorkbenchSnapshot
  onSent: (next: TeamWorkbenchSnapshot) => void
  groupId: string
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const model = useSettingsStore((state) => state.currentModel)
  const members = snapshot.team.members
  const online = members.filter((member) => member.activity === 'active' || member.status === 'running')
  const messages = snapshot.messages.filter((message) => message.kind !== 'system')
  const filtered = find
    ? messages.filter((message) => message.text.toLowerCase().includes(find.toLowerCase()))
    : messages

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
      await useTeamStore.getState().sendTeamMessage(team.name, clean, to)
      setText('')
      onSent(await teamsApi.getWorkbench(team.name))
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
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
            <span className="truncate text-[15px] font-semibold">{team.name}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" aria-hidden="true" />
            <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{members.length} 名成员</span>
          </div>
          <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">多智能体协作 · 产品 / 开发 / 评审 / 运营</div>
        </div>
        <button type="button" data-testid="group-chat-members" aria-label="成员" onClick={() => setShowMembers((v) => !v)} className="rounded p-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">成员</button>
        <button type="button" data-testid="group-chat-search" aria-label="搜索" onClick={() => setFind(find ? '' : ' ')} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Search size={15} aria-hidden="true" /></button>
        <button type="button" data-testid="group-chat-more" aria-label="更多" className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Ellipsis size={15} aria-hidden="true" /></button>
      </header>

      {showMembers ? (
        <div data-testid="group-chat-member-panel" className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--color-border)] px-4 py-2">
          {members.map((member, index) => (
            <span key={member.agentId} className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[11px]">
              <img src={MEMBER_AVATARS[getMemberAvatarKey(member)]} alt="" className="h-4 w-4 rounded-full object-cover" />
              {member.name ?? member.agentId}
              {online.includes(member) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /> : null}
              <span className="text-[var(--color-text-tertiary)]">{index}</span>
            </span>
          ))}
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
        {!filtered.length ? <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">没有消息</div> : null}
      </div>

      <div data-testid="group-chat-online" className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-1 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        {online.length ? `${online.map((member) => member.name).filter(Boolean).join(' · ')} 在线` : `${members.length} 名成员`}
      </div>

      <footer data-testid="group-chat-composer" className="shrink-0 border-t border-[var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
          <button type="button" aria-label="表情" className="rounded p-1 hover:bg-[var(--color-surface-hover)]"><Smile size={16} /></button>
          <button type="button" aria-label="文件" className="rounded p-1 hover:bg-[var(--color-surface-hover)]"><Paperclip size={16} /></button>
          <button type="button" aria-label="图片" className="rounded p-1 hover:bg-[var(--color-surface-hover)]"><Image size={16} /></button>
        </div>
        <textarea
          data-testid="group-chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
          placeholder="发消息…（@成员 定向，留空发全员）"
          rows={2}
          className="mt-1 w-full resize-none bg-transparent text-sm outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
            <span>+ Administrator</span>
            <span>跳过</span>
            <span className="truncate">{model?.name ?? model?.id ?? groupId}</span>
            <span>最大</span>
          </div>
          <button
            type="button"
            data-testid="group-chat-send"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-btn-primary-bg)] px-3 py-1 text-xs text-[var(--color-btn-primary-fg)] disabled:opacity-50"
          >
            发送 <Send size={13} />
          </button>
        </div>
        {sendError ? <div role="alert" className="mt-1 text-xs text-[var(--color-error)]">{sendError}</div> : null}
      </footer>
    </section>
  )
}

function DayRow({ message, previous, children }: {
  message: TeamWorkbenchMessage
  previous: TeamWorkbenchMessage | undefined
  children: React.ReactNode
}) {
  const day = message.timestamp.slice(0, 10)
  if (previous && previous.timestamp.slice(0, 10) === day) return <>{children}</>
  return <>
    <div data-testid="group-chat-day" className="my-3 text-center text-[11px] text-[var(--color-text-tertiary)]">{relativeDay(day)} {timeLabel(message.timestamp)}</div>
    {children}
  </>
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
      <div className={`flex max-w-[72%] min-w-0 flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
          {!mine ? <><span className="text-[12px] font-semibold" style={{ color }}>{message.from}</span><span className="text-[10px] text-[var(--color-text-tertiary)]">AI助手</span></> : null}
          <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">{timeLabel(message.timestamp)}</span>
        </div>
        <div className={`whitespace-pre-wrap break-words rounded-[var(--radius-lg)] px-3 py-2 text-sm ${mine ? 'bg-[var(--color-surface-user-msg)]' : 'bg-[var(--color-surface-container-lowest)]'}`}>
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
