import test from 'node:test';
import assert from 'node:assert/strict';
import {isForegroundResume,reconnectDelayMs} from '../mobileRecovery.mjs';

test('isForegroundResume',()=>{
  assert.equal(isForegroundResume('background','active'),true);
  assert.equal(isForegroundResume('inactive','active'),true);
  assert.equal(isForegroundResume('active','active'),false);
  assert.equal(isForegroundResume('unknown','active'),false);
  assert.equal(isForegroundResume('active','inactive'),false);
  assert.equal(isForegroundResume('active','background'),false);
  assert.equal(isForegroundResume('background','background'),false);
  assert.equal(isForegroundResume('inactive','background'),false);
});

test('reconnectDelayMs caps at 30s with bounded exponent',()=>{
  assert.deepEqual(
    [0,1,2,3,4,5,6,999].map(reconnectDelayMs),
    [1000,2000,4000,8000,16000,30000,30000,30000]
  );
  assert.deepEqual([-1,NaN,Infinity].map(reconnectDelayMs),[1000,1000,1000]);
});
