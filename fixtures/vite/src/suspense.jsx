import * as React from "react"
import { lazy, Suspense } from "react"
import { createRoot } from "react-dom/client"

// Suspense waits for e2e/suspense.test.ts: a component waiting on a promise
// (3 s), first so it's the first Suspense row, then a lazy() component (1 s).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const comments = sleep(3000).then(() => ["First!", "Nice shoe"])
let loaded
comments.then((list) => {
  loaded = list
})

// React 19 reads the promise with use(); React 18 has no use(), so it throws
// the promise until it settles, as libraries did before use().
function Comments() {
  const list = React.use ? React.use(comments) : (loaded ?? throwing())
  return (
    <ul data-testid="comments">
      {list.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  )
}
function throwing() {
  throw comments
}

function Details() {
  return <p data-testid="details">Details</p>
}
const LazyDetails = lazy(() => sleep(1000).then(() => ({ default: Details })))

createRoot(document.getElementById("root")).render(
  <>
    <Suspense
      fallback={<p data-testid="comments-fallback">Loading comments</p>}
    >
      <Comments />
    </Suspense>
    <Suspense fallback={<p data-testid="details-fallback">Loading details</p>}>
      <LazyDetails />
    </Suspense>
  </>,
)
