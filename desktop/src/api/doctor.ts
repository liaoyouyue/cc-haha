import { api } from './client'

export type DoctorReportItem = {
  id: string
  label: string
  kind: 'json' | 'jsonl' | 'directory'
  scope: 'user' | 'project'
  path: string
  protected: boolean
  exists: boolean
  status: 'ok' | 'not_configured' | 'missing' | 'invalid_json' | 'invalid_jsonl' | 'invalid_schema' | 'unreadable'
  bytes: number
  entryCount?: number
  lineCount?: number
  invalidLineCount?: number
  error?: string
}

export type DoctorReport = {
  generatedAt: string
  items: DoctorReportItem[]
  protectedSkips: Array<{
    id: string
    path: string
    reason: 'protected'
  }>
  summary: {
    total: number
    protectedCount: number
    neutralCount: number
    missingCount: number
    invalidCount: number
  }
}

export const doctorApi = {
  // timeout is caller-tunable: the startup health card runs during boot while the
  // sidecar is still warming up, where the interactive 3s budget is too tight.
  report: (cwd?: string, options: { timeout?: number } = {}) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ report: DoctorReport }>(`/api/doctor/report${query}`, { timeout: options.timeout ?? 3_000 })
  },
}
