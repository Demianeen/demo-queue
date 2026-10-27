import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceFailureDiagnostic } from '../lib/workspace-diagnostics.ts';

test('workspace diagnostics contain only phase, HTTP status and a fixed reason', () => {
  const error = Object.assign(new Error('secret token https://private.example user@example.com'), {
    status: 401,
    token: 'secret-token',
    requestId: 'private-id',
    url: 'https://private.example',
  });
  assert.deepEqual(workspaceFailureDiagnostic('memberships', error), {
    phase: 'memberships', status: 401, reason: 'request-failed',
  });
  assert.deepEqual(workspaceFailureDiagnostic('organization-check', error), {
    phase: 'organization-check', status: 401, reason: 'organization-mismatch',
  });
});

test('workspace diagnostics omit non-HTTP status values and raw errors', () => {
  for (const error of [null, undefined, 'private-error', new Error('private'), { status: '401' }, { status: 999 }, { status: 401.5 }]) {
    assert.deepEqual(workspaceFailureDiagnostic('authentication', error), {
      phase: 'authentication', status: undefined, reason: 'request-failed',
    });
  }
});
