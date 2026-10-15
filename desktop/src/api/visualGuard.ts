import { api } from './client'

export type VisualGuardConfig = {
  hwnd?: number
  region?: [number, number, number, number]
  interval: number
  providerId: string
  model: string
  company: string
  style: string
  banned: string
  sop: string
  knowledge: string
}

export type VisualGuardStatus = {
  state: 'stopped' | 'running' | 'paused' | 'error'
  workerPid: number | null
  transcript: string
  draft: string
  logs: string[]
  config: VisualGuardConfig
}

export type VisualGuardWindow = {
  hwnd: number
  title: string
  pid: number
  rect: [number, number, number, number]
}

export type VisualGuardProvider = { id: string; name: string; models: string[] }

export const visualGuardApi = {
  status: () => api.get<VisualGuardStatus>('/api/visual-guard/status'),
  config: () => api.get<VisualGuardConfig>('/api/visual-guard/config'),
  saveConfig: (config: Partial<VisualGuardConfig>) => api.put<VisualGuardConfig>('/api/visual-guard/config', config),
  windows: () => api.get<{ windows: VisualGuardWindow[] }>('/api/visual-guard/windows'),
  providers: () => api.get<{ activeId: string | null; providers: VisualGuardProvider[] }>('/api/visual-guard/providers'),
  selectRegion: () => api.post<{ region: VisualGuardConfig['region'] }>('/api/visual-guard/select-region'),
  recognize: () => api.post('/api/visual-guard/recognize'),
  start: () => api.post<VisualGuardStatus>('/api/visual-guard/start'),
  pause: () => api.post<VisualGuardStatus>('/api/visual-guard/pause'),
  resume: () => api.post<VisualGuardStatus>('/api/visual-guard/resume'),
  stop: () => api.post<VisualGuardStatus>('/api/visual-guard/stop'),
  review: (content: string) => api.post<VisualGuardStatus>('/api/visual-guard/review', { content }),
}
