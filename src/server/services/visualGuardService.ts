import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import WORKER_SOURCE from '../../../runtime/visual_guard_worker.py' with { type: 'text' }
import VISUAL_GUARD_REQUIREMENTS from '../../../runtime/requirements-visual-guard.txt' with { type: 'text' }

export type VisualGuardConfig = {
  hwnd?: number
  region?: [number, number, number, number]
}

type WorkerReply = { id?: string; ok: boolean; result?: unknown; error?: string }
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const configRoot = path.join(getClaudeConfigHomeDir(), '.runtime')
const configPath = path.join(configRoot, 'visual-guard.json')
const workerPath = path.join(configRoot, 'visual_guard_worker.py')
const pythonPath = process.env.CC_HAHA_VISUAL_GUARD_PYTHON || path.join(configRoot, 'venv', 'Scripts', 'python.exe')
// Built with PyInstaller --onedir next to the server executable: a onefile
// build re-unpacks to %TEMP% on every start (~10s) and runs as a bootloader
// parent plus a child, which costs both latency and an extra process.
const bundledWorkerPath = path.join(path.dirname(process.execPath), 'visual-guard-worker', 'visual-guard-worker.exe')

/** Long enough to switch windows after clicking, short enough to fail visibly. */
const MANUAL_CAPTURE_WAIT_SECONDS = 15

function sanitize(message: unknown): string {
  return String(message)
    .replace(/(?:sk|freellmapi)-[A-Za-z0-9_-]{12,}/gi, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer <redacted>')
}

function runPython(executable: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(executable, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } })
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => resolve({ code: -1, stderr: String(error) }))
    child.once('exit', code => resolve({ code: code ?? -1, stderr }))
  })
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Gives the agent eyes on a desktop window: it reads a window as positioned
 * text so a model without vision can still see, and returns coordinates so
 * acting on what was read needs no pixel guesswork.
 *
 * Read-only by design — nothing here clicks, types, or activates a window.
 */
export class VisualGuardService {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private starting: Promise<void> | null = null
  private config: VisualGuardConfig = {}
  private logs: string[] = []

  async init(): Promise<void> {
    await mkdir(configRoot, { recursive: true })
    try {
      this.config = JSON.parse(await readFile(configPath, 'utf8')) as VisualGuardConfig
    } catch {}
  }

  async getConfig(): Promise<VisualGuardConfig> {
    return { ...this.config }
  }

  async saveConfig(update: VisualGuardConfig): Promise<VisualGuardConfig> {
    this.config = { ...this.config, ...update }
    await mkdir(configRoot, { recursive: true })
    await writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf8')
    return this.getConfig()
  }

  status() {
    return {
      workerPid: this.child?.pid ?? null,
      logs: [...this.logs],
      config: { ...this.config },
    }
  }

  async windows(): Promise<unknown> {
    return this.request('windows')
  }

  /** Read the configured (or given) window as text with screen coordinates. */
  async see(hwnd?: number): Promise<unknown> {
    const target = hwnd ?? this.config.hwnd
    if (!target) throw new Error('请先选择目标窗口')
    return this.request('see', { hwnd: target, region: this.config.region, wait_seconds: MANUAL_CAPTURE_WAIT_SECONDS }, 90_000)
  }

  /** Where on screen does this text live? */
  async find(query: string, hwnd?: number): Promise<unknown> {
    const target = hwnd ?? this.config.hwnd
    if (!target) throw new Error('请先选择目标窗口')
    return this.request('find', { hwnd: target, query, region: this.config.region, wait_seconds: MANUAL_CAPTURE_WAIT_SECONDS }, 90_000)
  }

  async selectRegion(): Promise<unknown> {
    if (!this.config.hwnd) throw new Error('请先选择目标窗口')
    const result = await this.request('select_region', { hwnd: this.config.hwnd }, 120_000) as { region?: VisualGuardConfig['region'] }
    if (result.region) await this.saveConfig({ region: result.region })
    return result
  }

  async dispose(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child) return
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error('真实之眼进程已停止'))
    }
    this.pending.clear()
    child.kill()
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve()
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  private async ensureWorker(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      await mkdir(configRoot, { recursive: true })
      await writeFile(workerPath, WORKER_SOURCE, 'utf8')
      let executable = pythonPath
      let args = ['-u', workerPath]
      const override = process.env.CC_HAHA_VISUAL_GUARD_WORKER
      if (override) {
        executable = override
        args = []
      } else if (await exists(bundledWorkerPath)) {
        executable = bundledWorkerPath
        args = []
      } else if (!(await exists(pythonPath))) {
        throw new Error('真实之眼运行时不可用：缺少 visual-guard-worker.exe，且未安装 Python 运行环境')
      } else if (process.env.CC_HAHA_VISUAL_GUARD_PYTHON) {
        throw new Error('CC_HAHA_VISUAL_GUARD_PYTHON 指向的文件不存在')
      } else {
        await this.ensureOcrDependencies()
      }
      const child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      })
      this.child = child
      createInterface({ input: child.stdout }).on('line', line => this.handleLine(line))
      createInterface({ input: child.stderr }).on('line', line => this.log(`worker: ${sanitize(line)}`))
      child.once('exit', code => {
        if (this.child === child) this.child = null
        this.log(`worker 退出（${code ?? 'unknown'}）`)
        for (const item of this.pending.values()) {
          clearTimeout(item.timer)
          item.reject(new Error('真实之眼进程已退出'))
        }
        this.pending.clear()
      })
      await this.requestRaw('ping', {}, 30_000)
      this.log(`worker 已启动（PID ${child.pid ?? 'unknown'}）`)
    })().finally(() => { this.starting = null })
    return this.starting
  }

  /**
   * The Computer Use venv deliberately does not ship the ~240 MB OCR stack, so
   * the Python fallback installs it once, on the request that actually needs it.
   */
  private async ensureOcrDependencies(): Promise<void> {
    const probe = await runPython(pythonPath, ['-c', 'import rapidocr_onnxruntime'])
    if (probe.code === 0) return
    const requirementsPath = path.join(configRoot, 'requirements-visual-guard.txt')
    await writeFile(requirementsPath, VISUAL_GUARD_REQUIREMENTS, 'utf8')
    this.log('正在安装真实之眼所需的 OCR 依赖（仅首次，约 240MB）…')
    const install = await runPython(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath])
    if (install.code !== 0) {
      throw new Error(`OCR 依赖安装失败：${sanitize(install.stderr.slice(-500))}`)
    }
  }

  private async request(action: string, args: object = {}, timeout = 30_000): Promise<unknown> {
    await this.ensureWorker()
    return this.requestRaw(action, args, timeout)
  }

  private requestRaw(action: string, args: object, timeout: number): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new Error('Python worker 未启动'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${action} 超时`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, action, args })}\n`)
    })
  }

  private handleLine(line: string): void {
    let message: WorkerReply
    try {
      message = JSON.parse(line) as WorkerReply
    } catch {
      this.log(`worker 输出无效：${sanitize(line)}`)
      return
    }
    if (!message.id) return
    const item = this.pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(message.id)
    if (message.ok) item.resolve(message.result)
    else item.reject(new Error(sanitize(message.error ?? 'worker 请求失败')))
  }

  private log(message: string): void {
    this.logs.push(`[${new Date().toLocaleTimeString()}] ${sanitize(message)}`)
    this.logs = this.logs.slice(-200)
  }
}

export const visualGuardService = new VisualGuardService()
void visualGuardService.init()
