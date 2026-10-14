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
const DESK_PROPS = ['mug', 'plant', 'cat', 'tank'] as const
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

  const run = useCallback(async () => {
    if (!free) {
      setProbe({ state: 'none' })
      return
    }
    setProbe({ state: 'checking' })
    try {
      const result = await testProvider(free.id)
      const step = result?.connectivity
      if (!step?.success) {
        setProbe({ state: 'down' })
        return
      }
      const ms = step.latencyMs ?? 0
      setProbe({ state: ms > 4000 ? 'slow' : 'ok', ms })
    } catch {
      setProbe({ state: 'down' })
    }
  }, [free?.id, testProvider])

  useEffect(() => {
    void run()
  }, [run])

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
      <span className="font-medium">
        {t(label[probe.state] as never)}
        {probe.state === 'ok' || probe.state === 'slow' ? ` · ${Math.round(probe.ms ?? 0)}ms` : ''}
      </span>
    </button>
  )
}

/**
 * 墙上一排挂件。门/衣帽架/书架落地，其余挂墙（靠 mb 抬到墙裙之上）。
 * 纯装饰，不接数据。
 */
function WallDecor() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[4px] flex items-end justify-between px-3">
      {/* 木门：贴左墙，落地 */}
      <div className="relative h-[100px] w-[54px] rounded-t-sm border-2 border-[#c9b48c] bg-[#6d4222]">
        <div className="absolute inset-x-[8px] top-[7px] h-[34px] rounded-[1px] border border-[#4a2b12] bg-[#7d4e29]" />
        <div className="absolute inset-x-[8px] bottom-[7px] h-[40px] rounded-[1px] border border-[#4a2b12] bg-[#7d4e29]" />
        <div className="absolute right-[6px] top-[52px] h-[5px] w-[5px] rounded-full bg-[#e8c46a]" />
      </div>

      {/* 衣帽架：落地，两根外撇的钩 */}
      <div className="relative h-[80px] w-[26px]">
        <div className="absolute left-1/2 top-[8px] h-[3px] w-[26px] -translate-x-1/2 rounded-full bg-[#3f2a18]" />
        <div className="absolute left-[1px] top-[2px] h-[3px] w-[11px] rotate-[38deg] rounded-full bg-[#3f2a18]" />
        <div className="absolute right-[1px] top-[2px] h-[3px] w-[11px] -rotate-[38deg] rounded-full bg-[#3f2a18]" />
        <div className="absolute left-1/2 top-[9px] h-[56px] w-[3px] -translate-x-1/2 bg-[#3f2a18]" />
        <div className="absolute bottom-[6px] left-1/2 h-[3px] w-[18px] -translate-x-1/2 bg-[#3f2a18]" />
        <div className="absolute bottom-0 left-1/2 h-[7px] w-[26px] -translate-x-1/2 rounded-t-[3px] bg-[#3f2a18]" />
      </div>

      <Window />
      <Clock />
      <Whiteboard />
      <SmallArt tone="landscape" />
      <Window />
      <CalendarPage />
      <Bookshelf />
      <SmallArt tone="portrait" />
      <Window />
    </div>
  )
}

/** 蓝框日落窗：天蓝到橘的渐变 + 两朵云 + 太阳 + 左上角斜光。 */
function Window() {
  return (
    <div className="relative mb-[26px] h-[56px] w-[72px] rounded-[2px] border-[3px] border-[#9dc0da] bg-[#cfe6f5] p-[3px]">
      <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#8fc4e8_0%,#b9d9ef_42%,#f0cfa0_58%,#e8b47a_100%)]">
        <div className="absolute left-[6px] top-[7px] h-[3px] w-[14px] rotate-[-30deg] rounded-full bg-white/80" />
        <div className="absolute bottom-[10px] left-[6px] h-[5px] w-[18px] rounded-full bg-white/85" />
        <div className="absolute bottom-[13px] left-[16px] h-[5px] w-[14px] rounded-full bg-white/75" />
        <div className="absolute bottom-[9px] right-[8px] h-[6px] w-[6px] rounded-full bg-[#fdf0b0]" />
        <div className="absolute bottom-[7px] left-0 right-0 h-[4px] bg-[#d99a63]" />
      </div>
    </div>
  )
}

/** 圆挂钟：深木外圈 + 刻度点 + 两根指针。 */
function Clock() {
  return (
    <div className="relative mb-[40px] h-[36px] w-[36px] rounded-full border-[3px] border-[#4a3524] bg-[#3a2a20]">
      <div className="absolute inset-[2px] rounded-full bg-[#f7f1e2]" />
      <div className="absolute left-1/2 top-1/2 h-[11px] w-[2px] -translate-x-1/2 -translate-y-full bg-[#3a2a20]" />
      <div className="absolute left-1/2 top-1/2 h-[2px] w-[8px] -translate-y-1/2 bg-[#3a2a20]" />
      <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3a2a20]" />
    </div>
  )
}

