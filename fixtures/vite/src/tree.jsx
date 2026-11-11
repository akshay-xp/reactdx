import {
  Activity,
  Component,
  createContext,
  createElement,
  forwardRef,
  lazy,
  memo,
  Profiler,
  StrictMode,
  Suspense,
} from "react"
import { createRoot } from "react-dom/client"

// One of each component kind the tree shows, plus wrappers it hides
// (StrictMode, Fragment, text, DOM elements). Mirrors packages/page/test/tree.test.ts.
class Klass extends Component {
  render() {
    return null
  }
}
const Memoized = memo(function Memoized() {
  return null
})
const Fwd = forwardRef(function Fwd() {
  return null
})
const Named = forwardRef(function Inner() {
  return null
})
Named.displayName = "Named"
const Lazy = lazy(async () => ({
  default: function Lazy() {
    return null
  },
}))
const Theme = createContext(0)
Theme.displayName = "Theme"
const Plain = createContext(0)
function Item() {
  return <span>item</span>
}

function Kinds() {
  return (
    <>
      <Klass />
      <Memoized />
      <Fwd />
      <Named />
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
      <Theme.Provider value={1}>
        <Theme.Consumer>{() => null}</Theme.Consumer>
      </Theme.Provider>
      <Plain.Provider value={1} />
      <Profiler id="p" onRender={() => {}}>
        <Item />
      </Profiler>
      {createElement(() => null)}
      {["a", "b"].map((key) => (
        <Item key={key} />
      ))}
      {Activity && (
        <Activity mode="visible">
          <Item />
        </Activity>
      )}
      text
    </>
  )
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Kinds />
  </StrictMode>,
)
