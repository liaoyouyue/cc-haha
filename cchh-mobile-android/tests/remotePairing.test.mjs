import test from 'node:test';
import assert from 'node:assert/strict';
import {publicBaseUrl,parsePairingText,createPublicPairing,claimPublicPairing,publicSessionActive} from '../remotePairing.mjs';
const base='https://example.ngrok-free.app';
test('only HTTPS origin is accepted',()=>{
  assert.equal(publicBaseUrl(base),base);
  for(const s of ['http://example.com','https://foo.com/remote','https://foo.com/?q=1','https://user:pass@foo.com']) assert.throws(()=>publicBaseUrl(s));
});
test('pair secret and QR links parse',()=>{
  const secret='a'.repeat(40);
  assert.equal(parsePairingText(secret).secret,secret);
  assert.throws(()=>parsePairingText(base+'/?token='+secret));
  assert.deepEqual(parsePairingText(base+'/remote#pair='+secret),{baseUrl:base,secret});
  assert.throws(()=>parsePairingText('short'));
});
test('post pairs with exact Origin and cookies, not bearer',async()=>{
  const seen=[];
  const fetcher=async(url,options)=>{seen.push({url,options}); return {ok:true,json:async()=>({id:'p',claimSecret:'q'})}};
  const out=await createPublicPairing(base,'a'.repeat(40),'phone',fetcher);
  assert.equal(out.id,'p');
  assert.equal(seen[0].options.headers.Origin,base);
  assert.equal(seen[0].options.credentials,'include');
  assert.equal(seen[0].options.headers.Authorization,undefined);
});
test('foreign QR links rejected without calling server',async()=>{
  await assert.rejects(()=>createPublicPairing(base,'https://other.ngrok-free.app/?pair='+'a'.repeat(40),'phone',()=>{throw new Error('network called');}),/不一致/);
});
test('pending/approved/rejected pairing preserved',async()=>{
  for(const status of ['pending','approved','rejected']) {
    const fetcher=async()=>({ok:true,json:async()=>({status})});
    assert.equal((await claimPublicPairing(base,{id:'1',claimSecret:'2'},fetcher)).status,status);
  }
});
test('server session must explicitly authenticate',async()=>{
  assert.equal(await publicSessionActive(base,async()=>({ok:true,json:async()=>({authenticated:true})})),true);
  assert.equal(await publicSessionActive(base,async()=>({ok:true,json:async()=>({authenticated:false})})),false);
});
test('HTTP 401 denies authorization',async()=>{
  await assert.rejects(()=>createPublicPairing(base,'a'.repeat(40),'phone',async()=>({ok:false,status:401})),/失效/);
});
