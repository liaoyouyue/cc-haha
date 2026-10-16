import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

// Drives the worker over its JSONL protocol the way the MCP server uses it:
// import-free, one process, no CCHH server involved.
const python = process.env.CC_HAHA_VISUAL_GUARD_PYTHON
if (!python) throw new Error('CC_HAHA_VISUAL_GUARD_PYTHON is required')

const chatCode = `
import tkinter as tk
root=tk.Tk(); root.title('真实之眼-集成测试面版'); root.geometry('760x420+80+80')
tk.Label(root,text='客户：你好，请问基础服务怎么报价？',font=('Microsoft YaHei UI',14)).pack(pady=24)
tk.Label(root,text='我：您好，我先了解一下您的具体需求。',font=('Microsoft YaHei UI',14)).pack(pady=24)
root.mainloop()
`
// Created after the target, so the target is behind it and not in front.
const coverCode = `
import tkinter as tk
root=tk.Tk(); root.title('遮挡测试窗口'); root.geometry('900x520+60+60')
tk.Label(root,text='覆盖层文字：绝不应该被读到',font=('Microsoft YaHei UI',16),bg='#fde68a').pack(pady=60)
root.mainloop()
`
const chat = spawn(python, ['-c', chatCode], { windowsHide: true })
let cover: ReturnType<typeof spawn> | undefined

class Eye {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<string, (value: any) => void>()

  constructor() {
    const script = new URL('../runtime/visual_guard_worker.py', import.meta.url).pathname
    this.child = spawn(python, ['-u', script.slice(1)], { windowsHide: true })
    createInterface({ input: this.child.stdout }).on('line', line => {
      const message = JSON.parse(line)
      const resolve = this.pending.get(message.id)
      if (!resolve) return
      this.pending.delete(message.id)
      resolve(message)
    })
    this.child.stderr.on('data', chunk => process.stderr.write(`[worker] ${chunk}`))
    this.child.once('exit', code => {
      for (const [id, resolve] of this.pending) {
        this.pending.delete(id)
        resolve({ ok: false, error: `worker exited (${code}) before answering` })
      }
    })
  }

  // Every call is bounded: a worker that dies on startup must fail the test,
  // not leave it waiting on a reply that will never come.
  call(action: string, args: object = {}): Promise<any> {
    const id = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: `${action} timed out` })
      }, 30_000)
      this.pending.set(id, reply => { clearTimeout(timer); resolve(reply) })
      this.child.stdin.write(`${JSON.stringify({ id, action, args })}\n`)
    })
  }

  async ok(action: string, args: object = {}): Promise<any> {
    const reply = await this.call(action, args)
    if (!reply.ok) throw new Error(`${action}: ${reply.error}`)
    return reply.result
  }

  stop() { this.child.kill() }
}

const fail = (message: string): never => { throw new Error(message) }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await sleep(100)
  }
  return fail(`timeout waiting for ${label}`)
}

const eye = new Eye()
try {
  const target = await waitFor(async () => {
    const windows = await eye.ok('windows') as Array<{ hwnd: number; title: string; rect: [number, number, number, number] }>
    return windows.find(window => window.title === '真实之眼-集成测试面版')
  }, 'mock window')

  const sight = await eye.ok('see', { hwnd: target.hwnd }) as {
    text: string
    lines: Array<{ text: string; center: [number, number] }>
    elements: Array<{ role: string; name: string; clickable: boolean; box: [number, number, number, number] }>
  }
  if (!sight.text.includes('报价')) fail(`see did not read the window: ${sight.text}`)
  const line = sight.lines.find(item => item.text.includes('报价'))
  if (!line) fail('see returned no positioned line')
  const [x, y] = line.center
  if (x < target.rect[0] || x > target.rect[0] + target.rect[2]) fail(`x ${x} outside the window`)
  if (y < target.rect[1] || y > target.rect[1] + target.rect[3]) fail(`y ${y} outside the window`)

  // Tk exposes its frame but not its widgets, so the tree is asserted on the
  // frame and the content on OCR — which is why both reads ship together.
  if (!sight.elements.length) fail('see returned no controls at all')
  if (!sight.elements.some(element => element.clickable && element.name)) {
    fail(`no named clickable control: ${JSON.stringify(sight.elements.slice(0, 4))}`)
  }

  const found = await eye.ok('find', { hwnd: target.hwnd, query: '报价' }) as { best: { center: [number, number] } | null }
  if (!found.best) fail('find resolved nothing for text that is on screen')
  const missing = await eye.ok('find', { hwnd: target.hwnd, query: '这句话不可能出现在屏幕上' }) as { best: unknown }
  if (missing.best) fail('find matched text that is not on screen')

  const marked = await eye.ok('see', { hwnd: target.hwnd, mark: true }) as { changed: boolean; items: unknown[]; image_png_base64: string }
  if (marked.changed !== true) fail('the first marked read should report a change')
  if (!marked.image_png_base64.startsWith('iVBOR')) fail('the marked read returned no PNG')
  const again = await eye.ok('see', { hwnd: target.hwnd, mark: true }) as { changed: boolean }
  if (again.changed !== false) fail('an unchanged window should report no change')

  cover = spawn(python, ['-c', coverCode], { windowsHide: true })
  await waitFor(async () => {
    const windows = await eye.ok('windows') as Array<{ title: string }>
    return windows.some(window => window.title === '遮挡测试窗口') ? true : undefined
  }, 'cover window')
  await sleep(1_500)
  const covered = await eye.ok('see', { hwnd: target.hwnd }) as { text: string }
  if (covered.text.includes('绝不应该被读到')) fail('read the covering window instead of the target')
  if (!covered.text.includes('报价')) fail(`covered window unreadable: ${covered.text || '(empty)'}`)

  eye.stop()
  eye.stop()
  console.log(JSON.stringify({
    see: true, coordinates: true, controls: true, find: true, findMiss: true,
    markedImage: true, changeDetection: true,
    readsCoveredWindow: true, ignoresCoveringWindow: true,
  }))
} finally {
  eye.stop()
  chat.kill()
  cover?.kill()
}
