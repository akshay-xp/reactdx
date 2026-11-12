// One line of an Error's stack: the function it ran in, and the line as written,
// which identifies a call site (two calls on different lines differ).
export type Frame = { functionName: string; source: string }

// V8: "    at name (url:line:col)", or "    at url:line:col" without a name.
const V8 = /^at (?:(.+?) \(.*\)|.+)$/
// Firefox: "name@url:line:col" (name empty for anonymous functions).
const FIREFOX = /^([^@]*)@(.+:\d+:\d+)$/

export function parseStack(stack: string): Frame[] {
  const frames: Frame[] = []
  for (const raw of stack.split("\n")) {
    const source = raw.trim()
    const v8 = source.startsWith("at ") && V8.exec(source)
    const firefox = !v8 && FIREFOX.exec(source)
    const match = v8 || firefox
    if (match) frames.push({ functionName: match[1] ?? "", source })
  }
  return frames
}
