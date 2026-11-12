import { useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

const CELLS = 10000
const setters = []

function Cell({ index }) {
  const [value, setValue] = useState(0)
  setters[index] = setValue
  return <span data-testid="cell">{value}</span>
}

// Built once, so toggling Extra leaves the cells alone (React bails out on them).
const cells = Array.from({ length: CELLS }, (_, index) => (
  <Cell key={index} index={index} />
))

function Extra() {
  return <span data-testid="extra-on" />
}

// The button mounts or unmounts one component: the panel's commit-latency test.
function Bench() {
  const [extra, setExtra] = useState(false)
  return (
    <>
      <button
        type="button"
        data-testid="extra"
        onClick={() => setExtra(!extra)}
      >
        Toggle Extra
      </button>
      {extra && <Extra />}
      {cells}
    </>
  )
}

createRoot(document.getElementById("root")).render(<Bench />)

let tick = 0

window.__bench = (mode, iterations) => {
  const durations = []
  for (let i = 0; i < iterations; i++) {
    const value = ++tick
    const start = performance.now()
    flushSync(() => {
      if (mode === "all") for (const set of setters) set(value)
      else setters[0](value)
    })
    durations.push(performance.now() - start)
  }
  return durations
}
