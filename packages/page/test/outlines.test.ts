import { afterEach, expect, test, vi } from "vitest"
import { boxOf, createOutlineLayer, type Outline } from "../src/outlines.ts"

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

const outline = (style: Outline["style"]): Outline => ({
  left: 1,
  top: 2,
  width: 30,
  height: 40,
  label: "waiting 1.2s",
  style,
})

test("the layer draws each outline at its rectangle, labeled, with a count of the rest", () => {
  const before = children()
  const layer = createOutlineLayer(document)
  layer.draw([outline("waiting"), outline("arrived")], 3)
  expect(children()).toBe(before + 1)
  const host = document.documentElement.lastElementChild as HTMLElement
  expect(host.style.position).toBe("fixed")
  expect(host.style.pointerEvents).toBe("none")
  expect(host.style.zIndex).toBe("2147483647")
  expect(spy).toHaveBeenCalledWith({ mode: "closed" })

  const root = roots[0] as ShadowRoot
  const drawn = [...root.querySelectorAll<HTMLElement>("[data-outline]")]
  expect(
    drawn.map(({ style, dataset, textContent }) => [
      style.left,
      style.top,
      style.width,
      style.height,
      dataset.style,
      textContent,
    ]),
  ).toEqual([
    ["1px", "2px", "30px", "40px", "waiting", "waiting 1.2s"],
    ["1px", "2px", "30px", "40px", "arrived", "waiting 1.2s"],
  ])
  expect(root.querySelector("[data-more]")?.textContent).toBe("3 more outlines")

  layer.draw([outline("waiting")], 0)
  expect(children()).toBe(before + 1)
  expect(root.querySelector("[data-more]")).toBeNull()
  expect(root.querySelectorAll("[data-outline]").length).toBe(1)

  layer.draw([], 0)
  expect(host.isConnected).toBe(false)
  expect(children()).toBe(before)
})

const element = (left: number, top: number, width: number, height: number) => {
  const el = document.createElement("div")
  el.getBoundingClientRect = () =>
    ({ left, top, width, height }) as unknown as DOMRect
  return el
}

test("a component's box is the union of its elements' rectangles, empty ones skipped", () => {
  expect(
    boxOf([element(10, 20, 30, 40), element(0, 50, 5, 5), element(0, 0, 0, 0)]),
  ).toEqual({ left: 0, top: 20, width: 40, height: 40 })
  expect(boxOf([])).toBeUndefined()
  expect(boxOf([element(3, 3, 0, 0)])).toBeUndefined()
})
