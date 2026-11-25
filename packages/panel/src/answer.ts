import type {
  FromServer,
  Owner,
  RenderCount,
  RenderReason,
  Size,
  Value,
} from "@reactdx/messages"
import { sizeText } from "./size"
import { previewText } from "./value"

// A sentence in pieces (docs/panel.md, Inspector): text, a name in code, or a
// component (a link when it has an id).
export type Part =
  | string
  | { code: string }
  | { node: number | null; name: string }

export type AnswerContext = {
  // How long ago the render was ("2s"); none leaves the time out.
  ago?: string
  // The component that rendered it (its nearest owner).
  parent?: Owner
  hookName: (path: number[]) => string
  contextName: (read: number) => string
  nodeName: (id: number) => string | undefined
}

type Changed = { label: Part[]; old: Value; new: Value }

// "a", "a and b", "a, b and c", "a, b and 2 more".
const listOf = (labels: Part[][]): Part[] => {
  const shown = labels.length > 3 ? labels.slice(0, 2) : labels
  const out: Part[] = []
  shown.forEach((label, i) => {
    if (i > 0)
      out.push(i === shown.length - 1 && shown === labels ? " and " : ", ")
    out.push(...label)
  })
  if (shown !== labels) out.push(` and ${labels.length - 2} more`)
  return out
}

// One changed value with both sides (`values`), or several by name.
const clause = (prefix: string, changes: Changed[], values = true): Part[] => {
  const [only] = changes
  if (!only) return []
  const head = prefix ? [prefix] : []
  if (changes.length === 1 && values)
    return [
      ...head,
      ...only.label,
      ` changed (${previewText(only.old)} → ${previewText(only.new)})`,
    ]
  return [...head, ...listOf(changes.map((change) => change.label)), " changed"]
}

// Why the render happened, in one sentence.
export function answerOf(
  render: RenderReason | undefined,
  context: AnswerContext,
): Part[] {
  if (!render) return ["No renders since DevTools opened."]
  const when = context.ago ? ` ${context.ago} ago` : ""
  const { kinds, remount } = render
  if (kinds.includes("mount")) {
    if (remount?.cause === "key")
      return [
        `Remounted${when}: key changed (${remount.from ?? "none"} → ${remount.to ?? "none"}).`,
      ]
    if (remount?.cause === "ancestor") {
      const name = context.nodeName(remount.ancestor)
      return name === undefined
        ? [`Remounted${when}: an ancestor remounted.`]
        : [
            `Remounted${when}: `,
            { node: remount.ancestor, name },
            " remounted.",
          ]
    }
    return [`Mounted${when}.`]
  }
  if (kinds.includes("force")) return [`Forced to render${when}.`]
  if (kinds.includes("parent")) {
    const tail = " rendered. None of its props changed."
    return context.parent
      ? [
          `Rendered${when} because its parent `,
          { node: context.parent.id, name: context.parent.name },
          tail,
        ]
      : [`Rendered${when} because its parent${tail}`]
  }
  const clauses = [
    clause(
      "props ",
      (render.props ?? []).map((c) => ({ ...c, label: [{ code: c.key }] })),
    ),
    clause(
      "state ",
      (render.state ?? []).map((c) => ({ ...c, label: [{ code: c.key }] })),
    ),
    clause(
      "",
      (render.hooks ?? []).map((c) => ({
        ...c,
        label: [context.hookName(c.hook)],
      })),
    ),
    clause(
      "",
      (render.contexts ?? []).map((c) => ({
        ...c,
        label: [{ code: context.contextName(c.context) }],
      })),
      // A context's value is often a big object: its name says enough.
      false,
    ),
  ].filter((parts) => parts.length)
  if (!clauses.length) return [`Rendered${when}.`]
  return [
    `Rendered${when} because `,
    ...clauses.flatMap((parts, i) => (i ? [" and ", ...parts] : parts)),
    ".",
  ]
}

// One fix for the render, first that applies: a render only because the
// parent rendered (memo skips those), a prop that's a new object with the same
// value, or a new function a memo component can't skip.
export function hintOf(
  render: RenderReason,
  at: { name: string; memo: boolean; count: RenderCount | undefined },
): Part[] | undefined {
  const wasted = at.count?.wasted ?? 0
  if (render.kinds.length === 1 && render.kinds[0] === "parent" && wasted)
    return [
      `${wasted} of its ${at.count?.renders} renders were like this. Wrap `,
      { code: at.name },
      " in ",
      { code: "memo()" },
      " to skip them.",
    ]
  const props = render.props ?? []
  const same = props.find((change) => change.reference === "same-value")
  if (same)
    return [
      { code: same.key },
      " is a new object with the same value each render. Move it out of the parent's render or wrap it in ",
      { code: "useMemo" },
      ".",
    ]
  const fresh = props.find((change) => change.reference === "new-function")
  if (fresh && at.memo)
    return [
      { code: fresh.key },
      " is a new function each render. Wrap it in ",
      { code: "useCallback" },
      ".",
    ]
}

// "a", "a and b", "a, b and c".
const listed = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

// A component a Server Component rendered (M7 #79): who passed its props and
// their total size, and for each big prop, what makes it big.
export function fromServerOf(from: FromServer, name: string) {
  const { owner, props } = from
  const total: Size = {
    bytes: props.reduce((sum, prop) => sum + prop.bytes, 0),
    ...(props.some((prop) => prop.over) && { over: true as const }),
  }
  const count = `${props.length} ${props.length === 1 ? "prop" : "props"}`
  const answer: Part[] = [
    "Server Component ",
    owner.id === null ? owner.name : { node: owner.id, name: owner.name },
    ` passed it ${count}, ${sizeText(total)}`,
  ]
  const hints = props.flatMap((prop) =>
    prop.fields?.length
      ? [
          `${prop.key} is ${sizeText(prop)}, mostly ${listed(
            prop.fields.map((field) => `${field.key} (${sizeText(field)})`),
          )}. Pass ${name} only the fields it uses.`,
        ]
      : [],
  )
  return { answer, hints }
}
