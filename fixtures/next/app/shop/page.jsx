import { Suspense } from "react"
import AddToCart from "./AddToCart"
import CartCount from "./CartCount"
import { getCart, getProduct, getRecommendations, getReviews } from "./data"

async function ProductDetails({ id }) {
  const product = await getProduct(id)
  return (
    <section>
      <h2 data-testid="product">{product.name}</h2>
      <AddToCart product={product} price={product.price} />
    </section>
  )
}

// Recommendations waits inside Reviews' output, so its fetch starts only once
// Reviews' data arrives: a waterfall.
async function Reviews({ id }) {
  const reviews = await getReviews(id)
  return (
    <section data-testid="reviews">
      <ul>
        {reviews.map((review) => (
          <li key={review}>{review}</li>
        ))}
      </ul>
      <Suspense fallback={<p>Loading recommendations</p>}>
        <Recommendations id={id} />
      </Suspense>
    </section>
  )
}

async function Recommendations({ id }) {
  const items = await getRecommendations(id)
  return (
    <ul data-testid="recommendations">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

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
