import { test, expect, type Page } from '@playwright/test';
import { collectComponents } from './collect.ts';
import { callSite, fromSource, resolveFrame, type Location } from './resolve.ts';
import { expected, KNOWN_MISSES } from './expected.ts';

const VITE_ROOT = 'harness/vite-fixture';

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
        if (port === 5118 && name in KNOWN_MISSES.vite18) expect(component.source, name).toBeNull();
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

async function renderedAtShare(
  page: Page,
  port: number,
  misses: Record<string, string>,
  locate: (component: any) => Promise<Location | null>,
) {
  let hits = 0;
  for (const entry of expected.vite) {
    await page.goto(`http://localhost:${port}${entry.page}`);
    await page.getByTestId(entry.page === '/' ? 'counter' : 'ready').waitFor({ state: 'attached' });
    const component = (await page.evaluate(collectComponents)).find((c) => c.name === entry.name)!;
    const location = await locate(component);
    const actual = location && `${location.file}:${location.line}`;
    if (actual === entry.rendered) hits++;
    if (!(entry.name in misses)) expect.soft(actual, entry.name).toBe(entry.rendered);
  }
  return `${hits}/${expected.vite.length}`;
}

test('rendered-at share on Vite with React 19', async ({ page }) => {
  const share = await renderedAtShare(page, 5119, KNOWN_MISSES.vite19, async (component) => {
    const frame = callSite(component.stack);
    return frame && resolveFrame(frame, VITE_ROOT);
  });
  console.log(`vite 19 rendered-at: ${share}`);
});

test('rendered-at share on Vite with React 18', async ({ page }) => {
  const share = await renderedAtShare(page, 5118, KNOWN_MISSES.vite18, async (component) =>
    component.source && fromSource(component.source, VITE_ROOT),
  );
  console.log(`vite 18 rendered-at: ${share}`);
});
