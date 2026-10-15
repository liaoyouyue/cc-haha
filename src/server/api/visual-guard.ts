import { visualGuardService, type VisualGuardConfig } from '../services/visualGuardService.js'

function errorResponse(error: unknown, status = 400): Response {
  return Response.json({ error: error instanceof Error ? error.message : '视觉值守请求失败' }, { status })
}

async function jsonObject(req: Request): Promise<Record<string, unknown>> {
  const value: unknown = await req.json()
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是对象')
  return value as Record<string, unknown>
}

export async function handleVisualGuardApi(req: Request, segments: string[]): Promise<Response> {
  const action = segments[2] ?? 'status'
  try {
    if (req.method === 'GET' && action === 'status') return Response.json(visualGuardService.status())
    if (req.method === 'GET' && action === 'config') return Response.json(await visualGuardService.getConfig())
    if (req.method === 'GET' && action === 'providers') return Response.json(await visualGuardService.providers())
    if (req.method === 'GET' && action === 'windows') return Response.json({ windows: await visualGuardService.windows() })

    if (req.method === 'PUT' && action === 'config') {
      const body = await jsonObject(req)
      const update: Partial<VisualGuardConfig> = {}
      if (body.hwnd !== undefined) {
        if (!Number.isInteger(body.hwnd) || Number(body.hwnd) <= 0) throw new Error('hwnd 无效')
        update.hwnd = Number(body.hwnd)
      }
      if (body.region !== undefined) {
        if (!Array.isArray(body.region) || body.region.length !== 4 || body.region.some(value => !Number.isFinite(value))) throw new Error('region 无效')
        update.region = body.region.map(Number) as VisualGuardConfig['region']
      }
      if (body.interval !== undefined) {
        const interval = Number(body.interval)
        if (!Number.isFinite(interval) || interval < 1 || interval > 3600) throw new Error('interval 必须在 1 到 3600 秒之间')
        update.interval = interval
      }
      for (const key of ['providerId', 'model', 'company', 'style', 'banned', 'sop', 'knowledge'] as const) {
        if (body[key] !== undefined) {
          if (typeof body[key] !== 'string') throw new Error(`${key} 必须是字符串`)
          update[key] = body[key].slice(0, key === 'knowledge' ? 200_000 : 20_000)
        }
      }
      return Response.json(await visualGuardService.saveConfig(update))
    }

    if (req.method === 'POST' && action === 'select-region') return Response.json(await visualGuardService.selectRegion())
    if (req.method === 'POST' && action === 'recognize') return Response.json(await visualGuardService.recognize())
    if (req.method === 'POST' && action === 'start') { await visualGuardService.start(); return Response.json(visualGuardService.status()) }
    if (req.method === 'POST' && action === 'pause') { await visualGuardService.pause(); return Response.json(visualGuardService.status()) }
    if (req.method === 'POST' && action === 'resume') { await visualGuardService.resume(); return Response.json(visualGuardService.status()) }
    if (req.method === 'POST' && action === 'stop') { await visualGuardService.stop(); return Response.json(visualGuardService.status()) }
    if (req.method === 'POST' && action === 'review') {
      const body = await jsonObject(req)
      if (typeof body.content !== 'string') throw new Error('content 必须是字符串')
      await visualGuardService.review(body.content)
      return Response.json(visualGuardService.status())
    }
    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
