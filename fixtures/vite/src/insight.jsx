import { createContext, memo, useContext, useState } from "react"
import { createRoot } from "react-dom/client"

// One component per render reason (e2e/insight.test.ts): Late mounts on "add",
// Shown's prop changes on "bump", Stateful's own state on "state", Reader's
// context on "theme", and Plain (no props, not memo) renders only because its
// parent did. Styled is memo but gets an inline object and callback, which are
// new references on every render.
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
function Late() {
  return <p data-testid="late">Late</p>
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
function Reader() {
  return <p data-testid="reader">Theme {useContext(Theme)}</p>
}

function Insight() {
  const [count, setCount] = useState(1)
  const [theme, setTheme] = useState("dark")
  const [late, setLate] = useState(false)
  return (
    <div data-testid="insight">
      <Theme.Provider value={theme}>
        <Shown count={count} />
        <Styled style={{ color: "red" }} onPick={() => {}} data={{ count }} />
        <Plain />
        <Stateful />
        <Reader />
        {late && <Late />}
      </Theme.Provider>
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
