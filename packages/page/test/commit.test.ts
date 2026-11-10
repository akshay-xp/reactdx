import { expect, test } from 'vitest';
import React from 'react';

test('runs on the React version of its project', () => {
  expect(React.version.startsWith(process.env.REACT_VERSION!)).toBe(true);
});
