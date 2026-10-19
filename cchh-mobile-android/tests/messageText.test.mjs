import test from 'node:test';
import assert from 'node:assert/strict';
import {splitFences} from '../messageText.mjs';

test('plain text is one run',()=>{
  assert.deepEqual(splitFences('hello'),[{code:false,text:'hello'}]);
  assert.deepEqual(splitFences(''),[]);
});
test('fenced code keeps the body and drops the language line',()=>{
  assert.deepEqual(splitFences('before\n```js\nconst a=1\n```\nafter'),[
    {code:false,text:'before\n'},
    {code:true,text:'const a=1'},
    {code:false,text:'\nafter'}
  ]);
});
test('multiple blocks and an unclosed fence stay readable',()=>{
  const parts=splitFences('```diff\n-a\n+b\n```\nmid\n```\ntail');
  assert.deepEqual(parts,[
    {code:true,text:'-a\n+b'},
    {code:false,text:'\nmid\n'},
    {code:true,text:'tail'}
  ]);
});
