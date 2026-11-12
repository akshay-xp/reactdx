import {
  MAX_OPS,
  type PageMessage,
  type PickedMessage,
  picked,
  type RootInfo,
  snapshotMessage,
  type TreeBatchMessage,
  type TreeOp,
  treeBatch,
} from "@reactdx/messages"
import type { FiberRoot, HookRecord } from "./hook.ts"
import { createOverlay } from "./overlay.ts"
import { createTree } from "./tree.ts"

const AGENT = Symbol.for("reactdx.agent")
const THROTTLE_MS = 100

// Injected only once a development renderer connects (never at document_start).
// Reads the hook's record, so roots that committed before it arrived are kept.
export function startAgent(
  target: EventTarget,
  post: (message: PageMessage | TreeBatchMessage | PickedMessage) => void,
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

  let overlay: ReturnType<typeof createOverlay> | undefined
  // The page can post this too; an id the tree doesn't know finds nothing.
  const highlight = (id: number) => {
    const found = tree.find(id)
    overlay ??= createOverlay(document)
    overlay.show(found?.elements ?? [], found?.name ?? "")
  }

  // Picking listens on the window in the capture phase, ahead of the page's own
  // handlers (React's sit on its root container), and swallows only the click.
  const owner = (event: Event) =>
    event.target instanceof Element ? tree.owner(event.target) : undefined
  const pointing = (event: Event) => {
    const id = owner(event)
    if (id) highlight(id)
    else overlay?.hide()
  }
  const clicked = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    stopPicking()
    post(picked(owner(event) ?? null))
  }
  const escaped = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape") return
    stopPicking()
    post(picked(null))
  }
  const picking: [string, (event: Event) => void][] = [
    ["pointermove", pointing],
    ["click", clicked],
    ["keydown", escaped],
  ]
  const startPicking = () => {
    for (const [type, listener] of picking)
      target.addEventListener(type, listener, true)
  }
  const stopPicking = () => {
    for (const [type, listener] of picking)
      target.removeEventListener(type, listener, true)
    overlay?.hide()
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
    else if (data.type === "highlight") highlight(data.id)
    else if (data.type === "clear-highlight") overlay?.hide()
    else if (data.type === "pick-start") startPicking()
    else if (data.type === "pick-stop") stopPicking()
    else if (data.type === "unwatch") {
      stopPicking()
      watching = false
      buffer.length = 0
      tree.clear()
    }
  })
  snapshot()
}
