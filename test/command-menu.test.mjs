import assert from 'node:assert/strict';
import test from 'node:test';
import { bestEntryId, dedupeEntries, GROUP_CAP, isLiveGroup, liveGroup, menuSections, rankEntries, textScore } from '../lib/command-menu.ts';

const row = (id, overrides = {}) => ({ id, title: id, group: 'Go to', ...overrides });

test('a prefix beats a word start, which beats a substring, which beats letters in order', () => {
  const prefix = textScore('sub', row('Submissions'));
  const wordStart = textScore('sub', row('All submissions'));
  const substring = textScore('sub', row('Presubmit'));
  const fuzzy = textScore('sbm', row('Submissions'));
  assert.ok(prefix > wordStart);
  assert.ok(wordStart > substring);
  assert.ok(substring > fuzzy);
  assert.ok(fuzzy > 0);
});

test('nothing matches an empty query or missing letters', () => {
  assert.equal(textScore('   ', row('Events')), 0);
  assert.equal(textScore('zzz', row('Events')), 0);
});

test('a title hit beats the same hit in a keyword, subtitle or group', () => {
  const title = textScore('styles', row('Styles'));
  const keyword = textScore('styles', row('Brand', { keywords: ['styles'] }));
  const subtitle = textScore('practice', row('Demo', { subtitle: 'Practice · Queue' }));
  assert.ok(title > keyword);
  assert.ok(subtitle > 0);
  assert.ok(textScore('styles', row('Brand', { keywords: ['styles'] })) > textScore('styles', row('Brand', { subtitle: 'styles' })));
});

test('several words match when each hits some field, so the live event name finds its places', () => {
  const queue = row('Queue', { group: liveGroup('MCP comparison Outpost') });
  assert.ok(textScore('mcp queue', queue) > 0);
  assert.equal(textScore('mcp judging', queue), 0);
});

test('ranking keeps ties in their order and drops non-matches', () => {
  const entries = [row('Events'), row('Members'), row('New event', { group: 'Create' }), row('Practice events')];
  assert.deepEqual(rankEntries('event', entries).map((entry) => entry.id), ['Events', 'New event', 'Practice events']);
  assert.deepEqual(rankEntries('e', [row('Ea'), row('Eb')]).map((entry) => entry.id), ['Ea', 'Eb']);
});

const live = liveGroup('Demo night');
const entries = [
  row('Keyboard shortcuts', { group: 'Help' }),
  row('Events'),
  row('New event', { group: 'Create' }),
  row('Publish the queue', { group: 'This page' }),
  row('Switch to Acme', { group: 'Switch organization' }),
  row('Older night', { group: 'Events', suggested: true }),
  row('Ancient night', { group: 'Events' }),
  row('Submissions', { group: live }),
  row('Queue', { group: live }),
];

test('empty, the menu opens on the live event, recent events, creating, pages and help', () => {
  const sections = menuSections('', entries);
  assert.deepEqual(sections.map((section) => section.group), [live, 'Events', 'Create', 'Go to', 'Help']);
  assert.deepEqual(sections[1].entries.map((entry) => entry.id), ['Older night']);
});

test('typed, every group is searched in a fixed order', () => {
  const sections = menuSections('night', entries);
  assert.deepEqual(sections.map((section) => section.group), [live, 'Events']);
  assert.deepEqual(sections[1].entries.map((entry) => entry.id), ['Older night', 'Ancient night']);
  assert.deepEqual(menuSections('publish', entries).map((section) => section.group), ['This page']);
  assert.deepEqual(menuSections('acme', entries).map((section) => section.group), ['Switch organization']);
  assert.deepEqual(menuSections('qqqq', entries), []);
});

test('typed groups are capped after ranking, so the best match always shows', () => {
  const many = Array.from({ length: 12 }, (_, index) => row(`Event ${index} night`, { group: 'Events' }));
  const best = row('night', { group: 'Events' });
  const sections = menuSections('night', [...many, best]);
  assert.equal(sections[0].entries.length, GROUP_CAP);
  assert.equal(sections[0].entries[0].id, 'night');
});

test('letters in order only show when nothing matched a word or part of one', () => {
  const view = row('Open presentation view', { group: live });
  const event = row('Review night', { group: 'Events' });
  assert.deepEqual(menuSections('rev', [view, event]).map((section) => section.entries.map((entry) => entry.id)), [['Review night']]);
  assert.deepEqual(menuSections('opv', [view, event]).map((section) => section.entries.map((entry) => entry.id)), [['Open presentation view']]);
});

test('a loading or failed group keeps its place even before it has rows', () => {
  const loading = menuSections('zzz', entries, { Events: 'loading' });
  assert.deepEqual(loading.map((section) => [section.group, section.status]), [['Events', 'loading']]);
  const liveLoading = menuSections('', [row('Events')], { 'Live now': 'loading' });
  assert.deepEqual(liveLoading.map((section) => section.group), ['Live now', 'Go to']);
  assert.equal(menuSections('night', entries, { Events: 'error' })[1].status, 'error');
});

test('the live group is recognised with or without its event name', () => {
  assert.equal(isLiveGroup('Live now'), true);
  assert.equal(isLiveGroup(live), true);
  assert.equal(isLiveGroup('Live nowhere'), false);
});

test('the best match is selected wherever its group sits; the first row before typing', () => {
  const sections = menuSections('revi', [row('Previous event', { group: 'This page' }), row('Review night', { group: 'Events' })]);
  assert.equal(sections[0].group, 'This page');
  assert.equal(bestEntryId('revi', sections), 'Review night');
  assert.equal(bestEntryId('', menuSections('', entries)), 'Submissions');
  assert.equal(bestEntryId('', []), undefined);
});

test('an action registered twice in a group shows once, keeping the one with keys', () => {
  const rows = dedupeEntries([
    row('a', { title: 'Open presentation view', group: 'This page' }),
    row('b', { title: 'Open the Room panel', group: 'This page' }),
    row('c', { title: 'Open presentation view', group: 'This page', keys: ['S'] }),
    row('d', { title: 'Open presentation view', group: live }),
  ]);
  assert.deepEqual(rows.map((entry) => entry.id), ['c', 'b', 'd']);
});
