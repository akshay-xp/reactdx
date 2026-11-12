import * as React from "react"
import * as ReactDOM from "react-dom"
import { createRoot } from "react-dom/client"

// Every hook the inspector reads, at the top level of one component, plus a
// custom hook (e2e/inspector.test.ts lists what each one shows). React 19's own
// hooks are called only on React 19: the branch is the same on every render.
const modern = typeof React.use === "function"
const Theme = React.createContext("light")
Theme.displayName = "Theme"
const store = { subscribe: () => () => {}, get: () => "s" }
const done = Object.assign(Promise.resolve(5), {
  status: "fulfilled",
  value: 5,
})

function useCount() {
  return React.useState(2)
}
function useCart() {
  useCount()
  React.useDebugValue("2 items")
}

function Hooks() {
  // Assigned, destructured and plain, for hook names (e2e/inspector.test.ts).
  const [one, setOne] = React.useState(1)
  React.useReducer((state) => state, "r")
  const box = React.useRef({ a: 1 })
  React.useMemo(() => 3, [])
  React.useCallback(() => {}, [])
  React.useEffect(() => {}, [1])
  React.useLayoutEffect(() => {})
  React.useInsertionEffect(() => {}, [])
  const handle = React.useRef(null)
  React.useImperativeHandle(handle, () => ({ focus() {} }), [])
  React.useDeferredValue("d")
  React.useTransition()
  React.useSyncExternalStore(store.subscribe, store.get)
  React.useId()
  React.useContext(Theme)
  const cart = useCart()
  void [one, setOne, box, cart]
  // Inline: a helper function would show as a custom hook.
  if (modern) {
    React.use(done)
    React.useActionState((state) => state, "a")
    React.useOptimistic("o")
    ReactDOM.useFormStatus()
    React.useEffectEvent(() => {})
  }
  return <p data-testid="hooks">hooks</p>
}

createRoot(document.getElementById("root")).render(
  <Theme.Provider value="dark">
    <Hooks />
  </Theme.Provider>,
)
