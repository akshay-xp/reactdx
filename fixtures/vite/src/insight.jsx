import { createContext, memo, useContext, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

// One component per render reason (e2e/insight.test.ts): Late mounts on "add"
// (with Stepped, whose "step" builds a history from its mount), Shown's prop
// changes on "bump", Stateful's own state on "state" (Counter's on "count",
// which triggers its commit), Reader's context on "theme", and Plain (no
// props, not memo) renders only because its parent did. Styled is memo but
// gets an inline object and callback, which are new references on every
// render. Effects' "b" runs its [a, b] effect (b changed) and its no-deps one,
// not its [a] one. "rekey" remounts Item by its key; "wrap" swaps Inner's div
// for a section, remounting Inner. "list" mounts Products: 40 Product rows (not
// memo, a stable item each) that every keystroke in its search re-renders for
// nothing (M6 #72).
const Theme = createContext("light")
Theme.displayName = "Theme"

function Shown({ count }) {
  return <p data-testid="shown">Count {count}</p>
}
const Styled = memo(function Styled({ style, data }) {
  return (
    <p data-testid="styled" style={style}>
      Styled {data.count}
    </p>
  )
})
const noop = () => {}
function Effects() {
  const [a] = useState(1)
  const [b, setB] = useState(1)
  useEffect(noop, [a, b])
  useEffect(noop, [a])
  useEffect(noop)
  return (
    <>
      <p data-testid="effects">
        Effects a{a} b{b}
      </p>
      <button type="button" data-testid="b" onClick={() => setB(b + 1)}>
        Set b
      </button>
    </>
  )
}
function Item() {
  return <p data-testid="item">Item</p>
}
function Inner() {
  return <p data-testid="inner">Inner</p>
}
function Keyed() {
  const [itemKey, setItemKey] = useState("a")
  return (
    <>
      <Item key={itemKey} />
      <button type="button" data-testid="rekey" onClick={() => setItemKey("b")}>
        Rekey
      </button>
    </>
  )
}
function Wrapped() {
  const [wrapped, setWrapped] = useState(false)
  return (
    <>
      {wrapped ? (
        <section>
          <Inner />
        </section>
      ) : (
        <div>
          <Inner />
        </div>
      )}
      <button type="button" data-testid="wrap" onClick={() => setWrapped(true)}>
        Wrap
      </button>
    </>
  )
}
function Late() {
  return <p data-testid="late">Late</p>
}
function Stepped() {
  const [step, setStep] = useState(0)
  return (
    <>
      <p data-testid="stepped">Stepped {step}</p>
      <button
        type="button"
        data-testid="step"
        onClick={() => setStep(step + 1)}
      >
        Step
      </button>
    </>
  )
}
function Plain() {
  return <p>Plain</p>
}
function Stateful() {
  const [value, setValue] = useState(0)
  return (
    <>
      <p data-testid="stateful">State {value}</p>
      <button
        type="button"
        data-testid="state"
        onClick={() => setValue(value + 1)}
      >
        Set state
      </button>
    </>
  )
}
function Counter() {
  const [count, setCount] = useState(3)
  return (
    <>
      <p data-testid="counted">Counter {count}</p>
      <button
        type="button"
        data-testid="count"
        onClick={() => setCount(count + 1)}
      >
        Count
      </button>
    </>
  )
}
function Reader() {
  return <p data-testid="reader">Theme {useContext(Theme)}</p>
}

const items = Array.from({ length: 40 }, (_, id) => ({
  id,
  name: `Product ${id}`,
}))
function Product({ item }) {
  return <p data-testid="product">{item.name}</p>
}
function Products() {
  const [query, setQuery] = useState("")
  const matches = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  ).length
  return (
    <div>
      <input
        data-testid="search"
        aria-label="Search products"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p>{matches} match</p>
      {items.map((item) => (
        <Product key={item.id} item={item} />
      ))}
    </div>
  )
}

function Insight() {
  const [count, setCount] = useState(1)
  const [theme, setTheme] = useState("dark")
  const [late, setLate] = useState(false)
  const [list, setList] = useState(false)
  return (
    <div data-testid="insight">
      <Theme.Provider value={theme}>
        <Shown count={count} />
        <Styled style={{ color: "red" }} onPick={() => {}} data={{ count }} />
        <Plain />
        <Stateful />
        <Counter />
        <Reader />
        <Effects />
        <Keyed />
        <Wrapped />
        {late && (
          <>
            <Late />
            <Stepped />
          </>
        )}
      </Theme.Provider>
      {list && <Products />}
      <button type="button" data-testid="list" onClick={() => setList(true)}>
        List
      </button>
      <button type="button" data-testid="add" onClick={() => setLate(true)}>
        Add
      </button>
      <button
        type="button"
        data-testid="bump"
        onClick={() => setCount(count + 1)}
      >
        Bump
      </button>
      <button
        type="button"
        data-testid="theme"
        onClick={() => setTheme("light")}
      >
        Theme
      </button>
    </div>
  )
}

createRoot(document.getElementById("root")).render(<Insight />)
