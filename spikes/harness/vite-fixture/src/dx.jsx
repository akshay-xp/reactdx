import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function WhyChild({ style, label }) {
  return <p style={style}>{label}</p>;
}

function WhyParent() {
  const [label, setLabel] = useState('a');
  const [, setTick] = useState(0);
  return (
    <>
      <WhyChild style={{ color: 'red' }} label={label} />
      <button data-testid="why-same-ref" onClick={() => setTick((t) => t + 1)} />
      <button data-testid="why-label" onClick={() => setLabel((l) => l + 'a')} />
    </>
  );
}

function Dx() {
  return <WhyParent />;
}

createRoot(document.getElementById('root')).render(<Dx />);
