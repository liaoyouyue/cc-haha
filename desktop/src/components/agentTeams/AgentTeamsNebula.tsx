import { useEffect, useMemo, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import {
  AdditiveBlending,
  BackSide,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
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

const STATE_COLORS: Record<MemberWorkState, string> = {
  working: '#22d3ee',
  idle: '#64748b',
  retrying: '#f59e0b',
  stopped: '#94a3b8',
  exited: '#475569',
  error: '#f87171',
}

function nodeColor(node: NebulaNode): string {
  if (node.isLead) return '#c084fc'
  return STATE_COLORS[node.state]
}

/** 名牌贴图：canvas 画字，避免 DOM 叠 3D 的错位。 */
function makeLabelTexture(name: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  const scale = 3
  canvas.width = 512 * scale / 3
  canvas.height = 96 * scale / 3
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(2, 6, 15, 0.72)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.7
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    ctx.globalAlpha = 1
    ctx.font = `600 34px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = '#eafaff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.slice(0, 18), canvas.width / 2, canvas.height / 2 + 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** 3D 节点：核心发光球 + 大气光晕 + 赤道轨道环 + 名牌。 */
function makeNodeObject(node: NebulaNode): Group {
  const group = new Group()
  const color = nodeColor(node)
  const base = node.isLead ? 11 : 7
  const active = node.state === 'working'

  // 核心：不透亮球，bloom 会给它辉光
  const core = new Mesh(
    new SphereGeometry(base * 0.36, 24, 24),
    new MeshBasicMaterial({ color }),
  )
  group.add(core)

  // 内光晕：正面半透明壳
  const halo = new Mesh(
    new SphereGeometry(base * 0.62, 24, 24),
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: active ? 0.34 : 0.16,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  )
  group.add(halo)

  // 大气边缘：只画背面，形成轮廓光
  const rim = new Mesh(
    new SphereGeometry(base * 0.78, 24, 24),
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: active ? 0.2 : 0.1,
      side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  )
  group.add(rim)

  // 赤道轨道环：工作成员才转得出存在感
  if (active || node.isLead) {
    const ring = new Mesh(
      new CylinderGeometry(base * 1.15, base * 1.15, 0.4, 48, 1, true),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: node.isLead ? 0.5 : 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    ring.rotation.x = Math.PI / 2
    group.add(ring)
  }

  // 名牌
  const label = new Sprite(
    new SpriteMaterial({
      map: makeLabelTexture(node.name, color),
      transparent: true,
      depthWrite: false,
    }),
  )
  label.scale.set(base * 3.4, base * 0.64, 1)
  label.position.set(0, base * 1.25, 0)
  group.add(label)

  return group
}

function nodeSize(node: NebulaNode): number {
  if (node.isLead) return 18
  if (node.state === 'working') return 12
  if (node.state === 'retrying' || node.state === 'error') return 12
  return 7
}

function nodeLabel(node: NebulaNode, t: TranslationFn): string {
  const state = t(`agentTeams.member.${node.state}` as TranslationKey)
  const doing = node.doing ? `<div style="color:#7dd3fc">${escapeHtml(node.doing.slice(0, 48))}</div>` : ''
  return `<div style="font-family:monospace;background:rgba(2,8,20,0.92);border:1px solid rgba(34,211,238,0.5);padding:6px 9px;color:#eafaff">`
    + `<div style="font-weight:700">${escapeHtml(node.name)}</div>`
    + `<div style="color:#94a3b8;font-size:11px">${escapeHtml(state)}</div>${doing}</div>`
}

function stateText(state: MemberWorkState, member: TeamMember, t: TranslationFn): string {
  if (state === 'retrying') {
    return t('agentTeams.member.retrying', {
      attempt: member.autoRetry?.attempt ?? '?',
      max: member.autoRetry?.max ?? '?',
    })
  }
  return t(`agentTeams.member.${state}` as TranslationKey)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch))
}

/**
 * Sci-fi star map over the same snapshot the canvas draws. Members are glowing
 * nodes, recent messages become weighted particle links, and the HUD panels
 * carry the same numbers - nothing here invents state the snapshots lack.
 */
export function AgentTeamsNebula({
  snapshot,
  leadIsStreaming,
  selectedMemberId,
  onSelectMember,
  t,
}: {
  snapshot: TeamWorkbenchSnapshot
  leadIsStreaming: boolean
  selectedMemberId?: string | null
  onSelectMember: (member: TeamMember, isLead: boolean) => void
  t: TranslationFn
}) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const fittedRef = useRef(false)
  const graph = useMemo(
    () => nebulaGraphData(snapshot, { leadIsStreaming }),
    [snapshot, leadIsStreaming],
  )

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      const bloom = new UnrealBloomPass(new Vector2(1, 1), 1.15, 0.65, 0.12)
      fg.postProcessingComposer().addPass(bloom)
    } catch {
      // No WebGL context (tests, headless) - the HUD still renders.
    }
    fg.d3Force('charge')?.strength(-110)
  }, [])

  const tasks = snapshot.tasks
  const running = tasks.filter((task) => task.status === 'in_progress').length
  const done = tasks.filter((task) => task.status === 'completed').length
  const pending = tasks.filter((task) => task.status === 'pending').length

  return (
    <div
      data-testid="agent-teams-nebula"
      className="relative h-full w-full overflow-hidden bg-[#02060f] text-[#d7f7ff]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,0.9) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 34% 68%, rgba(190,227,248,0.75) 50%, transparent 51%),' +
            'radial-gradient(1.5px 1.5px at 56% 14%, rgba(255,255,255,0.8) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 72% 44%, rgba(148,197,255,0.7) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 88% 76%, rgba(255,255,255,0.65) 50%, transparent 51%),' +
            'radial-gradient(1.5px 1.5px at 22% 84%, rgba(190,227,248,0.6) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 44% 38%, rgba(255,255,255,0.55) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 64% 88%, rgba(255,255,255,0.6) 50%, transparent 51%),' +
            'radial-gradient(1px 1px at 8% 58%, rgba(148,197,255,0.6) 50%, transparent 51%),' +
            'radial-gradient(1.5px 1.5px at 80% 26%, rgba(255,255,255,0.7) 50%, transparent 51%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(14,116,144,0.16) 0%, rgba(2,6,15,0) 62%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.05]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, #9be8ff 0px, #9be8ff 1px, transparent 1px, transparent 3px)' }}
      />

      <ForceGraph3D
        ref={fgRef}
        graphData={graph}
        backgroundColor="#02060f"
        nodeThreeObject={(node) => makeNodeObject(node as NebulaNode)}
        nodeVal={(node) => nodeSize(node as NebulaNode)}
        nodeColor={(node) => nodeColor(node as NebulaNode)}
        nodeLabel={(node) => nodeLabel(node as NebulaNode, t)}
        nodeOpacity={0.95}
        linkColor={(link) => ((link as { weight?: number }).weight ? 'rgba(34,211,238,0.55)' : 'rgba(148,163,184,0.22)')}
        linkWidth={(link) => {
          const weight = (link as { weight?: number }).weight ?? 0
          return weight > 0 ? Math.min(2.4, 0.5 + weight * 0.35) : 0.4
        }}
        linkDirectionalParticles={(link) => ((link as { weight?: number }).weight ? 2 : 0)}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleColor={() => '#67e8f9'}
        linkDirectionalParticleSpeed={0.006}
        onNodeClick={(node) => {
          const nebulaNode = node as NebulaNode
          onSelectMember(nebulaNode.member, nebulaNode.isLead)
        }}
        onEngineStop={() => {
          if (fittedRef.current) return
          fittedRef.current = true
          try {
            fgRef.current?.zoomToFit(600, 70)
          } catch {
            // Zoom is cosmetic; failing to frame must not break the view.
          }
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-cyan-400/25 bg-[#03101d]/80 px-4 py-2 font-mono text-[11px] text-cyan-200/80">
          {(['working', 'idle', 'retrying', 'error', 'stopped', 'exited'] as MemberWorkState[]).map((state) => {
            const STATE_LABELS: Record<MemberWorkState, string> = {
              working: '工作中', idle: '空闲', retrying: '重试中', error: '出错', stopped: '已停止', exited: '已退出',
            }
            const count = snapshot.team.members.filter((member) => {
              const isLead = member.agentId === snapshot.team.leadAgentId
              return getMemberWorkState(member, { isLead, leadIsStreaming }) === state
            }).length
            if (!count) return null
            return (
              <span key={state} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLORS[state], boxShadow: `0 0 6px ${STATE_COLORS[state]}` }} />
                {STATE_LABELS[state]} ×{count}
              </span>
            )
          })}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute left-4 top-4 border border-cyan-400/40 bg-[#03101d]/85 px-4 py-3 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-cyan-300/80">
            {t('agentTeams.nebula.title')}
          </div>
          <div className="mt-1 font-mono text-lg font-bold tracking-wide text-[#eafaff]">
            {snapshot.team.name}
          </div>
          <div className="mt-2 flex gap-4 font-mono text-[11px] text-slate-300">
            <span><span className="text-cyan-300">{graph.nodes.length}</span> {t('agentTeams.nebula.members')}</span>
            <span><span className="text-amber-300">{running}</span> {t('agentTeams.nebula.running')}</span>
            <span><span className="text-emerald-300">{done}</span> {t('agentTeams.nebula.done')}</span>
            <span><span className="text-slate-400">{pending}</span> {t('agentTeams.nebula.pending')}</span>
          </div>
        </div>

        <div className="pointer-events-auto absolute right-3 top-4 bottom-4 w-56 overflow-y-auto border border-cyan-400/25 bg-[#03101d]/75 p-2 backdrop-blur-sm">
          {graph.nodes.map((node) => {
            const selected = selectedMemberId === node.member.agentId
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectMember(node.member, node.isLead)}
                className={`mb-1 flex w-full items-center gap-2 border px-2 py-1.5 text-left transition-colors ${
                  selected
                    ? 'border-cyan-300/70 bg-cyan-400/10'
                    : 'border-transparent hover:border-cyan-400/30 hover:bg-cyan-400/5'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: nodeColor(node), boxShadow: `0 0 8px ${nodeColor(node)}` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] font-semibold text-[#eafaff]">{node.name}</span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">
                    {stateText(node.state, node.member, t)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[11px] tracking-[0.18em] text-cyan-200/45">
          {t('agentTeams.nebula.hint')}
        </div>
      </div>
    </div>
  )
}
