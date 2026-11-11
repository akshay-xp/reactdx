// A hook like RDT's: its own renderer ids, and a record of commits it received.
export function fakeHook() {
  const renderers = new Map<number, unknown>()
  const calls: unknown[] = []
  return {
    calls,
    renderers,
    supportsFiber: true as const,
    inject(renderer: unknown) {
      renderers.set(renderers.size + 1, renderer)
      return renderers.size
    },
    onCommitFiberRoot(...args: unknown[]) {
      calls.push(args)
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  }
}
