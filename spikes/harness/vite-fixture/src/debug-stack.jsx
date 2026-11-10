import { Component, createElement, forwardRef, lazy, memo, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Other from './shapes/Other';

const LazyThing = lazy(() => import('./shapes/Lazy'));

function Plain() {
  return <p>plain</p>;
}

const Arrow = () => <p>arrow</p>;

const Memoized = memo(function Memoized() {
  return <p>memo</p>;
});

const Forwarded = forwardRef(function Forwarded(props, ref) {
  return <p ref={ref}>forwarded</p>;
});

class Klass extends Component {
  render() {
    return <p>class</p>;
  }
}

function NoJsx() {
  return createElement('p', null, 'no jsx');
}

function Item({ label }) {
  return <li>{label}</li>;
}

function withBorder(Inner) {
  return function Border() {
    return (
      <div style={{ border: '1px solid' }}>
        <Inner />
      </div>
    );
  };
}

function Wrapped() {
  return <p>wrapped</p>;
}

const Bordered = withBorder(Wrapped);

// ?many=<n> renders n extra Items, past React 19's 10k owner-stack limit.
const many = Number(new URLSearchParams(location.search).get('many') ?? 0);

function Many() {
  return Array.from({ length: many }, (_, index) => <Item key={index} label={index} />);
}

function Root() {
  return (
    <>
      <Plain />
      <Arrow />
      <Memoized />
      <Forwarded />
      <Klass />
      {createElement(NoJsx)}
      <ul>
        {['a', 'b', 'c'].map((label) => (
          <Item key={label} label={label} />
        ))}
      </ul>
      <Bordered />
      <Other />
      <Suspense fallback={null}>
        <LazyThing />
      </Suspense>
      {many > 0 && <Many />}
    </>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
