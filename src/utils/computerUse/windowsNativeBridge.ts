// Windows Native Bridge — CCHH Computer Use 2.0 P1
//
// 职责：管理常驻 win-cu-worker.exe（C# self-contained）的子进程与 named pipe
// NDJSON 客户端，向 helperBridge 提供与 callPythonHelper 同信封的 callNative()。
//
// 核心安全语义（来自 P0 审计 PATCH_IMPACT_MATRIX/IMPLEMENTATION_PLAN，不可破坏）：
//   1. 写请求前失败（spawn 失败 / 未连接 / worker 不存在）→ 返回 null，调用方回退 Python。
//   2. 写请求后失败（超时 / 响应中途断连）→ 抛 NativeCommandResultUnknownError，
//      禁止静默重放——动作可能已经执行，上层必须把 result_unknown 报给模型，不得自动重试。
//   3. Worker 只做只读能力（ping / cursor_position / screenshot / get_display_size /
//      check_permissions / shutdown）。P1 不动鼠标键盘；输入类命令不会路由到本桥。
//   4. 每 CLI/sidecar 进程一个 Worker 单例（与 pythonBridge resident 同策略）。
//   5. 回退开关：CC_HAHA_CU_WORKER=off 强制禁用（P5 正式化，这里先实现）。

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { connect, type Socket } from 'node:net'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export class NativeCommandResultUnknownError extends Error {
  readonly command: string
  constructor(command: string, reason: string) {
    super(
      `native_worker_result_unknown: command "${command}" was dispatched to the worker but its ` +
        `outcome could not be confirmed (${reason}). The action may have already executed; ` +
        `do NOT silently retry. Report result_unknown to the caller.`,
    )
    this.name = 'NativeCommandResultUnknownError'
    this.command = command
  }
}

export type NativeWorkerDeps = {
  workerPath?: string | null
  pipeName?: string
  startupTimeoutMs?: number
  callTimeoutMs?: number
  spawnFn?: typeof spawn
  /** 测试钩子：注入假 worker 路径，避免真的 spawn。 */
  fakeExec?: boolean
}

export type NativeCallOptions = {
  deadlineMs?: number
  turnId?: string
}

/** 解析 worker exe 路径。找不到返回 null（→ 调用方回退 Python，不抛错）。 */
export function resolveWinCuWorkerBinary(opts: {
  overrideDir?: string
  appRoot?: string
  cwd?: string
} = {}): string | null {
  if (process.env.CC_HAHA_CU_WORKER === 'off') return null

  const candidates: string[] = []
  const exe = 'win-cu-worker.exe'

  // 1. 显式 override（测试 / P5 打包验证）
  if (opts.overrideDir) candidates.push(join(opts.overrideDir, exe))

  // 2. 打包应用：asar → asar.unpacked/src-tauri/binaries（对齐 cuHelperBridge 的解析规则）
  const appRoot = opts.appRoot ?? process.env.CLAUDE_APP_ROOT
  if (appRoot) {
    const unpacked = appRoot.replace(/\.asar$/, '.asar.unpacked')
    candidates.push(join(unpacked, 'src-tauri', 'binaries', exe))
  }

  // 3. 开发工作树：<repo>/desktop/src-tauri/binaries。
  //    ponytail: 用模块自身位置上溯，不用 process.cwd()——sidecar 的 cwd 是用户目录，
  //    依赖 cwd 会让开发机静默走 Python 回退（实测踩过）。
  const here = opts.cwd ?? import.meta.dir
  // src/utils/computerUse → 上溯 3 层到仓库根
  candidates.push(join(here, '..', '..', '..', 'desktop', 'src-tauri', 'binaries', exe))
  if (opts.cwd) candidates.push(join(opts.cwd, 'desktop', 'src-tauri', 'binaries', exe))

  for (const p of candidates) {
    try {
      if (existsSync(p) && statSync(p).isFile()) return p
    } catch {
      // 权限/竞态：继续下一个候选
    }
  }
  return null
}

/** 能力探测：worker exe 是否存在且未被 env 关闭。不 spawn 进程。 */
export function isNativeWorkerAvailable(opts: Parameters<typeof resolveWinCuWorkerBinary>[0] = {}): boolean {
  return resolveWinCuWorkerBinary(opts) !== null
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  command: string
  /** 请求是否已写入管道。写后失败 = result_unknown。 */
  dispatched: boolean
}

const PROTOCOL = 1

export class WindowsNativeBridge {
  private worker: ChildProcess | null = null
  private workerPath: string | null
  private pipeName: string
  private startupTimeoutMs: number
  private callTimeoutMs: number
  private spawnFn: typeof spawn
  private fakeExec: boolean

