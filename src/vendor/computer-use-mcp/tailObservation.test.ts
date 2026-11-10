import { describe, test, expect, afterEach } from 'bun:test'
import { _test } from './windowsLegacyToolCalls.js'
import type { ComputerUseHostAdapter, ComputerUseOverrides } from './types.js'

const { withTailObservation } = _test as {
  withTailObservation: (
    adapter: ComputerUseHostAdapter,
    overrides: ComputerUseOverrides,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | { content: unknown[] }>
}

const LAST_SHOT = {
  base64: 'pre-batch-jpeg-data',
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  displayId: 0,
  originX: 0,
  originY: 0,
}

function fakeAdapter(zoomImpl?: () => Promise<{ base64: string }>) {
  return {
    executor: {
      zoom: zoomImpl ?? (async () => ({ base64: 'tail-crop-jpeg' })),
    },
  } as unknown as ComputerUseHostAdapter
}

const overrides = { lastScreenshot: LAST_SHOT } as unknown as ComputerUseOverrides
const noShot = {} as unknown as ComputerUseOverrides

describe('withTailObservation (P4-a)', () => {
  afterEach(() => { delete process.env.CC_HAHA_CU_TAIL_OBS })

  test('env off → payload untouched (default off)', async () => {
    delete process.env.CC_HAHA_CU_TAIL_OBS // 并发文件可能刚设过
    const payload = { completed: [{ action: 'key', ok: true }] }
    const r = await withTailObservation(fakeAdapter(), overrides, payload)
    expect(r).toBe(payload) // same reference — nothing appended
  })

  test('env on + lastScreenshot → appends tailObservation with stamp + guard note', async () => {
    process.env.CC_HAHA_CU_TAIL_OBS = '1'
    const r = (await withTailObservation(fakeAdapter(), overrides, { completed: [] })) as Record<string, unknown>
    const tail = r.tailObservation as Record<string, unknown>
    expect(tail).toBeTruthy()
    expect(tail.capturedAfterBatch).toBe(true)
    expect(typeof tail.capturedAtMs).toBe('number')
    expect(String(tail.note)).toContain('does NOT prove')
    expect(String(tail.note)).toContain('Do NOT click')
    const img = tail.image as Record<string, unknown>
    expect(img.mimeType).toBe('image/jpeg')
    expect(img.data).toBe('tail-crop-jpeg')
  })

  test('env on but no lastScreenshot → untouched', async () => {
    process.env.CC_HAHA_CU_TAIL_OBS = '1'
    const payload = { completed: [] }
    const r = await withTailObservation(fakeAdapter(), noShot, payload)
    expect(r).toBe(payload)
  })

  test('zoom throws → batch result survives (best-effort)', async () => {
    process.env.CC_HAHA_CU_TAIL_OBS = '1'
    const payload = { completed: [{ action: 'key', ok: true }] }
    const r = await withTailObservation(
      fakeAdapter(async () => { throw new Error('capture failed') }),
      overrides,
      payload,
    )
    expect(r).toBe(payload)
  })

  test('crop region is the center quarter (logical coords)', async () => {
    process.env.CC_HAHA_CU_TAIL_OBS = '1'
    let captured: unknown
    const adapter = fakeAdapter()
    ;(adapter.executor as { zoom: (r: unknown) => Promise<{ base64: string }> }).zoom = async (r: unknown) => {
      captured = r
      return { base64: 'x' }
    }
    await withTailObservation(adapter, overrides, { completed: [] })
    // displayWidth 1920/4 = 480, originX 0 → x = (1920-480)/2 = 720
    expect(captured).toEqual({ x: 720, y: 405, w: 480, h: 270 })
  })
})
