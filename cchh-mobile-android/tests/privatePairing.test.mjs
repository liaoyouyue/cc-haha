import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrivatePairingQr} from '../privatePairing.mjs';

const make = (base, token = 'h5_' + 'a'.repeat(44)) => {
  const u = new URL(base);
  u.searchParams.set('serverUrl', base);
  u.searchParams.set('h5Token', token);
  return u.toString();
};
test('CCHH H5 QR imports local and Tailscale credentials independently', () => {
  const first = parsePrivatePairingQr(make('http://192.168.1.42:3456', 'h5_'+'a'.repeat(44)));
  const second = parsePrivatePairingQr(make('http://100.77.21.34:3456', 'h5_'+'b'.repeat(44)));
  assert.deepEqual(first, {baseUrl:'http://192.168.1.42:3456',token:'h5_'+'a'.repeat(44)});
  assert.deepEqual(second, {baseUrl:'http://100.77.21.34:3456',token:'h5_'+'b'.repeat(44)});
  assert.notEqual(first.token, second.token);
});
test('does not accept random web links or ngrok public-pairing QR', () => {
  assert.throws(() => parsePrivatePairingQr('https://example.org/'), /H5/);
  assert.throws(() => parsePrivatePairingQr('https://example.org/remote#pair='+'a'.repeat(44)), /H5/);
});
test('rejects injected, duplicate and missing query fields', () => {
  const normal = make('http://10.1.2.3:3456');
  assert.throws(() => parsePrivatePairingQr(normal+'&redirect=https://evil.test'), /H5/);
  assert.throws(() => parsePrivatePairingQr(normal+'&h5Token=extra'), /H5/);
  assert.throws(() => parsePrivatePairingQr('http://10.1.2.3:3456/?h5Token=secret'), /H5/);
});
test('QR outer origin must match embedded serverUrl', () => {
  const wrong = new URL(make('http://192.168.1.42:3456'));
  wrong.searchParams.set('serverUrl','http://10.0.0.123:3456');
  assert.throws(() => parsePrivatePairingQr(wrong.toString()), /不一致/);
});
test('rejects user-info, path and URL fragments', () => {
  const normal = make('http://10.1.2.3:3456');
  for(const qr of [normal.replace('10.1.2.3','user@10.1.2.3'),
    normal.replace(':3456/?',':3456/sub?'), normal+'#secret']) {
    assert.throws(() => parsePrivatePairingQr(qr));
  }
});
test('plaintext public HTTP and malformed token are rejected', () => {
  assert.throws(() => parsePrivatePairingQr(make('http://8.8.8.8:3456')), /公网 HTTP/);
  assert.throws(() => parsePrivatePairingQr(make('http://10.1.2.3:3456','tiny')), /凭据无效/);
});
test('HTTPS QR with authenticated credentials remains supported', () => {
  assert.equal(parsePrivatePairingQr(make('https://cchh.example.com')).baseUrl, 'https://cchh.example.com');
});
test('parsing errors never echo bearer token', () => {
  const secret = 'h5_'+'x'.repeat(44);
  const qr = make('http://192.168.0.11:3456',secret)+'&bad=1';
  assert.throws(() => parsePrivatePairingQr(qr),(err)=>{
    assert.equal(err.message.includes(secret), false);
    return true;
  });
});
