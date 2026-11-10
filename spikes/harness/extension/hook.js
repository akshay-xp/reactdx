let nextRendererId = 1;

window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(renderer) {
    const id = nextRendererId++;
    this.renderers.set(id, renderer);
    return id;
  },
  onCommitFiberRoot(id, root) {
    console.log(`[reactdx] commit renderer=${id} container=${root.containerInfo.nodeName}`);
  },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
};

console.log('[reactdx] hook installed');