  private nextId = 1
  private pending = new Map<number, Pending>()
  /** named pipe socket：请求和响应都走它。stdout 只用于 boot 的 ready 探测。 */
  private pipeSocket: Socket | null = null
  private socketBuf = ''
  private booting: Promise<void> | null = null
  private disposed = false

  constructor(deps: NativeWorkerDeps = {}) {
    this.workerPath = deps.workerPath ?? resolveWinCuWorkerBinary()
    // 每实例唯一 pipe 名：同一进程可能并存多个 bridge（测试/多 worker），
    // 重名会让新 worker 的 server 实例抢走旧 worker 的连接。
    this.pipeName = deps.pipeName ?? `win-cu-worker-${process.pid}-${++instanceSeq}`
    this.startupTimeoutMs = deps.startupTimeoutMs ?? 10_000
    this.callTimeoutMs = deps.callTimeoutMs ?? 60_000
    this.spawnFn = deps.spawnFn ?? spawn
    this.fakeExec = deps.fakeExec ?? false
  }

  /** 调用方使用的主入口。返回 null = 未派发，可安全回退 Python。 */
  async callNative<T = unknown>(
    command: string,
    payload: Record<string, unknown> = {},
    opts: NativeCallOptions = {},
  ): Promise<T> {
    if (process.env.CC_HAHA_CU_WORKER === 'off') return null as T
    if (!this.workerPath) return null as T // 未派发 → 回退

    try {
      await this.ensureBooted()
    } catch (err) {
      // 启动失败：未派发任何动作，干净回退。
      logWarn(`worker boot failed, falling back to python: ${String(err)}`)
      return null as T
    }

    return await this.dispatch<T>(command, payload, opts)
  }

