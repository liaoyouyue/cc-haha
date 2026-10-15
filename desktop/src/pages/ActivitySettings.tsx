import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Box, ChartNoAxesColumn, CircleAlert, Pencil, Puzzle, Upload } from 'lucide-react'
import { activityStatsApi, type ActivityStatsResponse, type DailyActivity } from '../api/activityStats'
import {
  desktopUiPreferencesApi,
  getProfileAvatarUrl,
  type DesktopProfilePreferences,
} from '../api/desktopUiPreferences'
import { SettingsPageHeader, SettingsSection } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cx } from '@/lib/cx'
import { type Locale, useTranslation } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { publicAssetPath } from '../lib/publicAsset'

type HeatmapDay = {
  date: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  tokens: number
  level: number
  mode: HeatmapMode
  rangeStart?: string
  rangeEnd?: string
}

type SummaryMetric = {
  label: string
  value: string
  detail?: string
}

type PluginRankItem = {
  id: string
  label: string
  count: number
  kind: 'plugin' | 'skill'
}

type HeatmapMode = 'daily' | 'weekly' | 'cumulative'

/**
 * The five Token Intelligence sheets. `overview` is the original page: lifetime
 * totals plus the heatmap. The other four are the Phase A additions.
 */
type ActivityView = 'overview' | 'models' | 'projects' | 'tools' | 'diagnostics'

/**
 * Only the two sheets whose data carries a date grain can honour a range
 * filter — model spend from `dailyModelUsage` and project spend from
 * `projectUsage`. Tools and diagnostics are all-time aggregates, so they get no
 * control rather than a dead one.
 */
type UsageRange = 'all' | '30d' | '7d'

const RANGE_DAY_COUNTS: Record<UsageRange, number | null> = {
  all: null,
  '30d': 30,
  '7d': 7,
}

/** Sheets whose data carries a date grain, so the range filter actually bites. */
const RANGE_AWARE_VIEWS: ReadonlySet<ActivityView> = new Set<ActivityView>(['models', 'projects'])

/** Tokens a model processed rather than replayed from cache, plus cost. */
type ModelUsageRow = {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  fresh: number
  costUSD: number
  unpriced: boolean
}

type ProjectUsageRow = {
  projectPath: string
  projectName: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  costUSD: number
}

type SessionUsageRow = {
  sessionId: string
  projectName: string
  startedAt: string
  activeDurationMs: number
  messageCount: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  costUSD: number
}

type ToolRankRow = {
  name: string
  count: number
}

type DiagnosticLevel = 'warn' | 'info'

type DiagnosticItem = {
  id: string
  level: DiagnosticLevel
  title: string
  detail: string
}

const WEEK_COUNT = 52
const CHART_DAY_COUNT = 14
/** Leaderboards, not exports — the sheets say how many rows they show. */
const SESSION_ROW_LIMIT = 20
const TOOL_ROW_LIMIT = 12
/** Columns a month name needs ("Sep", "10月") before the next label may start. */
const MONTH_LABEL_MIN_WEEKS = 3
const WEEKDAY_LABEL_KEYS = [
  'settings.activity.weekday.mon',
  'settings.activity.weekday.wed',
  'settings.activity.weekday.fri',
] as const
const HEAT_CELL_GAP = 3
const HEAT_LABEL_WIDTH = 38
const HEAT_CELL_MIN = 6
const HEAT_CELL_MAX = 22
const TOOLTIP_WIDTH = 172
const HEAT_COLORS = [
  'var(--color-activity-heat-0)',
  'var(--color-activity-heat-1)',
  'var(--color-activity-heat-2)',
  'var(--color-activity-heat-3)',
  'var(--color-activity-heat-4)',
]
const DATE_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  jp: 'ja-JP',
  kr: 'ko-KR',
}
const DEFAULT_PROFILE: DesktopProfilePreferences = {
  displayName: 'cc-haha',
  subtitle: 'github.com/NanmiCoder/cc-haha',
  avatarFile: null,
  avatarUpdatedAt: null,
}
const DEFAULT_AVATAR_SRC = publicAssetPath('app-icon.png')

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  next.setDate(next.getDate() - next.getDay())
  return next
}

function formatDateLabel(dateKey: string, locale: Locale) {
  return parseLocalDate(dateKey).toLocaleDateString(DATE_LOCALES[locale], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatShortDate(dateKey: string, locale: Locale) {
  return parseLocalDate(dateKey).toLocaleDateString(DATE_LOCALES[locale], {
    month: 'numeric',
    day: 'numeric',
  })
}

export function formatTokens(tokens: number) {
  if (tokens >= 1e8) return `${(tokens / 1e8).toFixed(2)}亿`
  if (tokens >= 1e4) return `${Math.round(tokens / 1e4)}万`
  return `${tokens}`
}

function formatInteger(value: number, locale: Locale) {
  return new Intl.NumberFormat(DATE_LOCALES[locale], { maximumFractionDigits: 0 }).format(value)
}

function formatPercent(numerator: number, denominator: number, locale: Locale) {
  if (denominator <= 0) return '0%'
  return new Intl.NumberFormat(DATE_LOCALES[locale], {
    maximumFractionDigits: 0,
    style: 'percent',
  }).format(numerator / denominator)
}

function formatDayCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.dayOne' : 'settings.activity.count.dayOther', { count: value })
}

function formatTaskDuration(duration: number | undefined, locale: Locale, t: ReturnType<typeof useTranslation>) {
  if (!duration || duration <= 0) return t('settings.activity.noDuration')
  const totalMinutes = Math.max(1, Math.round(duration / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (locale === 'zh') {
    if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
    if (hours > 0) return `${hours} 小时`
    return `${minutes} 分钟`
  }

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function formatSessionCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.sessionOne' : 'settings.activity.count.sessionOther', { count: value })
}

function formatMessageCount(value: number, t: ReturnType<typeof useTranslation>) {
  return `${value} ${t('settings.activity.messages')}`
}

function formatRunCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.runOne' : 'settings.activity.count.runOther', { count: value })
}

function getModelTokenTotal(usage: ActivityStatsResponse['modelUsage'][string] | undefined) {
  if (!usage) return 0
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0)
  )
}

/**
 * Tokens the model actually had to process, as opposed to prefix it read back from cache. Cache
 * reads dominate the headline total — over 90% of it on a heavy agentic workload — and bill at a
 * tenth of input, so the raw total on its own says very little about what was spent.
 */
function getFreshTokenTotal(usage: ActivityStatsResponse['modelUsage'][string] | undefined) {
  if (!usage) return 0
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0)
  )
}

function formatCostUSD(cost: number, locale: Locale) {
  return new Intl.NumberFormat(DATE_LOCALES[locale], {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cost >= 100 ? 0 : 2,
  }).format(cost)
}

function formatShare(part: number, whole: number, locale: Locale) {
  if (whole <= 0) return '0%'
  return new Intl.NumberFormat(DATE_LOCALES[locale], {
    maximumFractionDigits: part / whole < 0.1 ? 1 : 0,
    style: 'percent',
  }).format(part / whole)
}