/** 白板：银灰框 + 底部三颗彩笔点。 */
function Whiteboard() {
  return (
    <div className="relative mb-[26px] h-[64px] w-[112px] rounded-[2px] bg-[#b9b2a4] p-[3px]">
      <div className="relative h-full w-full rounded-[1px] bg-[#faf7f0]">
        <div className="absolute left-[8px] top-[10px] h-[3px] w-[46px] rounded-full bg-[#d9d3c6]" />
        <div className="absolute left-[8px] top-[20px] h-[3px] w-[70px] rounded-full bg-[#e2ddd1]" />
        <div className="absolute left-[8px] top-[30px] h-[3px] w-[34px] rounded-full bg-[#e2ddd1]" />
        <div className="absolute bottom-[2px] left-[6px] flex gap-[3px]">
          <span className="h-[5px] w-[5px] rounded-full bg-[#4f9d5f]" />
          <span className="h-[5px] w-[5px] rounded-full bg-[#c94b3a]" />
          <span className="h-[5px] w-[5px] rounded-full bg-[#3f7fbf]" />
        </div>
      </div>
    </div>
  )
}

/** 小相框：landscape = 绿粉风景，portrait = 暖色人像。 */
function SmallArt({ tone }: { tone: 'landscape' | 'portrait' }) {
  return (
    <div className="mb-[30px] h-[40px] w-[36px] border-[3px] border-[#4a3524] bg-[#e8e0cc] p-[2px]">
      {tone === 'landscape' ? (
        <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#8fd0e0_0%,#bfe4ea_45%,#e8c8dc_70%,#c9e0b8_100%)]">
          <div className="absolute bottom-0 left-0 h-[9px] w-full bg-[#6aa86a]" />
          <div className="absolute bottom-[7px] left-[8px] h-[8px] w-[5px] bg-[#3f6b3f]" />
        </div>
      ) : (
        <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f0d9a8_0%,#e8c078_60%,#c98f4f_100%)]">
          <div className="absolute left-1/2 top-[6px] h-[9px] w-[9px] -translate-x-1/2 rounded-full bg-[#f6e3b8]" />
          <div className="absolute bottom-0 left-1/2 h-[12px] w-[18px] -translate-x-1/2 rounded-t-[8px] bg-[#d99a63]" />
        </div>
      )}
    </div>
  )
}

/** 日历：顶部铁环 + 红头 + 日期。 */
function CalendarPage() {
  return (
    <div className="relative mb-[28px] h-[54px] w-[48px] rounded-[2px] border-2 border-[#4a3524] bg-[#fbf8f0]">
      <div className="absolute -top-[5px] left-[9px] h-[6px] w-[3px] rounded-full bg-[#8a8a8a]" />
      <div className="absolute -top-[5px] right-[9px] h-[6px] w-[3px] rounded-full bg-[#8a8a8a]" />
      <div className="pt-[3px] text-center text-[9px] font-bold leading-[13px] text-[#3a2a20]">10</div>
      <div className="mx-[4px] h-[2px] bg-[#c94b3a]" />
      <div className="text-center text-[19px] font-bold leading-[24px] text-[#3a2a20]">14</div>
    </div>
  )
}

