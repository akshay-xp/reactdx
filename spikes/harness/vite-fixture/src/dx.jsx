import { createContext, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';

const WhyContext = createContext(0);
WhyContext.displayName = 'WhyContext';

function WhyChild({ style, label }) {
  const [own, setOwn] = useState(0);
  const context = useContext(WhyContext);
  return (
    <p style={style}>
      {label} {own} {context}
      <button data-testid="why-own" onClick={() => setOwn((o) => o + 1)} />
    </p>
  );
}

function WhyPlain() {
  return <p>plain</p>;
}

function WhyParent() {
  const [label, setLabel] = useState('a');
  const [, setTick] = useState(0);
  const [context, setContext] = useState(0);
  return (
    <WhyContext.Provider value={context}>
      <WhyChild style={{ color: 'red' }} label={label} />
      <WhyPlain />
      <button data-testid="why-same-ref" onClick={() => setTick((t) => t + 1)} />
      <button data-testid="why-parent" onClick={() => setTick((t) => t + 1)} />
      <button data-testid="why-label" onClick={() => setLabel((l) => l + 'a')} />
      <button data-testid="why-context" onClick={() => setContext((c) => c + 1)} />
    </WhyContext.Provider>
  );
}

function Dx() {
  return <WhyParent />;
}

createRoot(document.getElementById('root')).render(<Dx />);
