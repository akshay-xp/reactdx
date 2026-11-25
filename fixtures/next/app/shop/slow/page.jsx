import { Suspense } from "react"
import { Reviews } from "../components"

// Only the Reviews boundary, waiting long enough for e2e/suspense.test.ts to
// select it while it shows its fallback.
export default function SlowShop() {
  return (
    <main>
      <Suspense
        fallback={<p data-testid="reviews-fallback">Loading reviews</p>}
      >
        <Reviews id="p-12" wait={6000} />
      </Suspense>
    </main>
  )
}
