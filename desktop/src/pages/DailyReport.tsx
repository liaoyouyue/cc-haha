import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { activityStatsApi, type ActivityStatsResponse } from '../api/activityStats'
import { diagnosticsApi, type DiagnosticEvent } from '../api/diagnostics'
import { taskInboxApi, type TaskInboxEntry } from '../api/taskInbox'
import { tasksApi } from '../api/tasks'
import { useTranslation } from '../i18n'
import { Spinner } from '@/components/ui/Spinner'

/**
 * What the machine did today: usage, the tasks that ran, the schedules that
 * fired, and what broke. Everything is read from the APIs the app already
 * serves — no separate store, no second source of truth.
 */

type DailyModelTokens = { date: string; tokensByModel: Record<string, number> }

type ModelUsageLike = Record<string, { costUSD?: number }>

/**
 * The day's share of each model's recorded cost.
 *
 * The stats cache keeps tokens per day but only a running cost per model, so
 * the day is priced by the model's own token share of its total: no per-model
 * price table is needed, and a model's cost stays proportional to the tokens
 * that earned it.
 */
export function estimateDailyCost(
  date: string,
  dailyModelTokens: DailyModelTokens[],
  modelUsage: ModelUsageLike,
): number {
  const day = dailyModelTokens.find(row => row.date === date)
  if (!day) return 0
  let cost = 0
  for (const [model, tokens] of Object.entries(day.tokensByModel)) {
    const modelCost = modelUsage[model]?.costUSD ?? 0
    if (modelCost <= 0) continue
    let modelTotal = 0
    for (const row of dailyModelTokens) modelTotal += row.tokensByModel[model] ?? 0
    if (modelTotal <= 0) continue
    // A day's tokens can exceed the range total once the cache is trimmed.
    const share = Math.min(1, tokens / modelTotal)
    cost += modelCost * share
  }
  return cost
}

/** The entries that finished on the day of `now`, newest first. */
export function pickTodayEntries(
  entries: TaskInboxEntry[],
  now: Date,
): TaskInboxEntry[] {
  const day = now.toDateString()
  return entries
    .filter(entry => new Date(entry.finishedAt).toDateString() === day)
    .sort((a, b) => b.finishedAt - a.finishedAt)
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatTokens(value: number): string {
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return String(Math.round(value))
}

function formatCost(value: number): string {
  if (value <= 0) return '$0'
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="m-0 mt-1.5 text-[22px] font-semibold leading-tight tabular-nums text-[var(--color-text-primary)]">
        {value}
      </dd>
      {detail ? (
        <div className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">{detail}</div>
      ) : null}
    </div>
  )
}

