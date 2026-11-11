import { useState } from "react"

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button
      type="button"
      data-testid="counter"
      onClick={() => setCount(count + 1)}
    >
      Count: {count}
    </button>
  )
}
