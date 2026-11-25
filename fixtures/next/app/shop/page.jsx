import { Suspense } from "react"
import CartCount from "./CartCount"
import { ProductDetails, Reviews } from "./components"
import { getCart } from "./data"
import ThemeProvider from "./ThemeProvider"

export default function Shop() {
  return (
    <main>
      <Suspense fallback={<p>Loading product</p>}>
        <ProductDetails id="p-12" />
      </Suspense>
      {/* Outside the Suspense: its child stays the Reviews reference. */}
      <ThemeProvider>
        <Suspense
          fallback={<p data-testid="reviews-fallback">Loading reviews</p>}
        >
          <Reviews id="p-12" />
        </Suspense>
      </ThemeProvider>
      <Suspense fallback={<p>Loading cart</p>}>
        <CartCount cart={getCart()} />
      </Suspense>
    </main>
  )
}
