import { api } from './client.js'

export type TaskInboxEntry = {
  taskId: string
  sessionId: string
  status: 'completed' | 'failed' | 'stopped'
  description?: string
  summary?: string
  taskType?: string
  finishedAt: number
}

export const taskInboxApi = {
  list: () => api.get<{ unreadCount: number; entries: TaskInboxEntry[] }>('/api/task-inbox'),
  ack: () => api.post<{ ok: boolean }>('/api/task-inbox/ack'),
}
