import { afterEach, expect, test, vi } from "vitest"
import { createOverlay } from "../src/overlay.ts"

const element = (left: number, top: number, width: number, height: number) => {
  const el = document.createElement("div")
  el.getBoundingClientRect = () =>
    ({ left, top, width, height }) as unknown as DOMRect
  return el
}

const roots: ShadowRoot[] = []
const attach = Element.prototype.attachShadow
const spy = vi
  .spyOn(Element.prototype, "attachShadow")
  .mockImplementation(function (this: Element, init) {
    const root = attach.call(this, init)
    roots.push(root)
    return root
  })

afterEach(() => {
  roots.length = 0
  spy.mockClear()
})

const children = () => document.documentElement.children.length

test("shows one click-through host with a box per element and the label", () => {
  const before = children()
  const overlay = createOverlay(document)
  overlay.show([element(1, 2, 30, 40), element(5, 6, 7, 8)], "Counter")
  expect(children()).toBe(before + 1)
  const host = document.documentElement.lastElementChild as HTMLElement
  expect(host.style.position).toBe("fixed")
  expect(host.style.pointerEvents).toBe("none")
  expect(host.style.zIndex).toBe("2147483647")
  expect(spy).toHaveBeenCalledWith({ mode: "closed" })

  const root = roots[0] as ShadowRoot
  const boxes = [...root.querySelectorAll<HTMLElement>("[data-box]")].map(
    ({ style }) => [style.left, style.top, style.width, style.height],
  )
  expect(boxes).toEqual([
    ["1px", "2px", "30px", "40px"],
    ["5px", "6px", "7px", "8px"],
  ])
  expect(root.textContent).toContain("Counter")

  overlay.show([element(0, 0, 1, 1)], "A")
  expect(children()).toBe(before + 1)
  expect(root.querySelectorAll("[data-box]").length).toBe(1)
  expect(root.textContent).toContain("A")

  overlay.show([], "X")
  expect(children()).toBe(before)
  overlay.show([element(0, 0, 1, 1)], "A")
  overlay.hide()
  expect(children()).toBe(before)
  overlay.hide()
  expect(spy).toHaveBeenCalledTimes(1)
})
