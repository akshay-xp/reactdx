// Reads a function component's hooks by rendering it once more with a stub
// dispatcher (docs/page.md, Hooks). After react-debug-tools' inspectHooksOfFiber
// (MIT), which RDT uses.

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

type Call = { name: string; value?: unknown; hasValue: boolean }

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
    calls.push({ name, value, hasValue })
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
  let error: string | undefined
  try {
    render(fiber.memoizedProps)
  } catch (thrown) {
    error = String(thrown)
  } finally {
    ref[key] = previous
  }
  return {
    hooks: calls.map(({ name, value, hasValue }) =>
      hasValue ? { name, value } : { name },
    ),
    ...(error !== undefined && { error }),
  }
}
