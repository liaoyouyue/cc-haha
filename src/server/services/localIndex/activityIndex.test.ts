import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalIndexDatabase } from './database.js'
import { createActivityIndex } from './activityIndex.js'
import type { LocalIndexDatabase } from './database.js'

const tempDirs: string[] = []
const openDatabases: LocalIndexDatabase[] = []

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    try {
      database.close()
    } catch {
      // A locked temp file must not fail the assertions that already ran.
    }
  }
  for (const directory of tempDirs.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true })
    } catch {
      // Windows can hold the sqlite handle briefly; the OS temp dir is disposable.
    }
  }
})

/**
 * Fixed clock so the range predicates are deterministic: `now` also dates the
 * "today" half of the all-time predicate, and a real clock would make these
 * assertions expire.
 */
const NOW = new Date('2026-05-10T12:00:00.000Z')

/**
 * A real mtime, not epoch 0: the bounded-range predicate gates whole sources on
 * it, so seeding 1 would make every range test pass for the wrong reason.
 */
const MTIME_MS = Date.parse('2026-05-09T12:00:00.000Z')

type SourceSeed = {
  path: string
  sessionId: string
  projectPath: string
  isSubagent: boolean
}

type SessionSeed = {
  path: string
  sessionId: string
  firstTimestamp: string
  activeDurationMs: number
  messageCount: number
}

type DailySeed = {
  path: string
  date: string
  messageCount: number
  toolCallCount: number
}

type ModelSeed = {
  path: string
  date: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUSD: number
}

const SOURCES: SourceSeed[] = [
  // Project A: one main transcript plus a subagent transcript that shares its
  // parent_session_id — the case that must not be counted twice.
  { path: '/p/a/s1.jsonl', sessionId: 's1', projectPath: 'C--proj-a', isSubagent: false },
  { path: '/p/a/s1/subagents/a1.jsonl', sessionId: 's1', projectPath: 'C--proj-a', isSubagent: true },
  { path: '/p/b/s2.jsonl', sessionId: 's2', projectPath: 'C--proj-b', isSubagent: false },
  // A parent that exists only as subagent transcripts. These hold most of the
  // spend on a real machine, and a main-transcript-only grouping hid all of it.
  { path: '/p/b/s3/subagents/a2.jsonl', sessionId: 's3', projectPath: 'C--proj-b', isSubagent: true },
]

const SESSIONS: SessionSeed[] = [
  { path: '/p/a/s1.jsonl', sessionId: 's1', firstTimestamp: '2026-05-08T10:00:00.000Z', activeDurationMs: 3_600_000, messageCount: 10 },
  { path: '/p/a/s1/subagents/a1.jsonl', sessionId: 's1', firstTimestamp: '2026-05-08T11:00:00.000Z', activeDurationMs: 600_000, messageCount: 2 },
  { path: '/p/b/s2.jsonl', sessionId: 's2', firstTimestamp: '2026-05-09T09:00:00.000Z', activeDurationMs: 1_800_000, messageCount: 5 },
  { path: '/p/b/s3/subagents/a2.jsonl', sessionId: 's3', firstTimestamp: '2026-05-09T10:00:00.000Z', activeDurationMs: 300_000, messageCount: 3 },
]

const DAILY: DailySeed[] = [
  { path: '/p/a/s1.jsonl', date: '2026-04-20', messageCount: 1, toolCallCount: 1 },
  { path: '/p/a/s1.jsonl', date: '2026-05-08', messageCount: 6, toolCallCount: 3 },
  { path: '/p/a/s1.jsonl', date: '2026-05-09', messageCount: 4, toolCallCount: 2 },
  { path: '/p/a/s1/subagents/a1.jsonl', date: '2026-05-08', messageCount: 2, toolCallCount: 1 },
  { path: '/p/b/s2.jsonl', date: '2026-05-09', messageCount: 5, toolCallCount: 4 },
  { path: '/p/b/s3/subagents/a2.jsonl', date: '2026-05-09', messageCount: 3, toolCallCount: 0 },
]

