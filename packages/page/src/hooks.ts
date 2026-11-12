// Reads a function component's hooks by rendering it once more with a stub
// dispatcher (docs/page.md, Hooks). After react-debug-tools' inspectHooksOfFiber
// (MIT), which RDT uses.

import { type Frame, parseStack } from "./stack.ts"

type HookState = { memoizedState: unknown; next: HookState | null }
type ContextItem = { memoizedValue: unknown; next: ContextItem | null }
type Context = { displayName?: string; _currentValue?: unknown }

export type HooksFiber = {
  tag: number
  type: unknown
  elementType: unknown
  memoizedProps: unknown
  memoizedState: unknown
  ref: unknown
  dependencies: { firstContext: ContextItem | null } | null
}

// React 19 keeps the dispatcher at `H`, React 18 at `current`.
export type DispatcherRef = { H?: unknown; current?: unknown }

// A hook as read: `value` is absent for hooks with nothing to show (an effect
// without deps).
export type RawHook = { name: string; value?: unknown; hooks?: RawHook[] }

type Call = {
  name: string
  value?: unknown
  hasValue: boolean
  frames: Frame[]
}

// Frames on a stub's stack above the custom hook chain: record(), the stub
// method, and React's exported hook (useState, useFormStatus...). Below the
// chain: renderOf's closure, then what the stack before the render had.
const ABOVE = 3
const BELOW = 1

// Each level of a hook's custom hook chain, outermost first: the custom hook's
// name, keyed by where it was called, so two calls of one hook stay apart.
function chainOf(frames: Frame[], depth: number) {
  const chain = frames.slice(ABOVE, frames.length - depth - BELOW).reverse()
  return chain.slice(1).map((frame, i) => ({
    name: frame.functionName,
    key: `${(chain[i] as Frame).source} ${frame.functionName}`,
  }))
}

// Nests each call under its custom hooks; a DebugValue labels the hook it's in.
function group(calls: Call[], depth: number): RawHook[] {
  const top: RawHook[] = []
  let open: { key: string; hook: RawHook }[] = []
  for (const call of calls) {
    const chain = chainOf(call.frames, depth)
    let shared = 0
    while (
      shared < open.length &&
      shared < chain.length &&
      open[shared]?.key === chain[shared]?.key
    )
      shared++
    open = open.slice(0, shared)
    for (const level of chain.slice(shared)) {
      const hook: RawHook = { name: level.name, hooks: [] }
      ;(open.at(-1)?.hook.hooks ?? top).push(hook)
      open.push({ key: level.key, hook })
    }
    const parent = open.at(-1)?.hook
    if (parent && call.name === "DebugValue") parent.value = call.value
    else
      (parent?.hooks ?? top).push(
        call.hasValue
          ? { name: call.name, value: call.value }
          : { name: call.name },
      )
  }
  return top
}

const noop = () => {}

// Function components (0), forwardRef (11) and simple memo (15) have hooks.
function renderOf(fiber: HooksFiber) {
  const type = fiber.type as {
    (props: unknown): unknown
    render?: (props: unknown, ref: unknown) => unknown
  }
  if (fiber.tag === 0 || fiber.tag === 15)
    return (props: unknown) => type(props)
  if (fiber.tag === 11)
    return (props: unknown) => type.render?.(props, fiber.ref)
}

export function inspectHooks(
  fiber: HooksFiber,
  ref: DispatcherRef,
): { hooks: RawHook[]; error?: string } | undefined {
  const render = renderOf(fiber)
  if (!render) return
  // The fiber's hook list and context reads, consumed in call order.
  let hook = fiber.memoizedState as HookState | null
  let context = fiber.dependencies?.firstContext ?? null
  const calls: Call[] = []
  const next = () => {
    const current = hook
    hook = current?.next ?? null
    return current
  }
  const read = (of: Context) => {
    if (!context) return of._currentValue
    const value = context.memoizedValue
    context = context.next
    return value
  }
  const record = (name: string, value?: unknown, hasValue = true) =>
    calls.push({
      name,
      value,
      hasValue,
      frames: parseStack(new Error().stack ?? ""),
    })
  const effect = (name: string) => () => {
    const deps = (next()?.memoizedState as { deps?: unknown } | undefined)?.deps
    record(name, deps, deps != null)
  }

  const dispatcher = {
    readContext: read,
    useContext(of: Context) {
      const value = read(of)
      record(of.displayName ? `Context(${of.displayName})` : "Context", value)
      return value
    },
    useState(initial: unknown) {
      const state = next()
      const value = state
        ? state.memoizedState
        : typeof initial === "function"
          ? initial()
          : initial
      record("State", value)
      return [value, noop]
    },
    useReducer(_: unknown, arg: unknown, init?: (arg: unknown) => unknown) {
      const state = next()
      const value = state ? state.memoizedState : init ? init(arg) : arg
      record("Reducer", value)
      return [value, noop]
    },
    useRef(initial: unknown) {
      const state = next()
      const value = state
        ? (state.memoizedState as { current: unknown })
        : { current: initial }
      record("Ref", value.current)
      return value
    },
    useMemo(create: () => unknown) {
      const state = next()
      const value = state ? (state.memoizedState as unknown[])[0] : create()
      record("Memo", value)
      return value
    },
    useCallback(callback: unknown) {
      const state = next()
      record(
        "Callback",
        state ? (state.memoizedState as unknown[])[0] : callback,
      )
      return callback
    },
    useEffect: effect("Effect"),
    useLayoutEffect: effect("LayoutEffect"),
    useInsertionEffect: effect("InsertionEffect"),
    useImperativeHandle(target: unknown) {
      next()
      record(
        "ImperativeHandle",
        (target as { current?: unknown } | null)?.current,
      )
    },
    useDebugValue(value: unknown, format?: (value: unknown) => unknown) {
      record("DebugValue", format ? format(value) : value)
    },
    useDeferredValue(value: unknown) {
      const state = next()
      const deferred = state ? state.memoizedState : value
      record("DeferredValue", deferred)
      return deferred
    },
    // Two list entries: the pending state, then the start function.
    useTransition() {
      const state = next()
      next()
      const pending = state ? state.memoizedState : false
      record("Transition", pending)
      return [pending, noop]
    },
    // Two list entries: the snapshot, then the subscribing effect.
    useSyncExternalStore(_: unknown, snapshot: () => unknown) {
      const state = next()
      next()
      const value = state ? state.memoizedState : snapshot()
      record("SyncExternalStore", value)
      return value
    },
    useId() {
      const state = next()
      const id = state ? state.memoizedState : ""
      record("Id", id)
      return id
    },
  }

  const key = "H" in ref ? "H" : "current"
  const previous = ref[key]
  ref[key] = dispatcher
  // V8 keeps 10 frames by default: a deep custom hook chain needs them all.
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = Number.POSITIVE_INFINITY
  let error: string | undefined
  let depth = 0
  try {
    depth = parseStack(new Error().stack ?? "").length
    render(fiber.memoizedProps)
  } catch (thrown) {
    error = String(thrown)
  } finally {
    ref[key] = previous
    Error.stackTraceLimit = limit
  }
  return {
    hooks: group(calls, depth),
    ...(error !== undefined && { error }),
  }
}
