import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Inbox } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTaskInboxStore } from '../../stores/taskInboxStore'
import { useDismissable } from '@/hooks/useDismissable'
import { useSessionStore } from '../../stores/sessionStore'
import { isSessionTabId } from '../../stores/tabClose'
import { useTabStore } from '../../stores/tabStore'

const relativeTime = (value: number, now: number) => {
  const seconds = Math.max(1, Math.round((now - value) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/**
 * 跨会话后台任务收件箱：TabBar 常驻按钮 + 未读角标 + 下拉面板。
 * 任务完成事件由服务端 taskInboxService 落盘，这里 30s 轮询未读数。
 */
export function TaskInboxButton() {
  const t = useTranslation()
  const unreadCount = useTaskInboxStore((state) => state.unreadCount)
  const entries = useTaskInboxStore((state) => state.entries)
  const loaded = useTaskInboxStore((state) => state.loaded)
  const refresh = useTaskInboxStore((state) => state.refresh)
  const ack = useTaskInboxStore((state) => state.ack)
  const startPolling = useTaskInboxStore((state) => state.startPolling)
  const stopPolling = useTaskInboxStore((state) => state.stopPolling)
  const sessions = useSessionStore((state) => state.sessions)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  useEffect(() => {
    if (!open) return
    const clock = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(clock)
  }, [open])

  useDismissable({
    open,
    refs: [buttonRef],
    onDismiss: () => setOpen(false),
  })

  const rect = buttonRef.current?.getBoundingClientRect()

  const openPanel = () => {
    if (!open) void refresh()
    setOpen((value) => !value)
  }

  const label = t('taskInbox.title')
  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={openPanel}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <Inbox size={16} strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="task-inbox-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent-brand)] px-1 text-[10px] font-medium leading-none text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && rect ? createPortal(
        <div
          role="dialog"
          aria-label={label}
          className="fixed z-[var(--z-dropdown)] flex max-h-[420px] w-[380px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
          style={{ top: rect.bottom + 6, right: Math.max(12, window.innerWidth - rect.right) }}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{label}</span>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => void ack()}
                className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                {t('taskInbox.markAllRead')}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loaded ? (
              <p className="px-3 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">{t('common.loading')}</p>
            ) : entries.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">{t('taskInbox.empty')}</p>
            ) : (
              entries.map((entry) => {
                const title = sessions.find((session) => session.id === entry.sessionId)?.title
                return (
                  <button
                    key={entry.taskId}
                    type="button"
                    onClick={() => {
                      void ack()
                      setOpen(false)
                      // 会话开着就跳过去；没开不强开（恢复成本高，让用户从侧栏进）。
                      const tabs = useTabStore.getState().tabs
                      const existing = tabs.find((tab) => isSessionTabId(tab.sessionId) && tab.sessionId === entry.sessionId)
                      if (existing) useTabStore.getState().setActiveTab(entry.sessionId)
                    }}
                    className="flex w-full flex-col gap-0.5 border-b border-[var(--color-border)] px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.status === 'completed' ? 'bg-[var(--color-accent-success)]' : entry.status === 'failed' ? 'bg-[var(--color-accent-danger)]' : 'bg-[var(--color-text-tertiary)]'}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
                        {entry.summary || entry.description || entry.taskId}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                        {relativeTime(entry.finishedAt, now)}
                      </span>
                    </span>
                    {title && (
                      <span className="pl-3.5 text-[11px] text-[var(--color-text-tertiary)]">{title}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
