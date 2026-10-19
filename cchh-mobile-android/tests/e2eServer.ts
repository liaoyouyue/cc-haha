// Isolated CCHH server for the Android emulator smoke. Runs with a fake key,
// a temporary HOME/config dir, and the deterministic mock CLI fixture.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startServer } from '../../src/server/index.js'
import { H5AccessService } from '../../src/server/services/h5AccessService.js'

const configDir = process.env.CLAUDE_CONFIG_DIR!
await mkdir(configDir, { recursive: true })
await writeFile(path.join(configDir, 'settings.json'),
  JSON.stringify({ env: { ANTHROPIC_API_KEY: 'fake-e2e-key' }, language: 'en' }))
process.env.CLAUDE_CLI_PATH = path.resolve(import.meta.dir, '../../src/server/__tests__/fixtures/mock-sdk-cli.ts')

const h5 = new H5AccessService()
const { token } = await h5.enable()
const server = startServer(0, '0.0.0.0')
const local = `http://127.0.0.1:${server.port}`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const created = await (await fetch(`${local}/api/sessions`, {
  method: 'POST', headers, body: JSON.stringify({ workDir: process.env.HOME, permissionMode: 'default' }),
})).json() as { sessionId?: string }
if (!created.sessionId) throw new Error('Session creation failed')
const list = await (await fetch(`${local}/api/sessions?limit=100`, { headers })).json() as { sessions?: Array<{ id: string; title?: string }> }
const title = list.sessions?.find(item => item.id === created.sessionId)?.title || '未命名会话'
await writeFile(process.env.CCHH_E2E_INFO!, JSON.stringify({ port: server.port, token, sessionId: created.sessionId, title }))
console.log('E2E_SERVER_READY')
await new Promise(() => {})
