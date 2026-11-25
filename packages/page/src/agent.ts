import {
  type CommitsMessage,
  type CommittedMessage,
  type CountsMessage,
  commitsMessage,
  committed,
  countsMessage,
  type ExpandedMessage,
  expanded,
  type HookValue,
  type InspectedData,
  type InspectedMessage,
  inspected,
  MAX_AWAITS,
  MAX_CHANGES,
  MAX_COPY,
  MAX_HISTORY,
  MAX_OPS,
  MAX_OWNERS,
  MAX_RENDERED,
  MAX_TREE_STRING,
  type OutlineMode,
  type Owner,
  type PageMessage,
  type PickedMessage,
  parseTreeCommand,
  picked,
  type ReasonedMessage,
  type RenderReason,
  type RootInfo,
  reasoned,
  snapshotMessage,
  type TreeBatchMessage,
  type TreeOp,
  treeBatch,
  type Updater,
  type Value,
  type ValueStoredMessage,
  type ValueTarget,
  type ValueTextMessage,
  valueStored,
  valueText,
} from "@reactdx/messages"
import {
  type BoundaryKind,
  boundariesOf,
  createForcing,
  type ForcingRenderer,
} from "./boundaries.ts"
import { applyEdit, type EditOp, fromEditValue, type Renderer } from "./edit.ts"
import type { FiberRoot, Hook, HookRecord } from "./hook.ts"
import {
  type DispatcherRef,
  type HooksFiber,
  hookAt,
  hookLabel,
  hookPath,
  inspectHooks,
  type RawHook,
} from "./hooks.ts"
import { contextsOf, createRecorder, type RenderRecord } from "./insight.ts"
import { copyText, createInspector } from "./inspect.ts"
import { createOutlineLayer, createSuspenseOutlines } from "./outlines.ts"
import { createOverlay } from "./overlay.ts"
import { awaitsOf, renderedAt } from "./server.ts"
import { propSizes, sizeOf } from "./size.ts"
import { sourceOf } from "./source.ts"
import { causeOf, createSuspended, waitOf } from "./suspense.ts"
import { createTree, type Fiber } from "./tree.ts"

const AGENT = Symbol.for("reactdx.agent")
// Function, class, forwardRef and memo components (a lazy one resolves to these).
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15])
const THROTTLE_MS = 100

// The nearest provider of `context` above the fiber (ContextProvider, tag 10):
// React 19's provider is the context itself, React 18's its Provider object.
// None: the fiber reads the context's default value.
export function providerOf(fiber: Fiber, context: unknown) {
  for (let at = fiber.return; at; at = at.return) {
    const type = at.type as { _context?: unknown } | null
    if (at.tag === 10 && (type === context || type?._context === context))
      return at
  }
}

const sameValues = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

