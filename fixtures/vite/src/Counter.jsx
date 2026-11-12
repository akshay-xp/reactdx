import { useState } from "react"

// Mounted on odd counts, so a click adds or removes a component (and no text).
function Clicked() {
  return null
}

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <>
      <button
        type="button"
        data-testid="counter"
        onClick={() => setCount(count + 1)}
      >
        Count: {count}
      </button>
      {count % 2 === 1 && <Clicked />}
    </>
  )
}
