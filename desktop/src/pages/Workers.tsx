import { useCallback, useEffect, useRef, useState } from 'react'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation } from '../i18n'
import { classifyProvider } from '../lib/workerBoard'
import { memberPose, memberTask, officeRoute, taskHeadline, teamProgress, type OfficePoint } from '../lib/teamOffice'
import { useTeamWorkbench } from '../hooks/useTeamWorkbench'
import { memberAccentColor } from '../components/agentTeams/agentTeamsAvatars'
import {
  getMemberWorkState,
  getWorkbenchPhase,
  parseWorkbenchMessageBody,
  resolveMemberModel,
  runningTaskForMember,
} from '../components/agentTeams/agentTeamsModel'
import type { TeamMember, TeamWorkbenchMessage, TeamWorkbenchSnapshot, TeamWorkbenchTask } from '../types/team'
import roomArt from '../assets/office-room.png'

const KEYFRAMES = `
@keyframes office-breathe { 0%,100% { opacity:.04 } 50% { opacity:.16 } }
@keyframes office-screen { 0%,100% { opacity:.55 } 50% { opacity:1 } }
@keyframes office-cursor { 0%,45% { opacity:1 } 46%,100% { opacity:0 } }
@keyframes office-step { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-1px) } }
@keyframes office-legs { 0%,49% { transform:scaleX(1) } 50%,100% { transform:scaleX(-1) } }
@keyframes office-type { 0%,100% { transform:rotate(-.6deg) } 50% { transform:rotate(.6deg) } }
@keyframes office-talk { 0%,70%,100% { transform:rotate(0) } 30% { transform:rotate(1.5deg) } }
.office-actor[data-pose="walk"] .office-body { animation:office-step .32s linear infinite }
.office-actor[data-pose="walk"] .office-legs { animation:office-legs .64s steps(1) infinite }
.office-actor[data-pose="sit"][data-working="true"] .office-body { animation:office-type .45s ease-in-out infinite; transform-origin:50% 75% }
.office-actor[data-pose="talk"] .office-body { animation:office-talk 2.8s ease-in-out infinite; transform-origin:50% 100% }
@media (prefers-reduced-motion:reduce) { .office-room *, .office-room { animation:none !important } }
`

const humanSprites = import.meta.glob('../assets/office-people/person-*.png', { eager: true, import: 'default' }) as Record<string, string>
type OfficePose = 'sit' | 'walk' | 'talk'

function humanSprite(agentId: string, pose: OfficePose): string {
  let hash = 0
  for (let index = 0; index < agentId.length; index++) hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0
  const person = hash % 8 + 1
  // 坐姿用带椅子的背影图（面朝显示器）；站/走用旧侧面图。
  const suffix = `/person-${person}-${pose === 'sit' ? 'back' : pose}.png`
  return Object.entries(humanSprites).find(([path]) => path.endsWith(suffix))?.[1] ?? ''
}

type Desk = { screen: { x: number; y: number; w: number; h: number }; person: OfficePoint }

// 1672×941 底图；人物坐标锚定脚底，不再按整张图片中心对齐。
const DESKS: Desk[] = [
  { screen: { x: 11.6, y: 39.0, w: 9.1, h: 7.1 }, person: { x: 17.2, y: 52.5, scale: .62 } },
  { screen: { x: 39.1, y: 39.8, w: 8.7, h: 6.4 }, person: { x: 43.2, y: 52.5, scale: .62 } },
  { screen: { x: 58.3, y: 40.0, w: 8.5, h: 6.3 }, person: { x: 62.8, y: 52.5, scale: .62 } },
  { screen: { x: 13.8, y: 51.5, w: 9.5, h: 7.0 }, person: { x: 17.6, y: 71.0, scale: .78 } },
  { screen: { x: 30.7, y: 51.5, w: 9.3, h: 7.0 }, person: { x: 35.0, y: 71.0, scale: .78 } },
  { screen: { x: 46.5, y: 51.5, w: 9.4, h: 7.0 }, person: { x: 51.7, y: 71.0, scale: .78 } },
  { screen: { x: 63.3, y: 51.5, w: 9.2, h: 7.0 }, person: { x: 68.2, y: 71.0, scale: .78 } },
]

const MEETING: OfficePoint[] = [
  { x: 44.2, y: 35.0, scale: .62 },
  { x: 48.0, y: 35.5, scale: .64 },
  { x: 51.8, y: 35.0, scale: .62 },
  { x: 55.6, y: 35.5, scale: .64 },
  { x: 59.4, y: 35.0, scale: .62 },
  { x: 63.2, y: 35.5, scale: .64 },
]

