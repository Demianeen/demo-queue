import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '_generated') continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sources(file));
    else if (/\.tsx?$/.test(file) && !file.endsWith('.test.ts')) result.push(file);
  }
  return result;
}

test('retired event-admin capabilities and saved-link actions cannot return to application code', async () => {
  const root = new URL('../', import.meta.url).pathname;
  const files = (await Promise.all(['app', 'components', 'convex', 'lib'].map((name) => sources(join(root, name))))).flat();
  const violations = [];
  for (const file of files) {
    const name = relative(root, file);
    const source = await readFile(file, 'utf8');
    if (name !== 'convex/schema.ts' && /\badminToken\b/.test(source)) violations.push(`${name}: admin capability`);
    if (/SavedEventLinks|saved event links/i.test(source)) violations.push(`${name}: saved-link action`);
  }
  assert.deepEqual(violations, []);
});
