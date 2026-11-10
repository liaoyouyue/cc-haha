import { describe, expect, test } from 'bun:test'
import { anthropicToOpenaiChat } from './anthropicToOpenaiChat.js'

describe('OpenAI Chat thinking toggle compatibility', () => {
  for (const [input, expected] of [['adaptive', 'enabled'], ['enabled', 'enabled'], ['disabled', 'disabled']] as const) {
    test(`sends ${expected} for Anthropic ${input} thinking`, () => {
      const result = anthropicToOpenaiChat({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 256,
        thinking: { type: input },
        output_config: { effort: 'high' },
      }, { passThinkingToggle: true })

      expect(result.thinking).toEqual({ type: expected })
      expect(result.reasoning_effort).toBe('high')
    })
  }

  test('does not introduce the toggle on endpoints that did not opt in', () => {
    expect(anthropicToOpenaiChat({
      model: 'fixture', messages: [], max_tokens: 256, thinking: { type: 'adaptive' },
    }).thinking).toBeUndefined()
  })
})

describe('high effort drives thinking budget', () => {
  test('max effort maps to a 65536-token budget', () => {
    const result = anthropicToOpenaiChat({
      model: 'deepseek-v4-pro', messages: [], max_tokens: 1024,
      output_config: { effort: 'max' },
    }, { passThinkingToggle: true })
    expect(result.thinking?.budget_tokens).toBe(65536)
  })

  test('xhigh effort maps to a 32768-token budget', () => {
    const result = anthropicToOpenaiChat({
      model: 'deepseek-v4-pro', messages: [], max_tokens: 1024,
      output_config: { effort: 'xhigh' },
    }, { passThinkingToggle: true })
    expect(result.thinking?.budget_tokens).toBe(32768)
  })

  test('an explicit envelope budget wins over the effort-derived one', () => {
    const result = anthropicToOpenaiChat({
      model: 'deepseek-v4-pro', messages: [], max_tokens: 1024,
      output_config: { effort: 'max' },
      thinking: { type: 'enabled', budget_tokens: 16000 },
    }, { passThinkingToggle: true })
    expect(result.thinking?.budget_tokens).toBe(16000)
  })

  test('low effort does not set a budget', () => {
    const result = anthropicToOpenaiChat({
      model: 'deepseek-v4-pro', messages: [], max_tokens: 1024,
      output_config: { effort: 'low' },
    })
    expect(result.thinking?.budget_tokens).toBeUndefined()
  })
})
