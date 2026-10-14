import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useProviderStore } from '../stores/providerStore'
import { useChatStore, type PerSessionState } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useTranslation } from '../i18n'
import { buildWorkerRows, classifyProvider, mascotFor, formatDuration, totalTokens, type WorkerKind, type WorkerRow } from '../lib/workerBoard'
import { resolvePetSessionStatus, type PetSessionStatus } from '../features/pets/petSessionModel'
import { formatTokenCount } from '../lib/formatTokenCount'
import roomArt from '../assets/office-room.png'

// 12 只吉祥物当"员工头像"，按会话 id 固定分配，复用现有素材，不新增图片。
const mascots = import.meta.glob('../assets/agent-mascots/agent-mascot-*.png', { eager: true, import: 'default' }) as Record<string, string>
const MASCOT_SRC: Record<string, string> = Object.fromEntries(
  Object.entries(mascots).map(([path, url]) => [path.replace(/.*agent-mascot-/, '').replace(/\.png$/, ''), url]),
)

const STATUS_LABEL: Record<PetSessionStatus, string> = {
  waiting: 'workers.status.waiting',
  running: 'workers.status.running',
  review: 'workers.status.review',
  failed: 'workers.status.failed',
  idle: 'workers.status.idle',
}

/** 状态 → 卡片描边/徽章配色。运行中绿、等你确认蓝、出错红，其余中性。 */
function statusTone(status: PetSessionStatus, pinned: boolean) {
  if (pinned) return { border: 'border-sky-400/80', badge: 'bg-sky-500/20 text-sky-200', dot: 'bg-sky-300' }
  if (status === 'running' || status === 'waiting') return { border: 'border-emerald-400/70', badge: 'bg-emerald-500/20 text-emerald-200', dot: 'bg-emerald-300' }
  if (status === 'failed') return { border: 'border-rose-400/70', badge: 'bg-rose-500/20 text-rose-200', dot: 'bg-rose-300' }
  if (status === 'review') return { border: 'border-sky-400/50', badge: 'bg-sky-500/15 text-sky-200', dot: 'bg-sky-300' }
  return { border: 'border-white/12', badge: 'bg-white/8 text-slate-300', dot: 'bg-slate-500' }
}

// 房间是静态底图，靠这几条动画给它活气。只动"跟真实状态有关"的东西：
// 环境光是纯装饰，脉冲/扫光只在会话真的在跑时才出现。
const KEYFRAMES = `
@keyframes wf-breathe { 0%,100% { opacity: .10 } 50% { opacity: .26 } }
@keyframes wf-sheen { 0% { transform: translateX(-130%) } 100% { transform: translateX(240%) } }
@keyframes wf-scan { 0% { transform: translateY(-120%) } 100% { transform: translateY(1400%) } }
`

const KIND_CHIP: Record<WorkerKind, { label: string; className: string }> = {
  free: { label: 'workers.free', className: 'text-emerald-300' },
  paid: { label: 'workers.paid', className: 'text-amber-300' },
  unknown: { label: 'workers.unknown', className: 'text-slate-400' },
}

/** 每秒重绘一次，让运行中的计时器在动。没有运行中的会话就完全不跑。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/**
 * 员工动态面板。房间是参考图那张像素画的底图，会话数据全部落在底部卡片和悬浮详情卡上。
 */
export function Workers() {
  const t = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const selections = useSessionRuntimeStore((s) => s.selections)
  const providers = useProviderStore((s) => s.providers)
  const fetchProviders = useProviderStore((s) => s.fetchProviders)
  const chats = useChatStore((s) => s.sessions)

  useEffect(() => {
    if (providers.length === 0) void fetchProviders()
  }, [providers.length, fetchProviders])

  const rows = useMemo(
    () => buildWorkerRows(sessions, selections, providers),
    [sessions, selections, providers],
  )

  const statuses = useMemo(
    () => Object.fromEntries(rows.map((row) => [row.id, resolvePetSessionStatus(chats[row.id])])),
    [rows, chats],
  )
  const anyRunning = Object.values(statuses).some((s) => s === 'running' || s === 'waiting')
  const now = useNow(anyRunning)

  // 悬浮详情卡默认钉第一条：参考图里那张卡的位置要一直有人盖住。
  const [pinned, setPinned] = useState<string | null>(null)
  const detailRow = rows.find((row) => row.id === pinned) ?? rows[0]

  const freeCount = rows.filter((row) => row.kind === 'free').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <style>{KEYFRAMES}</style>
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-2.5">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('workers.title')}</h1>
        <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">
          {t('workers.subtitle', { total: rows.length, free: freeCount })}
        </p>
        <FreeRouterBadge />
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
          {t('workers.empty')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/[.18] p-4">
          <OfficeRoom>
            {detailRow && (
              <DetailCard
                row={detailRow}
                chat={chats[detailRow.id]}
                status={statuses[detailRow.id] ?? 'idle'}
                now={now}
              />
            )}
          </OfficeRoom>
        </div>
      )}

      <SessionStrip
        rows={rows}
        chats={chats}
        statuses={statuses}
        pinned={pinned}
        onPin={setPinned}
        now={now}
      />
    </div>
  )
}

