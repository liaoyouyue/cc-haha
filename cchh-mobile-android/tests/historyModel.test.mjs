import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesFromHistory, textFromContent, summarizeBlocks} from '../src/features/chat/historyMessage.mjs';
import {COLORS, METRICS} from '../src/theme/tokens.mjs';

test('v0.1.5 visible text and id/role/time are preserved',()=>{
  const normalized=messagesFromHistory({messages:[
    {id:'u1',type:'user',timestamp:'2026-10-20T12:00:00Z',content:'hello'},
    {id:'a2',type:'assistant',content:[{type:'text',text:'part 1'},{type:'text',text:'part 2'}]},
    {id:'ignore',type:'system',content:'must not display'},
  ]});
  assert.equal(normalized.length,2);
  assert.deepEqual(normalized.map(x=>({id:x.id,role:x.role,text:x.text,timestamp:x.timestamp})),[
    {id:'u1',role:'user',text:'hello',timestamp:'2026-10-20T12:00:00Z'},
    {id:'a2',role:'assistant',text:'part 1\npart 2',timestamp:''}
  ]);
});
test('tool/thinking metadata can be retained without printing sensitive payload',()=>{
  const secret='SENSITIVE_NOT_FOR_UI';
  const blocks=summarizeBlocks([
    {type:'thinking',thinking:secret},
    {type:'tool_use',id:'tool-1',name:'Bash',input:{command:'export KEY='+secret}},
    {type:'tool_result',tool_use_id:'tool-1',content:secret,is_error:true},
    {type:'image',source:{data:secret}},
    {type:'text',text:'Visible'}
  ]);
  assert.deepEqual(blocks.map(x=>x.type),['thinking','tool_use','tool_result','image','text']);
  assert.equal(JSON.stringify(blocks).includes(secret),false);
  assert.equal(blocks[2].isError,true);
  assert.equal(textFromContent([{type:'tool_result',content:secret},{type:'text',text:'Visible'}]),'Visible');
});
test('malformed and tool-only messages are not rendered as empty chat bubbles',()=>{
  assert.deepEqual(messagesFromHistory(null),[]);
  assert.deepEqual(messagesFromHistory({messages:'invalid'}),[]);
  assert.deepEqual(messagesFromHistory({messages:[null,{id:'x',type:'assistant',content:[{type:'tool_use',name:'Bash'}]}]}),[]);
});
test('theme tokens centralize current colors without moving the existing layout',()=>{
  assert.equal(COLORS.bg,'#FFFFFF');
  assert.equal(COLORS.accent,'#9981C4');
  assert.ok(METRICS.minTouchTarget>=48);
  assert.equal(Object.isFrozen(COLORS),true);
});
