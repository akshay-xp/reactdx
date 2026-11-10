'use client';

import { Component, forwardRef, memo } from 'react';

function Plain() {
  return <p>plain</p>;
}

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

function Item({ label }) {
  return <li>{label}</li>;
}

export default function Shapes() {
  return (
    <>
      <Plain />
      <Memoized />
      <Forwarded />
      <Klass />
      <ul>
        {['a', 'b', 'c'].map((label) => (
          <Item key={label} label={label} />
        ))}
      </ul>
      <i data-testid="ready" />
    </>
  );
}
