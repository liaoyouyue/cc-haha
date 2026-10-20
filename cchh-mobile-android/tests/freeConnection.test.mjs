import test from 'node:test';
import assert from 'node:assert/strict';
import {endpoint, parsePrivatePairingQr, parsePairingText} from '../connectionUtils.mjs';
import fs from 'node:fs';

test('endpoint validation rejects invalid formats',()=>{
  // Valid LAN addresses
  assert.equal(endpoint('http://192.168.1.100:3456'),'http://192.168.1.100:3456');
  assert.equal(endpoint('http://10.0.0.1:3456'),'http://10.0.0.1:3456');
  assert.equal(endpoint('http://172.16.0.1:3456'),'http://172.16.0.1:3456');
  assert.equal(endpoint('http://100.64.1.1:3456'),'http://100.64.1.1:3456');
  assert.equal(endpoint('http://127.0.0.1:3456'),'http://127.0.0.1:3456');
  assert.equal(endpoint('http://localhost:3456'),'http://localhost:3456');

  // Valid HTTPS
  assert.equal(endpoint('https://example.ngrok-free.app'),'https://example.ngrok-free.app');
  assert.equal(endpoint('https://my-tailscale-100-1-2-3.ts.net'),'https://my-tailscale-100-1-2-3.ts.net');

  // Invalid: path not allowed
  assert.throws(()=>endpoint('http://192.168.1.100:3456/path'),/路径/);
  assert.throws(()=>endpoint('https://example.com/api'),/路径/);

  // Invalid: query not allowed
  assert.throws(()=>endpoint('http://192.168.1.100:3456?foo=bar'),/参数/);
  assert.throws(()=>endpoint('https://example.com?token=xxx'),/参数/);

  // Invalid: hash not allowed
  assert.throws(()=>endpoint('https://example.com#section'),/参数/);

  // Invalid: user info not allowed
  assert.throws(()=>endpoint('http://user:pass@192.168.1.1:3456'),/账号/);

  // Invalid: public HTTP not allowed
  assert.throws(()=>endpoint('http://example.com:3456'),/HTTPS/);
  assert.throws(()=>endpoint('http://1.2.3.4:3456'),/HTTPS/);

  // Invalid: fragment instead of query for pairing
  assert.throws(()=>endpoint('https://example.com/remote#pair=secret'),/路径/);
});

test('LAN private QR parsing and validation',()=>{
  const token = 'valid-token-12345';
  const serverUrl = 'http://192.168.1.100:3456';
  // QR URL origin MUST match serverUrl origin
  const qr = `http://192.168.1.100:3456/?h5Token=${token}&serverUrl=${encodeURIComponent(serverUrl)}`;

  const parsed = parsePrivatePairingQr(`${qr}`);
  assert.equal(parsed.token, token);
  assert.equal(parsed.baseUrl, serverUrl);
});

test('LAN QR rejects invalid serverUrl mismatch',()=>{
  const token = 'valid-token-12345';
  const serverUrl = 'http://192.168.1.100:3456';
  const wrongServer = 'http://10.0.0.1:3456';
  // QR origin is 192.168.1.100 but serverUrl is 10.0.0.1 - mismatch
  const qr = `http://192.168.1.100:3456/?h5Token=${token}&serverUrl=${encodeURIComponent(wrongServer)}`;

  assert.throws(()=>parsePrivatePairingQr(`${qr}`),/地址不一致|连接凭据无效/);
});

test('public pairing QR parsing',()=>{
  const secret = 'a'.repeat(40);
  const base = 'https://example.ngrok-free.app';

  // Valid pairing QR - just secret
  assert.deepEqual(parsePairingText(secret),{baseUrl:null,secret});
  // Valid pairing QR - full URL
  assert.deepEqual(parsePairingText(`${base}/remote#pair=${secret}`),{baseUrl:base,secret});

  // Invalid: wrong path
  assert.throws(()=>parsePairingText(`${base}/other#pair=${secret}`),/二维码/);
  // Invalid: query parameters not allowed
  assert.throws(()=>parsePairingText(`${base}/remote?foo=bar`),/二维码|参数/);
});

test('public pairing rejects non-HTTPS',()=>{
  const secret = 'a'.repeat(40);
  // For HTTP URLs, parsePairingText treats it as a plain secret
  // Only full HTTPS URLs with /remote#pair= are accepted
  assert.throws(()=>parsePairingText('http://example.ngrok-free.app/remote#pair='+secret),/HTTPS|二维码|密钥/);
});

test('ngrok free tier limits documented',()=>{
  // Verify ngrok free tier limits are documented in COMMUNITY_BETA.md
  const doc = fs.readFileSync('D:/cchh-mobile-acceptance-20261019/cchh-mobile-android/COMMUNITY_BETA.md','utf8');
  assert.ok(doc.includes('ngrok'), 'Document should mention ngrok');
  assert.ok(doc.includes('免费'), 'Document should mention free tier');
  assert.ok(doc.includes('限额') || doc.includes('限制'), 'Document should mention limits');
});