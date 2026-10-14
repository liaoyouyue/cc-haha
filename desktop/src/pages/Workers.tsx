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

/** 桌上小摆件：按会话 id 固定分配，跟吉祥物一样"每个工位有主"。 */
const DESK_PROPS = ['mug', 'plant', 'cat', 'laptop'] as const
function deskPropFor(id: string): (typeof DESK_PROPS)[number] {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return DESK_PROPS[hash % DESK_PROPS.length] ?? 'mug'
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
        <div className="flex min-h-0 flex-1 flex-col p-5">
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

/** 墙上一排挂件：门、衣帽架、挂钟、白板、相框、日历、书架。纯装饰，不接数据。 */
function WallDecor() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-3">
      {/* 木门（左端，贴边） */}
      <div className="relative h-[86px] w-[52px] rounded-t-sm border-2 border-[#4a2f1b] bg-[#7a4a24]">
        <div className="absolute inset-x-[7px] top-[8px] h-[30px] rounded-sm border border-[#5a3719] bg-[#8b5a2e]" />
        <div className="absolute inset-x-[7px] bottom-[8px] h-[30px] rounded-sm border border-[#5a3719] bg-[#8b5a2e]" />
        <div className="absolute right-[5px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-[#e8c46a]" />
      </div>

      {/* 衣帽架 */}
      <div className="relative h-[78px] w-[26px]">
        <div className="absolute left-1/2 top-[10px] h-[3px] w-[24px] -translate-x-1/2 bg-[#3f2a18]" />
        <div className="absolute left-[2px] top-[12px] h-[9px] w-[3px] rotate-[18deg] bg-[#3f2a18]" />
        <div className="absolute right-[2px] top-[12px] h-[9px] w-[3px] -rotate-[18deg] bg-[#3f2a18]" />
        <div className="absolute left-1/2 top-[13px] h-[52px] w-[3px] -translate-x-1/2 bg-[#3f2a18]" />
        <div className="absolute bottom-[8px] left-1/2 h-[3px] w-[20px] -translate-x-1/2 bg-[#3f2a18]" />
      </div>

      <FramedWindow />

      {/* 挂钟（比别的挂件高一点，跟参考图一样错落） */}
      <div className="relative mb-[26px] h-[34px] w-[34px] rounded-full border-2 border-[#2f2118] bg-[#3a2a20]">
        <div className="absolute inset-[4px] rounded-full bg-[#f2ead8]" />
        <div className="absolute left-1/2 top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-full bg-[#2f2118]" />
        <div className="absolute left-1/2 top-1/2 h-[2px] w-[8px] bg-[#2f2118]" />
      </div>

      {/* 白板 */}
      <div className="h-[70px] w-[104px] rounded-sm border-2 border-[#b9b2a4] bg-[#f6f3ec]">
        <div className="mx-2 mt-3 h-[3px] w-14 bg-[#c8c2b4]" />
        <div className="mx-2 mt-2 h-[3px] w-20 bg-[#d6d0c2]" />
        <div className="mx-2 mt-2 h-[3px] w-10 bg-[#d6d0c2]" />
      </div>

      <FramedPicture />
      <FramedWindow />
      <CalendarPage />
      <Bookshelf />
      <FramedPicture />
      <FramedWindow />
    </div>
  )
}

function FramedWindow() {
  return (
    <div className="h-[54px] w-[68px] rounded-sm border-[3px] border-[#7fa8c9] bg-[#bfe0f2] p-[3px]">
      <div className="h-full w-full bg-[linear-gradient(180deg,#a9d6ef_0%,#dceef8_55%,#f0d9a8_56%,#e8c998_100%)]">
        <div className="mt-[8px] ml-[8px] h-[8px] w-[8px] rounded-full bg-[#fdf3c8]" />
      </div>
    </div>
  )
}

function FramedPicture() {
  return (
    <div className="h-[38px] w-[34px] border-2 border-[#4a3524] bg-[#cbe3e8] p-[2px]">
      <div className="h-full w-full bg-[linear-gradient(160deg,#8fb8c9_0%,#cfe4ea_60%,#e8f0e0_100%)]" />
    </div>
  )
}

function CalendarPage() {
  return (
    <div className="h-[52px] w-[46px] rounded-sm border-2 border-[#4a3524] bg-[#fbf8f0]">
      <div className="flex h-[14px] items-center justify-center bg-[#c94b3a] text-[8px] font-bold text-white">10</div>
      <div className="flex flex-1 items-center justify-center text-[16px] font-bold leading-none text-[#3a2a20]">14</div>
    </div>
  )
}

