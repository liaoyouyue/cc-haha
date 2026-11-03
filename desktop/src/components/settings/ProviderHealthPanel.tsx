// desktop/src/components/settings/ProviderHealthPanel.tsx

import { useCallback, useRef, useState } from 'react'
import { Activity, CircleAlert, CircleCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useTranslation } from '../../i18n'
import {
  collectProbeTargets,
  describeModelFailure,
  probeProviderModels,
  readCatalogModelIds,
  rankHealthyModels,
  type ModelHealth,
} from '../../lib/providerHealth'
import type { SavedProvider } from '../../types/provider'

type Props = {
  provider: SavedProvider
  /** Applies a model to the provider's main slot. */
  onUseModel: (providerId: string, modelId: string) => void
}

/**
 * The provider's model-by-model health. Probes every model the provider can serve so a
 * dead upstream shows up as a failed row instead of a failed conversation.
 */
export function ProviderHealthPanel({ provider, onUseModel }: Props) {
  const t = useTranslation()
  const [healths, setHealths] = useState<ModelHealth[]>([])
  const [isProbing, setIsProbing] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const handleProbe = useCallback(async () => {
    setIsProbing(true)
    setHealths([])
    setCatalogError(null)
    const { ids, error } = await readCatalogModelIds(provider)
    if (error) setCatalogError(error)
    const targets = collectProbeTargets(provider, ids)
    await probeProviderModels(provider.id, targets, (health) => {
      if (!mountedRef.current) return
      setHealths((current) => [...current, health])
    })
    if (mountedRef.current) setIsProbing(false)
  }, [provider])

  const healthy = rankHealthyModels(healths)
  const failed = healths.filter((health) => !health.ok)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleProbe} loading={isProbing} disabled={isProbing}>
          <Activity size={14} />
          {t('settings.providers.healthCheck')}
        </Button>
        {isProbing ? <Spinner size={14} tone="brand" label={t('settings.providers.healthChecking')} /> : null}
      </div>

      {catalogError ? (
        <p className="text-[11px] text-[var(--color-error)]">{t('settings.providers.healthCatalogError', { error: catalogError })}</p>
      ) : null}

      {healths.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid={`provider-health-${provider.id}`}>
          {healths.map((health) => (
            <div key={health.modelId} className="flex items-center gap-2 text-[11px]" data-testid={`provider-health-row-${health.modelId}`}>
              {health.ok
                ? <CircleCheck size={13} className="shrink-0 text-[var(--color-success)]" />
                : <CircleAlert size={13} className="shrink-0 text-[var(--color-error)]" />}
              <span className="font-mono truncate">{health.modelId}</span>
              {health.ok ? (
                <>
                  <span className="text-[var(--color-text-tertiary)]">{t('settings.providers.healthLatency', { latency: String(health.latencyMs) })}</span>
                  {health.modelId !== provider.models.main ? (
                    <Button variant="ghost" size="sm" onClick={() => onUseModel(provider.id, health.modelId)}>
                      {t('settings.providers.healthUseAsMain')}
                    </Button>
                  ) : (
                    <Badge tone="brand">{t('settings.providers.default')}</Badge>
                  )}
                </>
              ) : (
                <span className="truncate text-[var(--color-error)]">{describeModelFailure(health)}</span>
              )}
            </div>
          ))}
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            {t('settings.providers.healthSummary', { ok: String(healthy.length), failed: String(failed.length) })}
          </p>
        </div>
      ) : null}
    </div>
  )
}
