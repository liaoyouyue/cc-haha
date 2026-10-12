import type { UIMessage } from '../types/chat'

/**
 * 「行动证据契约」：一句话里声称「已经做完了」，但这一轮没有任何成功落地的
 * 工具调用 —— 就是假完成。抄白龙马（BaiLongma）的 action-contract：模型嘴上
 * 说文件建好了，实际 Write 报错、或者压根没调工具。
 *
 * 只做「这一轮的结论句」判定，跟 turnCompletion 同一套回合切分，避免把追问
 * 半路的一句过渡语当成结论。
 */
export type ActionEvidenceIssue = {
  /** 结论里出现的完成措辞原文，去重后最多若干条，用于界面提示。 */
  claims: string[]
  /** 这一轮成功落地的工具名（去重）。为空即整轮没有有效动作。 */
  evidenceTools: string[]
}

/**
 * 纯观察类工具不算「做过」。一轮只 Read/Grep 了一圈然后说「已完成」，恰恰
 * 是要拦下来的假完成，所以它们不构成证据。
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'TodoRead',
  'TodoWrite',
  'TaskList',
  'TaskGet',
  'AskUserQuestion',
  'ExitPlanMode',
  'EnterPlanMode',
  'SlashCommand',
])

/**
 * 完成措辞。
 *
 * 中文锚在「已 + 动词」，不单收「完成」两个字，否则「如果完成了」「完成度」
 * 这类描述会误报。第一人称英文用现在完成时/被动式，「X was added in v2」这种
 * 陈述不会命中 —— 否则纯问答轮次会被大量误伤。
 */
const CLAIM_PATTERNS: RegExp[] = [
  /已(?:完成|创建|新建|写入|保存|修改|删除|安装|配置|生成|更新|添加|修复|提交|部署|上传|下载|执行|替换|重命名|迁移|建立|写|改|建|删|做)[了掉]?/g,
  /(?:搞定|弄好|做好|写好|建好|改好|装好|修好|跑通|跑起来)(?:了)?/g,
  /(?:\bI(?:'ve| have)\s+|\bit(?:'s| is)\s+now\s+|\b(?:has|have) been\s+)(?:created|written|saved|modified|deleted|installed|configured|generated|updated|added|completed|fixed|committed|deployed|renamed|migrated)\b/gi,
]

const MAX_CLAIMS = 5

/** 从一段结论里摘出完成措辞；同一措辞只留一条。 */
export function extractCompletionClaims(text: string): string[] {
  if (!text) return []
  const claims: string[] = []
  const seen = new Set<string>()
  for (const pattern of CLAIM_PATTERNS) {
    // 带 /g 的正则会在多次 lastIndex 之间共享状态，逐段设回 0。
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const phrase = match[0].trim()
      if (!phrase || seen.has(phrase)) continue
      seen.add(phrase)
      claims.push(phrase)
      if (claims.length >= MAX_CLAIMS) return claims
    }
  }
  return claims
}

type OpenTurn = {
  lastAssistantTextId: string | null
  lastAssistantClaims: string[]
  hasWorkAfterLastReply: boolean
  toolNameByUseId: Map<string, string>
  evidenceTools: Set<string>
}

function startTurn(): OpenTurn {
  return {
    lastAssistantTextId: null,
    lastAssistantClaims: [],
    hasWorkAfterLastReply: false,
    toolNameByUseId: new Map(),
    evidenceTools: new Set(),
  }
}

function isTurnStart(message: UIMessage): boolean {
  return message.type === 'user_text' && message.pending !== true && message.optimisticQueued !== true
}

/** 挂在回合尾巴上的附加卡片不是回合进展（与 turnCompletion 一致）。 */
function isTrailingCard(message: UIMessage): boolean {
  return message.type === 'task_summary' || message.type === 'background_task'
}

function flushTurn(turn: OpenTurn, issues: Map<string, ActionEvidenceIssue>): void {
  if (!turn.lastAssistantTextId) return
  if (turn.hasWorkAfterLastReply) return
  if (turn.evidenceTools.size > 0) return
  if (turn.lastAssistantClaims.length === 0) return
  issues.set(turn.lastAssistantTextId, {
    claims: turn.lastAssistantClaims,
    evidenceTools: [],
  })
}

/**
 * 找出每一轮「声称完成但没有落地证据」的结论句，挂到那条助手回复的 id 上。
 * `turnActive` 为真时最后一轮不产出：它还在跑，此刻下结论是误判。
 */
export function buildActionEvidenceByMessageId(
  messages: UIMessage[],
  options: { turnActive?: boolean } = {},
): Map<string, ActionEvidenceIssue> {
  const issues = new Map<string, ActionEvidenceIssue>()
  let current: OpenTurn | null = null

  for (const message of messages) {
    if (isTurnStart(message)) {
      if (current) flushTurn(current, issues)
      current = startTurn()
      continue
    }
    if (!current) continue
    if (isTrailingCard(message)) continue

    switch (message.type) {
      case 'assistant_text':
        current.lastAssistantTextId = message.id
        current.lastAssistantClaims = extractCompletionClaims(message.content)
        current.hasWorkAfterLastReply = false
        break
      case 'tool_use':
        if (message.toolName) current.toolNameByUseId.set(message.toolUseId, message.toolName)
        current.hasWorkAfterLastReply = true
        break
      case 'tool_result': {
        if (message.isError === false) {
          const toolName = current.toolNameByUseId.get(message.toolUseId)
          if (toolName && !READ_ONLY_TOOLS.has(toolName)) current.evidenceTools.add(toolName)
        }
        current.hasWorkAfterLastReply = true
        break
      }
      default:
        current.hasWorkAfterLastReply = true
        break
    }
  }

  if (current && options.turnActive !== true) flushTurn(current, issues)
  return issues
}
