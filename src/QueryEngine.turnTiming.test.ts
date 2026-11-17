import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../scripts/pr/test-environment.js'

/**
 * The context panel's speed and TTFT rows read the timings the CLI reports on its
 * `result` message. The desktop gets them over the SDK socket, so the CLI's
 * result is the only carrier — a result without them leaves the panel showing
 * `--` for the measured rate and the first-token latency.
 */

const home = mkdtempSync(join(tmpdir(), 'query-turn-timing-'))
const originalEnv = { ...process.env }
const previousMacro = (globalThis as any).MACRO
;(globalThis as any).MACRO = { VERSION: 'fixture', BUILD_TIME: 'fixture' }
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, createSandboxedTestEnvironment(home, { CLAUDE_CODE_SIMPLE: '1', DISABLE_TELEMETRY: '1' }, originalEnv))

const originals = {
  input: { ...await import('./utils/processUserInput/processUserInput.js') },
  storage: { ...await import('./utils/sessionStorage.js') },
  context: { ...await import('./utils/queryContext.js') },
  query: { ...await import('./query.js') },
}

mock.module('./utils/queryContext.js', () => ({ ...originals.context,
  fetchSystemPromptParts: async () => ({ defaultSystemPrompt: [], userContext: {}, systemContext: {} }),
}))
mock.module('./utils/processUserInput/processUserInput.js', () => ({ ...originals.input,
  processUserInput: async () => ({ messages: [{ role: 'user', content: 'hi' }], shouldQuery: true, allowedTools: [] }),
}))
mock.module('./utils/sessionStorage.js', () => ({ ...originals.storage,
  recordTranscript: async () => {}, flushSessionStorage: async () => {},
}))

const TTFT_MS = 1_234
const DECODE_MS = 5_678

mock.module('./query.js', () => ({ ...originals.query,
  query: async function* () {
    // The API layer reports the first-token wait on message_start and the
    // generation span on message_stop, both as top-level fields of the
    // stream_event. The engine accumulates them per turn.
    yield { type: 'stream_event', event: { type: 'message_start', message: { usage: {} } }, ttftMs: TTFT_MS }
    yield { type: 'stream_event', event: { type: 'message_stop' }, decodeMs: DECODE_MS }
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 3, output_tokens: 1 } },
      uuid: 'assistant-1',
    }
  },
}))

const { QueryEngine } = await import('./QueryEngine.js')
const { getDefaultAppState } = await import('./state/AppStateStore.js')

function engine() {
  let state = getDefaultAppState()
  return new QueryEngine({
    cwd: home, tools: [], commands: [], mcpClients: [], agents: [],
    readFileCache: new Map() as any,
    customSystemPrompt: 'fixture', userSpecifiedModel: 'claude-sonnet-4-5',
    thinkingConfig: { type: 'disabled' },
    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    getAppState: () => state, setAppState: update => { state = update(state) },
  })
}

async function collectResults() {
  const results = []
  for await (const message of engine().submitMessage('hi' as any, { uuid: 'current-command' })) {
    if (message.type === 'result') results.push(message as Record<string, unknown>)
  }
  return results
}

beforeEach(() => { /* per-test state comes from a fresh engine */ })
afterAll(() => {
  for (const [path, mod] of Object.entries({
    './utils/processUserInput/processUserInput.js': originals.input,
    './utils/sessionStorage.js': originals.storage,
    './utils/queryContext.js': originals.context,
    './query.js': originals.query,
  })) mock.module(path, () => mod)
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  if (previousMacro === undefined) delete (globalThis as any).MACRO
  else (globalThis as any).MACRO = previousMacro
  rmSync(home, { recursive: true, force: true })
})

test('a completed turn reports its generation timings on the result message', async () => {
  const results = await collectResults()
  const success = results.find(r => r.subtype === 'success')
  expect(success).toBeDefined()
  // The desktop reads these two to derive the measured output rate and the
  // first-token latency; without them both rows stay `--`.
  expect(success!.ttft_ms).toBe(TTFT_MS)
  expect(success!.decode_ms).toBe(DECODE_MS)
})
