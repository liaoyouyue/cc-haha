import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'visual-guard-api-'))
process.env.CLAUDE_CONFIG_DIR = root
const { handleVisualGuardApi } = await import('./visual-guard.js')
const { handleApiRequest } = await import('../router.js')

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test('config accepts bounded desktop settings without secrets', async () => {
  const request = new Request('http://localhost/api/visual-guard/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hwnd: 123, region: [1, 2, 300, 200] }),
  })
  const response = await handleVisualGuardApi(request, ['api', 'visual-guard', 'config'])
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ hwnd: 123, region: [1, 2, 300, 200] })
})

test('remote browser cannot access desktop visual guard controls', async () => {
  const request = new Request('http://localhost/api/visual-guard/status')
  const response = await handleApiRequest(request, new URL(request.url), { remoteBrowser: true })
  expect(response.status).toBe(403)
})

test('config rejects invalid capture regions', async () => {
  const request = new Request('http://localhost/api/visual-guard/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ region: [1, 2, -3] }),
  })
  const response = await handleVisualGuardApi(request, ['api', 'visual-guard', 'config'])
  expect(response.status).toBe(400)
})