const SOCIAL: OfficePoint[] = [
  { x: 20, y: 37, scale: .68 },
  { x: 24, y: 37, scale: .68 },
  { x: 32, y: 78, scale: .94 },
  { x: 37, y: 78, scale: .94 },
  { x: 49, y: 78, scale: .94 },
  { x: 54, y: 78, scale: .94 },
  { x: 28, y: 37, scale: .68 },
]

export function Workers() {
  const t = useTranslation()
  const { snapshot, loading, error } = useTeamWorkbench()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [motionTick, setMotionTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setMotionTick((tick) => tick + 1), 36_000)
    return () => window.clearInterval(id)
  }, [])

  const members = snapshot?.team.members.filter((member) => memberPose(member) !== 'gone') ?? []
  const progress = snapshot ? teamProgress(members, snapshot.tasks) : null
  const selected = members.find((member) => member.agentId === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d1118]">
      <style>{KEYFRAMES}</style>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#121823] px-5">
        <h1 className="text-[15px] font-semibold text-white">{t('workers.title')}</h1>
        <p className="min-w-0 flex-1 truncate text-[12px] text-slate-400">
          {snapshot && progress
            ? t('workers.office.teamSummary', {
                team: snapshot.team.name,
                total: progress.total,
                working: progress.working,
                done: progress.done,
                blocked: progress.blocked,
              })
            : loading ? t('workers.office.loading') : t('workers.office.noTeam')}
          {error ? ` · ${error}` : ''}
        </p>
        <FreeRouterBadge />
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black p-3">
        <OfficeFloor
          snapshot={snapshot}
          members={members}
          selectedId={selectedId}
          motionTick={motionTick}
          onSelect={setSelectedId}
        />
      </div>

      {selected && snapshot && (
        <MemberInspector
          member={selected}
          snapshot={snapshot}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function OfficeFloor({
  snapshot,
  members,
  selectedId,
  motionTick,
  onSelect,
}: {
  snapshot: TeamWorkbenchSnapshot | null
  members: TeamMember[]
  selectedId: string | null
  motionTick: number
  onSelect: (id: string) => void
}) {
  const t = useTranslation()
  const phase = snapshot ? getWorkbenchPhase(snapshot) : 'forming'
  const meeting = phase === 'forming' || phase === 'finishing'

  return (
    <div
      data-testid="workers-room"
      className="office-room relative isolate w-full max-w-[1672px] shrink-0 overflow-hidden rounded-lg shadow-2xl"
      style={{ aspectRatio: '1672 / 941', backgroundImage: `url(${roomArt})`, backgroundSize: '100% 100%' }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(90% 60% at 35% 5%, rgba(255,194,112,.8), transparent 68%)',
          animation: 'office-breathe 8s ease-in-out infinite',
        }}
      />

      {DESKS.map((desk, index) => {
        const member = members[index]
        return (
          <DeskScreen
            key={index}
            desk={desk}
            member={member}
            snapshot={snapshot}
            selected={member?.agentId === selectedId}
            onSelect={onSelect}
          />
        )
      })}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: 60,
          backgroundImage: `url(${roomArt})`,
          backgroundSize: '100% 100%',
          clipPath: 'polygon(13% 50.5%,24% 50.5%,24% 59%,30% 59%,30% 50.5%,41% 50.5%,41% 59%,46% 59%,46% 50.5%,57% 50.5%,57% 59%,63% 59%,63% 50.5%,74% 50.5%,74% 59%,81% 59%,81% 73%,5% 73%,5% 60%,13% 60%)',
        }}
      />

      {members.slice(0, DESKS.length).map((member, index) => {
        const state = memberPose(member)
        if (state === 'gone' || state === 'away') return null
        const desk = DESKS[index]!
        let point = desk.person
        let officePose: OfficePose = 'sit'

        if (state === 'idle') {
          if (meeting && index < MEETING.length) {
            point = MEETING[index]!
            point = { ...point, x: point.x + (motionTick % 2 ? .8 : 0), y: point.y + (motionTick % 2 ? .5 : 0) }
            officePose = 'talk'
          } else if ((motionTick + Math.floor(index / 2)) % 3 === 1) {
            point = SOCIAL[index]!
            officePose = 'talk'
          } else if ((motionTick + Math.floor(index / 2)) % 3 === 2 && index < MEETING.length) {
            point = MEETING[index]!
            officePose = 'talk'
          }
        }

        const task = snapshot ? runningTaskForMember(snapshot.tasks, member) ?? memberTask(member, snapshot.tasks) : undefined

        return (
          <OfficePerson
            key={member.agentId}
            member={member}
            point={point}
            task={task}
            selected={member.agentId === selectedId}
            pose={officePose}
            onClick={() => onSelect(member.agentId)}
          />
        )
      })}

      {!snapshot && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-[12px] text-white/75 backdrop-blur">
          {t('workers.office.noTeam')}
        </div>
      )}
    </div>
  )
}

