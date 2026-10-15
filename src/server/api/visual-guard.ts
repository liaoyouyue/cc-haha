import { visualGuardService, type VisualGuardConfig } from '../services/visualGuardService.js'

function errorResponse(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : '真实之眼请求失败'
  // `message` is what the desktop client surfaces; `error` is kept for the
  // existing shape.
  return Response.json({ error: message, message }, { status })
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
    if (req.method === 'GET' && action === 'windows') return Response.json({ windows: await visualGuardService.windows() })

    if (req.method === 'PUT' && action === 'config') {
      const body = await jsonObject(req)
      const update: VisualGuardConfig = {}
      if (body.hwnd !== undefined) {
        if (!Number.isInteger(body.hwnd) || Number(body.hwnd) <= 0) throw new Error('hwnd 无效')
        update.hwnd = Number(body.hwnd)
      }
      if (body.region !== undefined) {
        if (!Array.isArray(body.region) || body.region.length !== 4 || body.region.some(value => !Number.isFinite(value))) throw new Error('region 无效')
        update.region = body.region.map(Number) as VisualGuardConfig['region']
      }
      return Response.json(await visualGuardService.saveConfig(update))
    }

    if (req.method === 'POST' && action === 'select-region') return Response.json(await visualGuardService.selectRegion())
    if (req.method === 'POST' && action === 'see') return Response.json(await visualGuardService.see())
    if (req.method === 'POST' && action === 'find') {
      const body = await jsonObject(req)
      if (typeof body.query !== 'string') throw new Error('query 必须是字符串')
      return Response.json(await visualGuardService.find(body.query.slice(0, 200)))
    }
    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
