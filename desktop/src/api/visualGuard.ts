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
  source: 'ocr'
}

/** A control from the window's accessibility tree. */
export type VisualGuardElement = {
  role: string
  name: string
  clickable: boolean
  box: [number, number, number, number]
  center: [number, number]
  source: 'uia'
  depth: number
}

export type VisualGuardSight = {
  window: VisualGuardWindow
  region: VisualGuardConfig['region'] | null
  width: number
  height: number
  elements: VisualGuardElement[]
  lines: VisualGuardLine[]
  text: string
}

export type VisualGuardFound = VisualGuardElement | VisualGuardLine

export const visualGuardApi = {
  status: () => api.get<VisualGuardStatus>('/api/visual-guard/status'),
  config: () => api.get<VisualGuardConfig>('/api/visual-guard/config'),
  saveConfig: (config: VisualGuardConfig) => api.put<VisualGuardConfig>('/api/visual-guard/config', config),
  windows: () => api.get<{ windows: VisualGuardWindow[] }>('/api/visual-guard/windows'),
  selectRegion: () => api.post<{ region: VisualGuardConfig['region'] }>('/api/visual-guard/select-region'),
  see: () => api.post<VisualGuardSight>('/api/visual-guard/see'),
  find: (query: string) => api.post<{
    query: string
    elements: VisualGuardElement[]
    lines: VisualGuardLine[]
    best: VisualGuardFound | null
    window: VisualGuardWindow
  }>('/api/visual-guard/find', { query }),
}
