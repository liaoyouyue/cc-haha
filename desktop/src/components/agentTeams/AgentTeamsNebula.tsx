import { useEffect, useMemo, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import { Vector2 } from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { TeamMember, TeamWorkbenchSnapshot } from '../../types/team'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
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
