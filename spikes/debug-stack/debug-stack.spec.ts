import { test, expect, type Page } from '@playwright/test';
import { collectComponents } from './collect.ts';
import { callSite, definedIn, locate, resolveFrame } from './resolve.ts';
import { expected, KNOWN_MISSES, type Expected } from './expected.ts';

const VITE_ROOT = 'harness/vite-fixture';
const NEXT_ROOT = 'harness/next-fixture';

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

async function componentsOn(page: Page, port: number, entry: Expected) {
  await page.goto(`http://localhost:${port}${entry.page}`);
  await page.getByTestId(entry.page === '/' ? 'counter' : 'ready').waitFor({ state: 'attached' });
  return page.evaluate(collectComponents);
}

const cases = [
  { label: 'vite19', port: 5119, root: VITE_ROOT, entries: expected.vite },
  { label: 'vite18', port: 5118, root: VITE_ROOT, entries: expected.vite },
  { label: 'next19', port: 5120, root: NEXT_ROOT, entries: expected.next },
];

for (const { label, port, root, entries } of cases) {
  test(`rendered-at share on ${label}`, async ({ page }) => {
    let hits = 0;
    const misses = KNOWN_MISSES[label] ?? {};
    for (const entry of entries) {
      const component = (await componentsOn(page, port, entry)).find((c) => c.name === entry.name);
      const location = component ? await locate(component, root) : null;
      const actual = location && `${location.file}:${location.line}`;
      if (actual === entry.rendered) hits++;
      if (!(entry.name in misses)) expect.soft(actual, entry.name).toBe(entry.rendered);
    }
    console.log(`${label} rendered-at: ${hits}/${entries.length}`);
  });

  test(`defined-in share on ${label}`, async ({ page }) => {
    let hits = 0;
    const misses = KNOWN_MISSES[`${label}Defined`] ?? {};
    for (const entry of entries) {
      const components = await componentsOn(page, port, entry);
      if (entry === entries[0]) expect(await definedIn('Missing', components, root)).toBeNull();
      const actual = (await definedIn(entry.name, components, root))?.file ?? null;
      if (actual === entry.defined) hits++;
      if (!(entry.name in misses)) expect.soft(actual, entry.name).toBe(entry.defined);
    }
    console.log(`${label} defined-in: ${hits}/${entries.length}`);
  });
}

test('React 19 stops capturing call sites past 10k elements', async ({ page }) => {
  await page.goto('http://localhost:5119/debug-stack.html?many=10500');
  await page.getByTestId('ready').waitFor({ state: 'attached' });
  const items = (await page.evaluate(collectComponents)).filter((component) => component.name === 'Item');
  const resolved = items.filter((item) => item.stack && new URL(callSite(item.stack)!.url).pathname === '/src/debug-stack.jsx');
  const lost = items.length - resolved.length;
  console.log(`items: ${items.length}, with call site: ${resolved.length}, without: ${lost}`);
  console.log(`a lost stack starts: ${items.find((item) => !resolved.includes(item))?.stack?.split("\n")[1].trim()}`);
  expect(lost).toBeGreaterThan(0);
  expect(resolved.length).toBeLessThanOrEqual(10000);
});
