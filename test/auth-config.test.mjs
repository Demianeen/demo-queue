import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkOSRedirectUri, previewWorkspaceUrl } from '../lib/auth-config.ts';

test('preview callbacks follow each trusted branch instead of a shared explicit URL', () => {
  for (const branch of ['demo-queue-git-first-team.vercel.app', 'demo-queue-git-second-team.vercel.app']) {
    assert.equal(getWorkOSRedirectUri({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: branch, NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://production.example/callback' }), `https://${branch}/callback`);
  }
});

test('missing or malformed preview hosts fail closed without production fallback', () => {
  for (const branch of [undefined, '', 'https://app.vercel.app', 'evil.example', 'app.vercel.app/path', 'app.vercel.app@evil.example', 'app.vercel.app:443', 'app.vercel.app?next=evil']) {
    assert.equal(getWorkOSRedirectUri({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: branch, NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://production.example/callback' }), undefined);
  }
});

test('production and local development retain their explicit callback', () => {
  for (const environment of ['production', 'development', undefined]) {
    const callback = environment === 'production' ? 'https://demo-queue-tau.vercel.app/callback' : 'http://localhost:3000/callback';
    assert.equal(getWorkOSRedirectUri({ VERCEL_ENV: environment, VERCEL_BRANCH_URL: 'preview.vercel.app', NEXT_PUBLIC_WORKOS_REDIRECT_URI: callback }), callback);
  }
});

test('preview workspace navigation keeps PKCE cookies on the callback host', () => {
  const callback = 'https://branch.vercel.app/callback';
  assert.equal(previewWorkspaceUrl('https://unique.vercel.app/events/sign-in?returnTo=%2Fstyles', callback), 'https://branch.vercel.app/events/sign-in?returnTo=%2Fstyles');
  assert.equal(previewWorkspaceUrl('https://branch.vercel.app/styles', callback), undefined);
  assert.equal(previewWorkspaceUrl('https://unique.vercel.app//evil.example?next=evil', callback), 'https://branch.vercel.app//evil.example?next=evil');
});
