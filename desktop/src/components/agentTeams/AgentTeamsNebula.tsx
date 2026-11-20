import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
} from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { TeamMember, TeamWorkbenchSnapshot } from '../../types/team'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
  getMemberWorkState,
  nebulaGraphData,
  type MemberWorkState,
  type NebulaNode,
} from './agentTeamsModel'

type TranslationFn = ReturnType<typeof useTranslation>

/** Command-deck palette: cyan primary on deep space (BHIL reference). */
const STATE_COLORS: Record<MemberWorkState, string> = {
  working: '#22d3ee',
  idle: '#475569',
  retrying: '#fbbf24',
  stopped: '#64748b',
  exited: '#475569',
  error: '#f87171',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  in_progress: '#22d3ee',
  pending: '#64748b',
  completed: '#34d399',
}

const LEAD_COLOR = '#67e8f9'
const BODY_COLOR = '#38bdf8'
const LINK_COLOR = 'rgba(56,189,248,0.28)'
const DECK_BG = '#020b16'

function stateLabel(state: MemberWorkState, member: TeamMember, t: TranslationFn): string {
  if (state === 'retrying') {
    return t('agentTeams.member.retrying', {
      attempt: member.autoRetry?.attempt ?? '?',
      max: member.autoRetry?.max ?? '?',
    })
  }
  return t(`agentTeams.member.${state}` as TranslationKey)
}

/** Radar-sweep style canvas nameplate with cyan HUD border. */
function makeLabelTexture(node: NebulaNode, selected: boolean): CanvasTexture {
  const label = node.name
  const dpr = 2
  const width = 384
  const height = 88
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return new CanvasTexture(canvas)
  ctx.scale(dpr, dpr)

  const accent = selected ? '#a5f3fc' : node.isLead ? LEAD_COLOR : BODY_COLOR
  const bg = selected ? 'rgba(8,32,52,0.92)' : 'rgba(3,16,29,0.82)'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // Corner brackets (HUD style)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  const b = 14
  ctx.beginPath()
  ctx.moveTo(2, b); ctx.lineTo(2, 2); ctx.lineTo(b, 2)
  ctx.moveTo(width - b, 2); ctx.lineTo(width - 2, 2); ctx.lineTo(width - 2, b)
  ctx.moveTo(width - 2, height - b); ctx.lineTo(width - 2, height - 2); ctx.lineTo(width - b, height - 2)
  ctx.moveTo(b, height - 2); ctx.lineTo(2, height - 2); ctx.lineTo(2, height - b)
  ctx.stroke()

  // Status tick
  ctx.fillStyle = STATE_COLORS[node.state]
  ctx.fillRect(16, height / 2 - 4, 8, 8)
  ctx.shadowColor = STATE_COLORS[node.state]
  ctx.shadowBlur = 8
  ctx.fillRect(16, height / 2 - 4, 8, 8)
  ctx.shadowBlur = 0

  // Name
  ctx.fillStyle = selected ? '#f0fdff' : '#d7f4ff'
  ctx.font = `600 ${node.isLead ? 26 : 22}px "Cascadia Mono", Consolas, monospace`
  ctx.textBaseline = 'middle'
  ctx.fillText(label.slice(0, 18), 34, height / 2)

  const tex = new CanvasTexture(canvas)
  tex.anisotropy = 4
  return tex
}

