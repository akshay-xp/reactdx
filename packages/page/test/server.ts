import React from "react"

const h = React.createElement

// Server Components: Flight sends each one's output wrapped in a lazy whose
// _debugInfo names it; React 19 copies that chain onto the fibers it creates.
export const react19 = React.version.startsWith("19.")

export const serverInfo = (
  name: string,
  key: string | null = null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  env: "Server",
  key,
  owner: null,
  props: {},
  ...extra,
})

export const server = (
  info: object,
  node: React.ReactNode,
  extra: object[] = [],
): React.ReactNode =>
  ({
    $$typeof: Symbol.for("react.lazy"),
    _payload: node,
    _init: (n: unknown) => n,
    _debugInfo: [{ time: 0 }, ...extra, info],
  }) as unknown as React.ReactNode

export function ServerChild() {
  return h("i")
}

// An element a Server Component created, as Flight builds it: its owner is the
// component's info (React freezes createElement's elements, so it's built here).
export const ownedBy = (
  info: object,
  type: React.ElementType,
  props: Record<string, unknown>,
): React.ReactNode =>
  ({
    $$typeof: Symbol.for("react.transitional.element"),
    type,
    key: null,
    props,
    _owner: info,
    _store: {},
  }) as unknown as React.ReactNode
