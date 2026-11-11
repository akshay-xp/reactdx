export type FiberRoot = {
  current: { tag: number; memoizedState: { element: unknown } | null }
}

export type Hook = {
  renderers: Map<number, unknown>
  supportsFiber: true
  inject(renderer: unknown): number
  onCommitFiberRoot(id: number, root: FiberRoot, ...rest: unknown[]): void
  onCommitFiberUnmount(...args: unknown[]): void
  onPostCommitFiberRoot(...args: unknown[]): void
  checkDCE(): void
}

export type RendererInfo = {
  version: string
  bundleType: number
  rendererPackageName: string
}

// What ReactDX knows about the page's React, whichever hook React connected to.
export type HookRecord = {
  renderers: Map<number, RendererInfo>
  roots: Map<number, Set<FiberRoot>>
  listeners: Set<(rendererId: number, root: FiberRoot) => void>
}

declare global {
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook | undefined
}

const KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__"

function createHook(): Hook {
  const renderers = new Map<number, unknown>()
  return {
    renderers,
    supportsFiber: true,
    inject(renderer) {
      const id = renderers.size + 1
      renderers.set(id, renderer)
      return id
    },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    // React warns "Download the React DevTools" when the hook lacks checkDCE.
    checkDCE() {},
  }
}

export function installHook(target: {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook
}): HookRecord {
  const record: HookRecord = {
    renderers: new Map(),
    roots: new Map(),
    listeners: new Set(),
  }
  Object.defineProperty(target, Symbol.for("reactdx"), { value: record })

  let restore = () => {}
  const addRenderer = (id: number, renderer: unknown) => {
    restore()
    const { version, bundleType, rendererPackageName } =
      renderer as RendererInfo
    record.renderers.set(id, { version, bundleType, rendererPackageName })
  }

  // Our listener runs after the hook's own onCommitFiberRoot.
  const attachTo = (hook: Hook) => {
    const { inject, onCommitFiberRoot } = hook
    for (const [id, renderer] of hook.renderers ?? []) addRenderer(id, renderer)
    hook.inject = function (renderer) {
      const id = inject.call(this, renderer)
      addRenderer(id, renderer)
      return id
    }
    hook.onCommitFiberRoot = function (id, root, ...rest) {
      onCommitFiberRoot.call(this, id, root, ...rest)
      const roots = record.roots.get(id) ?? new Set()
      record.roots.set(id, roots)
      if (root.current.memoizedState?.element == null) roots.delete(root)
      else roots.add(root)
      for (const listener of record.listeners) listener(id, root)
    }
  }

  // Another tool (RDT) got there first: React will use its hook, so wrap that one.
  const existing = Object.getOwnPropertyDescriptor(target, KEY)?.value
  if (existing) {
    attachTo(existing)
    return record
  }

  // On the prototype (Window.prototype in a browser), so other tools' own-property
  // checks don't see ours and can still install theirs.
  const hook = createHook()
  attachTo(hook)
  const native = Object.defineProperty
  native(Object.getPrototypeOf(target), KEY, {
    configurable: true,
    get: () => hook,
    // A tool assigning its own hook gets it as window's own property, as without us.
    set(value: Hook) {
      native(target, KEY, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      })
      attachTo(value)
    },
  })

  // A tool installing after us (RDT) defines its hook on window, shadowing ours:
  // attach to it as it lands. The page sees this wrapper only until React connects.
  const wrapper = ((object, key, descriptor) => {
    native(object, key, descriptor)
    if (object === target && key === KEY && target[KEY]) attachTo(target[KEY])
    return object
  }) as typeof Object.defineProperty
  Object.defineProperty = wrapper
  restore = () => {
    if (Object.defineProperty === wrapper) Object.defineProperty = native
  }
  return record
}
