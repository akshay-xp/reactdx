import { test, expect } from '@playwright/test';
import { median, p95 } from './stats.ts';

test('median of odd and even counts', () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});

test('p95 uses nearest rank', () => {
  expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
  expect(p95([5])).toBe(5);
});

test('inputs are not reordered', () => {
  const values = [3, 1, 2];
  median(values);
  p95(values);
  expect(values).toEqual([3, 1, 2]);
});
