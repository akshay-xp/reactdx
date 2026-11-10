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
