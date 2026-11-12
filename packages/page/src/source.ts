import { parseStack } from "./stack.ts"

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
