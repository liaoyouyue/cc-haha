import { BookMarked } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { memoryFileLabel, type MemoryHitSummary } from '../../lib/memoryHits'

/**
 * 本轮碰过记忆时的可见汇总（读到的 / 写进去的 / 加载失败的）。白龙马那套
 * 记忆注入信号的可视化：一串数字 + 文件名摆在收尾回复下面，省得展开工具分组。
 */
export function MemoryHitNotice({ summary }: { summary: MemoryHitSummary }) {
  const t = useTranslation()

  const parts: string[] = []
  if (summary.referenced.length > 0) {
    parts.push(t('chat.memoryHitsReferenced', { count: summary.referenced.length }))
  }
  if (summary.saved.length > 0) {
    parts.push(t('chat.memoryHitsSaved', { count: summary.saved.length }))
  }
  if (summary.loaded > 0) {
    parts.push(t('chat.memoryHitsLoaded', { count: summary.loaded }))
  }
  if (summary.failed > 0) {
    parts.push(t('chat.memoryHitsFailed', { count: summary.failed }))
  }

  const labels = [...summary.referenced, ...summary.saved].map(memoryFileLabel)
  const visible = labels.slice(0, 4)
  const hiddenCount = labels.length - visible.length

  return (
    <div
      role="status"
      data-memory-hits
      className="mt-2 flex w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-memory-border)] bg-[var(--color-memory-surface)] px-3 py-1.5 text-[11px] leading-snug"
    >
      <BookMarked size={13} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-[var(--color-memory-accent)]" />
      <span className="font-medium text-[var(--color-text-secondary)]">{t('chat.memoryHitsTitle')}</span>
      <span className="text-[var(--color-text-tertiary)]">{parts.join(' · ')}</span>
      {visible.map((label) => (
        <span
          key={label}
          className="rounded-[var(--radius-sm)] border border-[var(--color-memory-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-secondary)]"
        >
          {label}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
          {t('chat.memoryMoreFiles', { count: hiddenCount })}
        </span>
      ) : null}
    </div>
  )
}
