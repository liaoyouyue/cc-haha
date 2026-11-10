// P4-a A/B：30 次真实 batch 调用 × 开/关 tailObservation。
// 链路：handleComputerBatch 真实 dispatch（mock 最少 adapter 面）→ executor.zoom 走
// helperBridge →（worker 可用时）C# worker；否则 Python resident。
// 量：响应体积、zoom 附加耗时、成功/失败、tailObservation 字段有无。
// 红线：只读屏幕；不 commit。
import { describe, test, expect, afterEach } from 'bun:test'
import { _test as legacy } from './windowsLegacyToolCalls.js'
import { callHelper } from '../../utils/computerUse/helperBridge.js'

const { withTailObservation } = legacy as {
  withTailObservation: (
    adapter: any,
    overrides: any,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
}

const N = 30

function realAdapter(): any {
  // executor.zoom 走真实 helperBridge（P1 接线后 native-first）
  return {
    executor: {
      zoom: async (regionLogical: any) => {
        const display = await callHelper<any>('get_display_size', {})
        const sf = display.scaleFactor ?? 1
        return callHelper<any>('zoom', {
          x: Math.round(regionLogical.x),
          y: Math.round(regionLogical.y),
          width: Math.round(regionLogical.w),
          height: Math.round(regionLogical.h),
          targetWidth: Math.round(regionLogical.w * sf),
          targetHeight: Math.round(regionLogical.h * sf),
        })
      },
    },
  }
}

const overrides = {
  lastScreenshot: {
    base64: 'x', // 尾图不依赖 pre-batch 图内容，仅用其几何
    width: 1920, height: 1080,
    displayWidth: 1920, displayHeight: 1080,
    displayId: 0, originX: 0, originY: 0,
  },
} as any

describe('P4-a A/B x30 (real chain)', () => {
  // bun 并发跑测试文件会串 env：每个用例后强制清掉
  afterEach(() => { delete process.env.CC_HAHA_CU_TAIL_OBS })
  test('B 组: env off — 30 次, 无 tailObservation, 基线耗时', async () => {
    delete process.env.CC_HAHA_CU_TAIL_OBS
    const adapter = realAdapter()
    const t: number[] = []
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const r = await withTailObservation(adapter, overrides, { completed: [{ action: 'key', ok: true }] })
      t.push(performance.now() - t0)
      expect((r as any).tailObservation).toBeUndefined()
    }
    const s = [...t].sort((a, b) => a - b)
    console.log(`B(off): n=${N} p50=${s[N >> 1].toFixed(2)}ms max=${s[N - 1].toFixed(2)}ms`)
  }, 120_000)

  test('A 组: env on — 30 次, 有 tailObservation + 真实 crop 图', async () => {
    process.env.CC_HAHA_CU_TAIL_OBS = '1'
    const adapter = realAdapter()
    const t: number[] = []
    let totalB64 = 0
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const r = (await withTailObservation(adapter, overrides, { completed: [{ action: 'key', ok: true }] })) as any
      t.push(performance.now() - t0)
      expect(r.tailObservation?.capturedAfterBatch).toBe(true)
      expect(typeof r.tailObservation?.capturedAtMs).toBe('number')
      const b64: string = r.tailObservation?.image?.data ?? ''
      expect(b64.length).toBeGreaterThan(500)
      if (i === 0) totalB64 = b64.length
    }
    const s = [...t].sort((a, b) => a - b)
    console.log(`A(on): n=${N} p50=${s[N >> 1].toFixed(2)}ms max=${s[N - 1].toFixed(2)}ms cropB64≈${totalB64} chars`)
  }, 120_000)
})
