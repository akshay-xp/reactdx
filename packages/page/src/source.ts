import type { SourceRef } from "@reactdx/messages"
import { parseStack } from "./stack.ts"
import type { Fiber } from "./tree.ts"

type DebugFiber = Fiber & {
  _debugSource?: {
    fileName?: unknown
    lineNumber?: unknown
    columnNumber?: unknown
  } | null
}

// "url:line:column" at the end of a frame, after V8's "at name (" or Firefox's "name@".
const LOCATION = /^(?:at (?:.+? \()?|[^@]*@)(.+):(\d+):(\d+)\)?$/

// React 19 makes the element's Error inside jsxDEV/createElement, so frame 1 is
// the call site. Past React's owner stack limit, frame 0 is UnknownOwner instead.
export function stackSource(stack: string) {
  const [top, caller] = parseStack(stack)
  if (!caller || top?.functionName === "UnknownOwner") return null
  const match = LOCATION.exec(caller.source)
  if (!match) return null
  return { url: match[1], line: Number(match[2]), column: Number(match[3]) }
}

function written(fiber: DebugFiber): SourceRef | undefined {
  const at = fiber._debugSource
  if (
    typeof at?.fileName === "string" &&
    typeof at.lineNumber === "number" &&
    typeof at.columnNumber === "number"
  )
    return { file: at.fileName, line: at.lineNumber, column: at.columnNumber }
}

// The component's own location: the first element it renders, else where it was
// rendered. Fibers another component rendered are skipped with their subtree
// (their elements aren't this one's); fibers no element made are searched into.
export function sourceOf(fiber: Fiber): SourceRef | undefined {
  const owns = (at: Fiber) =>
    at._debugOwner === fiber ||
    (!!fiber.alternate && at._debugOwner === fiber.alternate)
  const stack: Fiber[] = fiber.child ? [fiber.child] : []
  while (stack.length) {
    const at = stack.pop() as Fiber
    if (at.sibling) stack.push(at.sibling)
    if (owns(at)) return written(at)
    if (!at._debugOwner && at.child) stack.push(at.child)
  }
  return written(fiber)
}