function DeskScreen({
  desk,
  member,
  snapshot,
  selected,
  onSelect,
}: {
  desk: Desk
  member?: TeamMember
  snapshot: TeamWorkbenchSnapshot | null
  selected: boolean
  onSelect: (id: string) => void
}) {
  const t = useTranslation()
  const state = member ? getMemberWorkState(member) : 'exited'
  const live = state === 'working'
  const task = member && snapshot ? runningTaskForMember(snapshot.tasks, member) ?? memberTask(member, snapshot.tasks) : undefined
  const accent = memberAccentColor(member?.color, 0)

  return (
    <button
      type="button"
      disabled={!member}
      data-testid={member ? `worker-desk-${member.agentId}` : undefined}
      aria-label={member ? t('workers.office.inspect', { name: member.name || member.role }) : undefined}
      onClick={() => member && onSelect(member.agentId)}
      className={`absolute overflow-hidden rounded-[2px] border transition ${selected ? 'border-cyan-300 shadow-[0_0_16px_rgba(103,232,249,.8)]' : 'border-transparent'} ${member ? 'cursor-pointer' : 'cursor-default'}`}
      style={{ left: `${desk.screen.x}%`, top: `${desk.screen.y}%`, width: `${desk.screen.w}%`, height: `${desk.screen.h}%`, zIndex: desk.person.y >= 65 ? 61 : 40 }}
    >
      {member && (
        <span className={`absolute inset-0 bg-[#061626]/90 p-[8%] text-left ${live ? '' : 'opacity-55'}`}>
          <span className="mb-[5%] flex items-center gap-[4%]">
            <span className={`h-[5px] w-[5px] rounded-full ${live ? 'agent-teams-live-dot bg-emerald-300' : state === 'error' || state === 'retrying' ? 'bg-rose-400' : 'bg-slate-500'}`} />
            <span className="min-w-0 truncate font-mono text-[clamp(4px,.5vw,8px)] text-slate-300">{member.name || member.role}</span>
          </span>
          {[72, 48, 84, 61, 36].map((width, index) => (
            <span
              key={index}
              className="mb-[4%] block h-[5%] rounded-full"
              style={{ width: `${width}%`, backgroundColor: accent, opacity: live ? .85 - index * .1 : .22, animation: live ? `office-screen ${1.5 + index * .25}s ease-in-out infinite` : undefined }}
            />
          ))}
          <span className="absolute bottom-[7%] left-[8%] max-w-[84%] truncate font-mono text-[clamp(4px,.45vw,7px)] text-cyan-200/80">
            {taskHeadline(task) || t('workers.office.waiting')}<i className="ml-0.5 not-italic" style={{ animation: live ? 'office-cursor 1s steps(1) infinite' : undefined }}>▌</i>
          </span>
        </span>
      )}
    </button>
  )
}