export function DailyReport() {
  const t = useTranslation()
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null)
  const [entries, setEntries] = useState<TaskInboxEntry[]>([])
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof tasksApi.list>>['tasks']>([])
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.allSettled([
      activityStatsApi.getStats('7d'),
      taskInboxApi.list(),
      tasksApi.list(),
      diagnosticsApi.getEvents(80),
    ]).then(([statsResult, inboxResult, tasksResult, eventsResult]) => {
      if (cancelled) return
      if (statsResult.status === 'fulfilled') setStats(statsResult.value)
      else setError(statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason))
      if (inboxResult.status === 'fulfilled') setEntries(inboxResult.value.entries)
      if (tasksResult.status === 'fulfilled') setTasks(tasksResult.value.tasks)
      if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value.events)
      setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const now = useMemo(() => new Date(), [])
  const today = dayKey(now)

  const todayActivity = useMemo(
    () => stats?.dailyActivity.find(day => day.date === today) ?? null,
    [stats, today],
  )
  const todayTokens = useMemo(
    () => stats?.dailyModelTokens
      .filter(day => day.date === today)
      .reduce((sum, day) => sum + Object.values(day.tokensByModel).reduce((a, b) => a + b, 0), 0) ?? 0,
    [stats, today],
  )
  const todayCost = useMemo(
    () => estimateDailyCost(today, stats?.dailyModelTokens ?? [], stats?.modelUsage ?? {}),
    [stats, today],
  )
  // Models with no published rate contribute tokens but no dollars. Saying so beats a $0
  // that reads like the day was free.
  const todayUnpriced = useMemo(() => {
    const day = stats?.dailyModelTokens.find(row => row.date === today)
    const unpriced = new Set(stats?.unpricedModels ?? [])
    if (!day) return []
    const used = Object.keys(day.tokensByModel)
    return used.filter(model => unpriced.has(model))
  }, [stats, today])
  const todayEntries = useMemo(() => pickTodayEntries(entries, now), [entries, now])
  const failures = todayEntries.filter(entry => entry.status === 'failed')
  const problems = useMemo(
    () => events.filter(event => event.severity === 'error' || event.severity === 'warn').slice(0, 8),
    [events],
  )

  const week = useMemo(() => {
    const rows = stats?.dailyModelTokens ?? []
    const max = Math.max(1, ...rows.map(row => Object.values(row.tokensByModel).reduce((a, b) => a + b, 0)))
    return rows.slice(-7).map(row => ({
      date: row.date,
      tokens: Object.values(row.tokensByModel).reduce((a, b) => a + b, 0),
      max,
    }))
  }, [stats])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-surface)]">
        <Spinner size={20} tone="brand" label={t('common.loading')} />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[960px] px-10 pb-16 pt-9">
        <header>
          <h1 className="text-[22px] font-semibold leading-[1.3] text-[var(--color-text-primary)]">
            {t('dailyReport.title')}
          </h1>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--color-text-tertiary)]">
            {t('dailyReport.subtitle')}
          </p>
        </header>

        {error ? (
          <div className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]">
            {error}
          </div>
        ) : null}

        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[var(--color-border)] pt-5 @[560px]:grid-cols-5">
          <StatTile label={t('dailyReport.messages')} value={String(todayActivity?.messageCount ?? 0)} />
          <StatTile label={t('dailyReport.sessions')} value={String(todayActivity?.sessionCount ?? 0)} />
          <StatTile label={t('dailyReport.toolCalls')} value={String(todayActivity?.toolCallCount ?? 0)} />
          <StatTile label={t('dailyReport.tokens')} value={formatTokens(todayTokens)} />
          <StatTile
            label={t('dailyReport.cost')}
            value={todayUnpriced.length > 0 && todayCost <= 0 ? '—' : formatCost(todayCost)}
            detail={todayUnpriced.length > 0 ? t('dailyReport.costPartial') : t('dailyReport.costEstimated')}
          />
        </dl>

        <section className="mt-9">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('dailyReport.weekTitle')}</h2>
          <div className="mt-3 flex h-28 items-end gap-2">
            {week.map(day => (
              <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{formatTokens(day.tokens)}</span>
                <div
                  className="w-full rounded-t-[3px] bg-[var(--color-brand)]"
                  style={{ height: `${Math.max(2, Math.round((day.tokens / day.max) * 72))}px` }}
                />
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{day.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-9 grid gap-8 @[860px]:grid-cols-2">
          <section className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {t('dailyReport.tasksTitle')}
              <span className="ml-2 text-[13px] font-normal text-[var(--color-text-tertiary)]">
                {t('dailyReport.taskCount', { done: todayEntries.length - failures.length, failed: failures.length })}
              </span>
            </h2>
            <ul className="mt-3 space-y-2">
              {todayEntries.length === 0 ? (
                <li className="text-[13px] text-[var(--color-text-tertiary)]">{t('dailyReport.noTasks')}</li>
              ) : todayEntries.slice(0, 12).map(entry => (
                <li key={entry.taskId} className="flex items-start gap-2 text-[13px] leading-[1.5]">
                  {entry.status === 'failed'
                    ? <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-error)]" aria-hidden="true" />
                    : entry.status === 'stopped'
                      ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
                      : <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--color-success)]" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]" title={entry.summary ?? entry.description}>
                    {entry.summary ?? entry.description ?? entry.taskId}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-tertiary)]">{timeOf(entry.finishedAt)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('dailyReport.schedulesTitle')}</h2>
            <ul className="mt-3 space-y-2">
              {tasks.slice(0, 8).map(task => (
                <li key={task.id} className="flex items-center gap-2 text-[13px] leading-[1.5]">
                  <Clock size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{task.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-tertiary)]">{task.cron}</span>
                  {task.enabled ? null : (
                    <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{t('dailyReport.paused')}</span>
                  )}
                </li>
              ))}
              {tasks.length === 0 ? (
                <li className="text-[13px] text-[var(--color-text-tertiary)]">{t('dailyReport.noTasks')}</li>
              ) : null}
            </ul>

            <h2 className="mt-8 text-[15px] font-semibold text-[var(--color-text-primary)]">{t('dailyReport.problemsTitle')}</h2>
            <ul className="mt-3 space-y-2">
              {problems.length === 0 ? (
                <li className="text-[13px] text-[var(--color-text-tertiary)]">{t('dailyReport.noProblems')}</li>
              ) : problems.map(event => (
                <li key={event.id} className="flex items-start gap-2 text-[13px] leading-[1.5]">
                  <AlertTriangle
                    size={14}
                    className={`mt-0.5 shrink-0 ${event.severity === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-warning)]'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]" title={event.summary}>
                    {event.summary}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
