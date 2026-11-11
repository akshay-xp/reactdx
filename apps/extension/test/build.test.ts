import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const targets = ['chrome-mv3', 'firefox-mv3'] as const;
const manifest = (target: string) => JSON.parse(readFileSync(path.join(root, '.output', target, 'manifest.json'), 'utf8'));

let output = '';
before(() => {
  // WXT prints warnings to stderr, so both streams are checked.
  const build = spawnSync('pnpm', ['build'], { cwd: root, encoding: 'utf8' });
  output = build.stdout + build.stderr;
  assert.equal(build.status, 0, output);
});

test('builds without warnings', () => {
  assert.doesNotMatch(output, /WARN|warning/i);
});

for (const target of targets) {
  test(`${target}: MV3 with only scripting and storage, hook script on every site`, () => {
    const m = manifest(target);
    assert.equal(m.manifest_version, 3);
    assert.deepEqual(m.permissions, ['scripting', 'storage']);
    assert.equal(m.host_permissions, undefined);
    assert.deepEqual(m.content_scripts, [
      { matches: ['<all_urls>'], run_at: 'document_start', world: 'MAIN', js: ['content-scripts/hook.js'] },
    ]);
  });
}

test('chrome-mv3: service worker background', () => {
  assert.equal(manifest('chrome-mv3').background.service_worker, 'background.js');
});

test('firefox-mv3: background scripts and gecko settings', () => {
  const m = manifest('firefox-mv3');
  assert.deepEqual(m.background.scripts, ['background.js']);
  assert.deepEqual(m.browser_specific_settings.gecko, {
    id: 'reactdx@akxp.net',
    strict_min_version: '128.0',
    data_collection_permissions: { required: ['none'] },
  });
});

const builtFiles = (target: string) => readdirSync(path.join(root, '.output', target), { recursive: true, encoding: 'utf8' });
const contains = (target: string, text: string) =>
  builtFiles(target).some((file) => file.endsWith('.js') && readFileSync(path.join(root, '.output', target, file), 'utf8').includes(text));

for (const target of targets) {
  test(`${target}: devtools page opens an empty ReactDX panel`, () => {
    assert.equal(manifest(target).devtools_page, 'devtools.html');
    assert.ok(builtFiles(target).includes('panel.html'), 'panel.html missing');
    assert.ok(contains(target, 'panel-root'), 'panel chunk missing panel-root');
    assert.ok(contains(target, '[reactdx] panel created'), 'devtools chunk missing log');
  });
}
