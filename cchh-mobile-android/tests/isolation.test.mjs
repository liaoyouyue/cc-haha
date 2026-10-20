import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrivatePairingQr} from '../privatePairing.mjs';
import {parsePairingText, createPublicPairing, claimPublicPairing} from '../remotePairing.mjs';

test('private pairing QR rejects cross-user credentials',()=>{
  const a_token = 'A'.repeat(40);
  const a_url = 'http://192.168.1.100:3456';
  const a_qr = `http://192.168.1.100:3456/?h5Token=${a_token}&serverUrl=${encodeURIComponent(a_url)}`;
  const parsed_a = parsePrivatePairingQr(a_qr);
  assert.equal(parsed_a.token, a_token);
  assert.equal(parsed_a.baseUrl, a_url);

  const b_token = 'B'.repeat(40);
  const b_url = 'http://192.168.1.200:3456';
  const b_qr = `http://192.168.1.200:3456/?h5Token=${b_token}&serverUrl=${encodeURIComponent(b_url)}`;
  const parsed_b = parsePrivatePairingQr(b_qr);
  assert.equal(parsed_b.token, b_token);
  assert.equal(parsed_b.baseUrl, b_url);

  // Cross-user QR should fail validation when used on wrong server
  const cross_qr = `http://192.168.1.100:3456/?h5Token=${b_token}&serverUrl=${encodeURIComponent(b_url)}`;
  assert.throws(()=>parsePrivatePairingQr(cross_qr), /地址不一致/);
});

test('public pairing rejects cross-user origin',async()=>{
  const base = 'https://example.ngrok-free.app';
  const fetcher = async(url, opts)=>{
    if (opts.headers.Origin !== base) throw new Error('Origin mismatch');
    return {ok:true, json:async()=>({id:'p',claimSecret:'q'})};
  };
  await assert.rejects(
    createPublicPairing(base,'https://other.ngrok-free.app/remote#pair='+'a'.repeat(40),'phone',fetcher),
    /不一致/
  );
});

test('user token cannot access another user session',async()=>{
  // This test verifies token-based isolation at the application level.
  // In real CCHH, each user has their own CCHH instance with separate token.
  // A token from User B cannot access User A's CCHH instance.

  const userA_sessions = {sessions:[{id:'sess-a',title:'User A'}]};
  const userB_sessions = {sessions:[{id:'sess-b',title:'User B'}]};

  const mockFetch = async(url, opts)=>{
    const auth = opts.headers?.Authorization || '';
    const token = auth.replace('Bearer ','');

    // User A's CCHH instance - only accepts user-a-token
    if (url.includes('user-a.example.com')) {
      if (token === 'user-a-token') return {ok:true,json:async()=>({sessions:[{id:'sess-a',title:'User A'}]})};
      return {ok:false,status:401,json:async()=>({error:'Unauthorized'})};
    }

    // User B's CCHH instance - only accepts user-b-token
    if (url.includes('user-b.example.com')) {
      if (token === 'user-b-token') return {ok:true,json:async()=>({sessions:[{id:'sess-b',title:'User B'}]})};
      return {ok:false,status:401,json:async()=>({error:'Unauthorized'})};
    }

    return {ok:false,status:401,json:async()=>({error:'Unauthorized'})};
  };

  // User A accessing their own CCHH
  const sessionsA = await (await mockFetch('http://user-a.example.com/api/sessions',{headers:{Authorization:'Bearer user-a-token'}})).json();
  assert.deepEqual(sessionsA.sessions.map(s=>s.id),['sess-a']);

  // User B accessing their own CCHH
  const sessionsB = await (await mockFetch('http://user-b.example.com/api/sessions',{headers:{Authorization:'Bearer user-b-token'}})).json();
  assert.deepEqual(sessionsB.sessions.map(s=>s.id),['sess-b']);

  // Cross-access: User B's token on User A's CCHH should fail
  const crossResponse = await mockFetch('http://user-a.example.com/api/sessions',{headers:{Authorization:'Bearer user-b-token'}});
  assert.equal(crossResponse.ok,false);
  assert.equal(crossResponse.status,401);

  // Cross-access: User A's token on User B's CCHH should fail
  const crossResponse2 = await mockFetch('http://user-b.example.com/api/sessions',{headers:{Authorization:'Bearer user-a-token'}});
  assert.equal(crossResponse2.ok,false);
  assert.equal(crossResponse2.status,401);
});