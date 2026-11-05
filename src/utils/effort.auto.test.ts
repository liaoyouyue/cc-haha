import { beforeEach, describe, expect, test } from 'bun:test'
import { isolateModelDefaultsEnv } from '../testUtils/modelEnv.js'
import { AUTO_EFFORT, pickAutoEffort, resolveAppliedEffort, rememberAutoEffortResult, clearAutoEffortMemory } from './effort.js'

isolateModelDefaultsEnv()

// pickAutoEffort keeps a per-model memory; reset it so cases stay independent.
beforeEach(() => {
  clearAutoEffortMemory()
})

describe('auto effort policy', () => {
  test('very long prompts map to max depth', () => {
    const long = 'x'.repeat(9000)
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: long })).toBe('max')
  })

  test('substantial prompts map to high', () => {
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: 'x'.repeat(2000) })).toBe('high')
  })

  test('short prompts map to low', () => {
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: 'hi' })).toBe('low')
  })

  test('mid-size prompts map to medium', () => {
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: 'x'.repeat(500) })).toBe('medium')
  })

  test('agent tasks map to high', () => {
    expect(pickAutoEffort('claude-opus-5-5', { type: 'agent-task' })).toBe('high')
  })

  test('cheap paths map to low/medium', () => {
    expect(pickAutoEffort('claude-opus-5-5', { type: 'simple-task' })).toBe('low')
    expect(pickAutoEffort('claude-opus-5-5')).toBe('medium')
  })

  test('resolveAppliedEffort expands auto to a concrete wire level', () => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    const resolved = resolveAppliedEffort('claude-opus-5-5', AUTO_EFFORT, {
      autoSignal: { type: 'user-text', text: 'x'.repeat(9000) },
    })
    expect(resolved).toBe('max')
  })

  test('remembered level fills in when no signal is given', () => {
    rememberAutoEffortResult('claude-opus-5-5', 'low')
    expect(pickAutoEffort('claude-opus-5-5')).toBe('low')
  })

  test('explicit signal overrides remembered level', () => {
    rememberAutoEffortResult('claude-opus-5-5', 'low')
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: 'x'.repeat(2000) })).toBe('high')
    expect(pickAutoEffort('claude-opus-5-5', { type: 'agent-task' })).toBe('high')
  })

  test('auto never leaks to the wire as a string', () => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    const resolved = resolveAppliedEffort('claude-opus-5-5', AUTO_EFFORT)
    expect(resolved === 'auto').toBe(false)
  })

  test('no keyword dependence: plain words never change the level', () => {
    // The same length, with and without "magic" words, scores identically.
    const withWords = 'please ultrathink this architecture refactor why debug analyze'
    const withoutWords = 'x'.repeat(withWords.length)
    expect(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: withWords }))
      .toBe(pickAutoEffort('claude-opus-5-5', { type: 'user-text', text: withoutWords }))
  })
})
