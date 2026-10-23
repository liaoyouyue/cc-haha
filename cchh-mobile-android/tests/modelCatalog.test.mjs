import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProviders, parseModels, parseCurrent, parseEffort, sameModel, slotsForModel,
} from '../modelCatalog.mjs';

// Shapes captured from a live CCHH 0.7.4 sidecar (61692).
const providersPayload = {
  activeId: 'e55cdd99-8f9d-45a6-8c93-7b236a7a5208',
  providers: [
    { id: 'e55cdd99-8f9d-45a6-8c93-7b236a7a5208', name: 'FreeLLMAPI 免费网关', apiFormat: 'anthropic',
      models: { main: 'auto', fable: 'auto', haiku: 'auto', sonnet: 'auto', opus: 'auto' } },
    { id: 'a46adf1e-d6c0-47b9-a8df-38ca7165fd2c', name: 'FreeRouter 付费', apiFormat: 'openai_chat',
      models: { main: 'pro/deepseek-v4-flash-0731', fable: 'pro/deepseek-v4-flash-0731',
        haiku: 'pro/deepseek-v4-flash-0731', sonnet: 'pro/deepseek-v4-flash-0731', opus: 'pro/deepseek-v4-flash-0731' } },
    { id: 'bc1f627a-3726-486f-946b-7307dffca2c5', name: 'AruHub', apiFormat: 'anthropic',
      models: { main: 'gpt-6.1-sol', fable: 'gpt-6.1-sol', haiku: 'gpt-6.1-sol', sonnet: 'gpt-6.1-sol', opus: 'gpt-6.1-sol' } },
  ],
};

test('parseProviders keeps every provider and marks the active one', () => {
  const { providers, activeId } = parseProviders(providersPayload);
  assert.equal(activeId, 'e55cdd99-8f9d-45a6-8c93-7b236a7a5208');
  assert.equal(providers.length, 3); // no filtering: free and paid both listed
  assert.equal(providers.filter(p => p.isActive).length, 1);
  assert.equal(providers[0].isActive, true);
  assert.deepEqual(providers[1].slots.main, 'pro/deepseek-v4-flash-0731');
  assert.deepEqual(providers[1].slots.opus, 'pro/deepseek-v4-flash-0731');
});

test('parseProviders tolerates missing/odd payloads', () => {
  assert.deepEqual(parseProviders(null), { activeId: null, providers: [] });
  assert.deepEqual(parseProviders({ providers: [{}, null] }), { activeId: null, providers: [] });
  const partial = parseProviders({ providers: [{ id: 'x', models: { main: 'm1', opus: '  ' } }] });
  assert.deepEqual(partial.providers[0].slots, { main: 'm1' });
});

test('parseModels lists the active provider catalog without truncation', () => {
  const models = parseModels({ models: [
    { id: 'auto', name: 'auto', description: 'Main model', context: '' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra', description: 'Frontier', context: '258400' },
    { bad: true },
  ]});
  assert.equal(models.length, 2);
  assert.equal(models[1].context, '258400');
});

test('parseCurrent and parseEffort mirror the desktop state', () => {
  assert.deepEqual(parseCurrent({ model: { id: 'auto', name: 'auto' } }), { id: 'auto', name: 'auto' });
  assert.equal(parseCurrent({}), null);
  assert.deepEqual(parseEffort({ level: 'high', available: ['low','medium','high','xhigh','max'] }),
    { level: 'high', available: ['low','medium','high','xhigh','max'] });
});

test('sameModel ignores tier suffix and case so readback verification is honest', () => {
  assert.equal(sameModel('auto', 'auto[1m]'), true);
  assert.equal(sameModel('GPT-6-Sol', 'gpt-6-sol'), true);
  assert.equal(sameModel('auto', 'gpt-6-sol'), false);
  assert.equal(sameModel('', ''), false);
});

test('slotsForModel names the slots currently bound to a model', () => {
  const { providers } = parseProviders(providersPayload);
  assert.deepEqual(slotsForModel(providers[0], 'auto[1m]'),
    ['主模型','Fable','Haiku','Sonnet','Opus']);
  assert.deepEqual(slotsForModel(providers[2], 'gpt-6.1-sol'), ['主模型','Fable','Haiku','Sonnet','Opus']);
  assert.deepEqual(slotsForModel(providers[2], 'nope'), []);
});