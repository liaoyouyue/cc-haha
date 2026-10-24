import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = process.argv[2] || 61692;
const SID = process.argv[3] || 'd29920a5-3c6b-4edd-af8c-eb902f1b3781';

const settings = JSON.parse(fs.readFileSync('C:/Users/Administrator/.claude/cc-haha/settings.json', 'utf8'));
const token = settings.h5Access.token;
const url = `ws://127.0.0.1:${PORT}/ws/${SID}?token=${encodeURIComponent(token)}`;
console.log('connecting', url.replace(token, 'h5_***'));
const ws = new WebSocket(url);
const evidence = [];
let phase = 'init';
let permReq = null;
let sawPermission = false;
let sawStop = false;
let sawToolResult = false;
let sawMessageComplete = false;

ws.on('open', () => {
  console.log('OPEN');
  ws.send(JSON.stringify({ type: 'sync_state' }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { msg = data.toString(); }
  const ts = new Date().toISOString();
  console.log('MSG', JSON.stringify(msg).slice(0, 250));
  evidence.push({ ts, msg });

  if (msg.type === 'connected') {
    phase = 'send_tool';
    console.log('>>> sending MOCK_TOOL to trigger permission');
    ws.send(JSON.stringify({ type: 'user_message', content: 'MOCK_TOOL {"tool":"Bash","input":{"command":"echo PERM-PROBE"}}' }));
  }
  if (msg.type === 'permission_request' && !sawPermission) {
    sawPermission = true;
    permReq = msg;
    console.log('>>> PERMISSION REQUEST RECEIVED:', JSON.stringify(msg).slice(0, 200));
    console.log('>>> sending permission_response allow');
    ws.send(JSON.stringify({ type: 'permission_response', requestId: msg.requestId, approved: true }));
  }
  if (msg.type === 'tool_result') { sawToolResult = true; }
  if (msg.type === 'message_complete') { sawMessageComplete = true; }
  if (msg.type === 'error') {
    console.log('>>> ERROR:', JSON.stringify(msg));
  }
});

ws.on('close', (code, reason) => {
  console.log('CLOSE', code, reason.toString());
  console.log('=== SUMMARY ===');
  console.log('saw_permission_request:', sawPermission);
  console.log('saw_tool_result:', sawToolResult);
  console.log('saw_message_complete:', sawMessageComplete);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
  if (permReq) console.log('perm_request:', JSON.stringify(permReq));
});

ws.on('error', (e) => { console.log('ERR', e.message); });

setTimeout(() => {
  console.log('=== TIMEOUT ===');
  console.log('saw_permission_request:', sawPermission);
  console.log('saw_tool_result:', sawToolResult);
  console.log('saw_message_complete:', sawMessageComplete);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
  process.exit(0);
}, 60000);