function Bookshelf() {
  // 书脊颜色固定写死，不随机 —— 每次渲染都跳色会晃眼。
  const shelf = ['#c94b3a', '#3f7fbf', '#e0a83c', '#4f9d5f', '#8a5fb0', '#d97b3a', '#3aa8a0']
  return (
    <div className="flex h-[86px] w-[62px] flex-col justify-end gap-[3px] border-2 border-[#4a2f1b] bg-[#6b4322] p-[3px]">
      {[0, 1, 2].map((shelfIndex) => (
        <div key={shelfIndex} className="flex h-[22px] items-end gap-[2px] border-b-2 border-[#4a2f1b] px-[2px]">
          {shelf.slice(shelfIndex, shelfIndex + 6).map((color, i) => (
            <div key={i} className="w-[5px] rounded-t-[1px]" style={{ height: `${12 + ((i * 3) % 8)}px`, backgroundColor: color }} />
          ))}
        </div>
      ))}
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
      className="relative mx-auto flex h-full w-full max-w-[1180px] flex-col rounded-[4px] border-[10px] border-[#a9743f] shadow-xl"
      style={{ imageRendering: 'pixelated', backgroundColor: '#c08a4c' }}
    >
      {/* 墙：米色格纹壁纸 + 挂件 + 绿色墙裙 */}
      <div
        className="relative h-[124px] shrink-0 border-b-[3px] border-[#5f8f6a]"
        style={{
          backgroundImage:
            'linear-gradient(#efe0c0 0 0), repeating-linear-gradient(90deg, rgba(0,0,0,.045) 0 1px, transparent 1px 16px), repeating-linear-gradient(0deg, rgba(0,0,0,.045) 0 1px, transparent 1px 16px)',
          backgroundColor: '#efe0c0',
        }}
      >
        <WallDecor />
      </div>

      {/* 地板：木框 + 蓝地毯（像素点阵），撑满剩余高度 */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-[#a9743f] p-[10px]">
        <div
          className="flex min-h-full flex-wrap content-center items-center justify-around gap-6 rounded-[2px] p-6"
          style={{
            backgroundColor: '#5b8fd6',
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(255,255,255,.10) 0 4px, transparent 4px 8px), repeating-linear-gradient(0deg, rgba(0,0,0,.10) 0 4px, transparent 4px 8px)',
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
  const screenTint = status === 'failed' ? '#ff8f8f' : '#7fe0a8'

  return (
    <div
      className="relative"
      onMouseEnter={() => onPin(row.id)}
      onMouseLeave={() => onPin(null)}
    >
      <button
        type="button"
        data-testid={`worker-desk-${row.id}`}
        onClick={() => useTabStore.getState().openTab(row.id, row.title || t('workers.untitled'), 'session')}
        className="group relative block h-[172px] w-[156px] focus:outline-none"
        aria-label={row.title || t('workers.untitled')}
      >
        {/* 显示器 */}
        <div className="absolute left-[46px] top-0 h-[48px] w-[66px] rounded-[3px] border-2 border-[#242424] bg-[#181a1e]">
          <div className="absolute inset-[4px] overflow-hidden rounded-[1px] bg-[#0b1f2a] px-1 py-[3px] font-mono text-[6px] leading-[7px]" style={{ color: screenTint }}>
            <div className="truncate">{status === 'running' ? '> working…' : status === 'failed' ? '!! error' : '> idle'}</div>
            <div className="truncate opacity-75">{'>>> >>> >>>'}</div>
            <div className="truncate opacity-55">{status === 'waiting' ? '? input' : '>>> >>>'}</div>
          </div>
        </div>
        <div className="absolute left-[76px] top-[48px] h-[5px] w-[6px] bg-[#242424]" />
        <div className="absolute left-[64px] top-[53px] h-[3px] w-[30px] rounded-[1px] bg-[#242424]" />

        {/* 台灯 */}
        <div className="absolute left-[120px] top-[30px] h-[30px] w-[16px]">
          <div className="absolute bottom-0 left-1/2 h-[3px] w-[16px] -translate-x-1/2 rounded-full bg-[#9aa0a6]" />
          <div className="absolute bottom-[3px] left-1/2 h-[22px] w-[3px] -translate-x-1/2 rotate-[14deg] bg-[#b6bcc2]" />
          <div className="absolute left-[2px] top-0 h-[9px] w-[13px] rounded-t-[6px] bg-[#c9ced4]" />
        </div>

        {/* 桌面 */}
        <div className="absolute left-[26px] top-[58px] h-[15px] w-[110px] rounded-[2px] border-2 border-[#7a4a24] bg-[#c08a4c]" />
        <div className="absolute left-[26px] top-[58px] h-[4px] w-[110px] rounded-t-[2px] bg-[#dba869]" />
        <div className="absolute left-[32px] top-[73px] h-[34px] w-[5px] bg-[#8a5a30]" />
        <div className="absolute left-[124px] top-[73px] h-[34px] w-[5px] bg-[#8a5a30]" />

        <DeskProp kind={deskPropFor(row.id)} />

        {/* 小人：坐/站在桌子后面，运行中会轻轻上下浮动 */}
        <img
          src={mascot}
          alt=""
          className={`absolute left-[54px] top-[22px] z-20 h-[46px] w-[46px] object-contain drop-shadow ${running ? 'animate-bounce' : ''}`}
          style={{ animationDuration: '1.6s' }}
        />

        {/* 转椅 */}
        <div className="absolute left-[46px] top-[104px] h-[52px] w-[64px]">
          <div className="absolute left-[4px] top-0 h-[30px] w-[56px] rounded-t-[8px] rounded-b-[3px] border-2 border-[#5c1f22] bg-[#8d3038]" />
          <div className="absolute left-[2px] top-[30px] h-[10px] w-[60px] rounded-[3px] border-2 border-[#5c1f22] bg-[#a03b43]" />
          <div className="absolute left-[30px] top-[40px] h-[8px] w-[4px] bg-[#3a3a3a]" />
          <div className="absolute left-[12px] top-[47px] h-[3px] w-[40px] rounded-full bg-[#3a3a3a]" />
        </div>

        <div className="absolute inset-x-0 bottom-[-2px] z-30 truncate text-center text-[11px] font-medium text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.7)]">
          {row.title || t('workers.untitled')}
        </div>
      </button>

      {/* 悬浮详情 */}
      {pinned && <DetailCard row={row} chat={chat} status={status} now={now} />}
    </div>
  )
}

/** 桌上小摆件。 */
function DeskProp({ kind }: { kind: (typeof DESK_PROPS)[number] }) {
  if (kind === 'plant') {
    return (
      <div className="absolute left-[34px] top-[34px] z-10 h-[30px] w-[24px]">
        <div className="absolute bottom-0 left-1/2 h-[12px] w-[16px] -translate-x-1/2 rounded-b-[3px] bg-[#b06a3a]" />
        <div className="absolute bottom-[10px] left-[3px] h-[12px] w-[8px] -rotate-[20deg] rounded-full bg-[#4f9d5f]" />
        <div className="absolute bottom-[10px] right-[3px] h-[12px] w-[8px] rotate-[20deg] rounded-full bg-[#3f8a50]" />
        <div className="absolute bottom-[16px] left-1/2 h-[10px] w-[8px] -translate-x-1/2 rounded-full bg-[#5fae6f]" />
      </div>
    )
  }
  if (kind === 'cat') {
    return (
      <div className="absolute left-[30px] top-[36px] z-10 h-[24px] w-[30px]">
        <div className="absolute bottom-0 left-0 h-[14px] w-[28px] rounded-[7px] bg-[#f0e6d2]" />
        <div className="absolute bottom-[12px] left-[2px] h-[10px] w-[12px] rounded-[5px] bg-[#f0e6d2]" />
        <div className="absolute bottom-[19px] left-[3px] h-[5px] w-[4px] -rotate-[12deg] bg-[#f0e6d2]" />
        <div className="absolute bottom-[19px] left-[9px] h-[5px] w-[4px] rotate-[12deg] bg-[#f0e6d2]" />
      </div>
    )
  }
  if (kind === 'laptop') {
    return (
      <div className="absolute left-[36px] top-[44px] z-10 h-[16px] w-[26px]">
        <div className="h-[12px] w-[24px] rounded-[2px] border-2 border-[#3a3a3a] bg-[#202226]" />
        <div className="h-[3px] w-[26px] rounded-[1px] bg-[#9aa0a6]" />
      </div>
    )
  }
  return (
    <div className="absolute left-[36px] top-[44px] z-10 h-[16px] w-[12px]">
      <div className="h-[13px] w-[12px] rounded-b-[3px] rounded-t-[1px] bg-[#3f7fbf]" />
      <div className="absolute -right-[3px] top-[4px] h-[7px] w-[4px] rounded-r-[2px] border-2 border-[#3f7fbf]" />
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
      className="absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-[230px] -translate-x-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-left text-[11px] shadow-xl"
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

/** 底部会话牌：跟参考图一样的木头牌子，一块对应一个工位。 */
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
    <div
      className="flex flex-shrink-0 gap-3 overflow-x-auto border-t-[3px] border-[#8a5c31] px-4 py-3"
      style={{ backgroundColor: '#c08a4c' }}
    >
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
            className={`min-w-[132px] max-w-[260px] flex-1 shrink-0 rounded-[3px] border-2 px-2.5 py-1.5 text-left text-[11px] ${
              pinned === row.id ? 'border-[var(--color-accent)]' : 'border-[#8a5c31]'
            }`}
            style={{
              backgroundColor: '#e6c48c',
              boxShadow: 'inset 0 3px 0 rgba(255,255,255,.4), inset 0 -4px 0 rgba(0,0,0,.14)',
            }}
          >
            <div className="truncate font-medium text-[#3a2a18]">{row.title || t('workers.untitled')}</div>
            <div className="truncate text-[#6b4a24]">
              {t(STATUS_LABEL[status] as never)}
              {turns > 0 && ` · ${formatTokenCount(turns)} tck`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