const MODELS: ModelSeed[] = [
  { path: '/p/a/s1.jsonl', date: '2026-04-20', model: 'm1', input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0, costUSD: 0.1 },
  { path: '/p/a/s1.jsonl', date: '2026-05-08', model: 'm1', input: 100, output: 10, cacheRead: 1_000, cacheWrite: 5, costUSD: 0.5 },
  { path: '/p/a/s1.jsonl', date: '2026-05-09', model: 'm1', input: 200, output: 20, cacheRead: 2_000, cacheWrite: 0, costUSD: 1 },
  { path: '/p/a/s1/subagents/a1.jsonl', date: '2026-05-08', model: 'm1', input: 7, output: 1, cacheRead: 0, cacheWrite: 0, costUSD: 0.1 },
  { path: '/p/b/s2.jsonl', date: '2026-05-09', model: 'm2', input: 300, output: 30, cacheRead: 0, cacheWrite: 0, costUSD: 0 },
  { path: '/p/b/s3/subagents/a2.jsonl', date: '2026-05-09', model: 'm2', input: 500, output: 50, cacheRead: 0, cacheWrite: 0, costUSD: 0 },
]

/** The 04-20 row sits outside a 7-day window ending 2026-05-10. */
const OLD_TOKENS = 1_100

const TOTAL_TOKENS = MODELS.reduce(
  (sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite,
  0,
)

async function seedIndex() {
  const directory = await mkdtemp(join(tmpdir(), 'cc-haha-activity-reads-'))
  tempDirs.push(directory)
  const database = openLocalIndexDatabase({ path: join(directory, 'index-v1.sqlite') })
  openDatabases.push(database)

  database.write(operation => {
    for (const source of SOURCES) {
      operation.run(`
        INSERT INTO activity_sources (
          path, parent_session_id, project_path, is_subagent, size_bytes, mtime_ms,
          file_identity, prefix_hash, indexed_bytes, parser_version, state,
          last_error_code, updated_at_ms
        ) VALUES (?, ?, ?, ?, 1, ?, NULL, 'hash', 0, 1, 'ready', NULL, 1)
      `, source.path, source.sessionId, source.projectPath, source.isSubagent ? 1 : 0, MTIME_MS)
      operation.run(`
        INSERT INTO activity_sessions (
          transcript_path, session_id, first_timestamp, last_timestamp,
          duration_ms, active_duration_ms, message_count, start_hour,
          speculation_time_saved_ms, shot_count
        ) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, 0, NULL)
      `, source.path, source.sessionId, SESSIONS.find(s => s.path === source.path)?.firstTimestamp ?? null,
      SESSIONS.find(s => s.path === source.path)?.firstTimestamp ?? null,
      SESSIONS.find(s => s.path === source.path)?.activeDurationMs ?? 0,
      SESSIONS.find(s => s.path === source.path)?.messageCount ?? 0)
    }

    for (const day of DAILY) {
      operation.run(`
        INSERT INTO activity_daily (transcript_path, date, message_count, tool_call_count)
        VALUES (?, ?, ?, ?)
      `, day.path, day.date, day.messageCount, day.toolCallCount)
    }

    for (const row of MODELS) {
      operation.run(`
        INSERT INTO activity_daily_models (
          transcript_path, date, model, input_tokens, output_tokens,
          cache_read_input_tokens, cache_creation_input_tokens,
          web_search_requests, cost_usd, context_window, max_output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)
      `, row.path, row.date, row.model, row.input, row.output,
      row.cacheRead, row.cacheWrite, row.costUSD)
    }
  })

  return createActivityIndex(database)
}

function totalOf(row: {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}) {
  return row.inputTokens + row.outputTokens +
    row.cacheReadInputTokens + row.cacheCreationInputTokens
}

/** Row shape shared by the three grains, for the range-consistency assertions. */
function firstOf(rows: Array<Parameters<typeof totalOf>[0]>) {
  return rows[0] as Parameters<typeof totalOf>[0]
}

describe('activity index Token Intelligence reads', () => {
  it('keeps the four token dimensions separate per day and model', async () => {
    const index = await seedIndex()
    const rows = index.aggregateDailyModelUsage('all', NOW)

    // One row per (day, model): the main transcript and its subagent both billed
    // m1 on 05-08, so they merge there rather than staying two rows.
    expect(rows).toHaveLength(4)
    const first = rows.find(row => row.date === '2026-05-08' && row.model === 'm1')!
    expect(first.inputTokens).toBe(107)
    expect(first.outputTokens).toBe(11)
    expect(first.cacheReadInputTokens).toBe(1_000)
    expect(first.cacheCreationInputTokens).toBe(5)
    expect(first.costUSD).toBeCloseTo(0.6, 6)
  })

  it('sums project tokens once even when a project spans several models and transcripts', async () => {
    const index = await seedIndex()
    const rows = index.aggregateProjectUsage('all', NOW)

    const projectA = rows.filter(row => row.projectPath === 'C--proj-a')
    const projectB = rows.filter(row => row.projectPath === 'C--proj-b')
    expect(projectA).toHaveLength(3)
    expect(projectB).toHaveLength(1)

    // The model rows fan out per transcript, the activity rows do not: a join
    // between them would have multiplied these counts by the model count. Both
    // of this project's parents, main and subagent-only, land on 05-09.
    expect(projectA.reduce((sum, row) => sum + row.sessionCount, 0)).toBe(3)
    expect(projectB[0]!.sessionCount).toBe(2)

    expect(projectA.reduce((sum, row) => sum + row.messageCount, 0)).toBe(13)
    expect(projectA.reduce((sum, row) => sum + row.toolCallCount, 0)).toBe(7)

    expect(rows.reduce((sum, row) => sum + totalOf(row), 0)).toBe(TOTAL_TOKENS)
    expect(projectA.reduce((sum, row) => sum + row.costUSD, 0)).toBeCloseTo(1.7, 6)
  })

  it('folds subagent transcripts into their parent session without inflating its duration', async () => {
    const index = await seedIndex()
    const rows = index.aggregateSessionUsage('all', NOW)

    // Ranked by total tokens, largest first: s1 4443, s3 550, s2 330.
    expect(rows.map(row => row.sessionId)).toEqual(['s1', 's3', 's2'])

    const s1 = rows[0]!
    expect(totalOf(s1)).toBe(4_443)
    // Worked time comes from the main transcript only — the subagent's extra
    // 10 minutes are its own, and adding them would double-count the parent's
    // wall clock.
    expect(s1.activeDurationMs).toBe(3_600_000)
    expect(s1.projectPath).toBe('C--proj-a')
    expect(s1.startedAt).toBe('2026-05-08T10:00:00.000Z')
    expect(s1.hasMainSession).toBe(true)
  })

  it('still lists a session that exists only as subagent transcripts', async () => {
    const index = await seedIndex()
    const s3 = index.aggregateSessionUsage('all', NOW).find(row => row.sessionId === 's3')!

    // Its spend is real and must be counted, but duration and message count were
    // never written, so the flag is what stops the sheet printing a 0m as if the
    // session had run instantaneously.
    expect(totalOf(s3)).toBe(550)
    expect(s3.hasMainSession).toBe(false)
    expect(s3.activeDurationMs).toBe(0)
    expect(s3.messageCount).toBe(0)
    expect(s3.projectPath).toBe('C--proj-b')
  })

  it('agrees across the three grains, so no token is counted twice or dropped', async () => {
    const index = await seedIndex()
    const byProject = index.aggregateProjectUsage('all', NOW)
      .reduce((sum, row) => sum + totalOf(row), 0)
    const bySession = index.aggregateSessionUsage('all', NOW)
      .reduce((sum, row) => sum + totalOf(row), 0)
    const byDay = index.aggregateDailyModelUsage('all', NOW)
      .reduce((sum, row) => sum + totalOf(row), 0)

    expect(byProject).toBe(TOTAL_TOKENS)
    expect(bySession).toBe(TOTAL_TOKENS)
    expect(byDay).toBe(TOTAL_TOKENS)
  })

  it('drops the same rows from every grain when the range is bounded', async () => {
    const index = await seedIndex()
    const at = (rows: Array<ReturnType<typeof firstOf>>) =>
      rows.reduce((sum, row) => sum + totalOf(row), 0)

    // The 04-20 row falls outside the window and must leave every grain, not
    // just the one the chart happens to read.
    expect(at(index.aggregateDailyModelUsage('7d', NOW))).toBe(TOTAL_TOKENS - OLD_TOKENS)
    expect(at(index.aggregateProjectUsage('7d', NOW))).toBe(TOTAL_TOKENS - OLD_TOKENS)
    expect(at(index.aggregateSessionUsage('7d', NOW))).toBe(TOTAL_TOKENS - OLD_TOKENS)
  })

  it('honours the session limit and keeps the largest sessions', async () => {
    const index = await seedIndex()
    const rows = index.aggregateSessionUsage('all', NOW, 1)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.sessionId).toBe('s1')
  })
})
