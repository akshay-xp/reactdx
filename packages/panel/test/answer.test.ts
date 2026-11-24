import type { RenderReason } from "@reactdx/messages"
import { expect, test } from "vitest"
import { type AnswerContext, answerOf, hintOf, type Part } from "../src/answer"

const context: AnswerContext = {
  ago: "2s",
  parent: { id: 5, name: "ProductList" },
  hookName: (path) => `State #${(path[0] ?? 0) + 1}`,
  contextName: () => "Theme",
  nodeName: (id) => (id === 7 ? "Layout" : undefined),
}

const text = (parts: Part[]) =>
  parts
    .map((part) =>
      typeof part === "string" ? part : "code" in part ? part.code : part.name,
    )
    .join("")

const render = (fields: Partial<RenderReason>): RenderReason => ({
  seq: 1,
  kinds: ["props"],
  ...fields,
})
const props = (...keys: string[]) =>
  keys.map((key, i) => ({ key, old: i + 1, new: i + 2 }))

test("each kind of render reads as one sentence", () => {
  const says = (reason: RenderReason | undefined, c = context) =>
    text(answerOf(reason, c))
  expect(says(undefined)).toBe("No renders since DevTools opened.")
  expect(says(render({ kinds: ["mount"] }))).toBe("Mounted 2s ago.")
  expect(
    says(
      render({
        kinds: ["mount"],
        remount: { cause: "key", from: "a", to: "b" },
      }),
    ),
  ).toBe("Remounted 2s ago: key changed (a → b).")
  const ancestor = answerOf(
    render({ kinds: ["mount"], remount: { cause: "ancestor", ancestor: 7 } }),
    context,
  )
  expect(text(ancestor)).toBe("Remounted 2s ago: Layout remounted.")
  expect(ancestor).toContainEqual({ node: 7, name: "Layout" })
  expect(says(render({ kinds: ["force"] }))).toBe("Forced to render 2s ago.")
  const parent = answerOf(render({ kinds: ["parent"] }), context)
  expect(text(parent)).toBe(
    "Rendered 2s ago because its parent ProductList rendered. None of its props changed.",
  )
  expect(parent).toContainEqual({ node: 5, name: "ProductList" })
  expect(
    says(render({ kinds: ["parent"] }), { ...context, parent: undefined }),
  ).toBe(
    "Rendered 2s ago because its parent rendered. None of its props changed.",
  )
  expect(says(render({ props: props("count") }))).toBe(
    "Rendered 2s ago because props count changed (1 → 2).",
  )
  expect(says(render({ props: props("count", "label") }))).toBe(
    "Rendered 2s ago because props count and label changed.",
  )
  expect(says(render({ props: props("a", "b", "c", "d") }))).toBe(
    "Rendered 2s ago because props a, b and 2 more changed.",
  )
  expect(
    says(render({ kinds: ["state"], hooks: [{ hook: [0], old: 3, new: 4 }] })),
  ).toBe("Rendered 2s ago because State #1 changed (3 → 4).")
  expect(
    says(render({ kinds: ["state"], state: [{ key: "x", old: 1, new: 2 }] })),
  ).toBe("Rendered 2s ago because state x changed (1 → 2).")
  expect(
    says(
      render({
        kinds: ["context"],
        contexts: [{ context: 0, old: "dark", new: "light" }],
      }),
    ),
  ).toBe("Rendered 2s ago because Theme changed.")
  expect(
    says(
      render({
        kinds: ["props", "state"],
        props: props("count"),
        hooks: [{ hook: [0], old: 3, new: 4 }],
      }),
    ),
  ).toBe(
    "Rendered 2s ago because props count changed (1 → 2) and State #1 changed (3 → 4).",
  )
  expect(
    says(render({ kinds: ["mount"] }), { ...context, ago: undefined }),
  ).toBe("Mounted.")
})

test("at most one hint, the first that applies", () => {
  const counts = { id: 1, renders: 4, wasted: 3 }
  const hint = (
    reason: RenderReason,
    memo = false,
    at: { count?: typeof counts } = { count: counts },
  ) => {
    const parts = hintOf(reason, { name: "ProductRow", memo, count: at.count })
    return parts && text(parts)
  }
  const sameValue = {
    key: "style",
    old: 1,
    new: 1,
    reference: "same-value" as const,
  }
  const newFunction = {
    key: "onAdd",
    old: 1,
    new: 2,
    reference: "new-function" as const,
  }
  expect(hint(render({ kinds: ["parent"] }))).toBe(
    "3 of its 4 renders were like this. Wrap ProductRow in memo() to skip them.",
  )
  expect(hint(render({ props: [sameValue] }))).toBe(
    "style is a new object with the same value each render. Move it out of the parent's render or wrap it in useMemo.",
  )
  expect(hint(render({ props: [newFunction] }), true)).toBe(
    "onAdd is a new function each render. Wrap it in useCallback.",
  )
  expect(hint(render({ props: [newFunction, sameValue] }), true)).toContain(
    "useMemo",
  )
  expect(hint(render({ props: [newFunction] }))).toBeUndefined()
  expect(hint(render({ kinds: ["parent"] }), false, {})).toBeUndefined()
  expect(
    hint(render({ kinds: ["parent"] }), false, {
      count: { ...counts, wasted: 0 },
    }),
  ).toBeUndefined()
  expect(hint(render({ kinds: ["mount"] }))).toBeUndefined()
})
