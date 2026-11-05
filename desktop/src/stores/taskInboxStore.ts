import { create } from 'zustand'
import { taskInboxApi, type TaskInboxEntry } from '../api/taskInbox.js'

/**
 * 跨会话后台任务收件箱。30 秒轮询（任务完成是分钟级事件，不值得 WS 专线）；
 * unreadCount 给 TabBar 角标，entries 给收件箱面板。
 */
type TaskInboxStore = {
  unreadCount: number
  entries: TaskInboxEntry[]
  loaded: boolean
  refresh: () => Promise<void>
  ack: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

let timer: ReturnType<typeof setInterval> | undefined

export const useTaskInboxStore = create<TaskInboxStore>((set, get) => ({
  unreadCount: 0,
  entries: [],
  loaded: false,

  refresh: async () => {
    try {
      const data = await taskInboxApi.list()
      set({ unreadCount: data.unreadCount, entries: data.entries, loaded: true })
    } catch { /* 服务不可达时保留旧值 */ }
  },

  ack: async () => {
    try {
      await taskInboxApi.ack()
      set({ unreadCount: 0 })
    } catch { /* 下次 refresh 会纠正 */ }
  },

  startPolling: () => {
    if (timer) return
    void get().refresh()
    timer = setInterval(() => { void get().refresh() }, 30000)
  },

  stopPolling: () => {
    if (timer) clearInterval(timer)
    timer = undefined
  },
}))
