import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('foreground recovery replaces the socket, syncs state and never resends a task',()=>{
  const source=readFileSync(new URL('../App.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const start=source.indexOf('  useEffect(() => {\n    if(!config || !selected) return;');
  const end=source.indexOf('  }, [config,selected?.id]);',start);
  assert.ok(start>=0 && end>start,'connection effect must be present');
  const effect=source.slice(start,end+'  }, [config,selected?.id]);'.length);
  let socketState='',turnBusy=false,stream='',approvals=[];
  let timerId=0;
  const timers=new Map(),sockets=[],history=[];
  const refs=()=>({current:null});
  const wsRef=refs(),reconnectRef=refs(),pingRef=refs(),sendLock=refs();
  const subscriptions={};
  class FakeSocket {
    static OPEN=1;
    readyState=0;
    sent=[];
    constructor(url){this.url=url;sockets.push(this);}
    send(message){this.sent.push(JSON.parse(message).type);}
    close(){this.readyState=3;this.onclose?.();}
  }
  const appState={currentState:'active',addEventListener(_event,handler){
    subscriptions.change=handler;
    return {remove(){delete subscriptions.change;}};
  }};
  let cleanup;
  let now=1_000_000;
  const sandbox={
    URL,WebSocket:FakeSocket,AppState:appState,Date:{now:()=>now},
    config:{mode:'private',baseUrl:'http://127.0.0.1:3456',token:'fixture'},
    selected:{id:'fixture-session',title:'Fixture'},
    wsRef,reconnectRef,pingRef,pongRef:{current:null},sendLock,keepScroll:{current:false},
    useEffect(callback){cleanup=callback();},
    loadHistory(session){history.push(session.id);},
    setHistory(){},setHistoryReady(){},setCursor(){},setDraft(){},setApprovals(value){approvals=typeof value==='function'?value(approvals):value;},
    setStream(value){stream=typeof value==='function'?value(stream):value;},
    setTurnBusy(value){turnBusy=value;},setSocketState(value){socketState=value;},setError(){},
    setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    setInterval(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},
    clearInterval(id){timers.delete(id);},
  };
  vm.runInNewContext(effect,sandbox);
  // The test slices App.js and runs the connection effect in a sandbox; inline
  // the two recovery policy helpers so the effect can call them without the
  // ESM import that the slice strips out.
  sandbox.isForegroundResume = (prev, next) => next === 'active' && (prev === 'inactive' || prev === 'background')
  sandbox.reconnectDelayMs = attempt => Math.min(30000, 1000 * 2 ** Math.max(0, Math.min(5, Math.trunc(Number.isFinite(attempt) ? attempt : 0))))
  try {
    assert.equal(sockets.length,1);
    const first=sockets[0];
    first.readyState=FakeSocket.OPEN;
    first.onopen();
    assert.deepEqual(first.sent,['sync_state']);
    assert.equal(socketState,'同步中');
    assert.equal(turnBusy,false);
    assert.equal(sendLock.current,true);
    first.onmessage({data:JSON.stringify({type:'permission_request',requestId:'approval-1',toolName:'Write'})});
    assert.equal(approvals.length,1);
    subscriptions.change('active');
    assert.equal(sockets.length,1);
    appState.currentState='background';subscriptions.change('background');
    appState.currentState='active';subscriptions.change('active');
    assert.equal(sockets.length,2);
    subscriptions.change('active');
    assert.equal(sockets.length,2);
    assert.equal(first.readyState,3);
    assert.equal(history.length,3); // initial load, socket open, foreground refresh
    first.onclose();
    first.onopen();
    first.onmessage({data:JSON.stringify({type:'content_delta',text:'late'})});
    assert.equal(stream,'');
    assert.equal([...timers.values()].filter(t=>t.delay!==15000).length,0);
    const resumed=sockets[1];
    resumed.readyState=FakeSocket.OPEN;
    resumed.onopen();
    assert.deepEqual(resumed.sent,['sync_state']);
    assert.equal(socketState,'同步中');
    assert.equal(turnBusy,false);
    assert.equal(sendLock.current,true);
    resumed.onmessage({data:JSON.stringify({type:'session_state',turnState:'running'})});
    assert.equal(turnBusy,true);
    assert.equal(sendLock.current,true);
    resumed.onmessage({data:JSON.stringify({type:'session_state',turnState:'idle'})});
    assert.equal(socketState,'已连接');
    assert.equal(turnBusy,false);
    assert.equal(sendLock.current,false);
    resumed.onmessage({data:JSON.stringify({type:'session_state',turnState:'running'})});
    resumed.onmessage({data:JSON.stringify({type:'status',state:'idle'})});
    assert.equal(turnBusy,false);
    assert.equal(sendLock.current,false);
    resumed.onmessage({data:JSON.stringify({type:'permission_requests_snapshot',toolRequestIds:[]})});
    assert.equal(approvals.length,0);
    const tick=[...timers.values()].find(t=>t.delay===30000);
    tick.callback();
    assert.ok(resumed.sent.includes('ping'));
    resumed.onmessage({data:JSON.stringify({type:'pong'})});
    assert.equal(resumed.readyState,FakeSocket.OPEN);
    tick.callback();
    assert.ok(resumed.sent.filter(s=>s==='ping').length>=2);
    assert.equal(resumed.readyState,FakeSocket.OPEN);
    assert.equal(socketState,'已连接');
    const pongTimer=[...timers.values()].find(t=>t.delay===12000);
    assert.ok(pongTimer);
    pongTimer.callback();
    assert.equal(resumed.readyState,3);
    assert.equal(socketState,'正在重连');
    const retry=[...timers.values()].find(t=>t.delay===2000);
    assert.ok(retry);
    retry.callback();
    assert.equal(sockets.length,3);
    assert.equal(turnBusy,false);
    assert.equal(sendLock.current,true);
    const recovered=sockets[2];
    recovered.readyState=FakeSocket.OPEN;
    recovered.onopen();
    assert.deepEqual(recovered.sent,['sync_state']);
    assert.ok(sockets.every(s=>!s.sent.includes('user_message')));
  } finally {cleanup?.();}
});

test('loading older history does not jump the chat back to the bottom',()=>{
  const source=readFileSync(new URL('../App.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const match=source.match(/onContentSizeChange=\{\(\)=>\{([\s\S]*?)\n      \}\}/);
  assert.ok(match,'auto-scroll handler must be present');
  const keepScroll={current:false};
  let scrolls=0;
  const sandbox={keepScroll,chatList:{current:{scrollToEnd(){scrolls++;}}}};
  vm.runInNewContext(`globalThis.handler=()=>{${match[1]}}`,sandbox);
  sandbox.handler();
  assert.equal(scrolls,1);
  keepScroll.current=true;
  sandbox.handler();
  assert.equal(scrolls,1);
  assert.equal(keepScroll.current,false);
  sandbox.handler();
  assert.equal(scrolls,2);
});

test('old identical user text does not acknowledge a pending repeat',()=>{
  const source=readFileSync(new URL('../App.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const start=source.indexOf('      setHistory(prev => {',source.indexOf('  async function loadHistory('));
  const end=source.indexOf('\n      });',start)+1;
  assert.ok(start>=0 && end>start,'history reconciliation must be present');
  const update=source.slice(start,end+'      });'.length);
  const previous=[{id:'old-user',role:'user',text:'same'},
    {id:'local-1',role:'user',text:'same',pending:true,knownUserIds:['old-user']}];
  const run=(prev,loaded)=>{
    let result;
    vm.runInNewContext(update,{older:false,loaded,setHistory(fn){result=fn(prev);}});
    return Array.from(result,m=>m.id);
  };
  const old=[{id:'old-user',role:'user',text:'same'}];
  assert.deepEqual(run(previous,old),['old-user','local-1']);
  const accepted=[...old,{id:'new-user',role:'user',text:'same'}];
  assert.deepEqual(run(previous,accepted),['old-user','new-user']);
  const twoPending=[...previous,{id:'local-2',role:'user',text:'same',pending:true,knownUserIds:['old-user']}];
  assert.deepEqual(run(twoPending,accepted),['old-user','new-user','local-2']);
});
