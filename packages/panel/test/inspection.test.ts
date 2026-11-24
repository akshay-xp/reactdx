import {
  type Container,
  expanded,
  inspected,
  reasoned,
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
  store.open({ root: "props", keys: ["a"] }, 9)
  store.open({ root: "props", keys: ["a"] }, 9)
  expect(store.isOpen({ root: "props", keys: ["a"] })).toBe(true)
  expect(sent.slice(1)).toEqual([{ type: "expand", objectId: 9, offset: 0 }])
  const page = object({ b: 1 }, { id: 9, nextOffset: 100 })
  store.receiveExpanded(expanded(9, 0, page))
  expect(store.expansion(9)).toEqual(page)
  store.close({ root: "props", keys: ["a"] })
  expect(store.isOpen({ root: "props", keys: ["a"] })).toBe(false)
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
  store.open({ root: "props", keys: ["a"] }, 9)
  store.open({ root: "props", keys: ["b"] })
  store.receiveExpanded(expanded(9, 0, object({ x: 1 }, { id: 9 })))
  store.receive(inspected(3, { props: object({ a: 1 }) }))
  store.receive(inspected(3, { props: object({ a: 2 }) }))
  expect(store.isOpen({ root: "props", keys: ["a"] })).toBe(true)
  expect(store.isOpen({ root: "props", keys: ["b"] })).toBe(true)
  expect(store.expansion(9)).toBeUndefined()
  expect(sent.filter((c) => c.type === "expand")).toHaveLength(3)
})

test("a new node closes every path; resend asks again", () => {
  const { sent, store } = setup()
  store.inspect(3)
  store.open({ root: "props", keys: ["a"] })
  store.inspect(5)
  expect(store.isOpen({ root: "props", keys: ["a"] })).toBe(false)
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

test("edit sends a write for the inspected node at a row path", () => {
  const { sent, store } = setup()
  store.edit({ root: "props", keys: ["label"] }, "Total")
  expect(sent).toEqual([])
  store.inspect(3)
  store.edit({ root: "props", keys: ["label"] }, "Total")
  store.edit({ root: { hook: [0] }, keys: [] }, 7)
  store.edit({ root: "props", keys: ["n"] }, { type: "undefined" })
  expect(sent.slice(1)).toEqual([
    { type: "edit", id: 3, root: "props", path: ["label"], value: "Total" },
    { type: "edit", id: 3, root: { hook: [0] }, path: [], value: 7 },
    {
      type: "edit",
      id: 3,
      root: "props",
      path: ["n"],
      value: { type: "undefined" },
    },
  ])
})

test("remove and rename send a delete or rename for the inspected node", () => {
  const { sent, store } = setup()
  store.remove({ root: "props", keys: ["a"] })
  expect(sent).toEqual([])
  store.inspect(3)
  store.remove({ root: "props", keys: ["a"] })
  store.rename({ root: "state", keys: ["a"] }, "b")
  expect(sent.slice(1)).toEqual([
    { type: "delete-path", id: 3, root: "props", path: ["a"] },
    { type: "rename-path", id: 3, root: "state", path: ["a"], to: "b" },
  ])
})

test("rerender asks the page to render the inspected node again", () => {
  const { sent, store } = setup()
  store.rerender()
  expect(sent).toEqual([])
  store.inspect(3)
  store.rerender()
  expect(sent.slice(1)).toEqual([{ type: "rerender", id: 3 }])
})

test("force asks the page to show a fallback or an error UI, or the children again", () => {
  const { sent, store } = setup()
  store.force("error", true)
  expect(sent).toEqual([])
  store.inspect(3)
  store.force("error", true)
  store.force("fallback", false)
  expect(sent.slice(1)).toEqual([
    { type: "force", id: 3, kind: "error", on: true },
    { type: "force", id: 3, kind: "fallback", on: false },
  ])
})

test("a pinned commit loads the node's older render; the newest follows re-sends", () => {
  const { sent, store } = setup()
  store.inspect(3)
  const latest = { seq: 9, kinds: ["state" as const] }
  const older = { seq: 5, kinds: ["props" as const] }
  store.receive(
    inspected(3, { props: object({}), render: latest, history: [2, 5, 9] }),
  )
  expect(store.history()).toEqual([2, 5, 9])
  expect(store.render()).toEqual(latest)
  store.pin(5)
  expect(sent.at(-1)).toEqual({ type: "reason", id: 3, seq: 5 })
  expect(store.render()).toBeUndefined()
  store.receiveReasoned(reasoned(3, 2, { seq: 2, kinds: ["mount"] }))
  store.receiveReasoned(reasoned(4, 5, older))
  expect(store.render()).toBeUndefined()
  store.receiveReasoned(reasoned(3, 5, older))
  expect(store.render()).toEqual(older)
  // A new render keeps the pinned one.
  const newer = { seq: 11, kinds: ["state" as const] }
  store.receive(
    inspected(3, { props: object({}), render: newer, history: [2, 5, 9, 11] }),
  )
  expect(store.render()).toEqual(older)
  store.pin(2)
  store.receiveReasoned(reasoned(3, 2, null))
  expect(store.render()).toBeNull()
  store.pin(11)
  expect(sent.at(-1)).toEqual({ type: "reason", id: 3, seq: 2 })
  expect(store.render()).toEqual(newer)
  store.pin(5)
  store.inspect(4)
  expect(store.render()).toBeUndefined()
})

test("a pinned commit steps the inspector to it, or says it's absent", () => {
  const { sent, store } = setup()
  store.inspect(3)
  const at = (seq: number) => ({ seq, kinds: ["state" as const] })
  store.receive(
    inspected(3, { props: object({}), render: at(9), history: [2, 5, 9] }),
  )
  store.pin(5)
  expect(sent.at(-1)).toEqual({ type: "reason", id: 3, seq: 5 })
  expect(store.pinned()).toBe(5)
  expect(store.absent()).toBe(false)
  const count = sent.length
  store.pin(9)
  expect(sent).toHaveLength(count)
  expect(store.render()).toEqual(at(9))
  store.pin(4)
  expect(store.absent()).toBe(true)
  // Another node, pinned to 5: applied when its inspection arrives.
  store.pin(5)
  store.inspect(4)
  store.receive(
    inspected(4, { props: object({}), render: at(5), history: [5] }),
  )
  expect(store.absent()).toBe(false)
  expect(store.render()).toEqual(at(5))
  store.inspect(6)
  store.receive(
    inspected(6, { props: object({}), render: at(1), history: [1] }),
  )
  expect(store.absent()).toBe(true)
  store.pin(undefined)
  expect(store.absent()).toBe(false)
  expect(store.render()).toEqual(at(1))
})
