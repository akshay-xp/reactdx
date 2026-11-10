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

window.__bench = (mode, iterations) => {
  const durations = [];
  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    flushSync(() => {
      if (mode === 'all') setters.forEach((set) => set(i));
      else setters[0](i);
    });
    durations.push(performance.now() - start);
  }
  return durations;
};
