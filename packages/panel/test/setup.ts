// jsdom has no layout, so no ResizeObserver: a box never resizes there.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