/** Core sphere + atmosphere halo + orbit ring (+ nameplate sprite). */
function makeNodeObject(node: NebulaNode, selected: boolean, t: TranslationFn): Group {
  const group = new Group()
  const accent = node.isLead ? LEAD_COLOR : BODY_COLOR
  const stateColor = STATE_COLORS[node.state]
  const coreRadius = node.isLead ? 9 : 5.5
  const isWorking = node.state === 'working' || node.state === 'retrying'

  // Core — emissive but capped: moderate color intensity so bloom adds glow, not blowout.
  const core = new Mesh(
    new SphereGeometry(coreRadius, 24, 24),
    new MeshBasicMaterial({ color: accent }),
  )
  group.add(core)

  // Atmosphere shell (BackSide fresnel-fake) — dim enough to avoid white-ball overexposure.
  const halo = new Mesh(
    new SphereGeometry(coreRadius * 1.55, 24, 24),
    new MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: isWorking ? 0.34 : 0.2,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false,
    }),
  )
  group.add(halo)

  // State dot on the equator — the readability cue per member.
  const dot = new Mesh(
    new SphereGeometry(2.1, 12, 12),
    new MeshBasicMaterial({ color: stateColor }),
  )
  dot.position.set(coreRadius * 1.15, coreRadius * 0.55, 0)
  group.add(dot)

  // Orbit ring — single thin ring, brighter when working/selected.
  const ring = new Mesh(
    new CylinderGeometry(coreRadius * 2.1, coreRadius * 2.1, 0.4, 48, 1, true),
    new MeshBasicMaterial({
      color: selected ? '#a5f3fc' : accent,
      transparent: true,
      opacity: selected ? 0.6 : isWorking ? 0.4 : 0.22,
      side: 2, // DoubleSide
      depthWrite: false,
    }),
  )
  ring.rotation.x = Math.PI / 2
  group.add(ring)

  // Nameplate sprite
  const tex = makeLabelTexture(node, selected)
  const spriteMaterial = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new Sprite(spriteMaterial)
  sprite.scale.set(34, 7.8, 1)
  sprite.position.set(0, coreRadius + 9.5, 0)
  group.add(sprite)

  if (node.isLead) {
    const crown = new Mesh(
      new CylinderGeometry(coreRadius * 2.9, coreRadius * 2.9, 0.35, 64, 1, true),
      new MeshBasicMaterial({
        color: LEAD_COLOR,
        transparent: true,
        opacity: 0.5,
        side: 2,
        depthWrite: false,
      }),
    )
    crown.rotation.x = Math.PI / 2.4
    group.add(crown)
  }

  group.userData.stateLabel = stateLabel(node.state, node.member, t)
  return group
}

/** Background starfield: static points on a large shell. */
function makeStarfield(count = 420): Points {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const r = 600 + Math.random() * 500
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new PointsMaterial({
    color: 0x9fd8ff,
    size: 1.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  })
  return new Points(geometry, material)
}

interface AgentTeamsNebulaProps {
  snapshot: TeamWorkbenchSnapshot
  leadIsStreaming: boolean
  selectedMemberId?: string | null
  onSelectMember: (member: TeamMember, isLead: boolean) => void
  t: TranslationFn
}

