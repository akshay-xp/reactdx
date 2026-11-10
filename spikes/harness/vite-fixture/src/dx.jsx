import { Component, createContext, useContext, useEffect, useState } from 'react';
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

function EffectDeps() {
  const [a, setA] = useState(0);
  const [b] = useState(0);
  useEffect(() => {}, [a, b]);
  useEffect(() => {}, [b]);
  return <button data-testid="effect-a" onClick={() => setA((x) => x + 1)} />;
}

function RemountChild() {
  return <span>child</span>;
}

function RemountHost() {
  const [k, setK] = useState(0);
  const [section, setSection] = useState(false);
  const Wrapper = section ? 'section' : 'div';
  return (
    <>
      <Wrapper>
        <RemountChild key={k} />
      </Wrapper>
      <button data-testid="remount-key" onClick={() => setK((x) => x + 1)} />
      <button data-testid="remount-wrapper" onClick={() => setSection((x) => !x)} />
    </>
  );
}

function OriginChild({ onBump }) {
  function handleBump() {
    onBump();
    onBump();
  }
  return <button data-testid="origin-bump" onClick={handleBump} />;
}

function OriginParent() {
  const [count, setCount] = useState(0);
  return <OriginChild onBump={() => setCount((c) => c + 1)} count={count} />;
}

const ConsumerContext = createContext('x');
ConsumerContext.displayName = 'ConsumerContext';

function ReaderA() {
  return <p>{useContext(ConsumerContext)}</p>;
}

class ReaderB extends Component {
  static contextType = ConsumerContext;
  render() {
    return <p>{this.context}</p>;
  }
}

function NotReader() {
  return <p>not a reader</p>;
}

function Consumers() {
  return (
    <ConsumerContext.Provider value="y">
      <ReaderA />
      <ReaderB />
      <NotReader />
    </ConsumerContext.Provider>
  );
}

function Dx() {
  return (
    <>
      <WhyParent />
      <EffectDeps />
      <RemountHost />
      <OriginParent />
      <Consumers />
    </>
  );
}

createRoot(document.getElementById('root')).render(<Dx />);
