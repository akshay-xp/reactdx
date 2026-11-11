import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBundle } from './bundles.ts';

const repo = path.resolve(import.meta.dirname, '../..');

function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'reactdx-check-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('a clean bundle passes', () => {
  assert.deepEqual(checkBundle(bundle({ 'a.js': 'console.log(1)' })), []);
});

for (const file of [
  'test-env/react-18/node_modules/react/cjs/react.production.min.js',
  'test-env/react-18/node_modules/react-dom/cjs/react-dom.production.min.js',
  'test-env/react-19/node_modules/react/cjs/react.production.js',
  'test-env/react-19/node_modules/react-dom/cjs/react-dom-client.production.js',
]) {
  test(`flags React: ${file}`, () => {
    const violations = checkBundle(bundle({ 'chunks/x.js': readFileSync(path.join(repo, file), 'utf8') }));
    assert.equal(violations.length, 1, String(violations));
    assert.ok(violations[0]?.startsWith('chunks/x.js: React ('), violations[0]);
  });
}