// Injected only once a development renderer connects (never at document_start).
// Reads the hook's record, so roots that committed before it arrived are kept.
export function startAgent(
  target: EventTarget,
  post: (
    message:
      | PageMessage
      | TreeBatchMessage
      | PickedMessage
      | InspectedMessage
      | ExpandedMessage
      | CommitsMessage
      | CommittedMessage
      | CountsMessage
      | ReasonedMessage
      | ValueTextMessage
      | ValueStoredMessage,
  ) => void,
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

  const recorder = createRecorder()
  const suspended = createSuspended()
  // The boundaries whose data arrived in the commit being recorded.
  const arrivals: { fiber: Fiber; id: number; ms: number }[] = []
  const tree = createTree({
    onForget: recorder.forget,
    onArrive: (fiber, id, ms) => {
      suspended.clear(fiber)
      arrivals.push({ fiber, id, ms })
      outlines?.arrived(id, ms)
    },
  })
  // React 18's profiling hooks (who suspended), only while watching, and only
  // when no other devtools is on the page: there's one slot, and RDT's Timeline
  // uses it (docs/page.md, Suspense).
  type Profiled = { injectProfilingHooks?: (hooks: unknown) => void }
  const profiled = new Set<Profiled>()
  const profile = () => {
    if (Object.hasOwn(target, "__REACT_DEVTOOLS_GLOBAL_HOOK__")) return
    const hook = (scope as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__
    for (const [id, renderer] of hook?.renderers ?? []) {
      const inject = (renderer as Profiled).injectProfilingHooks
      if (!inspectable(id) || typeof inject !== "function") continue
      inject(suspended.hooks)
      profiled.add(renderer as Profiled)
    }
  }
  const unprofile = () => {
    for (const renderer of profiled) renderer.injectProfilingHooks?.(null)
    profiled.clear()
    suspended.reset()
  }
  // Production builds have minified names and aren't inspected.
  const inspectable = (rendererId: number) =>
    record.renderers.get(rendererId)?.bundleType === 1
  let seq = 1
  // The last commit seq posted in `commits`.
  let sentCommit = 0
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
    profile()
    buffer.length = 0
    seq = 1
    const ops: TreeOp[] = [{ op: "reset" }]
    for (const [rendererId, set] of record.roots)
      if (inspectable(rendererId))
        for (const root of set) tree.full(root, info(root).id, ops)
    send(ops)
    // The panel's commit list starts over with the tree: send the buffer
    // again now (an idle page may not commit for a while), even if empty.
    sentCommit = 0
    postCommits(true)
    postCounts(true)
  }
  // Render counts for the tree, in batches of MAX_OPS: the changed ones on the
  // flush (if any), every one on a watch (at least one message).
  const postCounts = (all: boolean) => {
    const counts = recorder.takeCounts(all)
    if (!counts.length && !all) return
    for (let at = 0; at === 0 || at < counts.length; at += MAX_OPS)
      post(countsMessage(counts.slice(at, at + MAX_OPS)))
  }
  // The commits since the last sent, in batches the relay accepts (`always`:
  // at least one); each says what the page still holds.
  const postCommits = (always = false) => {
    const commits = recorder.summaries(sentCommit).map((commit) => {
      const change = commit.updaters.length
        ? firstChange(commit.seq)
        : undefined
      return change ? { ...commit, change } : commit
    })
    if (!commits.length && !always) return
    for (let at = 0; at === 0 || at < commits.length; at += MAX_HISTORY)
      post(
        commitsMessage(
          commits.slice(at, at + MAX_HISTORY),
          recorder.oldest(),
          recorder.dropped(),
        ),
      )
    sentCommit = commits.at(-1)?.seq ?? sentCommit
  }

  let overlay: ReturnType<typeof createOverlay> | undefined
  // Made on the panel's first outlines command (docs/page.md, Outlines).
  let outlines: ReturnType<typeof createSuspenseOutlines> | undefined
  const outline = (mode: OutlineMode | null) => {
    if (mode !== "suspense") return outlines?.off()
    outlines ??= createSuspenseOutlines({
      layer: createOutlineLayer(document),
      target,
      waits: () => tree.waits(),
      find: (id) => tree.find(id),
      causeFor: (id) => {
        const fiber = tree.fiber(id)
        return fiber && causeOf(fiber, suspended.causeFor(fiber))
      },
      now: () => performance.now(),
      frame: (callback) => requestAnimationFrame(callback),
    })
    outlines.on()
  }
  // The page can post this too; an id the tree doesn't know finds nothing.
  const highlight = (id: number) => {
    const found = tree.find(id)
    overlay ??= createOverlay(document)
    overlay.show(found?.elements ?? [], found?.name ?? "")
  }

  // Picking listens on the window in the capture phase, ahead of the page's own
  // handlers (React's sit on its root container), and swallows the whole press:
  // pages act on pointerdown and mousedown too (menus, drags, focus).
  const owner = (event: Event) =>
    event.target instanceof Element ? tree.owner(event.target) : undefined
  const pointing = (event: Event) => {
    const id = owner(event)
    if (id) highlight(id)
    else overlay?.hide()
  }
  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const clicked = (event: Event) => {
    swallow(event)
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
    ["pointerdown", swallow],
    ["mousedown", swallow],
    ["pointerup", swallow],
    ["mouseup", swallow],
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

  // The node the panel inspects, the inspector holding what was sent for it, and
  // the fiber values sent: React gives a rendered fiber new props and state objects.
  let selected:
    | {
        id: number
        values: ReturnType<typeof createInspector>
        sent?: {
          props: unknown
          state: unknown
          contexts: unknown[]
          // The render record sent, by commit seq.
          render?: number
        }
        hooks?: RawHook[]
      }
    | undefined
  // The renderer that owns the fiber's root (HostRoot, tag 3), from the global
  // hook, which holds the renderer objects React injected.
  const rendererOf = (fiber: Fiber) => {
    let at: Fiber | null = fiber
    while (at && at.tag !== 3) at = at.return
    const root = at?.stateNode as FiberRoot | undefined
    for (const [rendererId, set] of record.roots)
      if (root && set.has(root)) {
        const hook = (scope as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook })
          .__REACT_DEVTOOLS_GLOBAL_HOOK__
        return hook?.renderers.get(rendererId) as
          | (Renderer & { currentDispatcherRef?: DispatcherRef })
          | undefined
      }
  }
  // One forcing per renderer, made on its first force.
  const forcings = new Map<object, ReturnType<typeof createForcing>>()
  const forcingOf = (renderer: ForcingRenderer) => {
    let forcing = forcings.get(renderer)
    if (!forcing) {
      forcing = createForcing(renderer)
      forcings.set(renderer, forcing)
    }
    return forcing
  }
  // The nearest boundaries the tree knows, by id, and whether each is forced.
  const boundariesFor = (fiber: Fiber) => {
    const found = boundariesOf(fiber)
    const renderer = rendererOf(fiber)
    const out: { [kind in BoundaryKind]?: { id: number; on: boolean } } = {}
    for (const kind of ["fallback", "error"] as const) {
      const boundary = found[kind]
      const node = boundary && tree.known(boundary)
      if (!boundary || !node) continue
      const forcing = renderer && forcings.get(renderer)
      out[kind] = {
        id: node.id,
        on: forcing?.isForced(kind, boundary) ?? false,
      }
    }
    return out.fallback || out.error ? out : undefined
  }
  // Who rendered the fiber, nearest first: tree nodes by id, Server Components
  // (React 19 ReactComponentInfo, not in the tree) by name.
  const ownersOf = (fiber: Fiber) => ownersFrom(fiber._debugOwner)
  // A Server Component owner (a ReactComponentInfo, not a fiber), by its
  // server node's id once mounted.
  const serverOwner = (owner: unknown): Owner | undefined => {
    const info = owner as Record<string, unknown> | null | undefined
    if (info && typeof info.tag !== "number" && typeof info.name === "string")
      return {
        id: tree.serverId(info) ?? null,
        name: info.name.slice(0, MAX_TREE_STRING),
      }
  }
  const ownersFrom = (first: unknown) => {
    const owners: Owner[] = []
    let owner = first as Record<string, unknown> | null | undefined
    for (let i = 0; owner && i < MAX_OWNERS; i++) {
      if (typeof owner.tag === "number") {
        const node = tree.known(owner as unknown as Fiber)
        if (node) owners.push(node)
        owner = owner._debugOwner as typeof owner
      } else {
        const server = serverOwner(owner)
        if (server) owners.push(server)
        owner = owner.owner as typeof owner
      }
    }
    return owners
  }
  // A Server Component: what the server sent about it. Nothing to edit or read
  // from hooks; its props are the server's.
  const describeServer = (
    id: number,
    info: Record<string, unknown>,
    entries: unknown[],
  ) => {
    if (!selected) return null
    selected.sent = { props: info, state: undefined, contexts: [] }
    const data: InspectedData = {
      props: selected.values.serialize(info.props ?? {}) as Value,
      owners: ownersFrom(info.owner),
    }
    const source = renderedAt(info)
    if (source) data.source = source
    const rendered = tree
      .clientsUnder(id)
      .slice(0, MAX_RENDERED)
      .map(({ id, fiber }) => ({
        id,
        name: tree.known(fiber)?.name ?? "Anonymous",
        ...sizeOf(fiber.memoizedProps),
      }))
    data.server = { awaits: awaitsOf(info, entries), rendered }
    return data
  }
  // An arrived boundary's waits: the awaits of the Server Components inside it.
  const waitedOn = (id: number) =>
    tree
      .serversUnder(id)
      .flatMap((serverId) => {
        const found = tree.server(serverId)
        if (!found) return []
        const info = found.info as Record<string, unknown>
        const owner = String(info.name).slice(0, MAX_TREE_STRING)
        return awaitsOf(info, found.entries).map((wait) => ({ ...wait, owner }))
      })
      .slice(0, MAX_AWAITS)
  // An arrived boundary, named by the first Server Component inside it, else
  // the first component it shows (a lazy one resolved by now: Next's client
  // components are lazy references).
  const arrivalOf = ({ id, ms }: (typeof arrivals)[number]) => {
    const [first] = tree.serversUnder(id)
    const info = first === undefined ? undefined : tree.server(first)?.info
    const [client] = tree.clientsUnder(id)
    const name = info
      ? String(info.name)
      : ((client && tree.known(client.fiber)?.name) ?? "Suspense")
    return {
      boundary: id,
      name: name.slice(0, MAX_TREE_STRING),
      waited: ms,
      awaits: waitedOn(id),
    }
  }
  const describe = (id: number): InspectedData | null => {
    const found = tree.server(id)
    if (found)
      return describeServer(
        id,
        found.info as Record<string, unknown>,
        found.entries,
      )
    const fiber = tree.fiber(id)
    if (!fiber || !selected) return null
    const contexts = contextsOf(fiber)
    const latest = recorder.latest(id)
    selected.sent = {
      props: fiber.memoizedProps,
      state: fiber.memoizedState,
      contexts: contexts.map(({ value }) => value),
      render: latest?.seq,
    }
    const { serialize } = selected.values
    const data: InspectedData = {
      props: serialize(fiber.memoizedProps) as Value,
    }
    const state = (fiber.stateNode as { state?: unknown } | null)?.state
    // Class components (tag 1) keep their state on the instance.
    if (fiber.tag === 1 && state != null) data.state = serialize(state) as Value
    data.owners = ownersOf(fiber)
    // Rendered by a Server Component: its props came from the server.
    // Only a component's props are passed to code (a Suspense's aren't).
    const from = COMPONENT_TAGS.has(fiber.tag) && serverOwner(fiber._debugOwner)
    if (from)
      data.fromServer = { owner: from, props: propSizes(fiber.memoizedProps) }
    const source = sourceOf(fiber)
    if (source) data.source = source
    if (waitOf(fiber))
      data.suspense = {
        cause: causeOf(
          fiber,
          profiled.size ? suspended.causeFor(fiber) : undefined,
        ),
      }
    else if (fiber.tag === 13) {
      const awaited = waitedOn(id)
      if (awaited.length) data.suspense = { awaited }
    }
    const boundaries = boundariesFor(fiber)
    if (boundaries) data.boundaries = boundaries
    if (contexts.length)
      data.contexts = contexts.map(({ name, value, context }) => ({
        name,
        value: serialize(value) as Value,
        ...(!providerOf(fiber, context) && { default: true as const }),
      }))
    const ref = rendererOf(fiber)?.currentDispatcherRef
    const read = ref && inspectHooks(fiber as unknown as HooksFiber, ref)
    if (read) {
      const describeHook = (hook: RawHook): HookValue => {
        const context = contexts.findIndex(
          (read) => read.context === hook.context,
        )
        return {
          name: hook.name,
          ...("value" in hook && { value: serialize(hook.value) as Value }),
          ...(hook.hooks && { hooks: hook.hooks.map(describeHook) }),
          ...(hook.site && { site: hook.site }),
          ...(context !== -1 && { context }),
        }
      }
      data.hooks = read.hooks.map(describeHook)
      selected.hooks = read.hooks
      if (read.error !== undefined) data.hooksError = read.error
    }
    if (latest) {
      data.render = reasonOf(id, latest, read ? read.hooks : [], serialize)
      data.history = recorder.history(id)
    }
    return data
  }
  // A render record as sent: values serialized with the inspection's, keys and
  // lists within the validator's bounds, hooks by call indexes.
  const reasonOf = (
    id: number,
    record: RenderRecord,
    hooks: RawHook[],
    serialize: (value: unknown) => unknown,
  ): RenderReason => {
    const both = (change: { old: unknown; new: unknown }) => ({
      old: serialize(change.old) as Value,
      new: serialize(change.new) as Value,
    })
    const keyed = (changes: RenderRecord["props"] = []) =>
      changes.slice(0, MAX_CHANGES).map((change) => ({
        key: change.key.slice(0, MAX_TREE_STRING),
        ...both(change),
        ...(change.reference && { reference: change.reference }),
      }))
    const reason: RenderReason = {
      seq: record.seq,
      time: record.time,
      kinds: record.kinds,
    }
    if (record.props) reason.props = keyed(record.props)
    if (record.state) reason.state = keyed(record.state)
    if (record.hooks) {
      const list = []
      for (const change of record.hooks.slice(0, MAX_CHANGES)) {
        const hook = hookPath(hooks, change.index)
        if (hook) list.push({ hook, ...both(change) })
      }
      reason.hooks = list
    }
    if (record.remount)
      reason.remount =
        record.remount.cause === "key"
          ? {
              cause: "key",
              from: record.remount.from?.slice(0, MAX_TREE_STRING) ?? null,
              to: record.remount.to?.slice(0, MAX_TREE_STRING) ?? null,
            }
          : record.remount
    if (record.effects) {
      const list = []
      for (const run of record.effects.slice(0, MAX_CHANGES)) {
        const hook = hookPath(hooks, run.index)
        if (!hook) continue
        list.push({
          hook,
          ...(run.changed && {
            changed: run.changed
              .slice(0, MAX_CHANGES)
              .map((change) => ({ dep: change.dep, ...both(change) })),
          }),
        })
      }
      reason.effects = list
    }
    if (record.contexts)
      reason.contexts = record.contexts
        .slice(0, MAX_CHANGES)
        .map((change) => ({ context: change.read, ...both(change) }))
    reason.updaters = triggers(record.seq, serialize, id, hooks)
    return reason
  }
  // The components whose updates scheduled commit `seq`, with the state each
  // changed, labelled as their Hooks sections are. `own`: the selected node's
  // hooks, already read.
  const triggers = (
    seq: number,
    serialize: (value: unknown) => unknown,
    selectedId?: number,
    own: RawHook[] = [],
  ): Updater[] => {
    const list: Updater[] = []
    for (const updater of recorder.updatersOf(seq).slice(0, MAX_CHANGES)) {
      const fiber = tree.fiber(updater.id)
      if (!fiber) continue
      // Another component's hooks are read only if it changed some.
      const hooks =
        updater.id === selectedId || !updater.hooks.length
          ? own
          : hooksOf(fiber)
      const changes = []
      for (const change of updater.hooks.slice(0, MAX_CHANGES)) {
        const name = hookLabel(hooks, change.index)
        if (name)
          changes.push({
            name,
            old: serialize(change.old) as Value,
            new: serialize(change.new) as Value,
          })
      }
      list.push({ id: updater.id, hooks: changes })
    }
    return list
  }
  // The update's cause for the Updates list: its first updater's first
  // changed hook by list index. Not labeled: that's a shadow render of the
  // updater (its code runs again) on every update.
  const firstChange = (seq: number) => {
    const change = recorder.updatersOf(seq)[0]?.hooks[0]
    if (!change) return
    const { serialize } = createInspector()
    return {
      hook: change.index,
      old: serialize(change.old) as Value,
      new: serialize(change.new) as Value,
    }
  }
  const hooksOf = (fiber: Fiber) => {
    const ref = rendererOf(fiber)?.currentDispatcherRef
    return (
      (ref && inspectHooks(fiber as unknown as HooksFiber, ref)?.hooks) || []
    )
  }
  const inspect = (id: number | null) => {
    selected?.values.release()
    selected = id === null ? undefined : { id, values: createInspector() }
    if (id !== null) post(inspected(id, describe(id)))
  }
  // The value a panel row shows (copy-value, store-value), from what was sent.
  const valueAt = (target: ValueTarget) => {
    if (!selected) return
    if ("objectId" in target)
      return selected.values.find(target.objectId, target.key)
    if ("hook" in target) {
      const hook = hookAt(selected.hooks, target.hook)
      return hook && "value" in hook ? { value: hook.value } : undefined
    }
    const contexts = selected.sent?.contexts ?? []
    return target.context < contexts.length
      ? { value: contexts[target.context] }
      : undefined
  }
  const globals = target as unknown as Record<string, unknown>
  const useValue = (command: ReturnType<typeof parseTreeCommand>) => {
    if (command?.type !== "copy-value" && command?.type !== "store-value")
      return
    const found = valueAt(command.target)
    if (!found) return
    if (command.type === "copy-value") {
      const text = copyText(found.value)
      if (text.length <= MAX_COPY) post(valueText(text))
      return
    }
    // Like DevTools' "Store as global variable": the next free name, logged.
    let n = 1
    while (`$reactdx${n}` in globals) n++
    const name = `$reactdx${n}`
    globals[name] = found.value
    console.log(name, found.value)
    post(valueStored(name))
  }

  // On the flush: send again only if the node rendered (or unmounted) since.
  const refresh = () => {
    if (!selected) return
    const { id, sent } = selected
    // A server node changes only with a new payload: a new info object.
    const server = tree.server(id)
    if (server) {
      if (server.info !== sent?.props) post(inspected(id, describe(id)))
      return
    }
    const fiber = tree.fiber(id)
    if (
      fiber &&
      sent &&
      fiber.memoizedProps === sent.props &&
      recorder.latest(id)?.seq === sent.render &&
      fiber.memoizedState === sent.state &&
      sameValues(
        contextsOf(fiber).map(({ value }) => value),
        sent.contexts,
      )
    )
      return
    post(inspected(id, describe(id)))
    if (!fiber) inspect(null)
  }

  let pending = false
  record.listeners.add((rendererId, root) => {
    const entry = info(root)
    entry.commits++
    if (watching && inspectable(rendererId))
      // React clears memoizedUpdaters once this returns (dev builds keep them
      // while a devtools hook was present at load).
      recorder.commit(
        entry.id,
        new Set(
          (root as { memoizedUpdaters?: Set<unknown> }).memoizedUpdaters ?? [],
        ),
        (visit) => tree.commit(root, entry.id, buffer, visit),
        () => arrivals.splice(0).map(arrivalOf),
      )
    // Only schedules a frame: layout isn't read inside React's commit.
    outlines?.changed()
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      snapshot()
      if (buffer.length) send(buffer.splice(0))
      postCommits()
      postCounts(false)
      refresh()
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
    else if (data.type === "outlines") {
      const command = parseTreeCommand(data)
      if (command?.type === "outlines") outline(command.mode)
    } else if (
      data.type === "inspect" ||
      data.type === "expand" ||
      data.type === "reason" ||
      data.type === "commit"
    ) {
      const command = parseTreeCommand(data)
      if (command?.type === "inspect") inspect(command.id)
      if (command?.type === "commit") {
        const { seq } = command
        const renders = recorder.rendered(seq)
        if (!renders) post(committed(seq, null))
        // At least one batch: a commit that rendered nothing says so.
        else
          for (let at = 0; at === 0 || at < renders.length; at += MAX_OPS)
            post(
              committed(
                seq,
                renders.slice(at, at + MAX_OPS),
                at === 0
                  ? triggers(seq, createInspector().serialize)
                  : undefined,
              ),
            )
      }
      if (command?.type === "reason" && command.id === selected?.id) {
        const { id, seq } = command
        const record = recorder.record(id, seq)
        post(
          reasoned(
            id,
            seq,
            record
              ? reasonOf(
                  id,
                  record,
                  selected.hooks ?? [],
                  selected.values.serialize,
                )
              : null,
          ),
        )
      }
      if (command?.type === "expand") {
        const { objectId, offset } = command
        const value = selected?.values.expand(objectId, offset)
        if (value !== undefined)
          post(expanded(objectId, offset, value as Value))
      }
    } else if (
      data.type === "edit" ||
      data.type === "delete-path" ||
      data.type === "rename-path"
    ) {
      const command = parseTreeCommand(data)
      if (!command || !("root" in command) || command.id !== selected?.id)
        return
      const fiber = tree.fiber(command.id)
      const renderer = fiber && rendererOf(fiber)
      if (!renderer) return
      const op: EditOp =
        command.type === "edit"
          ? { op: "set", value: fromEditValue(command.value) }
          : command.type === "delete-path"
            ? { op: "delete" }
            : { op: "rename", to: command.to }
      const { root, path } = command
      if (typeof root === "object" && "context" in root) {
        // A context is written through its provider's value, so every reader
        // of that provider sees it. A default (no provider) can't be.
        const read = contextsOf(fiber)[root.context]
        const provider = read && providerOf(fiber, read.context)
        if (provider)
          applyEdit(renderer, provider, "props", ["value", ...path], op)
      } else applyEdit(renderer, fiber, root, path, op, selected.hooks)
      // React commits the edit in a microtask; send its result then, not on
      // the next flush, since the developer is waiting on this one value.
      setTimeout(refresh)
    } else if (data.type === "force") {
      const command = parseTreeCommand(data)
      if (command?.type !== "force" || command.id !== selected?.id) return
      const fiber = tree.fiber(command.id)
      const boundary = fiber && boundariesOf(fiber)[command.kind]
      const renderer = fiber && rendererOf(fiber)
      if (!boundary || !renderer) return
      forcingOf(renderer).force(command.kind, boundary, command.on)
      // Its props and state didn't change, so the flush wouldn't re-send it:
      // send whether the boundary is forced now, after React's commit.
      const { id } = command
      setTimeout(() => {
        if (selected?.id === id) post(inspected(id, describe(id)))
      })
    } else if (data.type === "rerender") {
      const command = parseTreeCommand(data)
      if (command?.type !== "rerender" || command.id !== selected?.id) return
      const fiber = tree.fiber(command.id)
      // A DOM element (5) or text (6) has no render of its own.
      if (!fiber || fiber.tag === 5 || fiber.tag === 6) return
      rendererOf(fiber)?.scheduleUpdate?.(fiber)
      setTimeout(refresh)
    } else if (data.type === "copy-value" || data.type === "store-value")
      useValue(parseTreeCommand(data))
    else if (data.type === "clear-updates") {
      recorder.clearCommits()
      postCommits(true)
    } else if (data.type === "unwatch") {
      stopPicking()
      outlines?.off()
      inspect(null)
      watching = false
      unprofile()
      buffer.length = 0
      tree.clear()
      recorder.clear()
    }
  })
  snapshot()
}