type Probe = { state: 'idle' | 'checking' | 'ok' | 'slow' | 'down' | 'none'; ms?: number }

/**
 * 免费路由健康灯：找到走本地免费网关的那个服务商，打一发真实探活。
 * 只在进页面时探一次，之后手动点刷新 —— 每次探活都是一次真实请求，别轮询。
 */
function FreeRouterBadge() {
  const t = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  const testProvider = useProviderStore((s) => s.testProvider)
  const free = providers.find((provider) => classifyProvider(provider) === 'free')
  const [probe, setProbe] = useState<Probe>({ state: 'idle' })

  const freeId = free?.id
  const run = useCallback(async () => {
    if (!freeId) {
      setProbe({ state: 'none' })
      return
    }
    setProbe({ state: 'checking' })
    try {
      // testProvider 发的是一次真实补全请求（不是轻量 ping），免费链上的模型可能几十秒才回。
      // 这里只是给它封个上限，免得灯永远转。
      const result = await Promise.race([
        testProvider(freeId),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 45_000)),
      ])
      if (!result) {
        setProbe({ state: 'down' })
        return
      }
      const step = result.connectivity
      if (!step?.success) {
        setProbe({ state: 'down' })
        return
      }
      const ms = step.latencyMs ?? 0
      setProbe({ state: ms > 4000 ? 'slow' : 'ok', ms })
    } catch {
      setProbe({ state: 'down' })
    }
  }, [freeId, testProvider])

  useEffect(() => {
    void run()
  }, [run])

  // 探活可能要等几十秒，摆个秒表让它看起来是在干活而不是卡死。
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    if (probe.state !== 'checking') return
    setWaited(0)
    const id = window.setInterval(() => setWaited((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [probe.state])

  const tone: Record<Probe['state'], string> = {
    idle: 'border-[var(--color-border)] text-[var(--color-text-tertiary)]',
    checking: 'border-[var(--color-border)] text-[var(--color-text-tertiary)]',
    ok: 'border-emerald-400/50 text-emerald-300',
    slow: 'border-amber-400/50 text-amber-300',
    down: 'border-rose-400/50 text-rose-300',
    none: 'border-[var(--color-border)] text-[var(--color-text-tertiary)]',
  }
  const dot: Record<Probe['state'], string> = {
    idle: 'bg-slate-400',
    checking: 'bg-slate-400 animate-pulse',
    ok: 'bg-emerald-400',
    slow: 'bg-amber-400',
    down: 'bg-rose-400',
    none: 'bg-slate-500',
  }
  const label: Record<Probe['state'], string> = {
    idle: 'workers.router.checking',
    checking: 'workers.router.checking',
    ok: 'workers.router.ok',
    slow: 'workers.router.slow',
    down: 'workers.router.down',
    none: 'workers.router.none',
  }

  return (
    <button
      type="button"
      data-testid="worker-router-badge"
      onClick={() => void run()}
      title={free?.baseUrl ?? ''}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${tone[probe.state]}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot[probe.state]}`} />
      <span>{t('workers.router.label')}</span>
      <span className="font-medium tabular-nums">
        {t(label[probe.state] as never)}
        {probe.state === 'ok' || probe.state === 'slow' ? ` · ${Math.round(probe.ms ?? 0)}ms` : ''}
        {probe.state === 'checking' && waited > 0 ? ` ${waited}s` : ''}
      </span>
    </button>
  )
}

/**
 * 房间 = 参考图底图。悬浮卡的位置用真卡片盖死，所以底图里那张画出来的卡永远不露。
 * 位置是按 1536x700 原图量的百分比，换图要重新量。
 */
const CARD_SPOT = { left: '35.4%', top: '54.5%', width: '27.6%', height: '38.5%' }

function OfficeRoom({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-testid="workers-room"
      className="relative mx-auto w-full max-w-[1500px] overflow-hidden rounded-lg shadow-2xl"
      style={{
        aspectRatio: '1536 / 700',
        backgroundImage: `url(${roomArt})`,
        backgroundSize: '100% 100%',
        backgroundColor: '#1a1410',
      }}
    >
      {/* 窗光呼吸：底图是死的，这层给它一点活气 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(115% 75% at 50% -8%, rgba(255,212,150,.95), transparent 62%)',
          animation: 'wf-breathe 7s ease-in-out infinite',
        }}
      />
      <div className="absolute" style={CARD_SPOT}>
        {children}
      </div>
    </div>
  )
}

/** 小图标：描边风，跟参考图里的细线图标一个调。 */
function RowIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}
const ICON = {
  tag: 'M2 7.2V2.6h4.6l7 7-4.6 4.6-7-7Zm2.4-2.6h.01',
  bolt: 'M8.6 1.6 3.6 9h3.2l-.8 5.4L11.4 7H8.2l.4-5.4Z',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Zm0-9.2V8l2.2 1.4',
  swap: 'M2.4 5.2h9.2l-2-2m2 7.6H2.4l2 2',
  db: 'M8 1.8c2.8 0 5 .9 5 1.9v8.6c0 1-2.2 1.9-5 1.9s-5-.9-5-1.9V3.7c0-1 2.2-1.9 5-1.9Zm5 1.9c0 1-2.2 1.9-5 1.9s-5-.9-5-1.9',
}

/** 悬浮详情卡：盖住底图里那张画好的卡，显示当前选中会话的真实数据。 */
function DetailCard({
  row, chat, status, now,
}: {
  row: WorkerRow
  chat: PerSessionState | undefined
  status: PetSessionStatus
  now: number
}) {
  const t = useTranslation()
  const usage = chat?.tokenUsage
  const session = useSessionStore((s) => s.sessions.find((item) => item.id === row.id))
  const tone = statusTone(status, false)

  // 本轮计时：卡片一挂上就开始数，状态掉出 running 就清空。
  const turnStart = useRef<number | null>(null)
  if (status === 'running' && turnStart.current === null) turnStart.current = now
  if (status !== 'running') turnStart.current = null

  const sessionSeconds = session?.createdAt ? (now - Date.parse(session.createdAt)) / 1000 : null
  const turnSeconds = turnStart.current ? (now - turnStart.current) / 1000 : null
  const running = status === 'running' || status === 'waiting'

  return (
    <div
      data-testid={`worker-detail-${row.id}`}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] border-2 border-sky-400/70 bg-[#0c1420]/95 p-[3.5%] text-left shadow-[0_0_40px_rgba(56,189,248,.22)] backdrop-blur-[2px]"
    >
      {running && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-[16%]"
          style={{
            background: 'linear-gradient(180deg, transparent, rgba(125,211,252,.18), transparent)',
            animation: 'wf-scan 3.4s linear infinite',
          }}
        />
      )}
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] shrink-0 text-sky-300" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4.4A1.4 1.4 0 0 1 3.4 3h2.4l1.4 1.6h5A1.4 1.4 0 0 1 13.6 6v5.6A1.4 1.4 0 0 1 12.2 13H3.4A1.4 1.4 0 0 1 2 11.6V4.4Z" />
        </svg>
        <span
          data-testid="worker-detail-title"
          className="min-w-0 flex-1 truncate text-[clamp(11px,1.15vw,17px)] font-semibold text-white"
        >
          {row.title || t('workers.untitled')}
        </span>
        <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-[2px] text-[clamp(8px,.72vw,11px)] ${tone.badge}`}>
          <span className={`h-[5px] w-[5px] rounded-full ${tone.dot} ${running ? 'animate-pulse' : ''}`} />
          {t(STATUS_LABEL[status] as never)}
        </span>
      </div>

      <div className="my-[3%] border-t border-dashed border-white/20" />

      <div className="truncate font-mono text-[clamp(8px,.8vw,12px)] text-slate-300">{row.workDir || '—'}</div>
      <div className="truncate text-[clamp(8px,.78vw,11px)] text-slate-400">
        {t('workers.detail.terminal')} · {row.providerName}
      </div>

      <div className="mt-[3.5%] space-y-[2.4%] text-[clamp(8px,.82vw,12px)] text-slate-300">
        <DetailRow
          icon={ICON.bolt}
          label={t(STATUS_LABEL[status] as never)}
          value={turnSeconds !== null ? formatDuration(turnSeconds) : '—'}
        />
        <DetailRow
          icon={ICON.clock}
          label={t('workers.detail.turn')}
          value={`${turnSeconds !== null ? formatDuration(turnSeconds) : '—'} · ${t('workers.detail.sessionAge', { duration: formatDuration(sessionSeconds ?? 0) })}`}
        />
        <DetailRow icon={ICON.tag} label={t('workers.detail.kind')} value={row.modelId} />
        <DetailRow
          icon={ICON.swap}
          label={t('workers.detail.io')}
          value={`${formatTokenCount(usage?.input_tokens)} · ${formatTokenCount(usage?.output_tokens)}`}
        />
        <DetailRow
          icon={ICON.db}
          label={t('workers.detail.cache')}
          value={`${formatTokenCount(usage?.cache_creation_tokens)} · ${t('workers.detail.cacheRead', { value: formatTokenCount(usage?.cache_read_tokens) })}`}
        />
      </div>

      <div className="mt-auto flex items-center gap-2 pt-[3%]">
        <span className={`rounded border px-1.5 py-px text-[clamp(8px,.78vw,11px)] ${
          row.kind === 'free' ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
            : row.kind === 'paid' ? 'border-amber-400/40 bg-amber-500/15 text-amber-300'
              : 'border-slate-400/40 bg-slate-500/15 text-slate-300'
        }`}>
          {t(row.kind === 'free' ? 'workers.free' : row.kind === 'paid' ? 'workers.paid' : 'workers.unknown')}
        </span>
        {totalTokens(usage) > 0 && (
          <span className="text-[clamp(8px,.78vw,11px)] text-slate-400">{formatTokenCount(totalTokens(usage))} tck</span>
        )}
      </div>
    </div>
  )
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">
        <RowIcon path={icon} />
      </span>
      <span className="w-[13%] shrink-0 truncate text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-slate-100">{value}</span>
    </div>
  )
}

