"use client"

import { use } from "react"

// Reads a promise the server passed: a client-side wait on server data.
export default function CartCount({ cart }) {
  const { count } = use(cart)
  return <p data-testid="cart-count">Cart ({count})</p>
}