  /** P2 起语义命令也走这里；P1 只暴露只读命令。 */
  isAvailable(): boolean {
    return this.workerPath !== null && process.env.CC_HAHA_CU_WORKER !== 'off'
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('native bridge disposed'))
    }
    this.pending.clear()
    this.pipeSocket?.destroy()
    this.pipeSocket = null
    this.socketBuf = ''
    if (this.worker && !this.worker.killed) {
      try { this.worker.kill() } catch { /* 已退出 */ }
    }
    this.worker = null
    this.booting = null
  }

  // ---- 内部 ----

  private ensureBooted(): Promise<void> {
    if (this.booting) return this.booting
    this.booting = this.boot().catch(err => {
      this.booting = null // 允许下次重试
      throw err
    })
    return this.booting
  }

  private async boot(): Promise<void> {
    if (this.worker && !this.worker.killed) return

    const t0 = Date.now()
    const child = this.fakeExec
      ? (null as unknown as ChildProcess)
      : this.spawnFn(this.workerPath!, ['--pipe', this.pipeName], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true, // 与私有黑框修复体系一致，绝不弹控制台
        })
    this.worker = child

    // 读 ready 行：worker 启动后第一行 stdout 必须是 ready JSON。
    // ponytail: 不用 readline，直接攒 buffer 找第一个 \n——少一层事件时序问题（bun 下 readline 偶发不吐行）。
    await new Promise<void>((resolve, reject) => {
      let buf = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`worker ready timeout after ${this.startupTimeoutMs}ms`))
      }, this.startupTimeoutMs)

      child.on('error', err => { clearTimeout(timer); if (!settled) { settled = true; reject(err) } })
      child.on('exit', code => {
        clearTimeout(timer)
        if (!settled) { settled = true; reject(new Error(`worker exited during boot with code ${code}`)) }
      })

      const stdout = child.stdout
      if (!stdout) { clearTimeout(timer); settled = true; reject(new Error('worker stdout unavailable')); return }

      const onData = async (chunk: Buffer | string) => {
        buf += chunk.toString()
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        stdout.off('data', onData)
        clearTimeout(timer)
        try {
          const parsed = JSON.parse(buf.slice(0, nl))
          if (parsed?.result?.ready !== true) {
            if (!settled) { settled = true; reject(new Error(`worker first line not ready: ${buf.slice(0, 200)}`)) }
            return
          }
          try {
            await this.connectPipe()
          } catch (pipeErr) {
            if (!settled) { settled = true; reject(pipeErr as Error) }
            return
          }
          child.on('exit', () => this.onWorkerExit())
          if (!settled) { settled = true; resolve() }
        } catch (err) {
          if (!settled) { settled = true; reject(new Error(`worker ready line parse failed: ${String(err)}`)) }
        }
      }
      stdout.on('data', onData)
    })

    logDebug(`worker booted pid=${this.worker?.pid} pipe=${this.pipeName} in ${Date.now() - t0}ms`)
  }

  /** 连 named pipe（轮询重试：worker ready 行之后 pipe accept 可能还差一拍）。 */
  private connectPipe(): Promise<void> {
    const pipePath = `\\\\.\\pipe\\${this.pipeName}`
    return new Promise((resolve, reject) => {
      let attempt = 0
      const tryConnect = () => {
        attempt++
        const sock = connect(pipePath)
        sock.once('connect', () => {
          this.pipeSocket = sock
          sock.setNoDelay(true)
          sock.on('data', (chunk: Buffer | string) => {
            this.socketBuf += chunk.toString()
            let nl: number
            while ((nl = this.socketBuf.indexOf('\n')) >= 0) {
              const line = this.socketBuf.slice(0, nl)
              this.socketBuf = this.socketBuf.slice(nl + 1)
              if (line.length > 0) this.onWorkerLine(line)
            }
          })
          sock.on('error', err => {
            logWarn(`pipe socket error: ${err.message}`)
            this.onWorkerExit()
          })
          sock.on('close', () => {
            if (this.pipeSocket === sock) this.onWorkerExit()
          })
          resolve()
        })
        sock.once('error', () => {
          sock.destroy()
          if (attempt < 25) setTimeout(tryConnect, 200)
          else reject(new Error(`pipe connect failed after ${attempt} attempts: ${pipePath}`))
        })
      }
      tryConnect()
    })
  }

  private async dispatch<T>(
    command: string,
    payload: Record<string, unknown>,
    opts: NativeCallOptions,
  ): Promise<T> {
    const id = this.nextId++
    const timeoutMs = opts.deadlineMs ?? this.callTimeoutMs
    const request = JSON.stringify({ id, command, payload, turnId: opts.turnId })

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        // 请求已写入 → 结果未知。禁止重放。
        reject(new NativeCommandResultUnknownError(command, `timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      const entry: Pending = { resolve: v => resolve(v as T), reject, timer, command, dispatched: false }
      this.pending.set(id, entry)

      // 写请求。写失败 = 未派发 → 干净回退（上层看到 null）。
      try {
        this.writeRequest(request)
        entry.dispatched = true
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        logWarn(`worker write failed (pre-dispatch), falling back to python: ${String(err)}`)
        resolve(null as T)
      }
    })
  }

  private writeRequest(line: string): void {
    if (!this.pipeSocket || this.pipeSocket.destroyed) {
      throw new Error('pipe socket unavailable')
    }
    this.pipeSocket.write(line + '\n')
  }

  private onWorkerLine(line: string): void {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      logWarn(`worker non-JSON line ignored: ${line.slice(0, 120)}`)
      return
    }
    if (typeof msg.id !== 'number') return
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    clearTimeout(entry.timer)

    if (msg.ok === true) {
      entry.resolve(msg.result)
    } else {
      const err = new Error(msg.error?.message ?? 'worker error') as Error & { code?: string }
      err.code = msg.error?.code ?? 'worker_error'
      entry.reject(err)
    }
  }

  private onWorkerExit(): void {
    // 所有已派发、尚未收到响应的请求 = result_unknown。
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      if (p.dispatched) {
        p.reject(new NativeCommandResultUnknownError(p.command, 'worker exited before response'))
      } else {
        p.reject(new Error('worker exited before dispatch'))
      }
    }
    this.pending.clear()
    this.pipeSocket?.destroy()
    this.pipeSocket = null
    this.socketBuf = ''
    this.worker = null
    this.booting = null
    // 不自动重启：下一次 callNative 会重新 ensureBooted()。
    // ponytail: 崩溃自动重启的退避策略等 P4 真实崩溃数据再定，现在 lazy-fail 即可。
  }

  killWorkerForTest(): void {
    if (this.worker && !this.worker.killed) {
      try { this.worker.kill('SIGKILL') } catch { /* noop */ }
    }
  }
}

function logWarn(msg: string): void {
  try { console.error(`[windowsNativeBridge] ${msg}`) } catch { /* stderr gone */ }
}

function logDebug(msg: string): void {
  try { console.error(`[windowsNativeBridge] ${msg}`) } catch { /* stderr gone */ }
}

// 进程退出时清理（对齐 pythonBridge.ts:289 的 process.once('exit') 模式）。
process.once('exit', () => {
  singleton?.dispose()
})

// ---- 进程级单例（helperBridge 使用） ----

let singleton: WindowsNativeBridge | null = null
let instanceSeq = 0

/** Module-level convenience: route one command through the process singleton. */
export function callNative<T = unknown>(
  command: string,
  payload: Record<string, unknown> = {},
  opts: NativeCallOptions = {},
): Promise<T> {
  return getNativeWorkerBridge().callNative<T>(command, payload, opts)
}

export function getNativeWorkerBridge(): WindowsNativeBridge {
  if (!singleton) singleton = new WindowsNativeBridge()
  return singleton
}

export function disposeNativeWorker(): void {
  singleton?.dispose()
  singleton = null
}
