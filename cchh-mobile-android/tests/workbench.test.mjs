import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKSPACE_TABS, projectRootOf, withinProjectRoot,
  terminalEntriesFromHistory, safeModelChoices} from '../mobileWorkbench.mjs';

test('five workspaces reflect the native reference while preserving CCHH branding', () => {
  assert.deepEqual(WORKSPACE_TABS.map(t => t.label),['聊天','任务']);
});
test('filesystem navigation stays within the selected project', () => {
  assert.equal(projectRootOf({projectPath:'D:\\sample'}),'D:\\sample');
  assert.equal(withinProjectRoot('D:\\sample','D:\\sample\\src'),true);
  assert.equal(withinProjectRoot('D:\\sample','D:\\sample-other'),false);
  assert.equal(withinProjectRoot('D:\\sample','C:\\something'),false);
  assert.equal(withinProjectRoot('/a/b','/a/b/file.txt'),true);
  assert.equal(withinProjectRoot('/a/b','/a/else'),false);
  assert.equal(withinProjectRoot('', '/tmp'),false);
});
test('terminal shows real tool blocks, never turns assistant prose into console data', () => {
  const payload={messages:[
    {id:'u1',type:'assistant',content:[{type:'text',text:'I ran ls (not a tool call)'}]},
    {id:'a2',type:'assistant',content:[{type:'tool_use',id:'tool1',name:'Bash',input:{command:'git status --short'}}]},
    {id:'u3',type:'user',content:[{type:'tool_result',tool_use_id:'tool1',content:'clean'}]},
    {id:'a4',type:'assistant',content:[{type:'tool_use',id:'tool2',name:'Read',input:{file_path:'/tmp/a'}}]},
  ]};
  assert.deepEqual(terminalEntriesFromHistory(payload).map(v=>v.text),['git status --short','clean']);
  assert.deepEqual(terminalEntriesFromHistory({messages:[]}),[]);
});
test('model picker lists actual reported model IDs only', () => {
  assert.deepEqual(safeModelChoices({models:[{id:'x',name:'X'},null,{name:'missing'}]}),
    [{id:'x',name:'X'}]);
  assert.deepEqual(safeModelChoices({}),[]);
});
