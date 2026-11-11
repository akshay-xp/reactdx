import {
  type PageMessage,
  type RootInfo,
  snapshotMessage,
  type TreeBatchMessage,
  type TreeOp,
  treeBatch,
} from "@reactdx/messages"
import type { FiberRoot, HookRecord } from "./hook.ts"
import { createTree } from "./tree.ts"

const AGENT = Symbol.for("reactdx.agent")
const THROTTLE_MS = 100

// Injected only once a development renderer connects (never at document_start).
// Reads the hook's record, so roots that committed before it arrived are kept.
export function startAgent(
  target: EventTarget,
  post: (message: PageMessage | TreeBatchMessage) => void,
) {
  const scope = target as unknown as Record<symbol, unknown>
  const record = scope[Symbol.for("reactdx")] as HookRecord | undefined
  if (scope[AGENT] || !record) return
  Object.defineProperty(scope, AGENT, { value: true })

  let nextId = 1
  const seen = new WeakMap<FiberRoot, { id: number; commits: number }>()
  const info = (root: FiberRoot) => {
    const entry = seen.get(root) ?? { id: nextId++, commits: 0 }
    seen.set(root, entry)
    return entry
  }
  const snapshot = () => {
    const roots: RootInfo[] = []
    for (const [rendererId, set] of record.roots)
      for (const root of set) roots.push({ rendererId, ...info(root) })
    post(snapshotMessage(roots))
  }

  const tree = createTree()
  const watch = () => {
    const ops: TreeOp[] = [{ op: "reset" }]
    for (const set of record.roots.values())
      for (const root of set) ops.push(...tree.full(root, info(root).id))
    post(treeBatch(1, ops))
  }

  let pending = false
  record.listeners.add((_, root) => {
    info(root).commits++
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      snapshot()
    }, THROTTLE_MS)
  })
  target.addEventListener("message", (event) => {
    const { data } = event as MessageEvent
    if (data?.source !== "reactdx-relay") return
    if (data.type === "get-snapshot") snapshot()
    else if (data.type === "watch") watch()
  })
  snapshot()
}
