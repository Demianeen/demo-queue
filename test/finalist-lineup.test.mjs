import assert from 'node:assert/strict';
import test from 'node:test';
import { finalistLineupPlan } from '../lib/finalist-lineup.ts';

test('the finalists become the lineup in their order', () => {
  const rows = [
    { id: 'a', status: 'candidate' }, { id: 'b', status: 'candidate' }, { id: 'c', status: 'candidate' }, { id: 'd', status: 'candidate' },
  ];
  const plan = finalistLineupPlan(rows, ['c', 'a', 'd']);
  assert.deepEqual(plan.lineup, ['c', 'a', 'd']);
  assert.deepEqual(plan.updates, [
    { id: 'c', status: 'queued', queueOrder: 1 },
    { id: 'a', status: 'queued', queueOrder: 2 },
    { id: 'd', status: 'queued', queueOrder: 3 },
  ]);
});

test('an old hand-built lineup goes back to the pool; nothing is dropped or deleted', () => {
  const rows = [
    { id: 'old1', status: 'queued', queueOrder: 1 }, { id: 'fin', status: 'queued', queueOrder: 2 },
    { id: 'old2', status: 'queued', queueOrder: 3 }, { id: 'new', status: 'candidate' },
  ];
  const plan = finalistLineupPlan(rows, ['new', 'fin']);
  // The finalist already in the lineup keeps its place; the new one joins after it.
  assert.deepEqual(plan.lineup, ['fin', 'new']);
  assert.deepEqual(plan.updates, [
    { id: 'fin', status: 'queued', queueOrder: 1 },
    { id: 'new', status: 'queued', queueOrder: 2 },
    { id: 'old1', status: 'candidate', queueOrder: undefined },
    { id: 'old2', status: 'candidate', queueOrder: undefined },
  ]);
});

test('a reordered lineup and the current presenter survive a resubmit', () => {
  const rows = [{ id: 'b', status: 'queued', queueOrder: 1 }, { id: 'a', status: 'queued', queueOrder: 2 }, { id: 'c', status: 'candidate' }];
  const plan = finalistLineupPlan(rows, ['a', 'b', 'c']);
  assert.deepEqual(plan.lineup, ['b', 'a', 'c']);
  assert.deepEqual(plan.updates, [{ id: 'c', status: 'queued', queueOrder: 3 }]);
  assert.deepEqual(finalistLineupPlan(rows.slice(0, 2), ['a', 'b']).updates, []);
});

test('finalists who pitched, did not show, withdrew or were hidden stay as they are', () => {
  const rows = [
    { id: 'done', status: 'done' }, { id: 'gone', status: 'no_show' }, { id: 'out', status: 'withdrawn' },
    { id: 'hid', status: 'hidden' }, { id: 'next', status: 'candidate' },
  ];
  const plan = finalistLineupPlan(rows, ['done', 'gone', 'out', 'hid', 'next']);
  assert.deepEqual(plan.lineup, ['next']);
  assert.deepEqual(plan.updates, [{ id: 'next', status: 'queued', queueOrder: 1 }]);
});
