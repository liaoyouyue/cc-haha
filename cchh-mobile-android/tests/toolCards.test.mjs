import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolCardsFromContent, toolCardSummary, hasToolCards } from '../toolCards.mjs';

test('toolCardsFromContent pairs tool_use with tool_result', () => {
  const content = [
    { type: 'text', text: 'checking…' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } },
    { type: 'tool_result', tool_use_id: 't1', content: 'file1\nfile2', is_error: false },
    { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.ts' } },
    { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'export const a = 1' }], is_error: false },
  ];
  const cards = toolCardsFromContent(content);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, 'Bash');
  assert.equal(cards[0].output, 'file1\nfile2');
  assert.equal(cards[0].complete, true);
  assert.equal(cards[1].output, 'export const a = 1');
});

test('unpaired tool_use is dropped (no card until result arrives)', () => {
  const content = [
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 1' } },
  ];
  assert.deepEqual(toolCardsFromContent(content), []);
  assert.equal(hasToolCards(content), false);
});

test('error results mark the card', () => {
  const content = [
    { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
    { type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true },
  ];
  const cards = toolCardsFromContent(content);
  assert.equal(cards[0].isError, true);
});

test('toolCardSummary is compact', () => {
  const cards = toolCardsFromContent([
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } },
    { type: 'tool_result', tool_use_id: 't1', content: 'hi', is_error: false },
  ]);
  const summary = toolCardSummary(cards[0]);
  assert.ok(summary.includes('Bash'));
  assert.ok(summary.includes('echo hi'));
  assert.ok(summary.includes('hi'));
  assert.ok(summary.length < 300);
});