import { describe, expect, test } from 'bun:test'
import {
  roughTokenCountEstimationForContent,
  roughTokenCountEstimationForThinking,
} from './tokenEstimation.js'
import { OPENAI_REASONING_ENVELOPE_PREFIX } from '../utils/openAIReasoningEnvelope.js'

describe('roughTokenCountEstimationForContent', () => {
  test('does not treat OpenAI encrypted reasoning bytes as plaintext tokens', () => {
    const data = `${OPENAI_REASONING_ENVELOPE_PREFIX}${JSON.stringify({
      id: 'rs_test',
      summary: [{ type: 'summary_text', text: 'visible summary' }],
      encrypted_content: 'x'.repeat(400_000),
    })}`

    expect(
      roughTokenCountEstimationForContent([
        { type: 'redacted_thinking', data },
      ]),
    ).toBe(4)
  })

  test('keeps estimating non-OpenAI redacted thinking payloads', () => {
    expect(
      roughTokenCountEstimationForContent([
        { type: 'redacted_thinking', data: 'x'.repeat(400) },
      ]),
    ).toBe(100)
  })
})

describe('roughTokenCountEstimationForThinking', () => {
  // Stands in for the engine's reasoning count where it reports none, so the
  // split between deliberation and answer stays available on any endpoint.
  test('counts thinking blocks only', () => {
    // 600 chars of thinking at 4 bytes/token = 150; the text block's 800 chars
    // belong to the output total and must not be added here.
    const estimate = roughTokenCountEstimationForThinking([
      { type: 'thinking', thinking: 'x'.repeat(600) },
      { type: 'text', text: 'y'.repeat(800) },
    ])
    expect(estimate).toBe(150)
  })

  test('reads nothing from a turn that did not think', () => {
    expect(roughTokenCountEstimationForThinking([{ type: 'text', text: 'answer' }])).toBe(0)
    expect(roughTokenCountEstimationForThinking('plain string content')).toBe(0)
    expect(roughTokenCountEstimationForThinking(undefined)).toBe(0)
  })

  test('includes redacted thinking, which is thinking the reader cannot see', () => {
    expect(
      roughTokenCountEstimationForThinking([
        { type: 'redacted_thinking', data: 'x'.repeat(400) },
      ]),
    ).toBe(100)
  })
})
