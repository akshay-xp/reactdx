import { cleanup } from "@solidjs/testing-library"
import { afterEach } from "vitest"

// No test globals, so the library can't unmount on its own: a menu (portaled
// to the body) would outlive its test.
afterEach(cleanup)

// jsdom has no layout, so no ResizeObserver: a box never resizes there.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
