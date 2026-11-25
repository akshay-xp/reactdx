import Link from "next/link"
import Counter from "./Counter"

export default function Page() {
  return (
    <main>
      <p data-testid="server">Rendered on the server</p>
      <Counter label="Count" />
      <nav>
        <Link href="/shop">Shop</Link> <Link href="/shop/slow">Slow shop</Link>
      </nav>
    </main>
  )
}
