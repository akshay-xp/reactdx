"use client"

import React, { useState } from "react"

// Mounted on odd counts, so a click adds or removes a component (and no text).
function Clicked() {
  return null
}

// `label` is a prop for the inspector to show (e2e/inspector.test.ts).
export default function Counter({ label }) {
  const [count, setCount] = useState(0)
  return (
    <>
      <p data-testid="react-version">{React.version}</p>
      <button
        type="button"
        data-testid="counter"
        onClick={() => setCount(count + 1)}
      >
        {label}: {count}
      </button>
      {count % 2 === 1 && <Clicked />}
    </>
  )
}
