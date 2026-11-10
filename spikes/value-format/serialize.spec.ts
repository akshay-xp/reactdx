import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { createInspector } from './serialize.ts';

const roundTrips = (value: unknown) => expect(JSON.parse(JSON.stringify(value))).toEqual(value);

test('JSON-safe primitives pass through unchanged', () => {
  const { serialize } = createInspector();
  for (const value of [1, 'a', true, null]) expect(serialize(value)).toBe(value);
});

test('primitives JSON cannot carry become descriptors', () => {
  const { serialize } = createInspector();
  const cases: [unknown, unknown][] = [
    [undefined, { type: 'undefined' }],
    [NaN, { type: 'number', value: 'NaN' }],
    [Infinity, { type: 'number', value: 'Infinity' }],
    [-Infinity, { type: 'number', value: '-Infinity' }],
    [-0, { type: 'number', value: '-0' }],
    [10n, { type: 'bigint', value: '10' }],
    ['x'.repeat(5000), { type: 'string', preview: 'x'.repeat(1000), length: 5000 }],
  ];
  for (const [value, descriptor] of cases) {
    const result = serialize(value);
    expect(result).toEqual(descriptor);
    roundTrips(result);
  }
});

class User {
  name = 'ada';
}

test('functions, symbols, and objects are described', () => {
  const { serialize } = createInspector();
  expect(serialize(function onClick() {})).toEqual({ type: 'function', name: 'onClick' });
  expect(serialize(Symbol('x'))).toEqual({ type: 'symbol', description: 'x' });
  expect(serialize({ a: 1 })).toEqual({ type: 'object', className: 'Object', id: expect.any(Number), size: 1, props: { a: 1 } });
  expect(serialize(new User())).toMatchObject({ type: 'object', className: 'User', props: { name: 'ada' } });
  expect(serialize(Object.create(null))).toMatchObject({ type: 'object', className: null, size: 0 });
  roundTrips(serialize({ a: 1, f() {} }));
});

test('getters are reported, never invoked', () => {
  const { serialize } = createInspector();
  const value = {
    get boom() {
      throw new Error('getter ran');
    },
  };
  expect(serialize(value)).toMatchObject({ props: { boom: { type: 'getter' } } });
});

test('objects past the depth limit become refs that expand on demand', () => {
  const { serialize, expand } = createInspector();
  const value = { a: { b: { c: { d: 1 } } } };
  const result: any = serialize(value);
  const ref = result.props.a.props.b;
  expect(ref).toEqual({ type: 'ref', id: expect.any(Number), preview: { type: 'object', className: 'Object', size: 1 } });
  expect(expand(ref.id)).toMatchObject({ type: 'object', props: { c: { type: 'object', props: { d: 1 } } } });
  expect((serialize(value) as any).props.a.props.b.id).toBe(ref.id);
  roundTrips(result);
});

test('circular references become refs marked circular', () => {
  const { serialize } = createInspector();
  const o: any = { name: 'o' };
  o.self = o;
  const result: any = serialize(o);
  expect(result.props.self).toEqual({ type: 'ref', id: result.id, circular: true });

  const parent: any = { children: [] };
  parent.children.push({ parent });
  roundTrips(serialize(parent));
});

test('large arrays, maps, and sets are sent one page at a time', () => {
  const { serialize, expand } = createInspector();
  const list = Array.from({ length: 10000 }, (_, i) => ({ i }));

  const start = performance.now();
  const array: any = serialize(list);
  const elapsed = performance.now() - start;
  expect(array).toMatchObject({ type: 'array', id: expect.any(Number), length: 10000, nextOffset: 100 });
  expect(array.items).toHaveLength(100);
  expect(JSON.stringify(array).length).toBeLessThan(20000);
  expect(elapsed).toBeLessThan(5);
  roundTrips(array);

  const next: any = expand(array.id, 100);
  expect(next.items[0]).toMatchObject({ props: { i: 100 } });
  expect(next.items).toHaveLength(100);
  expect(next.nextOffset).toBe(200);

  const map: any = serialize(new Map(list.map((item) => [item.i, item])));
  expect(map).toMatchObject({ type: 'map', size: 10000, nextOffset: 100 });
  expect(map.entries).toHaveLength(100);
  expect(map.entries[0]).toEqual([0, expect.objectContaining({ props: { i: 0 } })]);

  const set: any = serialize(new Set(list));
  expect(set).toMatchObject({ type: 'set', size: 10000, nextOffset: 100 });
  expect(set.values).toHaveLength(100);
});

test('built-ins get short descriptors', () => {
  const { serialize } = createInspector();
  expect(serialize(new Date(0))).toEqual({ type: 'date', iso: '1970-01-01T00:00:00.000Z' });
  expect(serialize(/a/g)).toEqual({ type: 'regexp', source: 'a', flags: 'g' });
  expect(serialize(new TypeError('x'))).toEqual({ type: 'error', name: 'TypeError', message: 'x' });
  expect(serialize(Promise.resolve())).toEqual({ type: 'promise' });
});

const fixtureRequire = createRequire(path.resolve(import.meta.dirname, '../harness/vite-fixture/package.json'));

for (const react of ['react-18', 'react-19']) {
  test(`${react} elements get a react-element descriptor`, () => {
    const { createElement } = fixtureRequire(react);
    const { serialize } = createInspector();
    function Counter() {
      return null;
    }
    expect(serialize(createElement(Counter, { key: 'k' }))).toEqual({ type: 'react-element', name: 'Counter', key: 'k' });
    expect(serialize(createElement('div'))).toEqual({ type: 'react-element', name: 'div', key: null });
  });
}

test('DOM nodes are described, not walked', async ({ page }) => {
  const { outputFiles } = await build({
    entryPoints: [path.resolve(import.meta.dirname, 'serialize.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'reactdxValue',
    write: false,
  });
  await page.setContent('<button id="b" class="x y">Go</button><svg id="s" class="icon"></svg>');
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(() => {
    const { serialize } = (window as any).reactdxValue.createInspector();
    const button = document.getElementById('b');
    const start = performance.now();
    const withRef = serialize({ ref: { current: button } });
    return {
      button: serialize(button),
      document: serialize(document),
      svg: serialize(document.getElementById('s')),
      elapsed: performance.now() - start,
      size: JSON.stringify(withRef).length,
    };
  });
  expect(result.button).toEqual({ type: 'element', tag: 'button', id: 'b', className: 'x y' });
  expect(result.document).toEqual({ type: 'node', nodeName: '#document' });
  expect(result.svg).toEqual({ type: 'element', tag: 'svg', id: 's', className: 'icon' });
  expect(result.elapsed).toBeLessThan(5);
  expect(result.size).toBeLessThan(1000);
});
