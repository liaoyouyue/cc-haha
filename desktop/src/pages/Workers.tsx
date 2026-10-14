import { useEffect, useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useProviderStore } from '../stores/providerStore'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useTranslation } from '../i18n'
import { buildWorkerRows, type WorkerKind, type WorkerRow } from '../lib/workerBoard'
import { resolvePetSessionStatus, currentPetPreview } from '../features/pets/petSessionModel'

const KIND_CLASS: Record<WorkerKind, string> = {
  free: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  paid: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  unknown: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] border-[var(--color-border)]',
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-emerald-500 animate-pulse',
  waiting: 'bg-amber-500 animate-pulse',
  review: 'bg-sky-500',
  failed: 'bg-red-500',
  idle: 'bg-[var(--color-text-tertiary)]',
}

/**
 * 工人看板：一张卡 = 一个会话（= 一个工人）。
 *
 * 存在的理由只有一个：不打开会话也能一眼看出「谁在干活、用的哪个模型、是不是走的免费网关」。
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

  const freeCount = rows.filter((row) => row.kind === 'free').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {rows.map((row) => (
              <WorkerCard key={row.id} row={row} chat={chats[row.id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WorkerCard({ row, chat }: { row: WorkerRow; chat: ReturnType<typeof useChatStore.getState>['sessions'][string] | undefined }) {
  const t = useTranslation()
  const status = resolvePetSessionStatus(chat)
  const preview = currentPetPreview(chat)

  return (
    <button
      type="button"
      data-testid={`worker-card-${row.id}`}
      onClick={() => useTabStore.getState().openTab(row.id, row.title || t('workers.untitled'), 'session')}
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left transition-colors hover:border-[var(--color-accent)]"
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.idle}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {row.title || t('workers.untitled')}
        </span>
        <span className={`flex-shrink-0 rounded border px-1.5 py-px text-[11px] font-medium ${KIND_CLASS[row.kind]}`}>
          {t(row.kind === 'free' ? 'workers.free' : row.kind === 'paid' ? 'workers.paid' : 'workers.unknown')}
        </span>
      </div>

      {row.workDir && (
        <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]" title={row.workDir}>
          {row.workDir}
        </div>
      )}

      <div className="min-h-[16px] truncate text-[12px] text-[var(--color-text-secondary)]">
        {preview || t(`workers.status.${status}` as never)}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="truncate">{row.providerName}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate font-mono" title={row.modelId}>{row.modelId}</span>
      </div>
    </button>
  )
}
