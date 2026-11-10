window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(renderer) {
    const id = this.renderers.size + 1;
    this.renderers.set(id, renderer);
    return id;
  },
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
};