/** 书架：落地，4 层，每层一列书脊。 */
function Bookshelf() {
  // 书脊颜色固定写死，不随机 —— 每次渲染都跳色会晃眼。
  const shelf = ['#c94b3a', '#3f7fbf', '#e0a83c', '#4f9d5f', '#8a5fb0', '#d97b3a', '#3aa8a0']
  return (
    <div className="flex h-[104px] w-[64px] flex-col justify-end gap-[2px] rounded-t-[2px] border-2 border-[#4a2f1b] bg-[#6b4322] p-[3px]">
      {[0, 1, 2, 3].map((shelfIndex) => (
        <div key={shelfIndex} className="flex h-[22px] items-end gap-[2px] border-b-2 border-[#4a2f1b] px-[1px]">
          {shelf.slice(shelfIndex % 3, (shelfIndex % 3) + 6).map((color, i) => (
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
      className="relative mx-auto flex h-full w-full max-w-[1180px] flex-col rounded-[3px] border-[8px] border-[#8a5c31] shadow-xl"
      style={{ imageRendering: 'pixelated', backgroundColor: '#c08a4c' }}
    >
      {/* 墙：米色菱格墙纸 + 挂件 + 绿色竖条墙裙 */}
      <div
        className="relative h-[136px] shrink-0"
        style={{
          backgroundColor: '#ecd9b0',
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 2px, transparent 2px 8px), repeating-linear-gradient(-45deg, rgba(196,160,104,.35) 0 2px, transparent 2px 8px)',
        }}
      >
        {/* 墙裙 + 压条：先画，好让门/书架落地的挂件盖在上面 */}
        <div
          className="absolute inset-x-0 bottom-0 h-[26px]"
          style={{
            backgroundColor: '#6f9d84',
            backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,.22) 0 2px, transparent 2px 22px)',
            borderTop: '2px solid #87b39a',
          }}
        />
        <div className="absolute inset-x-0 bottom-[-4px] h-[4px] bg-[#d9b98a]" />
        <WallDecor />
      </div>

      {/* 地板：木框 + 蓝地毯（菱形格），撑满剩余高度 */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-[#b8834a] p-[10px]">
        <div
          className="flex min-h-full flex-wrap content-center items-center justify-around gap-6 rounded-[2px] p-6"
          style={{
            backgroundColor: '#5b8fd6',
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,.13) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, rgba(0,0,0,.13) 0 2px, transparent 2px 6px)',
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
  const bars = status === 'failed' ? ['#ffb0a0', '#ff8f8f'] : ['#8fd8ff', '#7fe0a8']

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
        className="group relative block h-[186px] w-[168px] focus:outline-none"
        aria-label={row.title || t('workers.untitled')}
      >
        {/* 显示器 + 支架 */}
        <div className="absolute left-[40px] top-0 h-[54px] w-[76px] rounded-[2px] border-2 border-[#2a2a2a] bg-[#1b1d21]">
          <div className="absolute inset-[4px] overflow-hidden rounded-[1px] bg-[#0b1f2e] p-[4px]">
            {running ? (
              <div className="space-y-[4px]">
                <div className="h-[3px] w-[40px] rounded-full" style={{ backgroundColor: bars[0] }} />
                <div className="h-[3px] w-[26px] rounded-full" style={{ backgroundColor: bars[1] }} />
                <div className="h-[3px] w-[34px] rounded-full" style={{ backgroundColor: bars[0] }} />
                <div className="h-[3px] w-[18px] rounded-full" style={{ backgroundColor: bars[1] }} />
              </div>
            ) : (
              <div className="h-full w-full rounded-[1px] bg-[#0a1a26]">
                {status === 'failed' && <div className="mt-[8px] text-center font-mono text-[8px] text-[#ff8f8f]">!! error</div>}
              </div>
            )}
          </div>
        </div>
        <div className="absolute left-[73px] top-[54px] h-[6px] w-[7px] bg-[#2a2a2a]" />
        <div className="absolute left-[60px] top-[60px] h-[3px] w-[33px] rounded-[1px] bg-[#2a2a2a]" />

        {/* 台灯 */}
        <div className="absolute left-[124px] top-[26px] h-[34px] w-[20px]">
          <div className="absolute left-[3px] top-[3px] h-[9px] w-[15px] rounded-t-[7px] bg-[#c9ced4]" />
          <div className="absolute bottom-[5px] left-1/2 h-[24px] w-[3px] -translate-x-1/2 rotate-[16deg] rounded-full bg-[#b6bcc2]" />
          <div className="absolute bottom-0 left-1/2 h-[5px] w-[18px] -translate-x-1/2 rounded-full bg-[#9aa0a6]" />
        </div>

        {/* 桌面 + 浅色桌腿 */}
        <div className="absolute left-[22px] top-[64px] h-[16px] w-[124px] rounded-[2px] bg-[#a06a35]" />
        <div className="absolute left-[22px] top-[64px] h-[5px] w-[124px] rounded-t-[2px] bg-[#d9a86a]" />
        <div className="absolute left-[28px] top-[80px] h-[38px] w-[6px] rounded-b-[2px] bg-[#d9b98a]" />
        <div className="absolute right-[28px] top-[80px] h-[38px] w-[6px] rounded-b-[2px] bg-[#d9b98a]" />

        <DeskProp kind={deskPropFor(row.id)} />

        {/* 小人：站在桌子后，运行中轻轻上下浮动 */}
        <img
          src={mascot}
          alt=""
          className={`absolute left-[58px] top-[26px] z-20 h-[48px] w-[48px] object-contain drop-shadow ${running ? 'animate-bounce' : ''}`}
          style={{ animationDuration: '1.6s' }}
        />

        {/* 转椅：靠背 + 坐垫 + 中柱 + 五爪 */}
        <div className="absolute left-[48px] top-[112px] h-[62px] w-[72px]">
          <div className="absolute left-[8px] top-0 h-[36px] w-[56px] rounded-t-[10px] rounded-b-[4px] border-2 border-[#5c1f22] bg-[#8d3038]" />
          <div className="absolute left-[12px] top-[8px] h-[20px] w-[48px] rounded-t-[8px] bg-[#a03b43]" />
          <div className="absolute left-[4px] top-[36px] h-[11px] w-[64px] rounded-[3px] border-2 border-[#5c1f22] bg-[#9a3740]" />
          <div className="absolute left-[34px] top-[47px] h-[10px] w-[4px] bg-[#4a4a4a]" />
          <div className="absolute left-[18px] top-[56px] h-[4px] w-[36px] rounded-full bg-[#4a4a4a]" />
          <div className="absolute left-[14px] top-[56px] h-[4px] w-[12px] rotate-[24deg] rounded-full bg-[#4a4a4a]" />
          <div className="absolute right-[14px] top-[56px] h-[4px] w-[12px] -rotate-[24deg] rounded-full bg-[#4a4a4a]" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-30 truncate text-center text-[11px] font-medium text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.75)]">
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
      <div className="absolute left-[32px] top-[38px] z-10 h-[30px] w-[26px]">
        <div className="absolute bottom-0 left-1/2 h-[13px] w-[18px] -translate-x-1/2 rounded-b-[3px] rounded-t-[1px] bg-[#b06a3a]" />
        <div className="absolute bottom-[11px] left-[2px] h-[14px] w-[9px] -rotate-[22deg] rounded-full bg-[#4f9d5f]" />
        <div className="absolute bottom-[11px] right-[2px] h-[14px] w-[9px] rotate-[22deg] rounded-full bg-[#3f8a50]" />
        <div className="absolute bottom-[18px] left-1/2 h-[11px] w-[9px] -translate-x-1/2 rounded-full bg-[#5fae6f]" />
      </div>
    )
  }
  if (kind === 'cat') {
    return (
      <div className="absolute left-[30px] top-[40px] z-10 h-[26px] w-[32px]">
        <div className="absolute bottom-0 left-0 h-[15px] w-[30px] rounded-[8px] bg-[#f2e8d5]" />
        <div className="absolute bottom-[13px] left-[2px] h-[11px] w-[13px] rounded-[5px] bg-[#f2e8d5]" />
        <div className="absolute bottom-[21px] left-[3px] h-[6px] w-[4px] -rotate-[14deg] rounded-sm bg-[#f2e8d5]" />
        <div className="absolute bottom-[21px] left-[9px] h-[6px] w-[4px] rotate-[14deg] rounded-sm bg-[#f2e8d5]" />
        <div className="absolute bottom-[6px] right-[4px] h-[4px] w-[4px] rounded-full bg-[#c9b48c]" />
      </div>
    )
  }
  if (kind === 'tank') {
    return (
      <div
        className="absolute left-[36px] top-[26px] z-10 h-[40px] w-[30px] rounded-[2px] border-2 border-[#3f8f9a] bg-[#8fd8e0]/70"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 2px, transparent 2px 6px)' }}
      />
    )
  }
  return (
    <div className="absolute left-[36px] top-[48px] z-10 h-[18px] w-[14px]">
      <div className="h-[14px] w-[13px] rounded-b-[3px] rounded-t-[1px] bg-[#3f7fbf]" />
      <div className="absolute right-[-3px] top-[4px] h-[7px] w-[4px] rounded-r-[2px] border-2 border-[#3f7fbf]" />
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
      className="absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-[236px] -translate-x-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2.5 text-left text-[11px] shadow-xl"
    >
      <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{row.title || t('workers.untitled')}</div>
      {row.workDir && <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{row.workDir}</div>}
      <div className="mt-1 text-[var(--color-text-secondary)]">
        {t('workers.detail.terminal')} · {row.providerName}
      </div>
      <div className="truncate text-[11px] text-[var(--color-text-primary)]">{row.modelId}</div>
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
      className="flex flex-shrink-0 gap-3 overflow-x-auto px-4 py-3"
      style={{ backgroundColor: '#a9743f', borderTop: '3px solid #8a5c31' }}
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
              boxShadow: 'inset 0 3px 0 rgba(255,255,255,.45), inset 0 -4px 0 rgba(0,0,0,.16)',
            }}
          >
            <div className="truncate font-semibold text-[#3a2a18]">{row.title || t('workers.untitled')}</div>
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
