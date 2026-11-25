import { Suspense } from "react"
import CartCount from "./CartCount"
import { ProductDetails, Reviews } from "./components"
import { getCart } from "./data"

export default function Shop() {
  return (
    <main>
      <Suspense fallback={<p>Loading product</p>}>
        <ProductDetails id="p-12" />
      </Suspense>
      <Suspense
        fallback={<p data-testid="reviews-fallback">Loading reviews</p>}
      >
        <Reviews id="p-12" />
      </Suspense>
      <Suspense fallback={<p>Loading cart</p>}>
        <CartCount cart={getCart()} />
      </Suspense>
    </main>
  )
}
