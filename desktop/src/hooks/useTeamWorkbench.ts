import { useEffect, useState } from 'react'
import { teamsApi } from '../api/teams'
import type { TeamSummary, TeamWorkbenchSnapshot } from '../types/team'

export type TeamOfficeState = {
  snapshot: TeamWorkbenchSnapshot | null
  loading: boolean
  error: string | null
}

/** ISO 时间串按字典序就是时间序，不用 Date.parse（空串会算出 NaN 把排序搞崩）。 */
function pickActiveTeam(teams: readonly TeamSummary[]): TeamSummary | undefined {
  return [...teams].sort((left, right) =>
    (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
  )[0]
}

/**
 * 轮询最近一个团队的工位快照。没有团队时 snapshot 停在 null，页面上照常显示空办公室。
 * 用 setTimeout 串行拉，不叠请求；一次 tick 两跳（列表 + 快照）。
 */
export function useTeamWorkbench(pollMs = 4000): TeamOfficeState {
  const [state, setState] = useState<TeamOfficeState>({ snapshot: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const { teams } = await teamsApi.list()
        if (cancelled) return
        const active = pickActiveTeam(teams)
        if (!active) {
          setState({ snapshot: null, loading: false, error: null })
        } else {
          const snapshot = await teamsApi.getWorkbench(active.name)
          if (cancelled) return
          setState({ snapshot, loading: false, error: null })
        }
      } catch (err) {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), pollMs)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [pollMs])

  return state
}
