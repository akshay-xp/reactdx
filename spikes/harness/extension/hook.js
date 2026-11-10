let nextRendererId = 1;

window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(renderer) {
    const id = nextRendererId++;
    this.renderers.set(id, renderer);
    return id;
  },
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
};

console.log('[reactdx] hook installed');
