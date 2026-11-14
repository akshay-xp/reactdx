import { type JSX, Show } from "solid-js"
import type { TreeStore } from "./tree"

// The element picker, search (Enter: next match, Shift+Enter: previous) and the
// DOM elements filter. Laid out like SnapQL's search bar.
export function Toolbar(props: { tree: TreeStore }) {
  return (
    <search class="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2 py-1.5">
      <IconButton
        label="Pick element"
        testid="pick"
        pressed={props.tree.picking()}
        onClick={() => props.tree.setPicking(!props.tree.picking())}
      >
        <PickGlyph />
      </IconButton>
      <SearchField
        label="Search components"
        testid="search"
        clearLabel="Clear search"
        value={props.tree.query()}
        onInput={(text) => props.tree.setQuery(text)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          props.tree.step(event.shiftKey ? -1 : 1)
        }}
      >
        <span data-testid="search-count" class="shrink-0">
          {`${props.tree.position()} of ${props.tree.matches().length}`}
        </span>
      </SearchField>
      <IconButton
        label="Show DOM elements"
        testid="show-dom"
        pressed={props.tree.showHosts()}
        onClick={() => props.tree.setShowHosts(!props.tree.showHosts())}
      >
        <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
      </IconButton>
    </search>
  )
}

// The picker's crosshair, inside a 24-unit svg (the toolbar's, the inspector's).
export function PickGlyph() {
  return (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <circle cx="12" cy="12" r="5" />
    </>
  )
}

// A search box laid out like SnapQL's: an icon, the input, and while it holds
// text, `children` (a count) and a clear button.
export function SearchField(props: {
  label: string
  testid: string
  clearLabel: string
  value: string
  onInput: (text: string) => void
  onKeyDown?: (event: KeyboardEvent) => void
  children?: JSX.Element
}) {
  return (
    <label class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md bg-surface pr-0.5 pl-2 text-muted focus-within:ring-1 focus-within:ring-accent">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        data-testid={props.testid}
        aria-label={props.label}
        placeholder={props.label}
        class="min-w-0 flex-1 bg-transparent text-fg outline-none [&::-webkit-search-cancel-button]:hidden"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => props.onKeyDown?.(event)}
      />
      <Show when={props.value !== ""}>
        {props.children}
        <IconButton label={props.clearLabel} onClick={() => props.onInput("")}>
          <path d="M6 6l12 12M18 6 6 18" />
        </IconButton>
      </Show>
    </label>
  )
}

// SnapQL's icon button (apps/extension/src/panel/icon-button.tsx): the label is
// its accessible name and tooltip.
export function IconButton(props: {
  label: string
  testid?: string
  pressed?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      data-testid={props.testid}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      class="flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 hover:bg-selected hover:text-fg"
      // One color class per state: with both, CSS order decides, and muted wins.
      classList={{
        "bg-accent/20 text-accent": props.pressed,
        "text-muted": !props.pressed,
      }}
      onClick={props.onClick}
    >
      <Glyph size={15}>{props.children}</Glyph>
    </button>
  )
}

// A stroked 24-unit icon.
export function Glyph(props: { size: number; children: JSX.Element }) {
  return (
    <svg
      aria-hidden="true"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.children}
    </svg>
  )
}
