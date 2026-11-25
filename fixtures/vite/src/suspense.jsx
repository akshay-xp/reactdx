import * as React from "react"
import { lazy, Suspense, useState } from "react"
import { createRoot } from "react-dom/client"

// Suspense waits for e2e/suspense.test.ts: a component waiting on a promise
// (3 s), first so it's the first Suspense row, then a lazy() component (1 s).
// Again waits once more with a new promise: the load's first wait is over
// before DevTools watches (and React 18 says who suspended only while it does).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const rounds = new Map()
const commentsFor = (round) => {
  let entry = rounds.get(round)
  if (!entry) {
    entry = {}
    entry.promise = sleep(3000).then(() => {
      entry.list = ["First!", "Nice shoe"]
      return entry.list
    })
    rounds.set(round, entry)
  }
  return entry
}

// React 19 reads the promise with use(); React 18 has no use(), so it throws
// the promise until it settles, as libraries did before use().
function Comments({ round }) {
  const entry = commentsFor(round)
  const list = React.use ? React.use(entry.promise) : entry.list
  if (!list) throw entry.promise
  return (
    <ul data-testid="comments">
      {list.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  )
}

function Details() {
  return <p data-testid="details">Details</p>
}
const LazyDetails = lazy(() => sleep(1000).then(() => ({ default: Details })))

function SuspensePage() {
  const [round, setRound] = useState(0)
  return (
    <>
      <button
        type="button"
        data-testid="again"
        onClick={() => setRound(round + 1)}
      >
        Again
      </button>
      <Suspense
        fallback={<p data-testid="comments-fallback">Loading comments</p>}
      >
        <Comments key={round} round={round} />
      </Suspense>
      <Suspense
        fallback={<p data-testid="details-fallback">Loading details</p>}
      >
        <LazyDetails />
      </Suspense>
    </>
  )
}

createRoot(document.getElementById("root")).render(<SuspensePage />)
