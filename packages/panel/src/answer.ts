import type { Owner, RenderReason, Value } from "@reactdx/messages"
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
