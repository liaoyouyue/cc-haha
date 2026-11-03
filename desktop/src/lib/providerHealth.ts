// desktop/src/lib/providerHealth.ts

import { providersApi } from '../api/providers'
import type { SavedProvider } from '../types/provider'

/** One model's probe outcome. `ok` false means the model cannot serve a request right now. */
export type ModelHealth = {
  modelId: string
  ok: boolean
  latencyMs: number
  error?: string
  httpStatus?: number
  /** True when the probe never finished (timeout or abort). */
  pending?: boolean
}

/** A provider's probe outcome, one entry per model that was probed. */
export type ProviderHealth = {
  providerId: string
  models: ModelHealth[]
  /** Set when the upstream model list could not be read; the slot models were still probed. */
  catalogError?: string
}

/** Probes run this many at a time. Upstreams rate-limit concurrent requests (429), and a
 *  wide burst would make every healthy model look broken. */
const PROBE_CONCURRENCY = 4

/** How many upstream models to probe. A gateway can expose hundreds; probing all of them
 *  takes minutes and tells the user nothing they will act on. */
const MAX_CATALOG_MODELS = 40

/**
 * The models to probe for one provider: every distinct id its slots point at, plus the
 * upstream catalog when it can be read. Slots come first because those are the models
 * actually in use; the catalog is only there to offer replacements for a dead one.
 */
export function collectProbeTargets(
  provider: SavedProvider,
  catalogModelIds: string[],
): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  const slotIds = [provider.models.main, provider.models.fable, provider.models.haiku, provider.models.sonnet, provider.models.opus]
  for (const id of slotIds) {
    const trimmed = id?.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      targets.push(trimmed)
    }
  }
  for (const id of catalogModelIds) {
    const trimmed = id?.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      targets.push(trimmed)
    }
  }
  return targets.slice(0, MAX_CATALOG_MODELS)
}

/** Reads the upstream model list. Returns the ids, or an error message the caller shows. */
export async function readCatalogModelIds(provider: SavedProvider): Promise<{ ids: string[]; error?: string }> {
  try {
    const result = await providersApi.fetchModels({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      ...(provider.proxy ? { proxy: provider.proxy } : {}),
    })
    if (!result.ok) return { ids: [], error: result.message }
    return { ids: result.models.map((model) => model.id) }
  } catch (error) {
    return { ids: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** Probes one model. Never throws: a failed probe is a result, not an exception. */
async function probeModel(providerId: string, modelId: string): Promise<ModelHealth> {
  try {
    const { result } = await providersApi.test(providerId, { modelId })
    const step = result.connectivity
    return {
      modelId,
      ok: step.success,
      latencyMs: step.latencyMs,
      error: step.error,
      httpStatus: step.httpStatus,
    }
  } catch (error) {
    return {
      modelId,
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Probes every target with a bounded number of concurrent requests and calls `onResult`
 * as each one lands, so the UI fills in progressively instead of waiting for the slowest.
 */
export async function probeProviderModels(
  providerId: string,
  modelIds: string[],
  onResult: (health: ModelHealth) => void,
  concurrency = PROBE_CONCURRENCY,
): Promise<ModelHealth[]> {
  const results: ModelHealth[] = []
  let next = 0
  const worker = async () => {
    while (next < modelIds.length) {
      const index = next++
      const health = await probeModel(providerId, modelIds[index]!)
      results.push(health)
      onResult(health)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, modelIds.length) }, worker))
  return results
}

/** The models worth switching to: healthy ones first, fastest first inside that group. */
export function rankHealthyModels(models: ModelHealth[]): ModelHealth[] {
  return models
    .filter((model) => model.ok)
    .sort((a, b) => a.latencyMs - b.latencyMs)
}

/** A one-line reason the model failed, phrased for a status line. */
export function describeModelFailure(health: ModelHealth): string {
  if (health.httpStatus === 429) return 'HTTP 429 — rate limited or out of quota'
  if (health.httpStatus === 403) return 'HTTP 403 — blocked or out of quota'
  if (health.httpStatus === 404) return 'HTTP 404 — model not served by this provider'
  if (health.httpStatus === 502) return 'HTTP 502 — upstream gateway error'
  if (health.error) return health.error
  return 'probe failed'
}
