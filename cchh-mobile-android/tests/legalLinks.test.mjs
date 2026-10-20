import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_LINKS } from '../legalLinks.mjs';

test('legal links use the expected GitHub sources over HTTPS', () => {
  for (const value of Object.values(LEGAL_LINKS)) {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'github.com');
  }
  assert.match(LEGAL_LINKS.upstreamLicense, /NanmiCoder\/cc-haha\/blob\/v0\.7\.4\/LICENSE$/);
  assert.match(LEGAL_LINKS.source, /liaoyouyue\/cc-haha\/tree\/feat\/cchh-mobile-community-pairing-20261019\/cchh-mobile-android$/);
  assert.match(LEGAL_LINKS.thirdPartyNotices, /THIRD_PARTY_NOTICES\.md$/);
});