/** HUD panel shell: bracket corners + optional title bar. */
function DeckPanel({
  title,
  right,
  className = '',
  children,
}: {
  title?: string
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`pointer-events-auto flex flex-col border border-cyan-400/35 bg-[#03101d]/85 backdrop-blur-sm hud-brackets ${className}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between border-b border-cyan-400/25 px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-300/80">
            {title}
          </span>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'cyan' | 'amber' | 'emerald' | 'slate'
}) {
  const toneClass =
    tone === 'cyan'
      ? 'text-cyan-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'emerald'
          ? 'text-emerald-300'
          : 'text-slate-400'
  return (
    <span className="flex items-baseline justify-between gap-2 border-b border-cyan-400/10 pb-1">
      <span className="truncate text-slate-400">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </span>
  )
}

/** Four viewport corner brackets, HUD style. */
function BracketCorners() {
  const base = 'absolute h-5 w-5 border-cyan-300/60'
  return (
    <>
      <span aria-hidden="true" className={`${base} left-2 top-2 border-l-2 border-t-2`} />
      <span aria-hidden="true" className={`${base} right-2 top-2 border-r-2 border-t-2`} />
      <span aria-hidden="true" className={`${base} bottom-2 left-2 border-b-2 border-l-2`} />
      <span aria-hidden="true" className={`${base} bottom-2 right-2 border-b-2 border-r-2`} />
    </>
  )
}

/**
 * BHIL-style sci-fi command deck for Agent Teams:
 * top system bar / left member column / center star-net + task queue /
 * right evidence panel + decision slot / bottom message stream.
 */
export function AgentTeamsNebula({
  snapshot,
  leadIsStreaming,
  selectedMemberId,
  onSelectMember,
  t,
}: AgentTeamsNebulaProps) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined) as MutableRefObject<
    ForceGraphMethods | undefined
  >
  const fittedRef = useRef(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const graph = useMemo(
    () => nebulaGraphData(snapshot, { leadIsStreaming }),
    [snapshot, leadIsStreaming],
  )

  const members = useMemo(
    () =>
      snapshot.team.members.filter(
        (m, i, arr) => arr.findIndex((x) => x.agentId === m.agentId) === i,
      ),
    [snapshot],
  )

  const taskCounts = useMemo(() => {
    let running = 0
    let done = 0
    let pending = 0
    for (const task of snapshot.tasks) {
      if (task.status === 'in_progress') running += 1
      else if (task.status === 'completed') done += 1
      else pending += 1
    }
    return { running, done, pending }
  }, [snapshot])

  const workStates = useMemo(() => {
    const map = new Map<MemberWorkState, number>()
    for (const m of members) {
      const isLead = m.agentId === snapshot.team.leadAgentId
      const state = getMemberWorkState(m, { isLead, leadIsStreaming })
      map.set(state, (map.get(state) ?? 0) + 1)
    }
    return map
  }, [members, snapshot.team.leadAgentId, leadIsStreaming])

  const recentMessages = useMemo(() => snapshot.messages.slice(-8), [snapshot.messages])

  const selectedId = selectedMemberId ?? null
  const legendStates: MemberWorkState[] = ['working', 'idle', 'retrying', 'stopped', 'error']

  // Fit camera once, seed starfield, attach capped bloom.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || fittedRef.current || graph.nodes.length === 0) return
    fittedRef.current = true
    const dist = 320
    fg.cameraPosition({ x: 0, y: 0, z: dist }, { x: 0, y: 0, z: 0 }, 0)
    fg.scene().add(makeStarfield())
    const el = wrapRef.current
    const size = new Vector2(el?.clientWidth ?? 800, el?.clientHeight ?? 600)
    const bloom = new UnrealBloomPass(size, 0.85, 0.55, 0.22)
    fg.postProcessingComposer().addPass(bloom)
  }, [graph])

  // Slow auto-rotation.
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick)
      if (time - last < 50) return
      last = time
      const fg = fgRef.current
      if (!fg) return
      fg.scene().rotation.y += 0.0006
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const nodeObject = useMemo(() => {
    const cache = new Map<string, Group>()
    return (node: NebulaNode) => {
      const key = `${node.id}::${node.state}::${node.id === selectedId}`
      const cached = cache.get(key)
      if (cached) return cached
      const built = makeNodeObject(node, node.id === selectedId, t)
      if (cache.size > 64) cache.clear()
      cache.set(key, built)
      return built
    }
  }, [selectedId, t])

  const ownerName = (owner?: string | null): string => {
    if (!owner) return '—'
    const member = members.find((m) => m.agentId === owner)
    return member?.name ?? member?.role ?? owner.split('@')[0] ?? owner
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-[#020b16] font-mono"
      data-testid="agent-teams-nebula"
    >
      {/* Deep-space backdrop */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 65% 55% at 50% 42%, rgba(8,47,73,0.55) 0%, rgba(2,11,22,0) 70%),' +
            'radial-gradient(ellipse 90% 70% at 50% 50%, rgba(12,74,110,0.28) 0%, rgba(2,11,22,0) 78%)',
        }}
      />

      {/* 3D star-net canvas — fills the deck, panels overlay it */}
      <div className="absolute inset-x-0 bottom-14 top-11 z-10">
        <ForceGraph3D
          ref={fgRef}
          graphData={graph}
          backgroundColor={DECK_BG}
          showNavInfo={false}
          nodeRelSize={4}
          nodeThreeObject={(obj) => nodeObject(obj as NebulaNode)}
          linkColor={() => LINK_COLOR}
          linkOpacity={0.5}
          linkWidth={1.2}
          onNodeClick={(obj) => {
            const n = obj as NebulaNode
            const member = members.find((m) => m.agentId === n.id)
            if (member) onSelectMember(member, n.isLead)
          }}
          enableNodeDrag={false}
          warmupTicks={40}
          cooldownTicks={120}
        />
      </div>

      {/* Scanlines + vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-20 opacity-[0.14]"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(103,232,249,0.5) 0px, rgba(103,232,249,0.5) 1px, transparent 1px, transparent 4px)',
          mixBlendMode: 'screen',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            'radial-gradient(ellipse 120% 100% at 50% 50%, transparent 55%, rgba(1,6,13,0.85) 100%)',
        }}
      />

      {/* ── Zone 1: top system bar ─────────────────────────── */}
      <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-stretch border-b border-cyan-400/30 bg-[#03101d]/90">
        <div className="flex items-center gap-3 border-r border-cyan-400/25 px-4">
          <span
            className={`inline-block h-2 w-2 rounded-full ${leadIsStreaming ? 'animate-pulse' : ''}`}
            style={{
              background: leadIsStreaming ? '#22d3ee' : '#475569',
              boxShadow: leadIsStreaming ? '0 0 8px #22d3ee' : 'none',
            }}
          />
          <div className="leading-tight">
            <div className="text-[9px] uppercase tracking-[0.3em] text-cyan-300/70">
              {t('agentTeams.nebula.title')}
            </div>
            <div className="truncate text-sm font-bold tracking-wide text-[#eafaff]">
              {snapshot.team.name}
            </div>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-5 px-4 text-[11px]">
          <StatCell label={t('agentTeams.nebula.members')} value={members.length} tone="cyan" />
          <StatCell label={t('agentTeams.nebula.running')} value={taskCounts.running} tone="amber" />
          <StatCell label={t('agentTeams.nebula.done')} value={taskCounts.done} tone="emerald" />
          <StatCell label={t('agentTeams.nebula.pending')} value={taskCounts.pending} tone="slate" />
        </div>
        <div className="flex items-center gap-3 border-l border-cyan-400/25 px-4 text-[10px] text-slate-400">
          {legendStates.map((state) => {
            const count = workStates.get(state) ?? 0
            if (count === 0 && state !== 'working') return null
            return (
              <span key={state} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background: STATE_COLORS[state],
                    boxShadow: `0 0 6px ${STATE_COLORS[state]}`,
                  }}
                />
                {t(`agentTeams.member.${state}` as TranslationKey)}
                <span className="text-cyan-300">×{count}</span>
              </span>
            )
          })}
        </div>
      </div>

      {/* ── Zone 2: left member column ─────────────────────── */}
      <DeckPanel
        title={`${t('agentTeams.nebula.members')} · ${members.length}`}
        className="absolute bottom-16 left-3 top-14 z-30 w-56"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {members.map((m) => {
            const isLead = m.agentId === snapshot.team.leadAgentId
            const state = getMemberWorkState(m, { isLead, leadIsStreaming })
            const selected = m.agentId === selectedId
            return (
              <button
                key={m.agentId}
                type="button"
                onClick={() => onSelectMember(m, isLead)}
                className={`mb-1 flex w-full items-center gap-2 border px-2 py-1.5 text-left transition-colors ${
                  selected
                    ? 'border-cyan-300/70 bg-cyan-400/10'
                    : 'border-transparent hover:border-cyan-400/30 hover:bg-cyan-400/5'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: STATE_COLORS[state],
                    boxShadow: `0 0 6px ${STATE_COLORS[state]}`,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-xs ${selected ? 'text-cyan-100' : 'text-slate-200'}`}
                  >
                    {m.name || m.role || m.agentId.split('@')[0]}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {stateLabel(state, m, t)}
                  </span>
                </span>
                {isLead && (
                  <span className="shrink-0 border border-cyan-400/50 px-1 text-[9px] tracking-widest text-cyan-300">
                    LEAD
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </DeckPanel>

      {/* ── Zone 3a: task queue (below star-net, center-left) ─ */}
      <DeckPanel
        title={`${t('agentTeams.nebula.running')} ${taskCounts.running} / ${snapshot.tasks.length}`}
        className="absolute bottom-16 left-64 z-30 h-44 w-[26rem]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {snapshot.tasks.length === 0 && (
            <div className="px-2 py-3 text-[11px] text-slate-500">—</div>
          )}
          {snapshot.tasks.slice(0, 12).map((task) => {
            const color = TASK_STATUS_COLORS[task.status] ?? '#64748b'
            return (
              <div
                key={task.id}
                className="mb-1 flex items-center gap-2 border border-cyan-400/10 px-2 py-1"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: color, boxShadow: `0 0 5px ${color}` }}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
                  {task.subject}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500">
                  {ownerName(task.owner)}
                </span>
              </div>
            )
          })}
        </div>
      </DeckPanel>

      {/* ── Zone 4: right evidence/decision column ─────────── */}
      <DeckPanel
        title={`${t('agentTeams.nebula.done')} ${taskCounts.done} · ${t('agentTeams.nebula.pending')} ${taskCounts.pending}`}
        className="absolute bottom-16 right-3 top-14 z-30 w-64"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* Evidence: completed tasks */}
          <div className="mb-2 text-[9px] uppercase tracking-[0.25em] text-emerald-300/80">
            ✓ {t('agentTeams.nebula.done')} · {taskCounts.done}
          </div>
          {snapshot.tasks
            .filter((task) => task.status === 'completed')
            .slice(-5)
            .map((task) => (
              <div
                key={task.id}
                className="mb-1 border-l-2 border-emerald-400/50 bg-emerald-400/5 px-2 py-1"
              >
                <div className="truncate text-[11px] text-emerald-100/90">{task.subject}</div>
                <div className="truncate text-[9px] text-slate-500">
                  {ownerName(task.owner)}
                </div>
              </div>
            ))}
          {taskCounts.done === 0 && (
            <div className="mb-2 px-1 text-[10px] text-slate-600">—</div>
          )}

          {/* Decision slot: pending queue */}
          <div className="mb-2 mt-3 border-t border-cyan-400/20 pt-2 text-[9px] uppercase tracking-[0.25em] text-amber-300/80">
            △ {t('agentTeams.nebula.pending')} · {taskCounts.pending}
          </div>
          {snapshot.tasks
            .filter((task) => task.status === 'pending')
            .slice(0, 5)
            .map((task) => (
              <div
                key={task.id}
                className="mb-1 border-l-2 border-amber-400/40 bg-amber-400/5 px-2 py-1"
              >
                <div className="truncate text-[11px] text-amber-100/90">{task.subject}</div>
                <div className="truncate text-[9px] text-slate-500">
                  {task.blockedBy.length > 0
                    ? `← ${task.blockedBy.length} block`
                    : ownerName(task.owner ?? undefined)}
                </div>
              </div>
            ))}
          {taskCounts.pending === 0 && (
            <div className="px-1 text-[10px] text-slate-600">—</div>
          )}
        </div>
      </DeckPanel>

      {/* ── Zone 5: bottom message stream ──────────────────── */}
      <DeckPanel className="absolute inset-x-3 bottom-3 z-30 h-12">
        <div className="flex min-h-0 flex-1 items-center gap-3 overflow-hidden px-3 py-1.5">
          <span className="shrink-0 border border-cyan-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.25em] text-cyan-300/80">
            FEED
          </span>
          <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
            {recentMessages.slice(-3).map((msg) => (
              <span
                key={msg.id}
                className="min-w-0 shrink-0 truncate text-[11px] text-slate-300"
                title={msg.text}
              >
                <span className="text-cyan-400/70">{msg.from.split('@')[0]}</span>{' '}
                {msg.text.slice(0, 60)}
              </span>
            ))}
            {recentMessages.length === 0 && (
              <span className="text-[11px] text-slate-600">—</span>
            )}
          </div>
          <span className="shrink-0 text-[10px] tracking-wider text-slate-500">
            {t('agentTeams.nebula.hint')}
          </span>
        </div>
      </DeckPanel>

      {/* Viewport corner brackets */}
      <div className="pointer-events-none absolute inset-0 z-40">
        <BracketCorners />
      </div>

      <style>{`
        .hud-brackets {
          --hud: rgba(103, 232, 249, 0.75);
          position: relative;
        }
        .hud-brackets::before,
        .hud-brackets::after {
          content: '';
          position: absolute;
          width: 10px;
          height: 10px;
          pointer-events: none;
        }
        .hud-brackets::before {
          left: -1px;
          top: -1px;
          border-left: 2px solid var(--hud);
          border-top: 2px solid var(--hud);
        }
        .hud-brackets::after {
          right: -1px;
          bottom: -1px;
          border-right: 2px solid var(--hud);
          border-bottom: 2px solid var(--hud);
        }
      `}</style>
    </div>
  )
}
