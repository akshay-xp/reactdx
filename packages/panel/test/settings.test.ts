import { expect, test } from "vitest"
import { createSettings } from "../src/settings.ts"

// A store whose stored value arrives when `arrive` is called.
function slowStore(stored: boolean | undefined) {
  const saved: boolean[] = []
  let arrive = () => {}
  const store = {
    get: () =>
      new Promise<boolean | undefined>((resolve) => {
        arrive = () => resolve(stored)
      }),
    set: (on: boolean) => {
      saved.push(on)
    },
  }
  return { store, saved, arrive: () => arrive() }
}
const settled = () => new Promise((resolve) => setTimeout(resolve))

test("hook names start off, then take the stored value", async () => {
  const { store, arrive } = slowStore(true)
  const settings = createSettings(store)
  expect(settings.hookNames()).toBe(false)
  arrive()
  await settled()
  expect(settings.hookNames()).toBe(true)
})

test("a change is saved, and a stored value arriving later doesn't undo it", async () => {
  const { store, saved, arrive } = slowStore(false)
  const settings = createSettings(store)
  settings.setHookNames(true)
  arrive()
  await settled()
  expect(settings.hookNames()).toBe(true)
  expect(saved).toEqual([true])
})
