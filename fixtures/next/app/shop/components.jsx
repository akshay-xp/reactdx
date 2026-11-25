import { Suspense } from "react"
import AddToCart from "./AddToCart"
import { getProduct, getRecommendations, getReviews } from "./data"

export async function ProductDetails({ id }) {
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
export async function Reviews({ id, wait }) {
  const reviews = await getReviews(id, wait)
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

export async function Recommendations({ id }) {
  const items = await getRecommendations(id)
  return (
    <ul data-testid="recommendations">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
