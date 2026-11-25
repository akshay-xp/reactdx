import { Suspense, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

const CELLS = 10000
const setters = []

function Cell({ index }) {
  const [value, setValue] = useState(0)
  // The first render's setter (React keeps it): the inspector's shadow render
  // calls Cell again with a stub dispatcher, whose setter does nothing.
  setters[index] ??= setValue
  return <span data-testid="cell">{value}</span>
}

// `?waiting=N`: N boundaries that never stop waiting, spread among the cells,
// each starting a line, so the page scrolls (e2e/perf.test.ts, outlines).
const WAITING = Number(new URLSearchParams(location.search).get("waiting")) || 0
const never = new Promise(() => {})
function Never() {
  throw never
}
const every = Math.floor(CELLS / (WAITING || 1))

// Built once, so toggling Extra leaves the cells alone (React bails out on them).
const cells = Array.from({ length: CELLS }, (_, index) =>
  WAITING && index % every === 0 ? (
    <div key={index}>
      <Suspense fallback={<span data-testid="waiting">waiting</span>}>
        <Never />
      </Suspense>
      <Cell index={index} />
    </div>
  ) : (
    <Cell key={index} index={index} />
  ),
)

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
