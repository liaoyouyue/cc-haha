import { ackTaskInbox, listTaskInbox } from '../services/taskInboxService.js'

export function handleTaskInboxApi(req: Request, url: URL): Response {
  const segments = url.pathname.split('/').filter(Boolean)
  // /api/task-inbox | /api/task-inbox/ack
  if (segments[2] === 'ack' && req.method === 'POST') {
    ackTaskInbox()
    return Response.json({ ok: true })
  }
  if (req.method === 'GET') return Response.json(listTaskInbox())
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