function formatModelName(model: string) {
  return model
    .replace(/^claude-/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getPluginNameFromToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const parts = toolName.split('__').filter(Boolean)
  const serverName = parts[1]
  if (!serverName) return null
  if (serverName === 'codex_apps' && parts[2]) return parts[2]
  return serverName
}

function formatPluginName(pluginName: string) {
  return pluginName.replace(/_/g, '-')
}

function buildPluginAndSkillRankItems(stats: ActivityStatsResponse | null) {
  const skillItems = Object.entries(stats?.skillUsage ?? {}).map<PluginRankItem>(([skill, count]) => ({
    id: `skill:${skill}`,
    label: `$${skill}`,
    count,
    kind: 'skill',
  }))

  const pluginUsage = new Map<string, number>()
  for (const [toolName, count] of Object.entries(stats?.toolUsage ?? {})) {
    const pluginName = getPluginNameFromToolName(toolName)
    if (!pluginName || count <= 0) continue
    pluginUsage.set(pluginName, (pluginUsage.get(pluginName) || 0) + count)
  }
  const pluginItems = [...pluginUsage.entries()].map<PluginRankItem>(([pluginName, count]) => ({
    id: `plugin:${pluginName}`,
    label: `@${formatPluginName(pluginName)}`,
    count,
    kind: 'plugin',
  }))

  return [...skillItems, ...pluginItems]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
}

function withProfileDefaults(profile: Partial<DesktopProfilePreferences> | null | undefined): DesktopProfilePreferences {
  return { ...DEFAULT_PROFILE, ...profile }
}

function getProfileSubtitleHref(subtitle: string) {
  if (/^https?:\/\//i.test(subtitle)) return subtitle
  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(subtitle)) return `https://${subtitle}`
  return null
}

function calculateHeatCellSize(width: number) {
  const available = width - HEAT_LABEL_WIDTH - (WEEK_COUNT - 1) * HEAT_CELL_GAP
  return Math.max(HEAT_CELL_MIN, Math.min(HEAT_CELL_MAX, Math.floor(available / WEEK_COUNT)))
}

function sumDailyUsage(days: HeatmapDay[]) {
  return days.reduce(
    (sum, day) => ({
      sessions: sum.sessions + day.sessionCount,
      tokens: sum.tokens + day.tokens,
    }),
    { sessions: 0, tokens: 0 },
  )
}

function getDailyTokenMap(stats: ActivityStatsResponse | null) {
  const map = new Map<string, number>()
  for (const day of stats?.dailyModelTokens ?? []) {
    const total = Object.values(day.tokensByModel).reduce((sum, tokens) => sum + tokens, 0)
    map.set(day.date, total)
  }
  return map
}

/** The trailing window the daily bar chart covers, ending today. */
function buildRecentDailyTokens(stats: ActivityStatsResponse | null, dayCount: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tokenMap = getDailyTokenMap(stats)
  return Array.from({ length: dayCount }, (_, index) => {
    const date = localDateKey(addDays(today, index - (dayCount - 1)))
    return { date, tokens: tokenMap.get(date) ?? 0 }
  })
}

function buildModelRows(stats: ActivityStatsResponse | null) {
  const unpriced = new Set(stats?.unpricedModels ?? [])
  return Object.entries(stats?.modelUsage ?? {})
    .map(([model, usage]) => ({
      model,
      fresh: getFreshTokenTotal(usage),
      cached: usage.cacheReadInputTokens ?? 0,
      total: getModelTokenTotal(usage),
      costUSD: usage.costUSD ?? 0,
      unpriced: unpriced.has(model),
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model))
}

/**
 * Inclusive lower bound of a range as a `YYYY-MM-DD` key, or null for "all".
 * Comparing date keys as strings is safe because they are zero-padded ISO days,
 * and it keeps every range filter on the same calendar the server aggregates
 * with instead of introducing a second, local-timezone definition of "day".
 */
function getRangeCutoff(range: UsageRange): string | null {
  const days = RANGE_DAY_COUNTS[range]
  if (days === null) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return localDateKey(addDays(today, -(days - 1)))
}

function isDateInSelectedRange(dateKey: string, cutoff: string | null) {
  if (cutoff === null) return true
  return dateKey.slice(0, 10) >= cutoff
}

/**
 * Per-model rows for the selected range.
 *
 * With the local index available this folds `dailyModelUsage` down to the
 * window, so changing the range never costs a request. Without it (index
 * disabled, still building, or the JSONL fallback answered) it falls back to the
 * all-time `modelUsage` map and reports `rangeApplied: false`, so the sheet can
 * say the filter did not take effect instead of silently showing wider numbers
 * than the control claims.
 */
function buildModelUsageRows(
  stats: ActivityStatsResponse | null,
  cutoff: string | null,
): { rows: ModelUsageRow[]; rangeApplied: boolean } {
  const unpriced = new Set(stats?.unpricedModels ?? [])
  const daily = stats?.dailyModelUsage

  if (!daily) {
    return {
      rows: buildModelRows(stats).map((row) => ({
        model: row.model,
        input: 0,
        output: 0,
        cacheRead: row.cached,
        cacheWrite: 0,
        total: row.total,
        fresh: row.fresh,
        costUSD: row.costUSD,
        unpriced: row.unpriced,
      })),
      rangeApplied: false,
    }
  }

  const byModel = new Map<string, ModelUsageRow>()
  for (const day of daily) {
    if (!isDateInSelectedRange(day.date, cutoff)) continue
    const row = byModel.get(day.model) ?? {
      model: day.model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      fresh: 0,
      costUSD: 0,
      unpriced: unpriced.has(day.model),
    }
    row.input += day.inputTokens
    row.output += day.outputTokens
    row.cacheRead += day.cacheReadInputTokens
    row.cacheWrite += day.cacheCreationInputTokens
    row.costUSD += day.costUSD
    row.total += day.inputTokens + day.outputTokens +
      day.cacheReadInputTokens + day.cacheCreationInputTokens
    row.fresh += day.inputTokens + day.outputTokens + day.cacheCreationInputTokens
    byModel.set(day.model, row)
  }

  return {
    rows: [...byModel.values()]
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model)),
    rangeApplied: true,
  }
}

function buildProjectUsageRows(
  stats: ActivityStatsResponse | null,
  cutoff: string | null,
): ProjectUsageRow[] {
  const byProject = new Map<string, ProjectUsageRow>()
  for (const day of stats?.projectUsage ?? []) {
    if (!isDateInSelectedRange(day.date, cutoff)) continue
    const row = byProject.get(day.projectPath) ?? {
      projectPath: day.projectPath,
      projectName: day.projectName,
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      costUSD: 0,
    }
    // Counted per day, so a session spanning midnight lands on both days and a
    // subagent-only project still shows activity. The column is labelled
    // session-days for that reason; the session leaderboard is where per-session
    // counts live, and the two numbers are not interchangeable.
    row.sessionCount += day.sessionCount
    row.messageCount += day.messageCount
    row.toolCallCount += day.toolCallCount
    row.input += day.inputTokens
    row.output += day.outputTokens
    row.cacheRead += day.cacheReadInputTokens
    row.cacheWrite += day.cacheCreationInputTokens
    row.costUSD += day.costUSD
    row.total += day.inputTokens + day.outputTokens +
      day.cacheReadInputTokens + day.cacheCreationInputTokens
    byProject.set(day.projectPath, row)
  }

  return [...byProject.values()]
    .sort((a, b) => b.total - a.total || a.projectName.localeCompare(b.projectName))
}

function buildSessionUsageRows(
  stats: ActivityStatsResponse | null,
  cutoff: string | null,
  limit: number,
): SessionUsageRow[] {
  return (stats?.sessionUsage ?? [])
    .filter((session) => isDateInSelectedRange(session.startedAt, cutoff))
    .map<SessionUsageRow>((session) => ({
      sessionId: session.sessionId,
      projectName: session.projectName,
      startedAt: session.startedAt,
      activeDurationMs: session.activeDurationMs,
      messageCount: session.messageCount,
      input: session.inputTokens,
      output: session.outputTokens,
      cacheRead: session.cacheReadInputTokens,
      cacheWrite: session.cacheCreationInputTokens,
      total: session.inputTokens + session.outputTokens +
        session.cacheReadInputTokens + session.cacheCreationInputTokens,
      costUSD: session.costUSD,
    }))
    .sort((a, b) => b.total - a.total || a.sessionId.localeCompare(b.sessionId))
    .slice(0, limit)
}

/**
 * Raw tool call counts. `toolUsage` is an all-time aggregate with no date grain
 * on the wire, so this sheet takes no range control — a filter that did nothing
 * would be worse than no filter.
 */
