import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useProviderStore } from '../stores/providerStore'
import { useChatStore, type PerSessionState } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useTranslation } from '../i18n'
import { buildWorkerRows, mascotFor, formatDuration, totalTokens, type WorkerKind, type WorkerRow } from '../lib/workerBoard'
import { resolvePetSessionStatus, type PetSessionStatus } from '../features/pets/petSessionModel'
import { formatTokenCount } from '../lib/formatTokenCount'

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

const KIND_BADGE: Record<WorkerKind, string> = {
  free: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
  paid: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
  unknown: 'bg-slate-500/20 text-slate-300 border-slate-400/40',
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
 * 员工动态面板：像素办公室里一个工位一个会话，小人 = 该会话的吉祥物。
 * 数据来自 buildWorkerRows（会话 + 运行时选择 + provider），不引入新的状态源。
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

  const [pinned, setPinned] = useState<string | null>(null)

  const freeCount = rows.filter((row) => row.kind === 'free').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <header className="flex items-baseline gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('workers.title')}</h1>
        <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">
          {t('workers.subtitle', { total: rows.length, free: freeCount })}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
          {t('workers.empty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <OfficeRoom
            rows={rows}
            chats={chats}
            statuses={statuses}
            now={now}
            pinned={pinned}
            onPin={setPinned}
          />
        </div>
      )}

      <SessionStrip
        rows={rows}
        chats={chats}
        statuses={statuses}
        pinned={pinned}
        onPin={setPinned}
      />
    </div>
  )
}

function OfficeRoom({
  rows, chats, statuses, now, pinned, onPin,
}: {
  rows: WorkerRow[]
  chats: Record<string, PerSessionState | undefined>
  statuses: Record<string, PetSessionStatus>
  now: number
  pinned: string | null
  onPin: (id: string | null) => void
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-[1100px] rounded-lg border-2 border-[#7a5a3a] shadow-lg"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* 墙：条纹壁纸 + 踢脚线 */}
      <div
        className="h-20 rounded-t-[6px] border-b-4 border-[#8a6b46]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #e8d5b7 0 10px, #e2cda9 10px 20px), repeating-linear-gradient(0deg, rgba(255,255,255,.35) 0 4px, transparent 4px 18px)',
        }}
      />
      {/* 地板：蓝绿地毯 */}
      <div
        className="relative flex flex-wrap items-start justify-center gap-x-10 gap-y-6 rounded-b-[6px] px-8 pb-14 pt-10"
        style={{
          backgroundColor: '#5aa9a0',
          backgroundImage:
            'radial-gradient(circle at 6px 6px, rgba(255,255,255,.16) 2px, transparent 2px), linear-gradient(180deg, rgba(0,0,0,.06), rgba(0,0,0,.16))',
          backgroundSize: '12px 12px, 100% 100%',
        }}
      >
        {rows.map((row) => (
          <Desk
            key={row.id}
            row={row}
            chat={chats[row.id]}
            status={statuses[row.id] ?? 'idle'}
            now={now}
            pinned={pinned === row.id}
            onPin={onPin}
          />
        ))}
      </div>
    </div>
  )
}

