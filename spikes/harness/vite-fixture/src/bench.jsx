import { useState } from 'react';
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