function buildToolRankRows(stats: ActivityStatsResponse | null, limit: number): ToolRankRow[] {
  return Object.entries(stats?.toolUsage ?? {})
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Which usage dimensions this build actually collects. Drives the Overview
 * completeness strip and the Diagnostics sheet, so "we do not measure that"
 * reads as a stated gap rather than a zero that looks like real data.
 */
function buildCoverageItems(stats: ActivityStatsResponse | null) {
  // Truthiness, not `!== null`: a sidecar old enough to omit the key reports the
  // same thing as one that could not answer, and neither is a zero.
  const hasIndexGrain = Boolean(stats?.projectUsage && stats?.sessionUsage)
  return [
    { id: 'fourDims', labelKey: 'settings.activity.coverage.fourDims', collected: true },
    { id: 'cacheSplit', labelKey: 'settings.activity.coverage.cacheSplit', collected: true },
    { id: 'cost', labelKey: 'settings.activity.coverage.cost', collected: true },
    { id: 'project', labelKey: 'settings.activity.coverage.project', collected: hasIndexGrain },
    { id: 'session', labelKey: 'settings.activity.coverage.session', collected: hasIndexGrain },
    { id: 'toolCount', labelKey: 'settings.activity.coverage.toolCount', collected: true },
    { id: 'toolDuration', labelKey: 'settings.activity.coverage.toolDuration', collected: false },
    { id: 'toolFailure', labelKey: 'settings.activity.coverage.toolFailure', collected: false },
  ] as const
}

/**
 * Diagnostics built only from cross-checks the stored data can settle. Every
 * finding names the numbers behind it; anything that would need per-tool
 * durations, failure rates or a second source of truth is listed as a known gap
 * rather than guessed at.
 */
function buildDiagnostics(
  stats: ActivityStatsResponse | null,
  t: ReturnType<typeof useTranslation>,
): DiagnosticItem[] {
  const items: DiagnosticItem[] = []
  if (!stats) return items

  const unpriced = stats.unpricedModels ?? []
  if (unpriced.length > 0) {
    items.push({
      id: 'unpriced',
      level: 'warn',
      title: t('settings.activity.diag.unpricedTitle', { count: unpriced.length }),
      detail: unpriced.join(', '),
    })
  }

  // A model with tokens but no cost that the server did NOT flag as unpriced
  // means the two sides of the cost pipeline disagree. Worth surfacing: it is
  // exactly how a silent pricing-table gap would first show up.
  const unpricedSet = new Set(unpriced)
  const suspicious = Object.entries(stats.modelUsage ?? {})
    .filter(([model, usage]) => {
      const total = getModelTokenTotal(usage)
      return total > 0 && (usage.costUSD ?? 0) === 0 && !unpricedSet.has(model)
    })
    .map(([model]) => model)
  if (suspicious.length > 0) {
    items.push({
      id: 'zeroCost',
      level: 'warn',
      title: t('settings.activity.diag.zeroCostTitle', { count: suspicious.length }),
      detail: suspicious.join(', '),
    })
  }

  // Duplicate-accounting check: the per-day series and the per-model totals are
  // produced by the same rows, so any model whose day sum differs from its
  // aggregate is being counted twice (or dropped) somewhere in between.
  const dayTotals = new Map<string, number>()
  for (const day of stats.dailyModelTokens ?? []) {
    for (const [model, tokens] of Object.entries(day.tokensByModel)) {
      dayTotals.set(model, (dayTotals.get(model) ?? 0) + tokens)
    }
  }
  const mismatched = Object.entries(stats.modelUsage ?? {})
    .filter(([model, usage]) => {
      const aggregate = getModelTokenTotal(usage)
      const daily = dayTotals.get(model) ?? 0
      return Math.abs(aggregate - daily) > 0
    })
    .map(([model, usage]) =>
      `${model}: ${formatTokens(getModelTokenTotal(usage))} vs ${formatTokens(dayTotals.get(model) ?? 0)}`)
  if (mismatched.length > 0) {
    items.push({
      id: 'dupTokens',
      level: 'warn',
      title: t('settings.activity.diag.mismatchTitle', { count: mismatched.length }),
      detail: mismatched.slice(0, 5).join(' · '),
    })
  }

  const totalDays = stats.totalDays ?? 0
  const activeDays = stats.activeDays ?? 0
  if (totalDays > 0 && activeDays > totalDays) {
    items.push({
      id: 'activeRate',
      level: 'warn',
      title: t('settings.activity.diag.activeRateTitle'),
      detail: `${activeDays} / ${totalDays}`,
    })
  }

  if (!stats.projectUsage || !stats.sessionUsage) {
    items.push({
      id: 'indexGrain',
      level: 'info',
      title: t('settings.activity.diag.noIndexTitle'),
      detail: t('settings.activity.diag.noIndexDetail'),
    })
  }

  items.push({
    id: 'phaseB',
    level: 'info',
    title: t('settings.activity.diag.phaseBTitle'),
    detail: t('settings.activity.diag.phaseBDetail'),
  })

  return items
}

function getHeatLevel(day: DailyActivity | undefined, tokens: number, maxScore: number) {
  const sessionCount = day?.sessionCount ?? 0
  if (sessionCount === 0 && tokens === 0) return 0
  if (maxScore <= 0) return 1

  const score = sessionCount * 3 + Math.ceil(tokens / 50_000)
  const ratio = score / maxScore
  if (ratio >= 0.78) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.24) return 2
  return 1
}

function getBarHeight(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) return 0
  return Math.max(1, Math.min(7, Math.ceil((value / maxValue) * 7)))
}

function getBarLevel(value: number, maxValue: number) {
  if (value <= 0) return 0
  if (maxValue <= 0) return 1
  const ratio = value / maxValue
  if (ratio >= 0.78) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.24) return 2
  return 1
}

function buildHeatmapDays(stats: ActivityStatsResponse | null, mode: HeatmapMode) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const finalWeekStart = startOfWeek(today)
  const start = addDays(finalWeekStart, -(WEEK_COUNT - 1) * 7)
  const activityMap = new Map((stats?.dailyActivity ?? []).map((day) => [day.date, day]))
  const tokenMap = getDailyTokenMap(stats)
  const dates: string[] = []
  for (let cursor = new Date(start); cursor <= today; cursor = addDays(cursor, 1)) {
    dates.push(localDateKey(cursor))
  }

  const scores: number[] = []
  let cumulativeTokens = 0
  for (const dateKey of dates) {
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    cumulativeTokens += tokens
    scores.push((day?.sessionCount ?? 0) * 3 + Math.ceil(tokens / 50_000))
  }
  const maxScore = Math.max(...scores, 0)

  const days: HeatmapDay[] = []
  cumulativeTokens = 0
  for (const dateKey of dates) {
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    cumulativeTokens += tokens
    days.push({
      date: dateKey,
      sessionCount: day?.sessionCount ?? 0,
      messageCount: day?.messageCount ?? 0,
      toolCallCount: day?.toolCallCount ?? 0,
      tokens,
      level: getHeatLevel(day, tokens, maxScore),
      mode: 'daily',
    })
  }

  if (mode === 'daily') return days

  const weeks = Array.from({ length: WEEK_COUNT }, (_, index) => {
    const rangeStart = dates[index * 7] ?? ''
    const rangeEnd = dates[Math.min(index * 7 + 6, dates.length - 1)] ?? rangeStart
    return {
      rangeStart,
      rangeEnd,
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      tokens: 0,
      cumulativeTokens: 0,
    }
  })

  dates.forEach((dateKey, index) => {
    const week = weeks[Math.floor(index / 7)]
    const day = activityMap.get(dateKey)
    if (!week) return
    week.sessionCount += day?.sessionCount ?? 0
    week.messageCount += day?.messageCount ?? 0
    week.toolCallCount += day?.toolCallCount ?? 0
    week.tokens += tokenMap.get(dateKey) ?? 0
  })

  let runningTotal = 0
  for (const week of weeks) {
    runningTotal += week.tokens
    week.cumulativeTokens = runningTotal
  }

  const maxValue = Math.max(
    ...weeks.map((week) => (mode === 'weekly' ? week.tokens : week.cumulativeTokens)),
    0,
  )

  return dates.map((dateKey, index) => {
    const week = weeks[Math.floor(index / 7)]
    const row = index % 7
    const tokens = mode === 'weekly' ? week?.tokens ?? 0 : week?.cumulativeTokens ?? 0
    const height = getBarHeight(tokens, maxValue)
    const isFilled = height > 0 && row >= 7 - height

    return {
      date: dateKey,
      sessionCount: week?.sessionCount ?? 0,
      messageCount: week?.messageCount ?? 0,
      toolCallCount: week?.toolCallCount ?? 0,
      tokens,
      level: isFilled ? getBarLevel(tokens, maxValue) : 0,
      mode,
      rangeStart: week?.rangeStart,
      rangeEnd: week?.rangeEnd,
    }
  })
}

function buildMonthLabels(days: HeatmapDay[], locale: Locale) {
  if (days.length === 0) return []
  const labels: Array<{ week: number; label: string }> = []
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  if (!firstDay || !lastDay) return labels

  const firstDate = parseLocalDate(firstDay.date)
  const lastDate = parseLocalDate(lastDay.date)
  let previousMonth = -1

  // A month that starts in the last two columns has no room for its name; it
  // would overhang the grid's right edge (GitHub drops it for the same reason).
  for (let week = 0; week < WEEK_COUNT - (MONTH_LABEL_MIN_WEEKS - 1); week += 1) {
    const weekDate = addDays(firstDate, week * 7)
    if (weekDate > lastDate) break
    if (weekDate.getMonth() !== previousMonth) {
      // The window can open on the tail of a month: its label would collide
      // with the next one, so the full month keeps the space.
      const previous = labels[labels.length - 1]
      if (previous && week - previous.week < MONTH_LABEL_MIN_WEEKS) labels.pop()
      labels.push({
        week,
        label: weekDate.toLocaleDateString(DATE_LOCALES[locale], { month: 'short' }),
      })
      previousMonth = weekDate.getMonth()
    }
  }

  return labels
}

