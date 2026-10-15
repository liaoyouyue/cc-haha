import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const worker = process.env.CC_HAHA_VISUAL_GUARD_WORKER
if (!worker) throw new Error('CC_HAHA_VISUAL_GUARD_WORKER is required')
const python = process.env.CC_HAHA_VISUAL_GUARD_PYTHON
if (!python) throw new Error('CC_HAHA_VISUAL_GUARD_PYTHON is required for the mock chat window')
const root = await mkdtemp(path.join(tmpdir(), 'visual-guard-smoke-'))
process.env.CLAUDE_CONFIG_DIR = root
process.env.CC_HAHA_TRACE_API_CALLS = '0'

const mock = Bun.serve({
  port: 0,
  fetch: async request => {
    if (!request.url.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
    return Response.json({
      id: 'smoke', object: 'chat.completion', created: 0, model: 'smoke-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '这是待人工审核的测试草稿。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  },
})

const chatCode = `
import tkinter as tk
root=tk.Tk(); root.title('AI视觉值守-集成测试聊天'); root.geometry('720x420+80+80')
tk.Label(root,text='模拟客户会话（仅本地测试）',font=('Microsoft YaHei UI',16)).pack(pady=16)
tk.Label(root,text='客户：你好，请问基础服务怎么报价？',font=('Microsoft YaHei UI',14),bg='white').pack(anchor='w',padx=30,pady=20)
tk.Label(root,text='我：您好，我先了解一下您的具体需求。',font=('Microsoft YaHei UI',14),bg='#d1fae5').pack(anchor='e',padx=30,pady=20)
root.mainloop()
`
const chat = spawn(python, ['-c', chatCode], { windowsHide: true })

const { ProviderService } = await import('../src/server/services/providerService.ts')
const { VisualGuardService } = await import('../src/server/services/visualGuardService.ts')
const { drainTraceCaptureForTests, clearTraceCaptureStateForTests } = await import('../src/services/api/traceCapture.ts')
const provider = await new ProviderService().addProvider({
  presetId: 'custom', name: 'Smoke Provider', apiKey: 'dummy',
  baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiFormat: 'openai_chat',
  models: { main: 'smoke-model', haiku: 'smoke-model', sonnet: 'smoke-model', opus: 'smoke-model' },
})
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

try {
  const target = await waitFor(async () => {
    const windows = await service.windows() as Array<{ hwnd: number; title: string; rect: [number, number, number, number] }>
    return windows.find(window => window.title === 'AI视觉值守-集成测试聊天')
  }, 'mock window')
  await service.saveConfig({
    hwnd: target.hwnd, region: [0, 0, target.rect[2], target.rect[3]], interval: 1,
    providerId: provider.id, model: 'smoke-model', company: '测试公司，基础服务按需求报价。',
  })
  await service.recognize()
  const recognized = service.status()
  if (!recognized.transcript.includes('报价')) throw new Error(`OCR failed: ${recognized.transcript}`)
  if (!recognized.draft.includes('待人工审核')) throw new Error(`draft failed: ${recognized.draft}`)

  await service.start()
  let duplicateBlocked = false
  try { await service.start() } catch { duplicateBlocked = true }
  if (!duplicateBlocked) throw new Error('duplicate start was not blocked')
  await service.pause()
  if (service.status().state !== 'paused') throw new Error('pause failed')
  await service.resume()
  await service.stop()
  if (service.status().workerPid !== null) throw new Error('worker survived stop')

  await service.start()
  const pid = service.status().workerPid
  if (!pid) throw new Error('worker restart failed')
  process.kill(pid)
  await waitFor(async () => service.status().state === 'error' ? true : undefined, 'abnormal exit state')
  if (service.status().workerPid !== null) throw new Error('dead worker remained registered')
  console.log(JSON.stringify({ ocr: true, draft: true, duplicateStart: true, pauseResume: true, stopCleanup: true, crashRecovery: true }))
} finally {
  await service.dispose()
  chat.kill()
  mock.stop(true)
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await rm(root, { recursive: true, force: true }); break } catch (error) {
      if ((error as { code?: string }).code !== 'EBUSY' || attempt === 9) throw error
      await Bun.sleep(50)
    }
  }
}
