import assert from 'node:assert/strict';
import test from 'node:test';
import { adminViewPath, adminViewsFor, parseAdminView } from '../lib/admin-views.ts';
import { baseContract, eventRootProps, eventThemeContract, eventTokenProperties } from '../lib/event-theme-contract.ts';
import { commandForKeys, matchSequence } from '../lib/key-sequence.ts';
import { VISUAL_STYLES } from '../lib/visual-style.ts';

test('admin views live in the address and fall back to the live event home', () => {
  assert.equal(parseAdminView(null, 'demo'), 'home');
  assert.equal(parseAdminView('settings', 'demo'), 'settings');
  assert.equal(parseAdminView('nonsense', 'hackathon'), 'home');
  assert.equal(parseAdminView('judging', 'hackathon'), 'judging');
  assert.equal(parseAdminView('judges', 'hackathon'), 'judges');
  assert.equal(parseAdminView('judging', 'demo'), 'home');
  assert.equal(parseAdminView('judges', 'demo'), 'home');
  assert.equal(adminViewPath('demo-night', 'home'), '/events/demo-night/admin');
  assert.equal(adminViewPath('demo-night', 'queue'), '/events/demo-night/admin?view=queue');
  assert.equal(adminViewPath('demo-night', 'settings'), '/events/demo-night/admin?view=settings');
  assert.deepEqual(adminViewsFor('demo').map((item) => item.view), ['home', 'queue', 'submissions', 'settings']);
  assert.deepEqual(adminViewsFor('hackathon').map((item) => item.view), ['home', 'queue', 'judging', 'submissions', 'judges', 'settings']);
});

test('key sequences: longer ones win, and a sequence start never runs a single key', () => {
  const commands = [{ id: 'new', keys: ['C'] }, { id: 'connections', keys: ['G', 'C'] }, { id: 'events', keys: ['G', 'E'] }, { id: 'off', keys: ['X'], disabled: true }];
  assert.equal(matchSequence(['G', 'E'], ['x', 'g', 'e']), true);
  assert.equal(matchSequence([], ['g']), false);
  assert.equal(matchSequence(['⇧T'], ['T']), true);
  assert.equal(matchSequence(['⇧T'], ['t']), false);
  assert.equal(commandForKeys(commands, ['c'])?.id, 'new');
  assert.equal(commandForKeys(commands, ['g', 'c'])?.id, 'connections');
  assert.equal(commandForKeys(commands, ['g', 'e'])?.id, 'events');
  assert.equal(commandForKeys(commands, ['g']), undefined);
  assert.equal(commandForKeys(commands, ['x']), undefined);
});

test('every style has a full contract, and Base keeps its saved values', () => {
  for (const style of VISUAL_STYLES) {
    const contract = eventThemeContract(style);
    assert.ok(['card', 'split'].includes(contract.shell), style);
    assert.ok(['classic', 'sidebar'].includes(contract.stage), style);
    const props = eventTokenProperties(contract);
    for (const name of ['--event-bg', '--event-surface', '--event-fg', '--event-muted', '--event-accent', '--event-border', '--event-font-body', '--event-font-display', '--event-radius', '--event-panel']) assert.ok(props[name], `${style} ${name}`);
  }
  assert.equal(eventThemeContract('devday').stage, 'sidebar');
  assert.equal(eventThemeContract('outpost').shell, 'split');
  const base = eventTokenProperties(baseContract({ background: '#fafafa', foreground: '#111111', accent: '#2255ff', font: 'serif', radius: 10 }));
  assert.equal(base['--event-bg'], '#fafafa');
  assert.equal(base['--event-fg'], '#111111');
  assert.equal(base['--event-accent'], '#2255ff');
  assert.equal(base['--event-accent-fg'], '#ffffff');
  assert.equal(base['--event-radius'], '10px');
  assert.equal(base['--event-font'], 'Georgia, serif');
  assert.equal(eventRootProps('devday', undefined, 'stage')['data-event-stage'], 'sidebar');
  assert.equal(eventRootProps('codex')['data-event-stage'], undefined);
});