function getHeatmapCellTitle(day: HeatmapDay, locale: Locale, t: ReturnType<typeof useTranslation>) {
  if (day.mode === 'weekly') {
    return t('settings.activity.weekRange', {
      start: formatDateLabel(day.rangeStart ?? day.date, locale),
      end: formatDateLabel(day.rangeEnd ?? day.date, locale),
    })
  }

  if (day.mode === 'cumulative') {
    return t('settings.activity.cumulativeThrough', {
      date: formatDateLabel(day.rangeEnd ?? day.date, locale),
    })
  }

  return formatDateLabel(day.date, locale)
}

function getHeatmapCellDetail(day: HeatmapDay, t: ReturnType<typeof useTranslation>) {
  if (day.mode === 'cumulative') {
    return t('settings.activity.tokenValue', { tokens: formatTokens(day.tokens) })
  }

  return `${formatSessionCount(day.sessionCount, t)} · ${formatTokens(day.tokens)} ${t('settings.activity.tokens')}`
}

export function ActivitySettings() {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const heatmapMeasureRef = useRef<HTMLDivElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<DesktopProfilePreferences>(DEFAULT_PROFILE)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileStatus, setProfileStatus] = useState<string | null>(null)
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState(DEFAULT_PROFILE.displayName)
  const [draftSubtitle, setDraftSubtitle] = useState(DEFAULT_PROFILE.subtitle)
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('daily')
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [focusedDate, setFocusedDate] = useState<string | null>(null)
  const [heatCellSize, setHeatCellSize] = useState(10)
  const [activeView, setActiveView] = useState<ActivityView>('overview')
  const [range, setRange] = useState<UsageRange>('all')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    activityStatsApi.getStats('all')
      .then((nextStats) => {
        if (cancelled) return
        setStats(nextStats)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setIsProfileLoading(true)
    setProfileError(null)

    desktopUiPreferencesApi.getPreferences()
      .then((result) => {
        if (cancelled) return
        const nextProfile = withProfileDefaults(result.preferences.profile)
        setProfile(nextProfile)
        setDraftDisplayName(nextProfile.displayName)
        setDraftSubtitle(nextProfile.subtitle)
      })
      .catch((err) => {
        if (cancelled) return
        setProfileError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isLoading || error) return
    const element = heatmapMeasureRef.current
    if (!element) return

    const updateCellSize = () => {
      const nextSize = calculateHeatCellSize(element.clientWidth)
      setHeatCellSize((current) => (current === nextSize ? current : nextSize))
    }

    updateCellSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateCellSize)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateCellSize)
    return () => window.removeEventListener('resize', updateCellSize)
  }, [error, isLoading])

  const days = useMemo(() => buildHeatmapDays(stats, heatmapMode), [heatmapMode, stats])
  const monthLabels = useMemo(() => buildMonthLabels(days, locale), [days, locale])
  const today = days.length > 0 ? days[days.length - 1] : null
  const activeTooltipDate = hoveredDate ?? focusedDate
  const tooltipDay = days.find((day) => day.date === activeTooltipDate) ?? null
  const tooltipIndex = tooltipDay ? days.findIndex((day) => day.date === tooltipDay.date) : -1
  const heatGridWidth = WEEK_COUNT * heatCellSize + (WEEK_COUNT - 1) * HEAT_CELL_GAP
  const heatGridHeight = 7 * heatCellSize + 6 * HEAT_CELL_GAP
  const heatmapWidth = HEAT_LABEL_WIDTH + heatGridWidth
  const tooltipStyle = tooltipIndex >= 0
    ? {
        left: Math.max(
          HEAT_LABEL_WIDTH,
          Math.min(
            heatmapWidth - TOOLTIP_WIDTH,
            HEAT_LABEL_WIDTH + Math.floor(tooltipIndex / 7) * (heatCellSize + HEAT_CELL_GAP) - 52,
          ),
        ),
        top: Math.max(28, 30 + (tooltipIndex % 7) * (heatCellSize + HEAT_CELL_GAP) - 50),
    }
    : undefined
  const last30Usage = sumDailyUsage(days.slice(-30))
  const totalTokens = useMemo(() => {
    return (stats?.dailyModelTokens ?? []).reduce((sum, day) => (
      sum + Object.values(day.tokensByModel).reduce((daySum, tokens) => daySum + tokens, 0)
    ), 0)
  }, [stats])
  const totalToolCalls = useMemo(() => {
    return (stats?.dailyActivity ?? []).reduce((sum, day) => sum + day.toolCallCount, 0)
  }, [stats])
  const totalSkillUses = useMemo(() => {
    return Object.values(stats?.skillUsage ?? {}).reduce((sum, count) => sum + count, 0)
  }, [stats])
  const exploredSkillsCount = Object.keys(stats?.skillUsage ?? {}).length
  const topModel = useMemo(() => {
    return Object.entries(stats?.modelUsage ?? {}).reduce<{
      model: string
      tokens: number
    } | null>((top, [model, usage]) => {
      const tokens = getModelTokenTotal(usage)
      if (tokens <= 0) return top
      if (!top || tokens > top.tokens) return { model, tokens }
      return top
    }, null)
  }, [stats])
  const peakTokens = useMemo(() => {
    return (stats?.dailyModelTokens ?? []).reduce((peak, day) => {
      const dayTotal = Object.values(day.tokensByModel).reduce((sum, tokens) => sum + tokens, 0)
      return Math.max(peak, dayTotal)
    }, 0)
  }, [stats])
  const topPluginItems = useMemo(() => buildPluginAndSkillRankItems(stats), [stats])
  const recentDays = useMemo(() => buildRecentDailyTokens(stats, CHART_DAY_COUNT), [stats])
  const rangeCutoff = useMemo(() => getRangeCutoff(range), [range])
  const modelUsageWindow = useMemo(
    () => buildModelUsageRows(stats, rangeCutoff),
    [rangeCutoff, stats],
  )
  const projectRows = useMemo(
    () => buildProjectUsageRows(stats, rangeCutoff),
    [rangeCutoff, stats],
  )
  const sessionRows = useMemo(
    () => buildSessionUsageRows(stats, rangeCutoff, SESSION_ROW_LIMIT),
    [rangeCutoff, stats],
  )
  const toolRankRows = useMemo(() => buildToolRankRows(stats, TOOL_ROW_LIMIT), [stats])
  const coverageItems = useMemo(() => buildCoverageItems(stats), [stats])
  const diagnostics = useMemo(() => buildDiagnostics(stats, t), [stats, t])
  // Four-dimension totals over the selected window, summed from the same rows
  // the model sheet shows so the Overview strip and the table can never drift.
  const windowTotals = useMemo(() => {
    return modelUsageWindow.rows.reduce(
      (sum, row) => ({
        input: sum.input + row.input,
        output: sum.output + row.output,
        cacheRead: sum.cacheRead + row.cacheRead,
        cacheWrite: sum.cacheWrite + row.cacheWrite,
        total: sum.total + row.total,
        costUSD: sum.costUSD + row.costUSD,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUSD: 0 },
    )
  }, [modelUsageWindow])
  const windowPromptTokens = windowTotals.input + windowTotals.cacheRead + windowTotals.cacheWrite
  const unpricedInWindow = modelUsageWindow.rows.filter((row) => row.unpriced).length
  const metrics: SummaryMetric[] = [
    {
      label: t('settings.activity.totalTokens'),
      value: formatTokens(totalTokens),
      detail: formatDayCount(stats?.activeDays ?? 0, t),
    },
    {
      label: t('settings.activity.peakTokens'),
      value: formatTokens(peakTokens),
      detail: stats?.peakActivityDay ? formatDateLabel(stats.peakActivityDay, locale) : undefined,
    },
    {
      label: t('settings.activity.longestTask'),
      value: formatTaskDuration(stats?.longestSession?.duration, locale, t),
      detail: stats?.longestSession ? formatMessageCount(stats.longestSession.messageCount, t) : undefined,
    },
    {
      label: t('settings.activity.currentStreak'),
      value: formatDayCount(stats?.streaks.currentStreak ?? 0, t),
      detail: today ? `${formatTokens(today.tokens)} ${t('settings.activity.tokens')}` : undefined,
    },
    {
      label: t('settings.activity.longestStreak'),
      value: formatDayCount(stats?.streaks.longestStreak ?? 0, t),
      detail: formatSessionCount(last30Usage.sessions, t),
    },
  ]
  const costCard = {
    label: t('settings.activity.estimatedCost'),
    value: formatCostUSD(windowTotals.costUSD, locale),
    // A partial total presented as a complete one would understate spend for anyone running
    // third-party models, so say what it leaves out.
    detail: unpricedInWindow > 0
      ? t('settings.activity.costExcludesModels', { count: unpricedInWindow })
      : t('settings.activity.costComplete'),
  }
  const toolSummary = {
    exploredSkills: formatInteger(exploredSkillsCount, locale),
    totalSkillUses: formatInteger(totalSkillUses, locale),
    totalToolCalls: formatInteger(totalToolCalls, locale),
  }
  const avatarSrc = profile.avatarFile ? getProfileAvatarUrl(profile.avatarUpdatedAt) : DEFAULT_AVATAR_SRC
  const avatarClassName = profile.avatarFile
    ? 'h-full w-full object-cover'
    : 'h-full w-full scale-[1.28] object-contain transition-transform'
  const profileSubtitleHref = getProfileSubtitleHref(profile.subtitle)
  const hasUsage = Boolean(stats && (stats.totalSessions > 0 || totalTokens > 0))
  const modeOptions: Array<{ mode: HeatmapMode; label: string; help: string }> = [
    { mode: 'daily', label: t('settings.activity.mode.daily'), help: t('settings.activity.modeHelp.daily') },
    { mode: 'weekly', label: t('settings.activity.mode.weekly'), help: t('settings.activity.modeHelp.weekly') },
    { mode: 'cumulative', label: t('settings.activity.mode.cumulative'), help: t('settings.activity.modeHelp.cumulative') },
  ]
  const viewOptions: Array<{ view: ActivityView; label: string }> = [
    { view: 'overview', label: t('settings.activity.view.overview') },
    { view: 'models', label: t('settings.activity.view.models') },
    { view: 'projects', label: t('settings.activity.view.projects') },
    { view: 'tools', label: t('settings.activity.view.tools') },
    { view: 'diagnostics', label: t('settings.activity.view.diagnostics') },
  ]
  const rangeOptions: Array<{ range: UsageRange; label: string }> = [
    { range: 'all', label: t('settings.activity.range.all') },
    { range: '30d', label: t('settings.activity.range.30d') },
    { range: '7d', label: t('settings.activity.range.7d') },
  ]
  const insights: Array<{ label: string; value: string; detail?: string }> = [
    {
      label: t('settings.activity.activeRate'),
      value: formatPercent(stats?.activeDays ?? 0, stats?.totalDays ?? 0, locale),
      detail: t('settings.activity.activeRateDetail', {
        active: stats?.activeDays ?? 0,
        total: stats?.totalDays ?? 0,
      }),
    },
    {
      label: t('settings.activity.effectiveDuration'),
      // Summed from the session rows, which is the only place per-session
      // working time exists. Unavailable on the fallback path, where the
      // transcript scan keeps no per-session duration.
      value: stats?.sessionUsage
        ? formatTaskDuration(
            stats.sessionUsage.reduce((sum, session) => sum + session.activeDurationMs, 0),
            locale,
            t,
          )
        : '--',
      detail: stats?.sessionUsage ? t('settings.activity.effectiveDurationDetail') : t('settings.activity.notCollected'),
    },
    {
      label: t('settings.activity.cacheHitRate'),
      value: formatShare(windowTotals.cacheRead, windowPromptTokens, locale),
      detail: t('settings.activity.cacheHitRateDetail'),
    },
    {
      label: t('settings.activity.mostUsedModel'),
      value: topModel ? formatModelName(topModel.model) : t('settings.activity.none'),
      detail: topModel ? `${formatTokens(topModel.tokens)} ${t('settings.activity.tokens')}` : undefined,
    },
    {
      label: t('settings.activity.totalSessions'),
      value: formatInteger(stats?.totalSessions ?? 0, locale),
    },
    {
      label: t('settings.activity.totalToolCalls'),
      value: formatInteger(totalToolCalls, locale),
    },
  ]

  const cancelProfileEdit = () => {
    setIsEditingProfile(false)
    setDraftDisplayName(profile.displayName)
    setDraftSubtitle(profile.subtitle)
    setProfileError(null)
  }

  const saveProfile = async () => {
    setIsSavingProfile(true)
    setProfileError(null)
    setProfileStatus(null)
    try {
      const result = await desktopUiPreferencesApi.updateProfilePreferences({
        displayName: draftDisplayName,
        subtitle: draftSubtitle,
      })
      const nextProfile = withProfileDefaults(result.preferences.profile)
      setProfile(nextProfile)
      setDraftDisplayName(nextProfile.displayName)
      setDraftSubtitle(nextProfile.subtitle)
      setIsEditingProfile(false)
      setProfileStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setIsSavingProfile(true)
    setProfileError(null)
    setProfileStatus(null)
    try {
      const result = await desktopUiPreferencesApi.uploadProfileAvatar(file)
      const nextProfile = withProfileDefaults(result.preferences.profile)
      setProfile(nextProfile)
      setDraftDisplayName(nextProfile.displayName)
      setDraftSubtitle(nextProfile.subtitle)
      setProfileStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const removeAvatar = async () => {
    setIsSavingProfile(true)
    setProfileError(null)
    setProfileStatus(null)
    try {
      const result = await desktopUiPreferencesApi.deleteProfileAvatar()
      setProfile(withProfileDefaults(result.preferences.profile))
      setProfileStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const recentPeakTokens = Math.max(...recentDays.map((day) => day.tokens), 0)
  const recentFirstDay = recentDays[0]
  const recentLastDay = recentDays[recentDays.length - 1]

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader
        title={t('settings.activity.title')}
        description={t('settings.activity.subtitleLoading')}
      />

      {/* The identity this page is screenshotted under. The edit control stays
          invisible until hover or keyboard focus so it never lands in a shot. */}
      <div className="group/activity-profile mt-6 flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3.5">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
          <img
            src={avatarSrc}
            alt={t('settings.activity.avatarAlt', { name: profile.displayName })}
            className={avatarClassName}
            onError={(event) => {
              event.currentTarget.src = DEFAULT_AVATAR_SRC
              event.currentTarget.className = 'h-full w-full scale-[1.28] object-contain transition-transform'
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 whitespace-normal break-words text-[15px] font-semibold leading-snug text-[var(--color-text-primary)]">
            {profile.displayName}
          </h3>
          {profileSubtitleHref ? (
            <a
              href={profileSubtitleHref}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block max-w-full truncate text-xs text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-accent)]"
            >
              {profile.subtitle}
            </a>
          ) : (
            <div className="mt-0.5 max-w-full truncate text-xs text-[var(--color-text-tertiary)]">{profile.subtitle}</div>
          )}
          {profileStatus && <div className="mt-1 text-xs text-[var(--color-success)]">{profileStatus}</div>}
          {profileError && !isEditingProfile && <div className="mt-1 text-xs text-[var(--color-error)]">{profileError}</div>}
        </div>
        <IconButton
          icon={<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />}
          label={t('settings.activity.editProfile')}
          size="sm"
          tone="muted"
          disabledStyle="hide"
          className="opacity-0 group-hover/activity-profile:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            setIsEditingProfile(true)
            setDraftDisplayName(profile.displayName)
            setDraftSubtitle(profile.subtitle)
          }}
          disabled={isProfileLoading}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SegmentedControl
          size="sm"
          appearance="chip"
          label={t('settings.activity.view.label')}
          value={activeView}
          onChange={setActiveView}
          items={viewOptions.map((option) => ({ value: option.view, label: option.label }))}
        />
        {RANGE_AWARE_VIEWS.has(activeView) && (
          <SegmentedControl
            size="sm"
            appearance="chip"
            label={t('settings.activity.range.label')}
            value={range}
            onChange={setRange}
            items={rangeOptions.map((option) => ({ value: option.range, label: option.label }))}
          />
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-xs text-[var(--color-on-error-container)]"
        >
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {activeView === 'overview' && (
      <section className="activity-summary-panel mt-3 w-full min-w-0">
        <div className="activity-summary-grid grid gap-3">
          {isLoading
            ? Array.from({ length: 5 }).map((_, index) => (
                <Card
                  key={index}
                  surface="lowest"
                  padding="none"
                  aria-hidden="true"
                  className={cx(
                    'activity-summary-metric grid min-h-[92px] animate-pulse content-start gap-2 px-4 py-3.5',
                    index === 0 && 'activity-summary-metric-primary',
                  )}
                >
                  <div className="h-3 w-16 rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
                  <div className="h-6 w-20 rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
                  <div className="h-3 w-12 rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
                </Card>
              ))
            : metrics.map((metric, index) => (
                <Card
                  key={metric.label}
                  surface="lowest"
                  padding="none"
                  // `backwards` holds the entry frame through `animationDelay` so the stagger still
                  // reads, without a standalone `opacity-0`: that pairing is what made these cards
                  // invisible once the keyframes they named were dropped from globals.css.
                  className={cx(
                    'activity-summary-metric grid min-w-0 content-start gap-1 px-4 py-3.5',
                    '[animation:screen-pop_420ms_cubic-bezier(0.16,1,0.3,1)_backwards] motion-reduce:animate-none',
                    index === 0 && 'activity-summary-metric-primary',
                  )}
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <div className="min-w-0 truncate text-xs text-[var(--color-text-tertiary)]">{metric.label}</div>
                  <div
                    // Two lines rather than one truncated one: durations like "436 小时 26 分钟"
                    // do not fit a third of the row and were rendering as "436 小…".
                    className="activity-summary-value line-clamp-2 min-w-0 max-w-full text-[22px] font-semibold leading-tight tabular-nums text-[var(--color-text-primary)]"
                  >
                    {metric.value}
                  </div>
                  {metric.detail && (
                    <div className="min-w-0 truncate text-xs text-[var(--color-text-tertiary)]">{metric.detail}</div>
                  )}
                </Card>
              ))}
        </div>
      </section>
      )}

      {activeView === 'overview' && !isLoading && !error && hasUsage && recentFirstDay && recentLastDay && (
        <Card surface="lowest" padding="none" className="mt-3 px-4 pb-2.5 pt-4">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">
              {t('settings.activity.heatmapLabel')}
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
              {formatShortDate(recentFirstDay.date, locale)} – {formatShortDate(recentLastDay.date, locale)}
            </span>
          </div>
          <ol
            aria-label={t('settings.activity.heatmapLabel')}
            className="flex h-[150px] items-end gap-2 pt-5"
            style={{
              backgroundImage: 'repeating-linear-gradient(to top, var(--color-border) 0 1px, transparent 1px 43px)',
            }}
          >
            {recentDays.map((day, index) => {
              const isLast = index === recentDays.length - 1
              const isPeak = day.tokens > 0 && day.tokens === recentPeakTokens
              const height = recentPeakTokens > 0 ? (day.tokens / recentPeakTokens) * 100 : 0
              const dateLabel = formatDateLabel(day.date, locale)
              return (
                <li
                  key={day.date}
                  className="group/activity-bar relative flex h-full min-w-0 flex-1 items-end"
                  title={`${dateLabel} · ${formatTokens(day.tokens)} ${t('settings.activity.tokens')}`}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'w-full rounded-t-[var(--radius-xs)] transition-colors',
                      isLast
                        ? 'bg-[var(--color-brand)]'
                        : 'bg-[var(--color-outline)] group-hover/activity-bar:bg-[var(--color-text-tertiary)]',
                    )}
                    // Today keeps a 2px stub even before its first reply, so the
                    // highlighted "now" end of the window never disappears.
                    style={{ height: `${height}%`, minHeight: isLast ? 2 : undefined }}
                  />
                  {day.tokens > 0 && (
                    <span
                      aria-hidden="true"
                      className={cx(
                        'pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]',
                        isLast || isPeak ? 'opacity-100' : 'opacity-0 group-hover/activity-bar:opacity-100',
                      )}
                      style={{ bottom: `calc(${height}% + 4px)` }}
                    >
                      {formatTokens(day.tokens)}
                    </span>
                  )}
                  <span className="sr-only">{`${dateLabel}: ${formatTokens(day.tokens)} ${t('settings.activity.tokens')}`}</span>
                </li>
              )
            })}
          </ol>
          <div aria-hidden="true" className="mt-1.5 flex gap-2">
            {recentDays.map((day, index) => (
              <span
                key={day.date}
                className="min-w-0 flex-1 whitespace-nowrap text-center font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]"
              >
                {(recentDays.length - 1 - index) % 3 === 0 ? formatShortDate(day.date, locale) : ''}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={isEditingProfile}
        onClose={cancelProfileEdit}
        title={t('settings.activity.editProfile')}
        width={420}
        footer={
          <>
            <Button variant="ghost" size="base" onClick={cancelProfileEdit}>
              {t('settings.activity.cancelEdit')}
            </Button>
            <Button variant="primary" size="base" onClick={saveProfile} disabled={isSavingProfile}>
              {t('settings.activity.saveProfile')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.activity.displayNameHelper')}</p>

        <div className="mt-5 grid gap-4">
          <Input
            label={t('settings.activity.displayName')}
            value={draftDisplayName}
            onChange={(event) => setDraftDisplayName(event.target.value)}
          />

          <Input
            label={t('settings.activity.subtitle')}
            value={draftSubtitle}
            onChange={(event) => setDraftSubtitle(event.target.value)}
          />

          <div className="grid gap-2">
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">{t('settings.activity.avatar')}</div>
            <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.activity.avatarHelper')}</p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <Button
                variant="secondary"
                size="base"
                onClick={() => avatarInputRef.current?.click()}
                icon={<Upload size={14} strokeWidth={1.75} aria-hidden="true" />}
              >
                {t('settings.activity.changeAvatar')}
              </Button>
              {profile.avatarFile && (
                <Button variant="ghost" size="base" onClick={removeAvatar}>
                  {t('settings.activity.removeAvatar')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {profileError && (
          <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-xs text-[var(--color-on-error-container)]">
            <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
            <span className="min-w-0">{profileError}</span>
          </div>
        )}
      </Modal>

      {activeView === 'overview' && (
      <SettingsSection
        title={t('settings.activity.tokenActivity')}
        action={
          <SegmentedControl
            size="sm"
            label={t('settings.activity.tokenActivity')}
            value={heatmapMode}
            onChange={setHeatmapMode}
            items={modeOptions.map((option) => ({ value: option.mode, label: option.label, title: option.help }))}
          />
        }
      >
        {isLoading ? (
          <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[190px] px-4 py-4">
            <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
            <div className="mt-3 grid grid-flow-col justify-start gap-[3px]">
              {Array.from({ length: WEEK_COUNT }).map((_, col) => (
                <div key={col} className="grid grid-rows-7 gap-[3px]">
                  {Array.from({ length: 7 }).map((__, row) => (
                    <div key={row} className="activity-heat-swatch h-2.5 w-2.5 animate-pulse bg-[var(--color-surface-container)]" />
                  ))}
                </div>
              ))}
            </div>
          </Card>
        ) : !hasUsage ? (
          <EmptyState
            size="md"
            icon={<ChartNoAxesColumn size={18} strokeWidth={1.75} />}
            title={t('settings.activity.emptyTitle')}
            description={t('settings.activity.emptyBody')}
          />
        ) : (
          <Card surface="lowest" padding="none" className="px-4 pb-3.5 pt-4">
            <div ref={heatmapMeasureRef} className="min-w-0">
              <div className="relative" style={{ width: heatmapWidth, maxWidth: '100%' }}>
                {/* Absolutely placed by week: grid auto-placement pushed a label
                    whose 4-column span ran past the last week onto a second row,
                    and wrapped "10月" into two lines. */}
                <div
                  data-testid="activity-month-labels"
                  className="relative mb-3 h-5 text-[11px] leading-none text-[var(--color-text-tertiary)]"
                  style={{ marginLeft: HEAT_LABEL_WIDTH }}
                >
                  {monthLabels.map((month) => (
                    <span
                      key={`${month.week}-${month.label}`}
                      className="absolute top-0 whitespace-nowrap"
                      style={{ left: month.week * (heatCellSize + HEAT_CELL_GAP) }}
                    >
                      {month.label}
                    </span>
                  ))}
                </div>

                <div className="flex items-start" style={{ gap: HEAT_CELL_GAP }}>
                  <div
                    className="grid shrink-0 grid-rows-7 text-[11px] leading-none text-[var(--color-text-tertiary)]"
                    style={{ width: HEAT_LABEL_WIDTH, height: heatGridHeight, rowGap: HEAT_CELL_GAP }}
                  >
                    <div className="row-start-2 flex items-center">{t(WEEKDAY_LABEL_KEYS[0])}</div>
                    <div className="row-start-4 flex items-center">{t(WEEKDAY_LABEL_KEYS[1])}</div>
                    <div className="row-start-6 flex items-center">{t(WEEKDAY_LABEL_KEYS[2])}</div>
                  </div>

                  <div
                    role="grid"
                    aria-label={t('settings.activity.heatmapLabel')}
                    className="grid grid-flow-col"
                    style={{
                      gridTemplateRows: `repeat(7, ${heatCellSize}px)`,
                      gridAutoColumns: `${heatCellSize}px`,
                      columnGap: HEAT_CELL_GAP,
                      rowGap: HEAT_CELL_GAP,
                    }}
                    onMouseLeave={() => setHoveredDate(null)}
                  >
                    {days.map((day) => {
                      const isSelected = activeTooltipDate === day.date
                      const tooltipId = `activity-day-tooltip-${day.date}`
                      const cellTitle = getHeatmapCellTitle(day, locale, t)
                      const cellDetail = getHeatmapCellDetail(day, t)
                      return (
                        <button
                          key={day.date}
                          type="button"
                          role="gridcell"
                          aria-label={`${cellTitle}: ${cellDetail}`}
                          aria-describedby={activeTooltipDate === day.date ? tooltipId : undefined}
                          className={cx(
                            'activity-heat-cell border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-container-lowest)]',
                            isSelected
                              ? 'is-active border-[var(--color-activity-cell-border-active)]'
                              : 'border-[var(--color-activity-cell-border)] hover:border-[var(--color-activity-cell-border-hover)]',
                          )}
                          style={{
                            width: heatCellSize,
                            height: heatCellSize,
                            backgroundColor: HEAT_COLORS[day.level],
                          }}
                          onFocus={() => setFocusedDate(day.date)}
                          onBlur={() => setFocusedDate(null)}
                          onMouseEnter={() => setHoveredDate(day.date)}
                        />
                      )
                    })}
                  </div>
                </div>

                {tooltipDay && (
                  <div
                    id={`activity-day-tooltip-${tooltipDay.date}`}
                    role="tooltip"
                    className="pointer-events-none absolute z-[var(--z-tooltip)] min-w-[172px] rounded-[var(--radius-md)] border border-[var(--color-activity-tooltip-border)] bg-[var(--color-activity-tooltip-surface)] px-2.5 py-1.5 text-xs shadow-[var(--shadow-dropdown)]"
                    style={tooltipStyle}
                  >
                    <div className="font-medium text-[var(--color-activity-tooltip-text)]">{getHeatmapCellTitle(tooltipDay, locale, t)}</div>
                    <div className="mt-0.5 tabular-nums text-[var(--color-activity-tooltip-muted)]">
                      {getHeatmapCellDetail(tooltipDay, t)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
              <span className="mr-0.5">{t('settings.activity.less')}</span>
              {HEAT_COLORS.map((color) => (
                <span
                  key={color}
                  aria-hidden="true"
                  className="activity-heat-swatch border border-[var(--color-activity-cell-border)]"
                  style={{ width: heatCellSize, height: heatCellSize, backgroundColor: color }}
                />
              ))}
              <span className="ml-0.5">{t('settings.activity.more')}</span>
            </div>
          </Card>
        )}
      </SettingsSection>
      )}

      {activeView === 'overview' && !isLoading && !error && hasUsage && (
        <>
          <SettingsSection title={t('settings.activity.coverage.title')}>
            <Card surface="lowest" padding="none" className="px-4 py-3">
              <ul className="flex flex-wrap gap-1.5">
                {coverageItems.map((item) => (
                  <li
                    key={item.id}
                    className={cx(
                      'rounded-[var(--radius-md)] px-2 py-1 text-[11px]',
                      item.collected
                        ? 'bg-[var(--color-surface-container)] text-[var(--color-text-secondary)]'
                        : 'border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)]',
                    )}
                  >
                    {t(item.labelKey)}
                    {' · '}
                    {item.collected
                      ? t('settings.activity.coverage.collected')
                      : t('settings.activity.coverage.missing')}
                  </li>
                ))}
              </ul>
            </Card>
          </SettingsSection>

          <SettingsSection title={t('settings.activity.activityInsights')}>
            <Card surface="lowest" padding="none" className="overflow-hidden">
              <dl className="divide-y divide-[var(--color-border)]">
                {insights.map((metric) => (
                  <div key={metric.label} className="flex min-h-[44px] items-center justify-between gap-6 px-4 py-2.5">
                    <dt className="min-w-0 truncate text-[13px] text-[var(--color-text-secondary)]">{metric.label}</dt>
                    <dd className="flex min-w-0 items-baseline justify-end gap-2 text-right">
                      {metric.detail && (
                        <span className="min-w-0 truncate text-xs text-[var(--color-text-tertiary)]">{metric.detail}</span>
                      )}
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-[var(--color-text-primary)]">{metric.value}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </SettingsSection>
        </>
      )}

      {activeView === 'models' && (
        <>
          {!isLoading && !modelUsageWindow.rangeApplied && (
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
              {t('settings.activity.models.rangeUnavailable')}
            </div>
          )}
          <SettingsSection title={t('settings.activity.modelUsage')}>
            <Card surface="lowest" padding="none" className="px-4 py-3.5">
              <div className="min-w-0 truncate text-xs text-[var(--color-text-tertiary)]">{costCard.label}</div>
              <div className="mt-1 text-[22px] font-semibold leading-tight tabular-nums text-[var(--color-text-primary)]">
                {isLoading ? '--' : costCard.value}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">{costCard.detail}</div>
            </Card>
          </SettingsSection>

          <SettingsSection title={t('settings.activity.models.breakdownTitle')}>
            {isLoading ? (
              <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[120px] px-4 py-4">
                <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
              </Card>
            ) : modelUsageWindow.rows.length === 0 ? (
              <EmptyState
                size="md"
                icon={<ChartNoAxesColumn size={18} strokeWidth={1.75} />}
                title={t('settings.activity.emptyTitle')}
                description={t('settings.activity.emptyBody')}
              />
            ) : (
              <Card surface="lowest" padding="none" role="table" className="overflow-hidden">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))_minmax(0,0.8fr)] gap-2 bg-[var(--color-surface-container)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text-tertiary)]"
                >
                  <span role="columnheader" className="min-w-0 truncate">{t('settings.agents.model')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.dims.input')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.dims.output')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.dims.cacheRead')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.dims.cacheWrite')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.estimatedCost')}</span>
                </div>
                {modelUsageWindow.rows.map((row) => (
                  <div
                    key={row.model}
                    role="row"
                    className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))_minmax(0,0.8fr)] items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[13px] tabular-nums text-[var(--color-text-primary)]"
                  >
                    <span role="cell" className="min-w-0 truncate font-mono text-xs" title={row.model}>{row.model}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.input)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.output)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.cacheRead)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.cacheWrite)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">
                      {row.unpriced ? <span className="text-[var(--color-text-tertiary)]">—</span> : formatCostUSD(row.costUSD, locale)}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </SettingsSection>

          {!isLoading && modelUsageWindow.rows.some((row) => row.unpriced) && (
            <SettingsSection title={t('settings.activity.models.unpricedTitle')}>
              <Card surface="lowest" padding="none" className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-border)]">
                  {modelUsageWindow.rows.filter((row) => row.unpriced).map((row) => (
                    <li key={row.model} className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text-primary)]">{row.model}</span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">
                        {formatTokens(row.total)} {t('settings.activity.tokens')}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{t('settings.activity.models.unpricedBadge')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </SettingsSection>
          )}
        </>
      )}

      {activeView === 'projects' && (
        <>
          {!isLoading && !stats?.projectUsage && (
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
              {t('settings.activity.projects.unavailable')}
            </div>
          )}

          <SettingsSection title={t('settings.activity.projects.title')}>
            {isLoading ? (
              <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[120px] px-4 py-4">
                <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
              </Card>
            ) : projectRows.length === 0 ? (
              <EmptyState
                size="md"
                icon={<ChartNoAxesColumn size={18} strokeWidth={1.75} />}
                title={t('settings.activity.emptyTitle')}
                description={t('settings.activity.emptyBody')}
              />
            ) : (
              <Card surface="lowest" padding="none" role="table" className="overflow-hidden">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-2 bg-[var(--color-surface-container)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text-tertiary)]"
                >
                  <span role="columnheader" className="min-w-0 truncate">{t('settings.activity.projects.project')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.projects.sessions')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.projects.messages')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.totalTokens')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.estimatedCost')}</span>
                </div>
                {projectRows.map((row) => (
                  <div
                    key={row.projectPath}
                    role="row"
                    title={row.projectPath}
                    className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[13px] tabular-nums text-[var(--color-text-primary)]"
                  >
                    <span role="cell" className="min-w-0 truncate font-medium">{row.projectName}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatInteger(row.sessionCount, locale)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatInteger(row.messageCount, locale)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.total)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">
                      {row.costUSD > 0 ? formatCostUSD(row.costUSD, locale) : <span className="text-[var(--color-text-tertiary)]">—</span>}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </SettingsSection>

          <SettingsSection
            title={t('settings.activity.sessions.title')}
            action={
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.activity.sessions.cap', { count: SESSION_ROW_LIMIT })}
              </span>
            }
          >
            {isLoading ? (
              <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[120px] px-4 py-4">
                <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
              </Card>
            ) : sessionRows.length === 0 ? (
              <EmptyState
                size="md"
                icon={<ChartNoAxesColumn size={18} strokeWidth={1.75} />}
                title={t('settings.activity.emptyTitle')}
                description={t('settings.activity.emptyBody')}
              />
            ) : (
              <Card surface="lowest" padding="none" role="table" className="overflow-hidden">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-2 bg-[var(--color-surface-container)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text-tertiary)]"
                >
                  <span role="columnheader" className="min-w-0 truncate">{t('settings.activity.sessions.session')}</span>
                  <span role="columnheader" className="min-w-0 truncate">{t('settings.activity.projects.project')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.sessions.started')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.sessions.duration')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.totalTokens')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.estimatedCost')}</span>
                </div>
                {sessionRows.map((row) => (
                  <div
                    key={row.sessionId}
                    role="row"
                    title={row.sessionId}
                    className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[13px] tabular-nums text-[var(--color-text-primary)]"
                  >
                    <span role="cell" className="min-w-0 truncate font-mono text-xs">{row.sessionId.slice(0, 8)}</span>
                    <span role="cell" className="min-w-0 truncate">{row.projectName}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatShortDate(row.startedAt.slice(0, 10), locale)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTaskDuration(row.activeDurationMs, locale, t)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">{formatTokens(row.total)}</span>
                    <span role="cell" className="min-w-0 truncate text-right">
                      {row.costUSD > 0 ? formatCostUSD(row.costUSD, locale) : <span className="text-[var(--color-text-tertiary)]">—</span>}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </SettingsSection>
        </>
      )}

      {activeView === 'tools' && (
        <>
          <SettingsSection title={t('settings.activity.tools.title')}>
            {isLoading ? (
              <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[120px] px-4 py-4">
                <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
              </Card>
            ) : toolRankRows.length === 0 ? (
              <EmptyState
                size="md"
                icon={<ChartNoAxesColumn size={18} strokeWidth={1.75} />}
                title={t('settings.activity.emptyTitle')}
                description={t('settings.activity.emptyBody')}
              />
            ) : (
              <Card surface="lowest" padding="none" role="table" className="overflow-hidden">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,0.7fr)] gap-2 bg-[var(--color-surface-container)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text-tertiary)]"
                >
                  <span role="columnheader" className="min-w-0 truncate">{t('settings.activity.tools.tool')}</span>
                  <span role="columnheader" className="min-w-0 truncate text-right">{t('settings.activity.tools.calls')}</span>
                </div>
                {toolRankRows.map((row) => (
                  <div
                    key={row.name}
                    role="row"
                    className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,0.7fr)] items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <span role="cell" className="min-w-0 truncate font-mono text-xs" title={row.name}>{row.name}</span>
                    <span role="cell" className="min-w-0 truncate text-right tabular-nums">{formatInteger(row.count, locale)}</span>
                  </div>
                ))}
              </Card>
            )}
          </SettingsSection>

          {topPluginItems.length > 0 && (
            <SettingsSection title={t('settings.activity.mostUsedPluginsAndSkills')}>
              <Card surface="lowest" padding="none" className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-border)]">
                  {topPluginItems.map((item) => (
                    <li key={item.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]"
                      >
                        {item.kind === 'skill'
                          ? <Box size={14} strokeWidth={1.75} />
                          : <Puzzle size={14} strokeWidth={1.75} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text-primary)]">{item.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">{formatRunCount(item.count, t)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </SettingsSection>
          )}

          <SettingsSection title={t('settings.activity.tools.summaryTitle')}>
            <Card surface="lowest" padding="none" className="overflow-hidden">
              <dl className="divide-y divide-[var(--color-border)]">
                <div className="flex min-h-[44px] items-center justify-between gap-6 px-4 py-2.5">
                  <dt className="min-w-0 truncate text-[13px] text-[var(--color-text-secondary)]">{t('settings.activity.exploredSkills')}</dt>
                  <dd className="shrink-0 text-[13px] font-medium tabular-nums text-[var(--color-text-primary)]">{toolSummary.exploredSkills}</dd>
                </div>
                <div className="flex min-h-[44px] items-center justify-between gap-6 px-4 py-2.5">
                  <dt className="min-w-0 truncate text-[13px] text-[var(--color-text-secondary)]">{t('settings.activity.totalSkillUses')}</dt>
                  <dd className="shrink-0 text-[13px] font-medium tabular-nums text-[var(--color-text-primary)]">{toolSummary.totalSkillUses}</dd>
                </div>
                <div className="flex min-h-[44px] items-center justify-between gap-6 px-4 py-2.5">
                  <dt className="min-w-0 truncate text-[13px] text-[var(--color-text-secondary)]">{t('settings.activity.totalToolCalls')}</dt>
                  <dd className="shrink-0 text-[13px] font-medium tabular-nums text-[var(--color-text-primary)]">{toolSummary.totalToolCalls}</dd>
                </div>
              </dl>
            </Card>
          </SettingsSection>

          <SettingsSection title={t('settings.activity.tools.gapTitle')}>
            <Card surface="lowest" padding="none" className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-border)]">
                <li className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">{t('settings.activity.tools.duration')}</span>
                  <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{t('settings.activity.notCollected')}</span>
                </li>
                <li className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">{t('settings.activity.tools.failureRate')}</span>
                  <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{t('settings.activity.notCollected')}</span>
                </li>
              </ul>
            </Card>
          </SettingsSection>
        </>
      )}

      {activeView === 'diagnostics' && (
        <>
          <SettingsSection title={t('settings.activity.coverage.title')}>
            <Card surface="lowest" padding="none" className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-border)]">
                {coverageItems.map((item) => (
                  <li key={item.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">
                      {t(item.labelKey)}
                    </span>
                    <span
                      className={cx(
                        'shrink-0 text-xs',
                        item.collected ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-warning,var(--color-text-tertiary))]',
                      )}
                    >
                      {item.collected
                        ? t('settings.activity.coverage.collected')
                        : t('settings.activity.coverage.missing')}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </SettingsSection>

          <SettingsSection title={t('settings.activity.diagnostics.title')}>
            {isLoading ? (
              <Card surface="lowest" padding="none" aria-hidden="true" className="min-h-[120px] px-4 py-4">
                <div className="h-3 w-1/4 animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-surface-container)]" />
              </Card>
            ) : diagnostics.length === 0 ? (
              <Card surface="lowest" padding="none" className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                {t('settings.activity.diagnostics.allClear')}
              </Card>
            ) : (
              <Card surface="lowest" padding="none" className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-border)]">
                  {diagnostics.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span
                        aria-hidden="true"
                        className={cx(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          item.level === 'warn' ? 'bg-[var(--color-error)]' : 'bg-[var(--color-outline)]',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">{item.title}</span>
                        <span className="mt-0.5 block break-words font-mono text-[11px] text-[var(--color-text-tertiary)]">{item.detail}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                        {item.level === 'warn'
                          ? t('settings.activity.diagnostics.levelWarn')
                          : t('settings.activity.diagnostics.levelInfo')}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </SettingsSection>
        </>
      )}
    </div>
  )
}
