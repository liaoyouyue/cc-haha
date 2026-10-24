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
let sawConnected = false;
let sawStopAck = false;
let sawInterrupted = false;
let sawMessageComplete = false;
let sawError = false;
let stopSentAt = null;

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

  if (msg.type === 'connected' && !sawConnected) {
    sawConnected = true;
    console.log('>>> sending long user_message');
    ws.send(JSON.stringify({ type: 'user_message', content: '请详细解释量子纠缠，写一段 200 字的说明，不要停。' }));
  }
  // Send stop after 4 seconds
  if (sawConnected && !stopSentAt && Date.now() - new Date(evidence[0].ts).getTime() > 4000) {
    stopSentAt = new Date().toISOString();
    console.log('>>> sending stop_generation');
    ws.send(JSON.stringify({ type: 'stop_generation' }));
  }
  if (msg.type === 'system_notification' && msg.data?.state === 'interrupted') {
    sawInterrupted = true;
    console.log('>>> INTERRUPTED DETECTED');
  }
  if (msg.type === 'message_complete') { sawMessageComplete = true; }
  if (msg.type === 'error') { sawError = true; console.log('>>> ERROR:', JSON.stringify(msg)); }
});

ws.on('close', (code, reason) => {
  console.log('CLOSE', code, reason.toString());
  console.log('=== SUMMARY ===');
  console.log('saw_connected:', sawConnected);
  console.log('stop_sent_at:', stopSentAt);
  console.log('saw_interrupted:', sawInterrupted);
  console.log('saw_message_complete:', sawMessageComplete);
  console.log('saw_error:', sawError);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
});

ws.on('error', (e) => { console.log('ERR', e.message); });

setTimeout(() => {
  console.log('=== TIMEOUT ===');
  console.log('saw_connected:', sawConnected);
  console.log('stop_sent_at:', stopSentAt);
  console.log('saw_interrupted:', sawInterrupted);
  console.log('saw_message_complete:', sawMessageComplete);
  console.log('saw_error:', sawError);
  console.log('total_messages:', evidence.length);
  console.log('message_types:', evidence.map(e => e.msg.type).join(', '));
  process.exit(0);
}, 60000);