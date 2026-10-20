import test from 'node:test';
import assert from 'node:assert/strict';
import {isForegroundResume,reconnectDelayMs} from '../mobileRecovery.mjs';

test('isForegroundResume',()=>{
  assert.equal(isForegroundResume('background','active'),true);
  assert.equal(isForegroundResume('inactive','active'),true);
  assert.equal(isForegroundResume('active','active'),false);
  assert.equal(isForegroundResume('active','background'),false);
});

test('reconnectDelayMs caps at 30s with bounded exponent',()=>{
  assert.equal(reconnectDelayMs(0),1000);
  assert.equal(reconnectDelayMs(1),2000);
  assert.equal(reconnectDelayMs(5),30000);
  assert.equal(reconnectDelayMs(10),30000);
  assert.equal(reconnectDelayMs(NaN),1000);
});
