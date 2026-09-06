import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceReturnPath, isEventDetailsPath, eventDetailsPath } from '../lib/workspace-routes.ts';

test('sign-in returns only to local workspace routes', () => {
  for (const path of ['/events', '/styles', '/events/new', '/events/demo-night-123/overview']) assert.equal(workspaceReturnPath(path), path);
  for (const path of [null, 'https://example.com', '//example.com', '/events/../admin', '/events/%2fadmin', '/events/demo?next=evil', '/events/demo#hash', '/events/demo/extra', '/events/\\evil']) assert.equal(workspaceReturnPath(path), '/events');
});
test('event routes distinguish creation from details and handle unavailable slugs', () => {
  assert.equal(isEventDetailsPath('/events/new'), false);
  assert.equal(isEventDetailsPath('/events'), false);
  assert.equal(isEventDetailsPath('/styles'), false);
  assert.equal(isEventDetailsPath('/events/missing/overview'), true);
  assert.equal(isEventDetailsPath('/events/INVALID/overview'), true);
});

test('every event slug has a collision-free overview route', () => {
  for (const slug of ['new', 'sign-in', 'sign-out', 'styles', 'demo-night']) {
    const path = eventDetailsPath(slug);
    assert.equal(path, `/events/${slug}/overview`);
    assert.equal(isEventDetailsPath(path), true);
    assert.equal(workspaceReturnPath(path), path);
  }
});
