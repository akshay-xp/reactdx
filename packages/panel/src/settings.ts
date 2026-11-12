import { createSignal } from "solid-js"
import type { Settings } from "./Inspector"

// The panel's settings over the extension's store (storage.local). They start
// off and take the stored value when it arrives, unless the developer changed
// one first: a late read must not undo their choice.
export function createSettings(store: {
  get(): Promise<boolean | undefined>
  set(on: boolean): void
}): Settings {
  const [hookNames, setHookNames] = createSignal(false)
  let changed = false
  store.get().then((stored) => {
    if (!changed) setHookNames(stored === true)
  })
  return {
    hookNames,
    setHookNames(on) {
      changed = true
      setHookNames(on)
      store.set(on)
    },
  }
}