function Desk({
  row, chat, status, now, pinned, onPin,
}: {
  row: WorkerRow
  chat: PerSessionState | undefined
  status: PetSessionStatus
  now: number
  pinned: boolean
  onPin: (id: string | null) => void
}) {
  const t = useTranslation()
  const mascot = MASCOT_SRC[mascotFor(row.id)] ?? MASCOT_SRC.code
  const running = status === 'running' || status === 'waiting'

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => onPin(row.id)}
      onMouseLeave={() => onPin(null)}
    >
      <button
        type="button"
        data-testid={`worker-desk-${row.id}`}
        onClick={() => useTabStore.getState().openTab(row.id, row.title || t('workers.untitled'), 'session')}
        className="group flex flex-col items-center focus:outline-none"
        aria-label={row.title || t('workers.untitled')}
      >
        {/* 显示器 */}
        <div className="relative mb-1 h-[42px] w-[62px] rounded-[3px] border-2 border-[#2b2b2b] bg-[#1d1d1f]">
          <div className="absolute inset-[5px] overflow-hidden rounded-[1px] bg-[#0d2b1f] px-1 py-[3px] font-mono text-[7px] leading-[8px] text-[#6ee7a8]">
            <div className="truncate">{status === 'running' ? '> working…' : status === 'failed' ? '!! error' : '> idle'}</div>
            <div className="truncate opacity-70">{status === 'waiting' ? '? input' : ''}</div>
          </div>
          <div className="absolute -bottom-[6px] left-1/2 h-[6px] w-[10px] -translate-x-1/2 bg-[#2b2b2b]" />
        </div>

        {/* 小人 */}
        <img
          src={mascot}
          alt=""
          width={44}
          height={44}
          className={`h-11 w-11 object-contain drop-shadow ${running ? 'animate-bounce' : ''}`}
          style={{ animationDuration: '1.6s' }}
        />

        {/* 桌子 */}
        <div className="mt-[-6px] h-[14px] w-[86px] rounded-[3px] border-2 border-[#6b4a2a] bg-[#a9743f]" />
        <div className="h-[10px] w-[76px] rounded-b-[3px] bg-[#8a5c31]" />

        <div className="mt-1 max-w-[110px] truncate text-[11px] font-medium text-white/95">
          {row.title || t('workers.untitled')}
        </div>
      </button>

      {/* 悬浮详情 */}
      {pinned && <DetailCard row={row} chat={chat} status={status} now={now} />}
    </div>
  )
}

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
  const turnStart = useRef<number | null>(null)
  if (status === 'running' && turnStart.current === null) turnStart.current = now
  if (status !== 'running') turnStart.current = null

  const sessionSeconds = session?.createdAt ? (now - Date.parse(session.createdAt)) / 1000 : null
  const turnSeconds = turnStart.current ? (now - turnStart.current) / 1000 : null

  return (
    <div
      data-testid={`worker-detail-${row.id}`}
      className="absolute bottom-[calc(100%+6px)] left-1/2 z-30 w-[230px] -translate-x-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-left text-[11px] shadow-xl"
    >
      <div className="truncate font-medium text-[var(--color-text-primary)]">{row.title || t('workers.untitled')}</div>
      {row.workDir && <div className="truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">{row.workDir}</div>}
      <div className="mt-1 text-[var(--color-text-secondary)]">
        {t('workers.detail.terminal')}: {row.providerName}
      </div>
      <div className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">{row.modelId}</div>
      <div className="mt-1 text-[var(--color-text-secondary)]">
        {t(STATUS_LABEL[status] as never)}
        {turnSeconds !== null && ` · ${formatDuration(turnSeconds)}`}
      </div>
      {sessionSeconds !== null && (
        <div className="text-[var(--color-text-tertiary)]">
          {t('workers.detail.sessionAge', { duration: formatDuration(sessionSeconds) })}
        </div>
      )}
      <div className="mt-1 tabular-nums text-[var(--color-text-secondary)]">
        {t('workers.detail.tokensIn', { value: formatTokenCount(usage?.input_tokens) })} ·{' '}
        {t('workers.detail.tokensOut', { value: formatTokenCount(usage?.output_tokens) })}
      </div>
      <div className="tabular-nums text-[var(--color-text-tertiary)]">
        {t('workers.detail.cacheWrite', { value: formatTokenCount(usage?.cache_creation_tokens) })} ·{' '}
        {t('workers.detail.cacheRead', { value: formatTokenCount(usage?.cache_read_tokens) })}
      </div>
      <div className={`mt-2 inline-block rounded border px-1.5 py-px text-[10px] ${KIND_BADGE[row.kind]}`}>
        {t(row.kind === 'free' ? 'workers.free' : row.kind === 'paid' ? 'workers.paid' : 'workers.unknown')}
      </div>
    </div>
  )
}

function SessionStrip({
  rows, chats, statuses, pinned, onPin,
}: {
  rows: WorkerRow[]
  chats: Record<string, PerSessionState | undefined>
  statuses: Record<string, PetSessionStatus>
  pinned: string | null
  onPin: (id: string | null) => void
}) {
  const t = useTranslation()
  return (
    <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-t border-[var(--color-border)] px-4 py-2">
      {rows.map((row) => {
        const status = statuses[row.id] ?? 'idle'
        const chat = chats[row.id]
        const turns = totalTokens(chat?.tokenUsage)
        return (
          <button
            key={row.id}
            type="button"
            data-testid={`worker-chip-${row.id}`}
            onMouseEnter={() => onPin(row.id)}
            onMouseLeave={() => onPin(null)}
            onClick={() => useTabStore.getState().openTab(row.id, row.title || t('workers.untitled'), 'session')}
            className={`flex-shrink-0 rounded border px-2 py-1 text-left text-[11px] ${pinned === row.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'} bg-[var(--color-bg-secondary)]`}
          >
            <div className="max-w-[160px] truncate text-[var(--color-text-primary)]">{row.title || t('workers.untitled')}</div>
            <div className="text-[var(--color-text-tertiary)]">
              {t(STATUS_LABEL[status] as never)}
              {turns > 0 && ` · ${formatTokenCount(turns)} tck`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
