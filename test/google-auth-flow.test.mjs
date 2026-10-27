import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { AuthenticationException } from '@workos-inc/node';
import { sealData } from 'iron-session';
import { beginOrganizationSelection, callbackCookieName, googlePKCECookieName, organizationSelectionChoice, organizationSelectionCookieName, organizationSelectionCookieOptions, organizationSelectionFlowId, readGoogleCallback, readOrganizationSelection } from '../lib/google-auth-flow.ts';

const password = 'test-only-cookie-password-with-at-least-32-characters';
const now = Date.now();
const returnTo = '/events/demo-night/admin';
const data = { code: 'organization_selection_required', pending_authentication_token: 'pending-secret-only-in-encrypted-cookie', organizations: [{ id: 'org_outpost', name: 'Outpost' }, { id: 'org_test', name: 'Test' }] };
const workosError = () => new AuthenticationException(400, data, 'request_test');
const tamper = (sealed) => `${sealed.slice(0, 40)}${sealed[40] === 'a' ? 'b' : 'a'}${sealed.slice(41)}`;

function callback(state, cookieValue = state) {
  const url = new URL('https://demo.example/callback');
  url.search = new URLSearchParams({ code: 'code-secret', state }).toString();
  return { url, password, cookies: new Map([[googlePKCECookieName(state), { value: cookieValue }]]) };
}

function form(csrf, organizationId = 'org_test') {
  const fields = new FormData();
  fields.set('csrf', csrf);
  fields.set('organizationId', organizationId);
  return fields;
}

test('the callback derives the exact installed AuthKit flow cookie names', async () => {
  const require = createRequire(import.meta.resolve('@workos-inc/authkit-nextjs'));
  const { default: fnv1a } = await import(pathToFileURL(require.resolve('@sindresorhus/fnv1a')).href);
  for (const state of ['sealed-state', 'Fe26.2*encrypted-state~2', 'hello-世界']) assert.equal(googlePKCECookieName(state), `wos-auth-verifier-${Number(fnv1a(state, { size: 32 })).toString(16).padStart(8, '0')}`);
});

test('OAuth completion requires matching state and the flow-specific sealed verifier', async () => {
  const sealed = await sealData({ nonce: 'nonce', codeVerifier: 'v'.repeat(43), returnPathname: returnTo }, { password, ttl: 600 });
  assert.deepEqual(await readGoogleCallback(callback(sealed)), { code: 'code-secret', codeVerifier: 'v'.repeat(43), returnTo });
  await assert.rejects(() => readGoogleCallback(callback(sealed, 'wrong-state')));
  await assert.rejects(() => readGoogleCallback({ ...callback(sealed), cookies: new Map() }));
  await assert.rejects(() => readGoogleCallback(callback(tamper(sealed))));
  for (const name of ['code', 'state']) {
    const duplicate = callback(sealed);
    duplicate.url.searchParams.append(name, duplicate.url.searchParams.get(name));
    await assert.rejects(() => readGoogleCallback(duplicate));
    const missing = callback(sealed);
    missing.url.searchParams.delete(name);
    await assert.rejects(() => readGoogleCallback(missing));
  }
});

test('sealed callback data cannot redirect outside a workspace route', async () => {
  for (const returnPathname of ['https://evil.example', '//evil.example', '/events/../admin', '/events/new?next=https://evil.example']) {
    const sealed = await sealData({ nonce: 'nonce', codeVerifier: 'v'.repeat(43), returnPathname }, { password, ttl: 600 });
    assert.equal((await readGoogleCallback(callback(sealed))).returnTo, '/events');
  }
  assert.equal(callbackCookieName(new URL('https://demo.example/callback?state=one&state=two')), null);
});

test('only the typed WorkOS multi-org challenge becomes a purpose-scoped encrypted continuation', async () => {
  const { sealed, flowId } = await beginOrganizationSelection({ error: workosError(), returnTo, password, now });
  assert.equal(sealed.includes(data.pending_authentication_token), false);
  const selection = await readOrganizationSelection({ sealed, flowId, password, now });
  assert.equal(selection.pendingAuthenticationToken, data.pending_authentication_token);
  assert.deepEqual(selection.organizations, data.organizations);
  assert.equal(selection.returnTo, returnTo);
  assert.equal(await beginOrganizationSelection({ error: data, returnTo, password, now }), null);
  assert.equal(await beginOrganizationSelection({ error: new Error('not an authentication error'), returnTo, password, now }), null);
  const wrongCode = new AuthenticationException(400, { ...data, code: 'mfa_challenge' }, 'request_test');
  assert.equal(await beginOrganizationSelection({ error: wrongCode, returnTo, password, now }), null);
});

