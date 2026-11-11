export type Hook = {
  renderers: Map<number, unknown>
  supportsFiber: true
  inject(renderer: unknown): number
  onCommitFiberRoot(...args: unknown[]): void
  onCommitFiberUnmount(...args: unknown[]): void
  onPostCommitFiberRoot(...args: unknown[]): void
  checkDCE(): void
}

declare global {
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook | undefined
}

export function installHook(target: {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook
}): Hook {
  const renderers = new Map<number, unknown>()
  const hook: Hook = {
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
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook
  return hook
}
