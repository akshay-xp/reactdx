import {
  MAX_OPS,
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
  // Production builds have minified names and aren't inspected.
  const inspectable = (rendererId: number) =>
    record.renderers.get(rendererId)?.bundleType === 1
  let seq = 1
  let watching = false
  // Diffed on every commit (the bail-out check only holds against the previous
  // commit), posted on the flush.
  const buffer: TreeOp[] = []
  const send = (ops: TreeOp[]) => {
    for (let i = 0; i < ops.length; i += MAX_OPS)
      post(treeBatch(seq++, ops.slice(i, i + MAX_OPS)))
  }
  const watch = () => {
    watching = true
    buffer.length = 0
    seq = 1
    const ops: TreeOp[] = [{ op: "reset" }]
    for (const [rendererId, set] of record.roots)
      if (inspectable(rendererId))
        for (const root of set) tree.full(root, info(root).id, ops)
    send(ops)
  }

  let pending = false
  record.listeners.add((rendererId, root) => {
    const entry = info(root)
    entry.commits++
    if (watching && inspectable(rendererId)) tree.commit(root, entry.id, buffer)
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      snapshot()
      if (buffer.length) send(buffer.splice(0))
    }, THROTTLE_MS)
  })
  target.addEventListener("message", (event) => {
    const { data } = event as MessageEvent
    if (data?.source !== "reactdx-relay") return
    if (data.type === "get-snapshot") snapshot()
    else if (data.type === "watch") watch()
    else if (data.type === "unwatch") {
      watching = false
      buffer.length = 0
      tree.clear()
    }
  })
  snapshot()
}
