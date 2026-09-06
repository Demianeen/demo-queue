import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshMemberships, membershipEnvironmentKey } from '../lib/membership-freshness.ts';

test('memberships are reused before 60 seconds and refreshed at the boundary', async () => {
  let calls = 0;
  const old = { fetchedAt: 1000, value: ['old-org'] };
  const fresh = async () => { calls++; return { fetchedAt: 61000, value: ['new-org'] }; };
  assert.deepEqual(await freshMemberships(async () => old, fresh, () => 60999), ['old-org']);
  assert.equal(calls, 0);
  assert.deepEqual(await freshMemberships(async () => old, fresh, () => 61000), ['new-org']);
  assert.equal(calls, 1);
});

test('expired memberships never fall back to stale access when refresh fails', async () => {
  await assert.rejects(freshMemberships(async () => ({ fetchedAt: 0, value: ['revoked-org'] }), async () => { throw new Error('WorkOS unavailable'); }, () => 60000), /WorkOS unavailable/);
});

test('future timestamps are refreshed and empty membership lists are preserved', async () => {
  assert.deepEqual(await freshMemberships(async () => ({ fetchedAt: 100, value: ['old-org'] }), async () => ({ fetchedAt: 0, value: [] }), () => 0), []);
  assert.deepEqual(await freshMemberships(async () => ({ fetchedAt: 0, value: [] }), async () => { throw new Error('unexpected fetch'); }, () => 1), []);
});

test('WorkOS cache environment separates client and endpoint settings without secrets', () => {
  const base = { WORKOS_CLIENT_ID: 'client-a', WORKOS_API_KEY: 'private-key' };
  const key = membershipEnvironmentKey(base);
  for (const changed of [{ WORKOS_CLIENT_ID: 'client-b' }, { WORKOS_API_HOSTNAME: 'example.com' }, { WORKOS_API_HTTPS: 'false' }, { WORKOS_API_PORT: '444' }]) {
    assert.notEqual(membershipEnvironmentKey({ ...base, ...changed }), key);
  }
  assert.ok(!key.includes('private-key'));
});

test('a refresh that has already expired fails closed too', async () => {
  await assert.rejects(freshMemberships(async () => ({ fetchedAt: 0, value: ['old-org'] }), async () => ({ fetchedAt: 1, value: ['expired-refresh'] }), () => 60001), /refresh expired/);
});
