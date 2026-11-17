import { useState, useRef } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '../../i18n'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamMember } from '../../types/team'

/**
 * 群聊输入框：开头 `@成员名` 定向发送，否则全员广播。
 */
export function AgentTeamsGroupComposer({
  teamName,
  members,
}: {
  teamName: string
  members: TeamMember[]
}) {
  const t = useTranslation()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    // 解析开头 @ 目标：第一个 @ 后到空格的 token 是成员名
    let to: string | undefined
    let cleanBody = body
    if (body.startsWith('@')) {
      const rest = body.slice(1)
      const spaceIdx = rest.search(/\s/)
      const token = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)
      const matched = members.find(m => m.name && m.name.toLowerCase() === token.toLowerCase())
      if (matched?.name) {
        to = matched.name
        cleanBody = (spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1)).trim()
      }
    }
    if (!cleanBody) return
    setSending(true)
    setError(null)
    try {
      await useTeamStore.getState().sendTeamMessage(teamName, cleanBody, to)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2" data-testid="agent-teams-group-composer">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={t('agentTeams.group.placeholder')}
          className="min-h-[40px] max-h-[120px] w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-border-focus)]"
          rows={1}
          data-testid="agent-teams-group-input"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
          data-testid="agent-teams-group-send"
        >
          <Send size={14} strokeWidth={2} aria-hidden="true" />
          <span>{t('agentTeams.group.send')}</span>
        </Button>
      </div>
      {error && (
        <div className="mt-1 text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