test('organization continuation rejects expiry, tampering, wrong password and confused cookie purposes', async () => {
  const { sealed, flowId } = await beginOrganizationSelection({ error: workosError(), returnTo, password, now });
  assert.equal(await readOrganizationSelection({ sealed, flowId, password, now: now + 300_000 }), null);
  assert.equal(await readOrganizationSelection({ sealed: tamper(sealed), flowId, password, now }), null);
  assert.equal(await readOrganizationSelection({ sealed, flowId, password: `${password}-wrong`, now }), null);
  assert.equal(await readOrganizationSelection({ sealed: undefined, flowId, password, now }), null);
  const otherPurpose = await sealData({ ...data, expiresAt: now + 100_000 }, { password, ttl: 300 });
  assert.equal(await readOrganizationSelection({ sealed: otherPurpose, flowId, password, now }), null);
});

test('selection is restricted to the original organizations, matching CSRF and same origin', async () => {
  const { sealed, flowId } = await beginOrganizationSelection({ error: workosError(), returnTo, password, now });
  const selection = await readOrganizationSelection({ sealed, flowId, password, now });
  const choice = { selection, form: form(selection.csrf), origin: 'https://demo.example', requestUrl: 'https://demo.example/events/choose-organization/complete' };
  assert.deepEqual(organizationSelectionChoice(choice), { pendingAuthenticationToken: data.pending_authentication_token, organizationId: 'org_test', returnTo });
  assert.equal(organizationSelectionChoice({ ...choice, selection: null }), null);
  assert.equal(organizationSelectionChoice({ ...choice, origin: null }), null);
  assert.equal(organizationSelectionChoice({ ...choice, origin: 'https://evil.example' }), null);
  assert.equal(organizationSelectionChoice({ ...choice, form: form('wrong-csrf') }), null);
  assert.equal(organizationSelectionChoice({ ...choice, form: form(selection.csrf, 'org_foreign') }), null);
  for (const name of ['csrf', 'organizationId']) {
    const duplicate = form(selection.csrf);
    duplicate.append(name, duplicate.get(name));
    assert.equal(organizationSelectionChoice({ ...choice, form: duplicate }), null);
  }
});

test('concurrent organization challenges have separate cookies and cannot cross flows', async () => {
  const first = await beginOrganizationSelection({ error: workosError(), returnTo, password, now });
  const second = await beginOrganizationSelection({ error: workosError(), returnTo: '/events/new', password, now });
  assert.notEqual(organizationSelectionCookieName(first.flowId), organizationSelectionCookieName(second.flowId));
  const firstSelection = await readOrganizationSelection({ ...first, password, now });
  const secondSelection = await readOrganizationSelection({ ...second, password, now });
  assert.equal(firstSelection.returnTo, returnTo);
  assert.equal(secondSelection.returnTo, '/events/new');
  assert.equal(await readOrganizationSelection({ ...first, flowId: second.flowId, password, now }), null);
  assert.equal(organizationSelectionChoice({ selection: secondSelection, form: form(firstSelection.csrf), origin: 'https://demo.example', requestUrl: 'https://demo.example/events/choose-organization/complete' }), null);
  const url = new URL(`https://demo.example/events/choose-organization?flow=${first.flowId}`);
  assert.equal(organizationSelectionFlowId(url), first.flowId);
  url.searchParams.append('flow', second.flowId);
  assert.equal(organizationSelectionFlowId(url), null);
  assert.equal(organizationSelectionFlowId(new URL('https://demo.example/?flow=invalid')), null);
});

test('pending cookies are host-only, HttpOnly, short-lived and secure on HTTPS', () => {
  assert.deepEqual(organizationSelectionCookieOptions('https://demo.example/callback'), { httpOnly: true, sameSite: 'lax', secure: true, path: '/events/choose-organization', maxAge: 300 });
  assert.equal(organizationSelectionCookieOptions('http://localhost:3001/callback').secure, false);
  assert.equal('domain' in organizationSelectionCookieOptions('https://demo.example/callback'), false);
});
