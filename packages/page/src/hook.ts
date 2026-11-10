export function installHook(target: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }): void {
  const renderers = new Map<number, unknown>();
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers,
    supportsFiber: true,
    inject(renderer: unknown) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    // React warns "Download the React DevTools" when the hook lacks checkDCE.
    checkDCE() {},
  };
}
