import { TriangleAlert } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { ActionEvidenceIssue } from '../../lib/actionEvidence'

/**
 * 这句结论声称「已经做完了」，但整轮没有任何成功落地的写操作 —— 白龙马那套
 * 行动证据契约的可见部分：不拦模型发话，只把「口说无凭」摆到用户眼前。
 */
export function ActionEvidenceNotice({ issue }: { issue: ActionEvidenceIssue }) {
  const t = useTranslation()

  return (
    <div
      role="status"
      data-action-evidence
      className="mt-2 flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] px-3 py-1.5 text-[11px] leading-snug text-[var(--color-on-warning-container)]"
    >
      <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {t('chat.actionEvidenceWarning', { claims: issue.claims.join(' / ') })}
      </span>
    </div>
  )
}
