const state = (window.__reactdxTiming = {
  loadId: Math.random().toString(36).slice(2),
  injected: 0,
  commits: 0,
  persisted: false,
});

window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(renderer) {
    state.injected++;
    this.renderers.set(state.injected, renderer);
    return state.injected;
  },
  onCommitFiberRoot() {
    state.commits++;
  },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
};

window.addEventListener('pageshow', (event) => {
  state.persisted = event.persisted;
  setTimeout(() => {
    console.log(
      `[reactdx:timing] status loadId=${state.loadId} injected=${state.injected} commits=${state.commits} persisted=${state.persisted}`,
    );
  }, 500);
});
