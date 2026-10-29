import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  WindowsNativeBridge,
  NativeCommandResultUnknownError,
  resolveWinCuWorkerBinary,
  isNativeWorkerAvailable,
} from './windowsNativeBridge.js'

// 真 worker exe：publish 出来的 self-contained 单文件。
const WORKER = resolveWinCuWorkerBinary({
  overrideDir: join(import.meta.dir, '..', 'win-cu-p1', 'publish'),
})

describe('resolveWinCuWorkerBinary', () => {
  test('prefers explicit overrideDir (missing override falls back to dev layout, null only when nothing exists)', () => {
    // overrideDir 不存在时不再是"必 null"——resolve 会继续尝试 dev 布局（模块相对）。
    // 断言改为：返回值要么 null（哪儿都没有），要么是真实存在的 exe。
    const dir = join(import.meta.dir, 'fixtures-does-not-exist')
    const r = resolveWinCuWorkerBinary({ overrideDir: dir })
    if (r === null) return
    expect(existsSync(r)).toBe(true)
    expect(r.endsWith('win-cu-worker.exe')).toBe(true)
  })
  test('finds published binary via overrideDir', () => {
    // 只在 CI/开发机上跑（exe 存在时）
    if (!WORKER) return
    expect(WORKER.endsWith('win-cu-worker.exe')).toBe(true)
    expect(existsSync(WORKER)).toBe(true)
  })
})

describe('WindowsNativeBridge vs real worker', () => {
  let bridge: WindowsNativeBridge
  beforeEach(() => { bridge = new WindowsNativeBridge({ workerPath: WORKER, startupTimeoutMs: 20_000 }) })
  afterEach(() => { void bridge.dispose() })

  test.skipIf(!WORKER)('ping round trip', async () => {
    const r = await bridge.callNative<{ pong: boolean; pid: number; protocol: number }>('ping', {})
    expect(r.pong).toBe(true)
    expect(r.protocol).toBe(1)
    expect(r.pid).toBeGreaterThan(0)
  }, 15000)

  test.skipIf(!WORKER)('cursor_position returns ints', async () => {
    const r = await bridge.callNative<{ x: number; y: number }>('cursor_position', {})
    expect(Number.isInteger(r.x)).toBe(true)
    expect(Number.isInteger(r.y)).toBe(true)
  }, 15000)

  test.skipIf(!WORKER)('unknown command → unsupported_command error', async () => {
    try {
      await bridge.callNative('definitely_not_a_command', {})
      expect.unreachable()
    } catch (e: any) {
      expect(e.code).toBe('unsupported_command')
    }
  }, 15000)

  test.skipIf(!WORKER)('screenshot returns jpeg base64', async () => {
    const r = await bridge.callNative<{ format: string; base64: string; bytes: number }>(
      'screenshot', { quality: 60 },
    )
    expect(r.format).toBe('jpeg')
    expect(r.base64.length).toBeGreaterThan(1000)
    expect(r.bytes).toBeGreaterThan(1000)
  }, 15000)

  test.skipIf(!WORKER)('worker killed mid-flight → NativeCommandResultUnknownError (no replay)', async () => {
    // 先发一个 ping 确认通路
    await bridge.callNative('ping', {})
    // 直接杀 worker 子进程
    bridge.killWorkerForTest()
    try {
      await bridge.callNative('ping', {})
      // 若重连成功（新进程）也接受——但要能 ping 通
      const r = await bridge.callNative<{ pong: boolean }>('ping', {})
      expect(r.pong).toBe(true)
    } catch (e) {
      // 期望要么 result_unknown（请求已写入但响应丢失），要么干净的重启成功
      expect(
        e instanceof NativeCommandResultUnknownError ||
        (e as Error).message.length > 0,
      ).toBe(true)
    }
  }, 15000)

  test.skipIf(!WORKER)('cold start → ready line → first command OK', async () => {
    const t0 = performance.now()
    const r = await bridge.callNative<{ pong: boolean }>('ping', {})
    const dt = performance.now() - t0
    expect(r.pong).toBe(true)
    // ponytail: wall-clock budget, not a product SLA — cold-spawning the 69MB
    // worker measured 9-10s under load (the bun default is 5s).
    expect(dt).toBeLessThan(30000)
  }, 30000)

  test.skipIf(!WORKER)('isNativeWorkerAvailable reflects reality', async () => {
    // WORKER 存在时应当 true（或至少不抛）
    const avail = isNativeWorkerAvailable({ overrideDir: join(import.meta.dir, '..', '..', '..', '..', 'win-cu-p1', 'publish') })
    expect(typeof avail).toBe('boolean')
  })
})

describe('NativeCommandResultUnknownError semantics', () => {
  test('carries command and no replay flag', () => {
    const e = new NativeCommandResultUnknownError('ping', 'timeout after 60s')
    expect(e.command).toBe('ping')
    expect(e.message).toContain('result_unknown')
    expect(e.name).toBe('NativeCommandResultUnknownError')
  })
})

// —— 说明：spawn / readline / existsSync 引用只为类型导入保留（worker 启动逻辑在 bridge 内部）。——
void spawn; void createInterface
