import { test, expect } from '@playwright/test';
import { collectComponents } from './collect.ts';
import { callSite, resolveFrame } from './resolve.ts';
import { expected, KNOWN_MISSES } from './expected.ts';

const VITE_ROOT = 'harness/vite-fixture';

// React 18's _debugSource comes from the JSX transform, so createElement calls have none.
const NO_SOURCE_18 = ['NoJsx'];

const SHAPES = ['Root', 'Plain', 'Arrow', 'Memoized', 'Forwarded', 'Klass', 'NoJsx', 'Item', 'Wrapped', 'LazyThing', 'Other', 'Nested'];

for (const [port, field, other] of [[5119, 'stack', 'source'], [5118, 'source', 'stack']] as const) {
  test(`collects every component shape with its ${field} on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/debug-stack.html`);
    await page.getByTestId('ready').waitFor({ state: 'attached' });
    const components = await page.evaluate(collectComponents);
    for (const name of SHAPES) {
      const found = components.filter((component) => component.name === name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const component of found) {
        if (port === 5118 && NO_SOURCE_18.includes(name)) expect(component.source, name).toBeNull();
        else expect(component[field], name).not.toBeNull();
        expect(component[other], name).toBeNull();
      }
    }
    expect(components.filter((component) => component.name === 'Item')).toHaveLength(3);
  });
}

test('resolves a React 19 call site through Vite source maps', async ({ page }) => {
  await page.goto('http://localhost:5119/');
  await page.getByTestId('counter').waitFor();
  const components = await page.evaluate(collectComponents);
  const counter = components.find((component) => component.name === 'Counter')!;
  const location = await resolveFrame(callSite(counter.stack)!, VITE_ROOT);
  expect(location).toMatchObject({ file: 'src/App.jsx', line: 8 });
});

test('callSite is null when no frame follows the factory', () => {
  expect(callSite('Error: react-stack-top-frame\n    at exports.jsxDEV (http://x/a.js:1:1)')).toBeNull();
});

test('rendered-at share on Vite with React 19', async ({ page }) => {
  let hits = 0;
  for (const entry of expected.vite) {
    await page.goto(`http://localhost:5119${entry.page}`);
    await page.getByTestId(entry.page === '/' ? 'counter' : 'ready').waitFor({ state: 'attached' });
    const component = (await page.evaluate(collectComponents)).find((c) => c.name === entry.name)!;
    const frame = callSite(component.stack);
    const location = frame && (await resolveFrame(frame, VITE_ROOT));
    const actual = location && `${location.file}:${location.line}`;
    if (actual === entry.rendered) hits++;
    if (!(entry.name in KNOWN_MISSES.vite19)) expect.soft(actual, entry.name).toBe(entry.rendered);
  }
  console.log(`vite 19 rendered-at: ${hits}/${expected.vite.length}`);
});
