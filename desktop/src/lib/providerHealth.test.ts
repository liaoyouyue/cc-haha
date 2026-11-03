import { describe, expect, it, vi, beforeEach } from 'vitest'
import { providersApi } from '../api/providers'
import {
  collectProbeTargets,
  describeModelFailure,
  probeProviderModels,
  rankHealthyModels,
  readCatalogModelIds,
} from './providerHealth'
import type { SavedProvider } from '../types/provider'

const provider: SavedProvider = {
  id: 'p1',
  presetId: 'custom',
  name: 'Gateway',
  baseUrl: 'http://127.0.0.1:3425/v1',
  apiKey: 'magpie',
  apiFormat: 'anthropic',
  models: { main: 'model-a', haiku: 'model-a', sonnet: 'model-b', opus: 'model-b' },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('collectProbeTargets', () => {
  it('lists each slot model once, slots first', () => {
    const targets = collectProbeTargets(provider, ['model-c', 'model-a'])
    expect(targets).toEqual(['model-a', 'model-b', 'model-c'])
  })

  it('keeps every catalog model the slots do not name', () => {
    const targets = collectProbeTargets(provider, ['model-c', 'model-d'])
    expect(targets).toContain('model-c')
    expect(targets).toContain('model-d')
    expect(targets).toHaveLength(4)
  })
})

describe('readCatalogModelIds', () => {
  it('returns the upstream model ids', async () => {
    vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: true,
      endpoint: 'http://127.0.0.1:3425/v1/models',
      models: [{ id: 'model-a' }, { id: 'model-z' }],
    })
    const result = await readCatalogModelIds(provider)
    expect(result.ids).toEqual(['model-a', 'model-z'])
    expect(result.error).toBeUndefined()
  })

  it('reports an upstream failure as an error instead of throwing', async () => {
    vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: false,
      errorCode: 'auth-failed',
      message: '401 unauthorized',
      endpointsTried: [],
    })
    const result = await readCatalogModelIds(provider)
    expect(result.ids).toEqual([])
    expect(result.error).toBe('401 unauthorized')
  })
})

describe('probeProviderModels', () => {
  it('probes every model and reports each result', async () => {
    vi.spyOn(providersApi, 'test').mockImplementation(async (_id, overrides) => ({
      result: {
        connectivity: {
          success: overrides?.modelId !== 'bad',
          latencyMs: overrides?.modelId === 'good' ? 42 : 0,
          error: overrides?.modelId === 'bad' ? 'HTTP 429' : undefined,
          httpStatus: overrides?.modelId === 'bad' ? 429 : 200,
        },
      },
    }))
    const seen: string[] = []
    const results = await probeProviderModels('p1', ['good', 'bad'], (health) => seen.push(health.modelId))
    expect(seen).toHaveLength(2)
    expect(results).toHaveLength(2)
    const good = results.find((r) => r.modelId === 'good')
    const bad = results.find((r) => r.modelId === 'bad')
    expect(good!.ok).toBe(true)
    expect(good!.latencyMs).toBe(42)
    expect(bad!.ok).toBe(false)
    expect(bad!.httpStatus).toBe(429)
  })

  it('turns a thrown probe into a failed result rather than rejecting', async () => {
    vi.spyOn(providersApi, 'test').mockRejectedValue(new Error('network down'))
    const results = await probeProviderModels('p1', ['x'], () => {})
    expect(results[0]!.ok).toBe(false)
    expect(results[0]!.error).toBe('network down')
  })

  it('never runs more than the concurrency limit at once', async () => {
    let running = 0
    let peak = 0
    vi.spyOn(providersApi, 'test').mockImplementation(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return { result: { connectivity: { success: true, latencyMs: 1 } } }
    })
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`)
    await probeProviderModels('p1', ids, () => {}, 4)
    expect(peak).toBeLessThanOrEqual(4)
  })
})

describe('rankHealthyModels', () => {
  it('keeps only healthy models, fastest first', () => {
    const ranked = rankHealthyModels([
      { modelId: 'slow', ok: true, latencyMs: 900 },
      { modelId: 'dead', ok: false, latencyMs: 0 },
      { modelId: 'fast', ok: true, latencyMs: 40 },
    ])
    expect(ranked.map((m) => m.modelId)).toEqual(['fast', 'slow'])
  })
})

describe('describeModelFailure', () => {
  it('names the quota and rate-limit statuses', () => {
    expect(describeModelFailure({ modelId: 'm', ok: false, latencyMs: 0, httpStatus: 429 })).toContain('429')
    expect(describeModelFailure({ modelId: 'm', ok: false, latencyMs: 0, httpStatus: 403 })).toContain('403')
  })

  it('falls back to the raw error when there is no status', () => {
    expect(describeModelFailure({ modelId: 'm', ok: false, latencyMs: 0, error: 'boom' })).toBe('boom')
  })
})
