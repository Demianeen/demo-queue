import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkOS } from '@workos-inc/node';
import { googleSignInUrl } from '../lib/google-sign-in.ts';

const workos = new WorkOS('sk_test_example');
const buildAuthorizationUrl = (options) => workos.userManagement.getAuthorizationUrl(options);

test('the installed SDK rejects an AuthKit screen hint with the Google provider', () => {
  assert.throws(() => buildAuthorizationUrl({
    provider: 'GoogleOAuth',
    clientId: 'client_example',
    redirectUri: 'https://preview.vercel.app/callback',
    screenHint: 'sign-in',
  }), /screenHint.*only supported.*authkit/);
});

function authkitUrl(origin = 'https://api.workos.com') {
  const url = new URL('/user_management/authorize', origin);
  url.search = new URLSearchParams({
    provider: 'authkit',
    client_id: 'client_example',
    redirect_uri: 'https://preview.vercel.app/callback',
    response_type: 'code',
    state: 'sealed-state-with-return-path-and-verifier',
    code_challenge: 'original-pkce-challenge',
    code_challenge_method: 'S256',
    screen_hint: 'sign-in',
  }).toString();
  return url;
}

test('Google transport preserves state and PKCE and removes the AuthKit-only screen hint', () => {
  const original = authkitUrl();
  const result = new URL(googleSignInUrl(original.toString(), () => { throw new Error('Unexpected rebuild'); }));
  assert.equal(result.origin, 'https://api.workos.com');
  assert.equal(result.pathname, '/user_management/authorize');
  assert.equal(result.searchParams.get('provider'), 'GoogleOAuth');
  assert.equal(result.searchParams.has('screen_hint'), false);
  original.searchParams.set('provider', 'GoogleOAuth');
  original.searchParams.delete('screen_hint');
  assert.equal(result.toString(), original.toString());
});

test('custom AuthKit hosts rebuild through the Node SDK with original state and PKCE', () => {
  const original = authkitUrl('https://login.example.com');
  const result = new URL(googleSignInUrl(original.toString(), buildAuthorizationUrl));
  assert.equal(result.origin, 'https://api.workos.com');
  assert.equal(result.pathname, '/user_management/authorize');
  assert.equal(result.searchParams.get('provider'), 'GoogleOAuth');
  for (const name of ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method']) {
    assert.equal(result.searchParams.get(name), original.searchParams.get(name));
  }
});

test('unexpected endpoint, scheme or credentials never become a Google redirect destination', () => {
  for (const value of ['https://api.workos.com/unexpected', 'http://api.workos.com/user_management/authorize', 'https://api.workos.com.evil.example/user_management/authorize', 'https://user:password@api.workos.com/user_management/authorize']) {
    const original = new URL(value);
    original.search = authkitUrl().search;
    const result = new URL(googleSignInUrl(original.toString(), buildAuthorizationUrl));
    assert.equal(result.origin, 'https://api.workos.com');
    assert.equal(result.pathname, '/user_management/authorize');
    assert.equal(result.username, '');
    assert.equal(result.password, '');
  }
});

test('missing, duplicate and malformed authorization parameters fail closed', () => {
  for (const name of ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'provider']) {
    const missing = authkitUrl();
    missing.searchParams.delete(name);
    assert.throws(() => googleSignInUrl(missing.toString(), buildAuthorizationUrl));
    const duplicate = authkitUrl();
    duplicate.searchParams.append(name, duplicate.searchParams.get(name));
    assert.throws(() => googleSignInUrl(duplicate.toString(), buildAuthorizationUrl));
  }
  for (const [name, value] of [['redirect_uri', 'javascript:alert(1)'], ['code_challenge_method', 'plain'], ['provider', 'GoogleOAuth'], ['response_type', 'token']]) {
    const invalid = authkitUrl();
    invalid.searchParams.set(name, value);
    assert.throws(() => googleSignInUrl(invalid.toString(), buildAuthorizationUrl));
  }
});
