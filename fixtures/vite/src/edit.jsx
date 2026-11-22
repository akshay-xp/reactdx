import { Component, Suspense } from "react"
import { createRoot } from "react-dom/client"

// The editing toggles' targets (e2e/edit.test.ts): a component inside a Suspense
// boundary, one inside an error boundary, and one under neither.
class Boundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <p data-testid="error-ui">Something broke</p>
    ) : (
      this.props.children
    )
  }
}

function Inside() {
  return <p data-testid="ready">Inside</p>
}
function Child() {
  return <p data-testid="child">Child</p>
}
function Outside() {
  return <p data-testid="outside">Outside</p>
}

createRoot(document.getElementById("root")).render(
  <>
    <Suspense fallback={<p data-testid="fallback">Loading</p>}>
      <Inside />
    </Suspense>
    <Boundary>
      <Child />
    </Boundary>
    <Outside />
  </>,
)
