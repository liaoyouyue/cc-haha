import { describe, expect, it } from 'bun:test'
import {
  SDKPartialAssistantMessageSchema,
  SDKResultSuccessSchema,
} from './coreSchemas.js'

describe('SDK schemas and generation timings', () => {
  it('keeps ttftMs/decodeMs on a partial assistant message', () => {
    const parsed = SDKPartialAssistantMessageSchema().parse({
      type: 'stream_event',
      event: { type: 'message_start' },
      parent_tool_use_id: null,
      uuid: '00000000-0000-4000-8000-000000000000',
      session_id: 's1',
      ttftMs: 1234,
      decodeMs: 5678,
    })
    console.log('parsed partial:', JSON.stringify(parsed))
    expect((parsed as Record<string, unknown>).ttftMs).toBe(1234)
    expect((parsed as Record<string, unknown>).decodeMs).toBe(5678)
  })

  it('keeps decode_ms/ttft_ms on a success result', () => {
    const parsed = SDKResultSuccessSchema().parse({
      type: 'result',
      subtype: 'success',
      duration_ms: 1000,
      duration_api_ms: 900,
      is_error: false,
      num_turns: 1,
      result: '',
      stop_reason: null,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 2 },
      modelUsage: {},
      permission_denials: [],
      uuid: '00000000-0000-4000-8000-000000000000',
      session_id: 's1',
      decode_ms: 4321,
      ttft_ms: 876,
    })
    console.log('parsed result:', JSON.stringify(parsed))
    expect((parsed as Record<string, unknown>).decode_ms).toBe(4321)
    expect((parsed as Record<string, unknown>).ttft_ms).toBe(876)
  })
})
