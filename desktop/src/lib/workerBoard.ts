import type { SavedProvider } from '../types/provider'
import type { SessionListItem } from '../types/session'
import type { RuntimeSelection } from '../types/runtime'

/**
 * 工人看板的数据层：把「会话 + 运行时选择 + 服务商」压成一行行工位。
 *
 * 目的只有一个：一眼看出哪个会话在跑、用的是哪个模型、这个模型是不是走的免费网关。
 * 纯函数，无副作用，方便直接跑测试。
 */

export type WorkerKind = 'free' | 'paid' | 'unknown'

export type WorkerRow = {
  id: string
  title: string
  workDir: string
  providerName: string
  modelId: string
  kind: WorkerKind
}

/**
 * 判定一个服务商是不是「免费」。
 *
 * 只看 baseUrl 是否指向本地免费网关，外加预设/名字里的 free 标记。
 * 故意不维护 provider id 白名单：id 是 UUID，换一次安装就烂一次。
 */
export function classifyProvider(provider: SavedProvider | undefined): WorkerKind {
  if (!provider) return 'unknown'
  const base = provider.baseUrl.toLowerCase()
  if (/localhost:3001|127\.0\.0\.1:3001/.test(base)) return 'free'
  const haystack = `${provider.presetId} ${provider.name}`.toLowerCase()
  if (haystack.includes('free') || haystack.includes('免费')) return 'free'
  if (!base) return 'unknown'
  return 'paid'
}

/** 会话当前实际在用的模型：优先运行时选择（实时），回落会话列表里的快照。 */
export function resolveSessionModel(
  session: SessionListItem,
  selection: RuntimeSelection | undefined,
): { providerId: string | null; modelId: string } {
  if (selection) return { providerId: selection.providerId ?? null, modelId: selection.modelId }
  return { providerId: session.runtimeProviderId ?? null, modelId: session.runtimeModelId ?? '' }
}

export function buildWorkerRows(
  sessions: readonly SessionListItem[],
  selections: Record<string, RuntimeSelection | undefined>,
  providers: readonly SavedProvider[],
): WorkerRow[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))
  return sessions
    .map((session) => {
      const { providerId, modelId } = resolveSessionModel(session, selections[session.id])
      const provider = providerId ? byId.get(providerId) : undefined
      return {
        id: session.id,
        title: session.title,
        workDir: session.workDir ?? session.projectPath ?? '',
        providerName: provider?.name ?? providerId ?? '—',
        modelId: modelId || '—',
        kind: classifyProvider(provider),
      }
    })
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title))
}
