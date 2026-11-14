import type { JSX } from "solid-js"
import { Glyph } from "./Toolbar"

// A screen with nothing to show yet: centered, an icon in a circle above a title,
// a muted hint, and an action (`children`) if there is one.
export function Empty(props: {
  icon: JSX.Element
  title: string
  hint: string
  children?: JSX.Element
}) {
  return (
    <div
      data-testid="empty"
      class="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center"
    >
      <span class="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted">
        <Glyph size={22}>{props.icon}</Glyph>
      </span>
      <p class="font-medium text-fg">{props.title}</p>
      <p class="text-muted">{props.hint}</p>
      {props.children}
    </div>
  )
}

// An empty screen's action: a bordered button with an icon.
export function EmptyAction(props: {
  icon: JSX.Element
  pressed?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      class="mt-1 flex items-center gap-1.5 rounded-md border px-2.5 py-1"
      classList={{
        "border-accent bg-accent/20 text-accent": props.pressed,
        "border-border text-fg hover:bg-selected": !props.pressed,
      }}
      onClick={() => props.onClick()}
    >
      <Glyph size={14}>{props.icon}</Glyph>
      {props.children}
    </button>
  )
}
