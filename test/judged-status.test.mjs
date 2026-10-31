import assert from 'node:assert/strict';
import test from 'node:test';
import { isJudgedStatus } from '../lib/judged-status.ts';

test('a project waiting, in the Stage lineup or already pitched stays in judging', () => {
  for (const status of ['candidate', 'queued', 'up_next', 'current', 'done', 'no_show']) assert.equal(isJudgedStatus(status), true, status);
});

test('hidden and withdrawn projects are out of judging', () => {
  for (const status of ['hidden', 'withdrawn']) assert.equal(isJudgedStatus(status), false, status);
});
