import { test, expect } from '@playwright/test';
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
