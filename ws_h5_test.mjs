import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = process.argv[2] || 61692;
const SID = process.argv[3] || 'd29920a5-3c6b-4edd-af8c-eb902f1b3781';

// Read H5 token from settings.json (local only, never printed)
const settingsPath = 'C:/Users/Administrator/.claude/cc-haha/settings.json';
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const token = settings.h5Access.token;
if (!token) { console.error('NO H5 TOKEN'); process.exit(2); }

const url = `ws://127.0.0.1:${PORT}/ws/${SID}?token=${encodeURIComponent(token)}`;
console.log('connecting to', url.replace(token, 'h5_***'));
const ws = new WebSocket(url);
const evidence = [];
let connectedAt = null;
let messageSentAt = null;

ws.on('open', () => {
  console.log('OPEN');
  ws.send(JSON.stringify({ type: 'sync_state' }));
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { msg = data.toString(); }
  const ts = new Date().toISOString();
  console.log('MSG', JSON.stringify(msg).slice(0, 300));
  evidence.push({ ts, msg });
  if (msg.type === 'connected') {
    connectedAt = ts;
    console.log('CONNECTED, sending user_message');
    ws.send(JSON.stringify({ type: 'user_message', content: 'REPLY-WS-PROBE-ONLY' }));
    messageSentAt = ts;
  }
  if (msg.type === 'message_complete') {
    console.log('=== DONE: message_complete received ===');
    console.log('CONNECTED_AT:', connectedAt);
    console.log('MESSAGE_SENT_AT:', messageSentAt);
    console.log('TOTAL_MESSAGES:', evidence.length);
    ws.close();
  }
  if (msg.type === 'error') {
    console.log('ERROR MESSAGE:', JSON.stringify(msg));
  }
});

ws.on('close', (code, reason) => {
  console.log('CLOSE', code, reason.toString());
  console.log('=== EVIDENCE SUMMARY ===');
  console.log('connected:', connectedAt);
  console.log('message_sent:', messageSentAt);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
});

ws.on('error', (e) => { console.log('ERR', e.message); });

setTimeout(() => {
  console.log('=== TIMEOUT ===');
  console.log('connected:', connectedAt);
  console.log('message_sent:', messageSentAt);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
  process.exit(0);
}, 60000);