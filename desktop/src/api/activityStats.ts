import { api } from './client'

export type ActivityStatsRange = '7d' | '30d' | 'all'

export type DailyActivity = {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export type DailyModelTokens = {
  date: string
  tokensByModel: Record<string, number>
}

export type StreakInfo = {
  currentStreak: number
  longestStreak: number
  currentStreakStart: string | null
  longestStreakStart: string | null
  longestStreakEnd: string | null
}

export type SessionStats = {
  sessionId: string
  duration: number
  messageCount: number
  timestamp: string
}

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  webSearchRequests?: number
  /** Estimated dollars. Always 0 for models listed in `unpricedModels`. */
  costUSD?: number
}

export type ActivityStats = {
  totalSessions: number
  totalMessages: number
  totalDays: number
  activeDays: number
  streaks: StreakInfo
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  longestSession: SessionStats | null
  modelUsage: Record<string, ModelUsage>
  /**
   * Models whose tokens count toward the totals but whose dollars don't, because no published
   * rates exist for them (third-party providers). The cost figure is a floor when this is
   * non-empty, and the UI has to say so rather than presenting it as the whole bill.
   */
  unpricedModels?: string[]
  toolUsage: Record<string, number>
  skillUsage: Record<string, number>
  firstSessionDate: string | null
  lastSessionDate: string | null
  peakActivityDay: string | null
  peakActivityHour: number | null
  totalSpeculationTimeSavedMs: number
}

/**
 * One day of one model's spend. The per-day grain is what lets the model sheet
 * re-filter a new range without another round trip: the whole window arrives
 * once and is narrowed in the browser.
 */
export type DailyModelUsage = {
  date: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

/**
 * One day of one project. `projectPath` is the sanitized transcript directory
 * name and is the stable key; `projectName` is a display label derived from it
 * (and therefore approximate — the sanitizer is lossy).
 */
export type ProjectUsage = {
  date: string
  projectPath: string
  projectName: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

/**
 * One parent session with its subagents rolled in. `hasMainSession` is false for
 * sessions that exist only as subagent transcripts — their token totals are
 * real, but duration and message count were never recorded, so they render as
 * unmeasured rather than zero.
 */
export type SessionUsage = {
  sessionId: string
  projectPath: string
  projectName: string
  hasMainSession: boolean
  startedAt: string
  activeDurationMs: number
  messageCount: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

/**
 * `null` means the local index could not answer — it is disabled, still
 * building, or the read fell back to the JSONL scan, which has no per-project
 * or per-session token grain. It is never an empty array standing in for
 * "unknown", so the page can tell the two apart and say so.
 */
export type ActivityStatsAddOns = {
  dailyModelUsage: DailyModelUsage[] | null
  projectUsage: ProjectUsage[] | null
  sessionUsage: SessionUsage[] | null
  /**
   * Sessions started in each **local** hour, keyed "0"–"23" (every hour present,
   * zero when unused). `null` means the local index could not answer, so the
   * hourly chart hides instead of drawing a flat line it did not measure.
   */
  hourCounts: Record<string, number> | null
}

export type ActivityStatsApiResponse = {
  stats: ActivityStats
  range: ActivityStatsRange
  generatedAt: string
} & Partial<ActivityStatsAddOns>

export type ActivityStatsResponse = ActivityStats & {
  range: ActivityStatsRange
  generatedAt: string
} & Required<ActivityStatsAddOns>

/**
 * Latency and outcomes as the local LLM gateway recorded them. A different
 * population from everything above: the gateway's own retention window, keyed
 * by the upstream model it served, never joined onto the model leaderboard.
 * `null` means the gateway is absent or unreadable — not an empty window.
 */
export type GatewayDay = {
  date: string
  requests: number
  succeeded: number
  failed: number
  canceled: number
  latencyP50Ms: number | null
  latencyP95Ms: number | null
}

export type GatewayPlatformRow = {
  platform: string
  requests: number
  failed: number
  latencyP50Ms: number | null
}

export type GatewayActivity = {
  source: string
  firstRequestAt: string | null
  lastRequestAt: string | null
  days: GatewayDay[]
  platforms: GatewayPlatformRow[]
}

export const gatewayActivityApi = {
  async get(days = 14): Promise<GatewayActivity | null> {
    const response = await api.get<{ gateway: GatewayActivity | null }>(`/api/gateway-activity?days=${days}`)
    return response.gateway ?? null
  },
}

export const activityStatsApi = {
  async getStats(range: ActivityStatsRange = 'all'): Promise<ActivityStatsResponse> {
    const suffix = range === 'all' ? '' : `/${range}`
    const response = await api.get<ActivityStatsApiResponse>(`/api/activity-stats${suffix}`, { timeout: 120_000 })
    return {
      ...response.stats,
      range: response.range,
      generatedAt: response.generatedAt,
      // A sidecar that predates these fields omits the keys entirely; collapsing
      // that into the same null the new sidecar sends keeps one unavailable path
      // in the page instead of two.
      dailyModelUsage: response.dailyModelUsage ?? null,
      projectUsage: response.projectUsage ?? null,
      sessionUsage: response.sessionUsage ?? null,
      hourCounts: response.hourCounts ?? null,
    }
  },
}
