import assert from 'node:assert/strict';
import test from 'node:test';
import { adminViewPath, adminViewsFor, canonicalViewParam, judgingPath, liveView, parseAdminView, parseJudgingView, phaseTabLabel } from '../lib/admin-views.ts';
import { baseContract, eventRootProps, eventThemeContract, eventTokenProperties } from '../lib/event-theme-contract.ts';
import { commandForKeys, matchSequence } from '../lib/key-sequence.ts';
import { VISUAL_STYLES } from '../lib/visual-style.ts';

test('the phase tabs: one per phase plus Settings, and a demo night has no judging', () => {
  assert.deepEqual(adminViewsFor('hackathon').map((item) => item.label), ['Submissions', 'Judging', 'Stage', 'Results', 'Settings']);
  assert.deepEqual(adminViewsFor('demo').map((item) => item.label), ['Submissions', 'Queue', 'Results', 'Settings']);
  assert.equal(adminViewPath('demo-night', 'queue'), '/events/demo-night/admin?view=queue');
  assert.equal(adminViewPath('hack', 'results'), '/events/hack/admin?view=results');
});

test('opening an event lands on the live phase tab', () => {
  assert.equal(liveView('hackathon', 'submissions'), 'submissions');
  assert.equal(liveView('hackathon', 'judging'), 'judging');
  assert.equal(liveView('hackathon', 'stage'), 'stage');
  assert.equal(liveView('hackathon', 'finished'), 'results');
  assert.equal(liveView('demo', 'submissions'), 'submissions');
  assert.equal(liveView('demo', 'stage'), 'queue');
  assert.equal(liveView('demo', 'finished'), 'results');
  assert.equal(liveView('hackathon', undefined), 'submissions');
  assert.equal(phaseTabLabel('demo', 'stage'), 'Queue');
  assert.equal(phaseTabLabel('hackathon', 'finished'), 'Results');
  assert.equal(parseAdminView(null, 'hackathon', 'judging'), 'judging');
  // Any tab opens in any phase.
  assert.equal(parseAdminView('submissions', 'hackathon', 'stage'), 'submissions');
  assert.equal(parseAdminView('results', 'demo', 'submissions'), 'results');
});

test('links from before the phase tabs still open, on the tab that took over', () => {
  // The Overview became the live tab.
  assert.equal(canonicalViewParam('home', 'hackathon'), null);
  assert.equal(parseAdminView('home', 'hackathon', 'stage'), 'stage');
  assert.equal(parseAdminView('home', 'demo', 'stage'), 'queue');
  // Presentations became Stage on a hackathon; Queue stays a demo night's.
  assert.equal(canonicalViewParam('queue', 'hackathon'), 'stage');
  assert.equal(canonicalViewParam('queue', 'demo'), 'queue');
  assert.equal(canonicalViewParam('stage', 'demo'), 'queue');
  // The old Judges page is part of Judging; a demo night has neither.
  assert.equal(canonicalViewParam('judges', 'hackathon'), 'judging');
  assert.equal(canonicalViewParam('judges', 'demo'), null);
  assert.equal(parseAdminView('judging', 'demo', 'submissions'), 'submissions');
  assert.equal(canonicalViewParam('nonsense', 'hackathon'), null);
  assert.equal(canonicalViewParam('settings', 'demo'), 'settings');
});

test('judging keeps its view, project and filters in the address', () => {
  assert.equal(parseJudgingView(null), 'progress');
  assert.equal(parseJudgingView('ranking'), 'ranking');
  assert.equal(parseJudgingView('nonsense'), 'progress');
  assert.equal(judgingPath('hack'), '/events/hack/admin?view=judging');
  assert.equal(judgingPath('hack', { judging: 'ranking', project: 'p1', track: null }), '/events/hack/admin?view=judging&judging=ranking&project=p1');
  assert.equal(judgingPath('hack', { judging: 'progress', group: 'first' }), '/events/hack/admin?view=judging&group=first');
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
