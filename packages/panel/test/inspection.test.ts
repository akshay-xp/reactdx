import {
  type Container,
  expanded,
  inspected,
  type Value,
  valueStored,
  valueText,
} from "@reactdx/messages"
import { expect, test } from "vitest"
import { createInspectorStore, type InspectorCommand } from "../src/inspection"

const object = (props: Record<string, Value>, extra = {}): Value => ({
  type: "object",
  className: "Object",
  id: 7,
  size: Object.keys(props).length,
  props,
  ...extra,
})

const setup = () => {
  const sent: InspectorCommand[] = []
  const copied: string[] = []
  const store = createInspectorStore(
    (command) => sent.push(command),
    (text) => copied.push(text),
  )
  return { sent, copied, store }
}

test("inspect asks for the node and drops what was shown", () => {
  const { sent, store } = setup()
  store.inspect(3)
  store.receive(inspected(3, { props: object({ a: 1 }) }))
  expect(store.data()).toEqual({ props: object({ a: 1 }) })
  store.inspect(4)
  expect(sent).toEqual([
    { type: "inspect", id: 3 },
    { type: "inspect", id: 4 },
  ])
  expect(store.data()).toBeUndefined()
  store.inspect(undefined)
  expect(sent.at(-1)).toEqual({ type: "inspect", id: null })
})

test("replies for another node are ignored; null means it's gone", () => {
  const { store } = setup()
  store.inspect(3)
  store.receive(inspected(4, { props: object({ a: 1 }) }))
  expect(store.data()).toBeUndefined()
  expect(store.gone()).toBe(false)
  store.receive(inspected(3, null))
  expect(store.gone()).toBe(true)
})

test("opening a ref asks for it once; the reply is its expansion", () => {
  const { sent, store } = setup()
  store.inspect(3)
  store.open("props.a", 9)
  store.open("props.a", 9)
  expect(store.isOpen("props.a")).toBe(true)
  expect(sent.slice(1)).toEqual([{ type: "expand", objectId: 9, offset: 0 }])
  const page = object({ b: 1 }, { id: 9, nextOffset: 100 })
  store.receiveExpanded(expanded(9, 0, page))
  expect(store.expansion(9)).toEqual(page)
  store.close("props.a")
  expect(store.isOpen("props.a")).toBe(false)
})

test("more pages are appended to the expansion", () => {
  const { sent, store } = setup()
  store.inspect(3)
  const first: Value = {
    type: "array",
    id: 9,
    length: 3,
    items: [1, 2],
    nextOffset: 2,
  }
  store.receiveExpanded(expanded(9, 0, first))
  store.more(first as Container)
  expect(sent.at(-1)).toEqual({ type: "expand", objectId: 9, offset: 2 })
  store.receiveExpanded(
    expanded(9, 2, { type: "array", id: 9, length: 3, items: [3] }),
  )
  expect(store.expansion(9)).toEqual({
    type: "array",
    id: 9,
    length: 3,
    items: [1, 2, 3],
  })
})

test("a re-send keeps open paths and asks for open refs again", () => {
  const { sent, store } = setup()
  store.inspect(3)
  store.open("props.a", 9)
  store.open("props.b")
  store.receiveExpanded(expanded(9, 0, object({ x: 1 }, { id: 9 })))
  store.receive(inspected(3, { props: object({ a: 1 }) }))
  store.receive(inspected(3, { props: object({ a: 2 }) }))
  expect(store.isOpen("props.a")).toBe(true)
  expect(store.isOpen("props.b")).toBe(true)
  expect(store.expansion(9)).toBeUndefined()
  expect(sent.filter((c) => c.type === "expand")).toHaveLength(3)
})

test("a new node closes every path; resend asks again", () => {
  const { sent, store } = setup()
  store.inspect(3)
  store.open("props.a")
  store.inspect(5)
  expect(store.isOpen("props.a")).toBe(false)
  store.resend()
  expect(sent.at(-1)).toEqual({ type: "inspect", id: 5 })
})

test("a row's key is copied here; its value is asked of the page, which sends the text to copy", () => {
  const { sent, copied, store } = setup()
  store.copyKey("count")
  store.copyValue({ objectId: 7, key: "count" })
  store.storeValue({ hook: [0, 1] })
  expect(sent).toEqual([
    { type: "copy-value", target: { objectId: 7, key: "count" } },
    { type: "store-value", target: { hook: [0, 1] } },
  ])
  store.receiveValueText(valueText("2"))
  expect(copied).toEqual(["count", "2"])
})

test("value text is copied only in reply to a Copy value, once", () => {
  const { copied, store } = setup()
  // The page can post one whenever it likes: unasked, it's dropped.
  store.receiveValueText(valueText("forged"))
  store.copyValue({ objectId: 7 })
  store.receiveValueText(valueText("asked"))
  store.receiveValueText(valueText("again"))
  expect(copied).toEqual(["asked"])
})

test("stored() names the global a Store as global variable went to, only when asked", () => {
  const { store } = setup()
  store.receiveValueStored(valueStored("$reactdx9"))
  expect(store.stored()).toBeUndefined()
  store.storeValue({ objectId: 7 })
  store.receiveValueStored(valueStored("$reactdx1"))
  expect(store.stored()).toBe("$reactdx1")
  store.receiveValueStored(valueStored("$reactdx2"))
  expect(store.stored()).toBe("$reactdx1")
  store.clearStored()
  expect(store.stored()).toBeUndefined()
})
