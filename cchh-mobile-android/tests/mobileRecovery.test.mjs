import test from 'node:test';
import assert from 'node:assert/strict';
import { isForegroundResume, reconnectDelayMs } from '../mobileRecovery.mjs';

test('reconnect only when returning to the foreground after suspension', () => {
  assert.equal(isForegroundResume('background', 'active'), true);
  assert.equal(isForegroundResume('inactive', 'active'), true);
  for (const [prev, next] of [
    ['active', 'active'], ['unknown', 'active'],
    ['active', 'inactive'], ['background', 'background'],
    ['inactive', 'background'],
  ]) assert.equal(isForegroundResume(prev, next), false);
});

test('reconnect backoff remains bounded, even for invalid attempts', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 999].map(reconnectDelayMs),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  for (const n of [-1, Number.NaN, Infinity]) assert.equal(reconnectDelayMs(n), 1000);
});
