import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceReturnPath, isEventDetailsPath, isEventAdminPath, eventDetailsPath } from '../lib/workspace-routes.ts';

test('sign-in returns only to local workspace routes', () => {
  for (const path of ['/events', '/styles', '/events/new', '/events/demo-night-123/overview', '/events/demo-night-123/admin']) assert.equal(workspaceReturnPath(path), path);
  for (const path of [null, 'https://example.com', '//example.com', '/events/../admin', '/events/%2fadmin', '/events/demo?next=evil', '/events/demo#hash', '/events/demo/extra', '/events/\\evil']) assert.equal(workspaceReturnPath(path), '/events');
});
test('event routes distinguish creation from details and handle unavailable slugs', () => {
  assert.equal(isEventDetailsPath('/events/new'), false);
  assert.equal(isEventDetailsPath('/events'), false);
  assert.equal(isEventDetailsPath('/styles'), false);
  assert.equal(isEventDetailsPath('/events/missing/overview'), true);
  assert.equal(isEventDetailsPath('/events/INVALID/overview'), true);
});

test('admin controls are distinct event child routes', () => {
  assert.equal(isEventAdminPath('/events/demo-night/admin'), true);
  assert.equal(isEventDetailsPath('/events/demo-night/admin'), false);
  for (const path of ['/events/new', '/events/demo-night/overview', '/admin/demo-night/old-token', '/events/demo-night/admin/extra']) assert.equal(isEventAdminPath(path), false);
});

test('every event slug has a collision-free overview route', () => {
  for (const slug of ['new', 'sign-in', 'sign-out', 'styles', 'demo-night']) {
    const path = eventDetailsPath(slug);
    assert.equal(path, `/events/${slug}/overview`);
    assert.equal(isEventDetailsPath(path), true);
    assert.equal(workspaceReturnPath(path), path);
  }
});

test('connection login preserves only a local validated consent request', () => {
  for (const path of ['/events/connections', '/events/connect', '/events/connect?request=abc123']) assert.equal(workspaceReturnPath(path), path);
  for (const path of ['/events/connect?request=abc&redirect=https://evil.test', '/events/connect?request=', '/events/connect?request=abc#fragment', '/events/connect?request=../other']) assert.equal(workspaceReturnPath(path), '/events');
});
