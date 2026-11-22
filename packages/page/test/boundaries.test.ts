import React from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { inspecting } from "./inspecting.ts"

const h = React.createElement
const { send, replies, idOf, inspect } = inspecting()

class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    return this.state.error
      ? h("p", { "data-testid": "error-ui" }, "Something broke")
      : this.props.children
  }
}
const Inside = () => h("p", { "data-testid": "ready" }, "Inside")
const Child = () => h("p", { "data-testid": "child" }, "Child")
const Outside = () => h("p", { "data-testid": "outside" }, "Outside")
const app = () =>
  h(
    React.Fragment,
    null,
    h(
      React.Suspense,
      { fallback: h("p", { "data-testid": "fallback" }, "Loading") },
      h(Inside),
    ),
    h(Boundary, null, h(Child)),
    h(Outside),
  )

// React logs the simulated error it renders the error UI for.
let logged: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => logged.mockRestore())

const shown = (testid: string) => {
  const el = document.querySelector<HTMLElement>(`[data-testid=${testid}]`)
  return Boolean(el) && el?.style.display !== "none"
}
const force = (id: number, kind: string, on: boolean) =>
  React.act(async () => {
    send({ source: "reactdx-relay", type: "force", id, kind, on })
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

test("an inspection names the nearest Suspense and error boundary, unforced", async () => {
  const inside = await inspect(app(), "Inside")
  expect(inside?.boundaries).toEqual({
    fallback: { id: idOf("Suspense"), on: false },
  })
  const child = await inspect(app(), "Child")
  expect(child?.boundaries).toEqual({
    error: { id: idOf("Boundary"), on: false },
  })
  const outside = await inspect(app(), "Outside")
  expect(outside?.boundaries).toBeUndefined()
})

test("force shows a Suspense boundary's fallback, then its children again", async () => {
  await inspect(app(), "Inside")
  await force(idOf("Inside"), "fallback", true)
  expect(shown("fallback")).toBe(true)
  expect(shown("ready")).toBe(false)
  // Its children are hidden: the panel turns it off from the boundary.
  const boundary = idOf("Suspense")
  send({ source: "reactdx-relay", type: "inspect", id: boundary })
  expect(replies().at(-1)?.data?.boundaries?.fallback).toEqual({
    id: boundary,
    on: true,
  })
  await force(boundary, "fallback", false)
  expect(shown("ready")).toBe(true)
  expect(shown("fallback")).toBe(false)
})

test("force shows an error boundary's error UI, then its children again", async () => {
  await inspect(app(), "Child")
  await force(idOf("Child"), "error", true)
  expect(shown("error-ui")).toBe(true)
  expect(shown("child")).toBe(false)
  // The child is gone: the panel turns it off from the boundary.
  const boundary = idOf("Boundary")
  send({ source: "reactdx-relay", type: "inspect", id: boundary })
  expect(replies().at(-1)?.data?.boundaries?.error).toEqual({
    id: boundary,
    on: true,
  })
  await force(boundary, "error", false)
  expect(shown("child")).toBe(true)
  expect(shown("error-ui")).toBe(false)
})
