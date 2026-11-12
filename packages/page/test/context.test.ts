import React from "react"
import { expect, test } from "vitest"
import { inspecting } from "./inspecting.ts"

const h = React.createElement
const { send, replies, idOf, inspect } = inspecting()

const Theme = React.createContext("light")
Theme.displayName = "Theme"
const Plain = React.createContext(1)
const react19 = React.version.startsWith("19.")

function Reader() {
  React.useContext(Theme)
  React.useContext(Theme)
  React.useContext(Plain)
  return null
}
function UseReader() {
  ;(React as unknown as { use: (c: unknown) => unknown }).use(Theme)
  return null
}
class ClassReader extends React.Component {
  static contextType = Theme
  render() {
    return null
  }
}
function Nothing() {
  return null
}

const dark = (child: React.ReactNode) =>
  h(Theme.Provider, { value: "dark" }, child)

test("the contexts a function component reads, once each, in order", async () => {
  const data = await inspect(dark(h(Reader)), "Reader")
  expect(data?.contexts).toEqual([
    { name: "Theme", value: "dark" },
    { name: "Context", value: 1 },
  ])
})

test.skipIf(!react19)("use() reads count too", async () => {
  const data = await inspect(dark(h(UseReader)), "UseReader")
  expect(data?.contexts).toEqual([{ name: "Theme", value: "dark" }])
})

test("a class's contextType", async () => {
  const data = await inspect(dark(h(ClassReader)), "ClassReader")
  expect(data?.contexts).toEqual([{ name: "Theme", value: "dark" }])
})

test("a component reading none has no contexts", async () => {
  const data = await inspect(dark(h(Nothing)), "Nothing")
  expect(data?.contexts).toBeUndefined()
})

// Past the agent's 100 ms flush.
const flushed = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))

const Consumer = React.memo(function Consumer() {
  React.useContext(Theme)
  return null
})
let setTheme = (_: string) => {}
let setOther = (_: number) => {}
function Switcher() {
  const [theme, set] = React.useState("dark")
  const [, other] = React.useState(0)
  React.useEffect(() => {
    setTheme = set
    setOther = other
  })
  return h(Theme.Provider, { value: theme }, h(Consumer))
}

test("a provider's new value re-sends a consumer whose props didn't change", async () => {
  await inspect(h(Switcher), "Consumer")
  await React.act(() => setOther(1))
  await flushed()
  expect(replies()).toHaveLength(1)
  await React.act(() => setTheme("light"))
  await flushed()
  expect(replies()).toHaveLength(2)
  expect(replies()[1]?.data?.contexts).toEqual([
    { name: "Theme", value: "light" },
  ])
})

function Leaf() {
  return h("em", null, "leaf")
}
function Inner() {
  return h(Leaf)
}
function Middle() {
  return h("div", null, h(Inner))
}
function Outer() {
  return h(Middle)
}

const owners = (
  data?: { owners?: { id: number | null; name: string }[] } | null,
) => data?.owners ?? []

test("owners, nearest first, with the tree's ids", async () => {
  const data = await inspect(h(Outer), "Leaf")
  expect(owners(data).map((o) => o.name)).toEqual(["Inner", "Middle", "Outer"])
  expect(owners(data).map((o) => o.id)).toEqual([
    idOf("Inner"),
    idOf("Middle"),
    idOf("Outer"),
  ])
  send({ source: "reactdx-relay", type: "inspect", id: idOf("Outer") })
  expect(replies().at(-1)?.data?.owners).toEqual([])
  send({ source: "reactdx-relay", type: "inspect", id: idOf("em") })
  expect(owners(replies().at(-1)?.data)[0]).toEqual({
    id: idOf("Leaf"),
    name: "Leaf",
  })
})