function OfficePerson({
  member,
  point,
  task,
  selected,
  pose,
  onClick,
}: {
  member: TeamMember
  point: OfficePoint
  task?: TeamWorkbenchTask
  selected: boolean
  pose: OfficePose
  onClick: () => void
}) {
  const state = getMemberWorkState(member)
  const [initial] = useState(point)
  const [travelling, setTravelling] = useState(false)
  const nodeRef = useRef<HTMLButtonElement>(null)
  const position = useRef(point)
  const { x, y, scale } = point

  useEffect(() => {
    const node = nodeRef.current!
    const target = { x, y, scale }
    const route = officeRoute(position.current, target)
    let segment = 1
    let previous = performance.now()
    let frame: number
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const draw = (next: OfficePoint) => {
      position.current = next
      node.style.left = `${next.x}%`
      node.style.top = `${next.y}%`
      node.style.width = `${11.3 * next.scale}%`
      node.style.zIndex = String(Math.round(next.y))
    }
    const step = (now: number) => {
      const next = route[segment]
      if (reduced || !next) {
        draw(target)
        setTravelling(false)
        return
      }
      setTravelling(true)
      const current = position.current
      const dx = next.x - current.x
      const dy = next.y - current.y
      const distance = Math.hypot(dx, dy * 941 / 1672)
      const ratio = distance === 0 ? 1 : Math.min(1, Math.min(now - previous, 64) * .006 / distance)
      if (Math.abs(dx) > .05) node.style.setProperty('--office-facing', dx < 0 ? '-1' : '1')
      draw({ x: current.x + dx * ratio, y: current.y + dy * ratio, scale: current.scale + (next.scale - current.scale) * ratio })
      previous = now
      if (ratio === 1) segment++
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [x, y, scale])

  const currentPose = travelling ? 'walk' : pose
  const avatar = humanSprite(member.agentId, currentPose)
  const label = member.name || member.role || member.agentId
  const active = state === 'working'

  return (
    <button
      ref={nodeRef}
      type="button"
      data-testid={`worker-person-${member.agentId}`}
      data-pose={currentPose}
      data-working={active}
      onClick={onClick}
      className="office-actor absolute -translate-x-1/2 -translate-y-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      style={{ left: `${initial.x}%`, top: `${initial.y}%`, width: `${11.3 * initial.scale}%`, zIndex: Math.round(initial.y) }}
      aria-label={label}
    >
      {active && task && (
        <span className="pointer-events-none absolute bottom-[94%] left-1/2 max-w-[160px] -translate-x-1/2 truncate whitespace-nowrap rounded-md border border-cyan-300/30 bg-[#08131f]/90 px-2 py-1 text-[clamp(6px,.55vw,9px)] text-cyan-100 shadow-lg">
          {taskHeadline(task)}
        </span>
      )}
      <span className="relative block w-full" style={{ transform: travelling ? 'scaleX(var(--office-facing, 1))' : undefined }}>
        <span className="office-body relative block w-full">
          <img src={avatar} alt="" draggable={false} className="block w-full object-contain drop-shadow-md" style={{ clipPath: travelling ? 'inset(0 0 47% 0)' : undefined }} />
          {travelling && <img src={avatar} alt="" draggable={false} className="office-legs absolute inset-0 w-full object-contain" style={{ clipPath: 'inset(53% 0 0 0)' }} />}
        </span>
        {currentPose === 'talk' && <span aria-hidden="true" className="absolute right-0 top-[12%] rounded-full bg-white/90 px-1.5 text-[10px] tracking-widest text-slate-700">···</span>}
        {(state === 'error' || state === 'retrying') && <span className="absolute right-1 top-2 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />}
        {selected && <span className="absolute inset-0 rounded-full border-2 border-cyan-300" />}
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full max-w-[120px] -translate-x-1/2 truncate rounded-full border border-white/15 bg-black/70 px-2 py-[2px] text-[clamp(6px,.55vw,9px)] font-medium text-white backdrop-blur">
        {label}
      </span>
    </button>
  )
}

function MemberInspector({
  member,
  snapshot,
  onClose,
}: {
  member: TeamMember
  snapshot: TeamWorkbenchSnapshot
  onClose: () => void
}) {
  const t = useTranslation()
  const isLead = member.agentId === snapshot.team.leadAgentId
  const state = getMemberWorkState(member)
  const leadModel = snapshot.team.members.find((item) => item.agentId === snapshot.team.leadAgentId)?.model
  const model = resolveMemberModel(member, isLead ? undefined : leadModel)
  const task = runningTaskForMember(snapshot.tasks, member) ?? memberTask(member, snapshot.tasks)
  const messages = recentMessages(snapshot.messages, member)
  const avatar = humanSprite(member.agentId, 'talk')

  return (
    <aside
      data-testid="worker-inspector"
      className="absolute bottom-5 right-5 z-50 w-[min(370px,calc(100%-40px))] rounded-2xl border border-cyan-300/35 bg-[#09121f]/95 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,.55)] backdrop-blur-xl"
    >
      <button type="button" onClick={onClose} aria-label={t('workers.office.close')} className="absolute right-3 top-2 text-xl text-slate-400 hover:text-white">×</button>
      <div className="flex items-center gap-3 pr-5">
        <img src={avatar} alt="" className="h-14 w-14 shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{member.name || member.role || member.agentId}</div>
          <div className="truncate text-[12px] text-slate-400">{member.role}{model ? ` · ${model.label}` : ''}</div>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/[.07] px-2 py-0.5 text-[11px] text-slate-300">
            <span className={`h-1.5 w-1.5 rounded-full ${state === 'working' ? 'agent-teams-live-dot bg-emerald-300' : state === 'error' || state === 'retrying' ? 'bg-rose-400' : 'bg-slate-500'}`} />
            {t(`agentTeams.member.${state}` as never)}
          </div>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-white/10 bg-white/[.04] p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('workers.office.currentTask')}</div>
        <div className="text-[13px] font-medium text-slate-100">{task ? task.subject : t('workers.office.noTask')}</div>
        {task?.description && <div className="mt-1 line-clamp-3 text-[11px] leading-5 text-slate-400">{task.description}</div>}
        {task && <div className="mt-2 text-[10px] text-cyan-300">#{task.id} · {t(`agentTeams.task.${task.status === 'in_progress' ? 'running' : task.status === 'pending' ? 'open' : task.status}` as never)}</div>}
      </section>

      <section className="mt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('workers.office.recentMessages')}</div>
        <div className="space-y-1.5">
          {messages.length === 0 ? (
            <div className="text-[11px] text-slate-500">—</div>
          ) : messages.map((message) => (
            <div key={message.id} className="rounded-lg bg-white/[.04] px-2.5 py-2 text-[11px] text-slate-300">
              <span className="mr-1.5 font-semibold text-cyan-300">{message.from}</span>
              <span className="line-clamp-2">{message.summary || readableMessage(message)}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}

function recentMessages(messages: TeamWorkbenchMessage[], member: TeamMember): TeamWorkbenchMessage[] {
  const ids = [member.agentId, member.name].filter(Boolean).map((value) => value!.toLowerCase())
  return messages
    .filter((message) => ids.includes(message.from.toLowerCase()) || message.recipients.some((recipient) => ids.includes(recipient.toLowerCase())))
    .slice(-3)
    .reverse()
}

function readableMessage(message: TeamWorkbenchMessage): string {
  const body = parseWorkbenchMessageBody(message)
  if (body.kind === 'text') return body.text
  if (body.kind === 'assignment') return body.subject || (body.taskId ? `#${body.taskId}` : 'task assignment')
  return body.detail || body.type.replaceAll('_', ' ')
}

type Probe = { state: 'checking' | 'ok' | 'slow' | 'down' | 'none'; ms?: number }

function FreeRouterBadge() {
  const t = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  const fetchProviders = useProviderStore((s) => s.fetchProviders)
  const testProvider = useProviderStore((s) => s.testProvider)
  const free = providers.find((provider) => classifyProvider(provider) === 'free')
  const [probe, setProbe] = useState<Probe>({ state: 'checking' })
  const [waited, setWaited] = useState(0)

  useEffect(() => {
    if (providers.length === 0) void fetchProviders()
  }, [providers.length, fetchProviders])

  const freeId = free?.id
  const run = useCallback(async () => {
    if (!freeId) {
      setProbe({ state: 'none' })
      return
    }
    setProbe({ state: 'checking' })
    try {
      const result = await Promise.race([
        testProvider(freeId),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 45_000)),
      ])
      if (!result?.connectivity.success) {
        setProbe({ state: 'down' })
        return
      }
      const ms = result.connectivity.latencyMs ?? 0
      setProbe({ state: ms > 4000 ? 'slow' : 'ok', ms })
    } catch {
      setProbe({ state: 'down' })
    }
  }, [freeId, testProvider])

  useEffect(() => { void run() }, [run])
  useEffect(() => {
    if (probe.state !== 'checking') return
    setWaited(0)
    const id = window.setInterval(() => setWaited((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [probe.state])

  const color = probe.state === 'ok' ? 'text-emerald-300 border-emerald-400/40'
    : probe.state === 'slow' ? 'text-amber-300 border-amber-400/40'
      : probe.state === 'down' ? 'text-rose-300 border-rose-400/40'
        : 'text-slate-400 border-white/10'
  const label = probe.state === 'ok' ? 'workers.router.ok'
    : probe.state === 'slow' ? 'workers.router.slow'
      : probe.state === 'down' ? 'workers.router.down'
        : probe.state === 'none' ? 'workers.router.none'
          : 'workers.router.checking'

  return (
    <button type="button" onClick={() => void run()} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${color}`}>
      <span className={`h-2 w-2 rounded-full ${probe.state === 'checking' ? 'animate-pulse bg-slate-400' : probe.state === 'ok' ? 'bg-emerald-400' : probe.state === 'slow' ? 'bg-amber-400' : probe.state === 'down' ? 'bg-rose-400' : 'bg-slate-500'}`} />
      {t('workers.router.label')} · {t(label as never)}
      {probe.state === 'checking' && waited > 0 ? ` ${waited}s` : ''}
      {(probe.state === 'ok' || probe.state === 'slow') && ` ${Math.round(probe.ms ?? 0)}ms`}
    </button>
  )
}
