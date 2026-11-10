import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const CELLS = 10000;
const setters = [];

function Cell({ index }) {
  const [value, setValue] = useState(0);
  setters[index] = setValue;
  return <span data-testid="cell">{value}</span>;
}

createRoot(document.getElementById('root')).render(
  Array.from({ length: CELLS }, (_, index) => <Cell key={index} index={index} />),
);

let tick = 0;

window.__bench = (mode, iterations) => {
  const durations = [];
  for (let i = 0; i < iterations; i++) {
    const value = ++tick;
    const start = performance.now();
    flushSync(() => {
      if (mode === 'all') setters.forEach((set) => set(value));
      else setters[0](value);
    });
    durations.push(performance.now() - start);
  }
  return durations;
};
