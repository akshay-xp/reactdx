const AGENT = Symbol.for("reactdx.agent")

// Injected only once a development renderer connects (never at document_start).
export function startAgent(target: object) {
  const scope = target as Record<symbol, unknown>
  if (scope[AGENT]) return
  Object.defineProperty(scope, AGENT, { value: true })
}
