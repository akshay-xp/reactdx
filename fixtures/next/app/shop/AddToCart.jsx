"use client"

// Gets the whole product from the server, the props-size example.
export default function AddToCart({ product, price }) {
  return (
    <button type="button" data-testid="add-to-cart" title={product.id}>
      Add to cart · ${price}
    </button>
  )
}
