import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

/**
 * The local LLM gateway keeps a per-request log, and on this machine it is the
 * only place that records how long a call took and whether it worked: the
 * transcript index stores tokens, never latency.
 *
 * It is a different population from every other sheet on the page, and the page
 * says so rather than mixing them:
 *   - it covers the gateway's own retention window, not the transcript history;
 *   - it is attributed to the upstream model the gateway actually served, not to
 *     the alias Claude Code asked for, so these rows cannot be joined onto the
 *     model leaderboard.
 * Rows with no latency are dropped from the percentiles and kept in the counts.
 */
const DEFAULT_GATEWAY_DB = join(homedir(), 'AI-Tools', 'freellmapi', 'server', 'data', 'freeapi.db')

/** The gateway also serves other clients; only Claude Code's own traffic is ours. */
const CLIENT_AGENT = 'claude-code'

/** Enough for any range the page offers, and a bound on a runaway query. */
const DEFAULT_DAYS = 14
const MAX_DAYS = 60

const SUCCESS_STATES = new Set(['success', 'ok'])

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
  /** Where the rows came from, so the page never has to guess. */
  source: string
  firstRequestAt: string | null
  lastRequestAt: string | null
  days: GatewayDay[]
  platforms: GatewayPlatformRow[]
}

type RequestRow = {
  day: string
  platform: string
  status: string
  latency_ms: number | null
}

/**
 * Nearest-rank percentile on an ascending array. Nearest-rank over an
 * interpolated one because "the 95th slowest call" is a thing that happened,
 * while the midpoint between two calls is not.
 */
function percentile(ascending: number[], fraction: number): number | null {
  if (ascending.length === 0) return null
  const rank = Math.ceil(fraction * ascending.length) - 1
  return ascending[Math.min(ascending.length - 1, Math.max(0, rank))]!
}

function summarise(rows: RequestRow[], date: string): GatewayDay {
  const latencies: number[] = []
  let succeeded = 0
  let failed = 0
  let canceled = 0

  for (const row of rows) {
    if (SUCCESS_STATES.has(row.status)) succeeded += 1
    else if (row.status === 'canceled') canceled += 1
    else failed += 1
    if (typeof row.latency_ms === 'number' && row.latency_ms > 0) latencies.push(row.latency_ms)
  }
  latencies.sort((left, right) => left - right)

  return {
    date,
    requests: rows.length,
    succeeded,
    failed,
    canceled,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
  }
}

/**
 * Reads the gateway's request log. Returns null — never a zero-filled object —
 * when the gateway is absent or its schema has moved on, so the page can render
 * "unavailable" instead of a flat line it did not measure.
 */
export function readGatewayActivity(
  dbPath: string,
  days: number,
  now: Date,
): GatewayActivity | null {
  if (!existsSync(dbPath)) return null

  const since = new Date(now.getTime() - days * 86_400_000)
  let db: Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    const rows = db
      .query(
        `SELECT date(created_at, 'localtime') AS day, platform, status, latency_ms
         FROM requests
         WHERE client_agent = ? AND created_at >= ?
         ORDER BY created_at`,
      )
      .all(CLIENT_AGENT, since.toISOString().slice(0, 19).replace('T', ' ')) as RequestRow[]

    if (rows.length === 0) {
      return { source: dbPath, firstRequestAt: null, lastRequestAt: null, days: [], platforms: [] }
    }

    const bounds = db
      .query('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM requests WHERE client_agent = ?')
      .get(CLIENT_AGENT) as { first: string | null; last: string | null }

    const byDay = new Map<string, RequestRow[]>()
    const byPlatform = new Map<string, RequestRow[]>()
    for (const row of rows) {
      byDay.set(row.day, [...(byDay.get(row.day) ?? []), row])
      byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row])
    }

    return {
      source: dbPath,
      firstRequestAt: bounds.first,
      lastRequestAt: bounds.last,
      days: [...byDay.entries()]
        .map(([date, dayRows]) => summarise(dayRows, date))
        .sort((left, right) => left.date.localeCompare(right.date)),
      platforms: [...byPlatform.entries()]
        .map(([platform, platformRows]) => {
          const summary = summarise(platformRows, platform)
          return {
            platform,
            requests: summary.requests,
            failed: summary.failed,
            latencyP50Ms: summary.latencyP50Ms,
          }
        })
        .sort((left, right) => right.requests - left.requests),
    }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/**
 * Registered as its own route rather than folded into `/api/activity-stats`:
 * that response is one range over one population, and these rows answer for a
 * different window and a different set of requests.
 */
export function handleGatewayActivityApi(req: Request, url: URL): Response {
  try {
    if (req.method !== 'GET') {
      throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    }

    const requested = Number.parseInt(url.searchParams.get('days') ?? `${DEFAULT_DAYS}`, 10)
    const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : DEFAULT_DAYS
    const dbPath = process.env.CC_HAHA_GATEWAY_DB || DEFAULT_GATEWAY_DB

    return Response.json({
      generatedAt: new Date().toISOString(),
      gateway: readGatewayActivity(dbPath, days, new Date()),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
