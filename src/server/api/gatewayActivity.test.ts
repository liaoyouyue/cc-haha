import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGatewayActivity } from './gatewayActivity.js'

const dirs: string[] = []

function makeGatewayDb(rows: Array<[string, string, string, number | null, string | null]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-activity-'))
  dirs.push(dir)
  const path = join(dir, 'freeapi.db')
  const db = new Database(path)
  db.run(`CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL,
    client_agent TEXT
  )`)
  const insert = db.prepare(
    'INSERT INTO requests (platform, model_id, status, latency_ms, created_at, client_agent) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const [platform, status, createdAt, latency, agent] of rows) {
    insert.run(platform, 'upstream/model', status, latency, createdAt, agent)
  }
  db.close()
  return path
}

afterEach(() => {
  // Best effort: Windows keeps the file busy for a moment after SQLite closes
  // it, and a leftover temp dir is not worth failing the suite over.
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignored
    }
  }
})

describe('readGatewayActivity', () => {
  test('returns null rather than a zero-filled window when the gateway is absent', () => {
    expect(readGatewayActivity(join(tmpdir(), 'definitely-not-here', 'freeapi.db'), 14, new Date())).toBeNull()
  })

  test('counts outcomes, keeps canceled apart from failures, and drops rows with no latency', () => {
    const day = '2026-10-15'
    const path = makeGatewayDb([
      ['kilo', 'success', `${day} 01:00:00`, 100, 'claude-code'],
      ['kilo', 'ok', `${day} 02:00:00`, 200, 'claude-code'],
      ['kilo', 'error', `${day} 03:00:00`, 300, 'claude-code'],
      ['kilo', 'canceled', `${day} 04:00:00`, 400, 'claude-code'],
      ['kilo', 'success', `${day} 05:00:00`, null, 'claude-code'],
      // Another client's traffic must never be counted as ours.
      ['kilo', 'error', `${day} 06:00:00`, 999, 'openai-sdk'],
    ])
    const result = readGatewayActivity(path, 14, new Date('2026-10-16T12:00:00Z'))

    expect(result).not.toBeNull()
    const day0 = result!.days.find((entry) => entry.date === day)!
    expect(day0.requests).toBe(5)
    expect(day0.succeeded).toBe(3)
    expect(day0.failed).toBe(1)
    expect(day0.canceled).toBe(1)
    // Nearest rank over the four rows that recorded a latency.
    expect(day0.latencyP50Ms).toBe(200)
    expect(day0.latencyP95Ms).toBe(400)
  })

  test('splits days and platforms, and bounds the window', () => {
    const path = makeGatewayDb([
      ['kilo', 'success', '2026-10-15 01:00:00', 100, 'claude-code'],
      ['openrouter', 'error', '2026-10-15 02:00:00', 900, 'claude-code'],
      ['kilo', 'success', '2026-10-14 01:00:00', 50, 'claude-code'],
      // Older than the window.
      ['kilo', 'success', '2026-09-01 01:00:00', 10, 'claude-code'],
    ])
    const result = readGatewayActivity(path, 3, new Date('2026-10-16T12:00:00Z'))!

    expect(result.days.map((entry) => entry.date)).toEqual(['2026-10-14', '2026-10-15'])
    expect(result.platforms[0]).toMatchObject({ platform: 'kilo', requests: 2, failed: 0 })
    expect(result.platforms[1]).toMatchObject({ platform: 'openrouter', requests: 1, failed: 1 })
    expect(result.firstRequestAt).toBe('2026-09-01 01:00:00')
  })
})
