import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const worker = process.env.CC_HAHA_VISUAL_GUARD_WORKER
if (!worker) throw new Error('CC_HAHA_VISUAL_GUARD_WORKER is required')
const python = process.env.CC_HAHA_VISUAL_GUARD_PYTHON
if (!python) throw new Error('CC_HAHA_VISUAL_GUARD_PYTHON is required for the mock window')
const root = await mkdtemp(path.join(tmpdir(), 'visual-guard-smoke-'))
process.env.CLAUDE_CONFIG_DIR = root
process.env.CC_HAHA_TRACE_API_CALLS = '0'

const chatCode = `
import tkinter as tk
root=tk.Tk(); root.title('AI视觉值守-集成测试面版'); root.geometry('760x420+80+80')
tk.Label(root,text='客户：你好，请问基础服务怎么报价？',font=('Microsoft YaHei UI',14)).pack(pady=24)
tk.Label(root,text='我：您好，我先了解一下您的具体需求。',font=('Microsoft YaHei UI',14)).pack(pady=24)
root.mainloop()
`
// A second window created afterwards sits on top, so the target is not the
// foreground window and is partly covered — the case that used to read the
// wrong pixels or refuse outright.
const coverCode = `
import tkinter as tk
root=tk.Tk(); root.title('遮挡测试窗口'); root.geometry('900x520+60+60')
tk.Label(root,text='覆盖层文字：绝不应该被读到',font=('Microsoft YaHei UI',16),bg='#fde68a').pack(pady=60)
root.mainloop()
`
const chat = spawn(python, ['-c', chatCode], { windowsHide: true })
let cover: ReturnType<typeof spawn> | undefined

const { VisualGuardService } = await import('../src/server/services/visualGuardService.ts')
const { drainTraceCaptureForTests, clearTraceCaptureStateForTests } = await import('../src/services/api/traceCapture.ts')
const service = new VisualGuardService()
await service.init()

async function waitFor<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const fail = (message: string): never => { throw new Error(message) }

try {
  const target = await waitFor(async () => {
    const windows = await service.windows() as Array<{ hwnd: number; title: string; rect: [number, number, number, number] }>
    return windows.find(window => window.title === 'AI视觉值守-集成测试面版')
  }, 'mock window')
  await service.saveConfig({ hwnd: target.hwnd, region: [0, 0, target.rect[2], target.rect[3]] })

  const sight = await service.see() as { lines: Array<{ text: string; center: [number, number] }>; text: string }
  if (!sight.text.includes('报价')) fail(`see() did not read the window: ${sight.text}`)
  const line = sight.lines.find(item => item.text.includes('报价'))
  if (!line) fail('see() returned no line with coordinates')
  const [x, y] = line.center
  if (x < target.rect[0] || x > target.rect[0] + target.rect[2]) fail(`coordinate ${x} is outside the window`)
  if (y < target.rect[1] || y > target.rect[1] + target.rect[3]) fail(`coordinate ${y} is outside the window`)

  const found = await service.find('报价') as { matches: Array<{ text: string }> }
  if (!found.matches.length) fail('find() returned no match for text that is on screen')
  const missing = await service.find('这句话不可能出现在屏幕上') as { matches: Array<unknown> }
  if (missing.matches.length) fail('find() matched text that is not on screen')

  cover = spawn(python, ['-c', coverCode], { windowsHide: true })
  await waitFor(async () => {
    const windows = await service.windows() as Array<{ title: string }>
    return windows.some(window => window.title === '遮挡测试窗口') ? true : undefined
  }, 'cover window')
  await Bun.sleep(1_500)

  const covered = await service.see() as { text: string }
  if (covered.text.includes('绝不应该被读到')) {
    fail('read the covering window instead of the target — capture is not window-scoped')
  }
  if (!covered.text.includes('报价')) {
    fail(`covered window could not be read in the background: ${covered.text || '(empty)'}`)
  }

  await service.see()
  const pid = service.status().workerPid
  if (!pid) fail('worker did not start')
  process.kill(pid)
  await waitFor(async () => service.status().workerPid === null ? true : undefined, 'worker crash handling')
  await service.see()

  await service.dispose()
  if (service.status().workerPid !== null) fail('worker survived dispose()')
  console.log(JSON.stringify({
    see: true, coordinates: true, find: true, findMiss: true,
    readsCoveredWindow: true, ignoresCoveringWindow: true, crashRecovery: true, stopCleanup: true,
  }))
} finally {
  await service.dispose()
  chat.kill()
  cover?.kill()
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await rm(root, { recursive: true, force: true }); break } catch (error) {
      if ((error as { code?: string }).code !== 'EBUSY' || attempt === 9) throw error
      await Bun.sleep(50)
    }
  }
}