/** 底部会话卡：一块一张，样式照参考图（图标块 + 标题 + 路径 + chip 行 + 状态徽章）。 */
function SessionStrip({
  rows, chats, statuses, pinned, onPin, now,
}: {
  rows: WorkerRow[]
  chats: Record<string, PerSessionState | undefined>
  statuses: Record<string, PetSessionStatus>
  pinned: string | null
  onPin: (id: string | null) => void
  now: number
}) {
  const t = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  return (
    <div className="flex flex-shrink-0 gap-3 overflow-x-auto px-4 py-3">
      {rows.map((row) => {
        const status = statuses[row.id] ?? 'idle'
        const chat = chats[row.id]
        const turns = totalTokens(chat?.tokenUsage)
        const createdAt = sessions.find((item) => item.id === row.id)?.createdAt
        const sessionSeconds = createdAt ? (now - Date.parse(createdAt)) / 1000 : null
        const tone = statusTone(status, pinned === row.id)
        const kind = KIND_CHIP[row.kind]
        const mascot = MASCOT_SRC[mascotFor(row.id)] ?? MASCOT_SRC.code

        return (
          <button
            key={row.id}
            type="button"
            data-testid={`worker-chip-${row.id}`}
            onMouseEnter={() => onPin(row.id)}
            onMouseLeave={() => onPin(null)}
            onClick={() => useTabStore.getState().openTab(row.id, row.title || t('workers.untitled'), 'session')}
            className={`relative flex min-w-[268px] max-w-[420px] flex-1 shrink-0 items-start gap-3 overflow-hidden rounded-2xl border-2 px-3.5 py-3 text-left ${tone.border}`}
            style={{ backgroundColor: '#111826' }}
          >
            {(status === 'running' || status === 'waiting') && (
              <span
                className="pointer-events-none absolute inset-y-0 w-1/3"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.07), transparent)',
                  animation: 'wf-sheen 3.2s linear infinite',
                }}
              />
            )}
            <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-white/[.06]">
              <img src={mascot} alt="" className="h-9 w-9 object-contain" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                  {row.title || t('workers.untitled')}
                </span>
                <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-[2px] text-[11px] ${tone.badge}`}>
                  <span className={`h-[6px] w-[6px] rounded-full ${tone.dot} ${status === 'running' || status === 'waiting' ? 'animate-pulse' : ''}`} />
                  {t(STATUS_LABEL[status] as never)}
                </span>
              </span>

              <span className="mt-[3px] block truncate text-[12px] text-slate-400">{row.workDir || '—'}</span>

              <span className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Chip className={kind.className} icon={ICON.db} text={t(kind.label as never)} />
                {turns > 0 && <Chip icon={ICON.swap} text={`${formatTokenCount(turns)} tck`} />}
                {sessionSeconds !== null && <Chip icon={ICON.clock} text={formatDuration(sessionSeconds)} />}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Chip({ icon, text, className = '' }: { icon: string; text: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md bg-white/[.07] px-2 py-1 ${className}`}>
      <RowIcon path={icon} />
      <span className="truncate text-slate-200">{text}</span>
    </span>
  )
}
