import { api } from './client'

export type VisualGuardConfig = {
  hwnd?: number
  region?: [number, number, number, number]
}

export type VisualGuardStatus = {
  workerPid: number | null
  logs: string[]
  config: VisualGuardConfig
}

export type VisualGuardWindow = {
  hwnd: number
  title: string
  pid: number
  rect: [number, number, number, number]
}

export type VisualGuardLine = {
  text: string
  score: number
  box: [number, number, number, number]
  center: [number, number]
}

export type VisualGuardSight = {
  window: VisualGuardWindow
  region: VisualGuardConfig['region'] | null
  width: number
  height: number
  lines: VisualGuardLine[]
  text: string
}

export type VisualGuardMatch = VisualGuardLine & { query: string }

export const visualGuardApi = {
  status: () => api.get<VisualGuardStatus>('/api/visual-guard/status'),
  config: () => api.get<VisualGuardConfig>('/api/visual-guard/config'),
  saveConfig: (config: VisualGuardConfig) => api.put<VisualGuardConfig>('/api/visual-guard/config', config),
  windows: () => api.get<{ windows: VisualGuardWindow[] }>('/api/visual-guard/windows'),
  selectRegion: () => api.post<{ region: VisualGuardConfig['region'] }>('/api/visual-guard/select-region'),
  see: () => api.post<VisualGuardSight>('/api/visual-guard/see'),
  find: (query: string) => api.post<{ query: string; matches: VisualGuardLine[]; window: VisualGuardWindow }>(
    '/api/visual-guard/find', { query },
  ),
}
