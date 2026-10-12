import type { DoctorReport } from '../api/doctor'

/**
 * 启动自检：把启动时那一份 doctor 报告压成一个「一眼看得懂」的健康结论，
 * 而不是让用户自己翻配置清单。抄白龙马那套「开场先体检」。
 */
export type StartupHealthLevel = 'ok' | 'warn' | 'error'

export type StartupHealthSummary = {
  level: StartupHealthLevel
  /** 缺失的配置文件数（不算错，但要提示）。 */
  missing: number
  /** 损坏/非法的配置文件数（要修）。 */
  invalid: number
  /** 自检接口本身没连上（服务没起或请求失败），此时其余计数无意义。 */
  unavailable: boolean
}

export function summarizeStartupHealth(report: DoctorReport | null, unavailable = false): StartupHealthSummary {
  if (unavailable || !report) {
    return { level: 'error', missing: 0, invalid: 0, unavailable: true }
  }

  const missing = report.summary.missingCount
  const invalid = report.summary.invalidCount
  const level: StartupHealthLevel = invalid > 0 ? 'error' : missing > 0 ? 'warn' : 'ok'

  return { level, missing, invalid, unavailable: false }
}
