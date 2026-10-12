import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { runDoctorCheck } from '../../lib/doctorRepair'
import { summarizeStartupHealth, type StartupHealthSummary } from '../../lib/startupHealth'
import { useTranslation } from '../../i18n'

// 健康自检的启动卡片：安静地报一句结论，坏了才抢眼。
const LEVEL_STYLES = {
  ok: { Icon: CircleCheck, className: 'text-[var(--color-success)]' },
  warn: { Icon: TriangleAlert, className: 'text-[var(--color-warning)]' },
  error: { Icon: CircleX, className: 'text-[var(--color-error)]' },
} as const

export function StartupHealthCard() {
  const t = useTranslation()
  const [summary, setSummary] = useState<StartupHealthSummary | null>(null)

  useEffect(() => {
    let active = true
    // Boot budget: this machine's first doctor pass measured 2-4s, so the
    // interactive 3s default reported a false "unavailable" on every launch.
    runDoctorCheck({ timeout: 20_000 })
      .then((report) => {
        if (active) setSummary(summarizeStartupHealth(report))
      })
      .catch(() => {
        if (active) setSummary(summarizeStartupHealth(null, true))
      })
    return () => {
      active = false
    }
  }, [])

  if (!summary) return null

  const { Icon, className } = LEVEL_STYLES[summary.level]
  const detail = summary.unavailable
    ? t('startup.healthUnavailable')
    : summary.invalid > 0
      ? t('startup.healthError', { count: summary.invalid })
      : summary.missing > 0
        ? t('startup.healthWarn', { count: summary.missing })
        : t('startup.healthOk')

  return (
    <div
      role="status"
      data-startup-health={summary.level}
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-1 text-xs text-[var(--color-text-secondary)]"
    >
      <Icon size={13} strokeWidth={2.2} aria-hidden="true" className={`shrink-0 ${className}`} />
      <span className="whitespace-nowrap">
        <span className="text-[var(--color-text-tertiary)]">{t('startup.healthTitle')}</span>
        {' · '}
        {detail}
      </span>
    </div>
  )
}
