import type { OutlineMode } from "@reactdx/messages"
import { type JSX, Show } from "solid-js"
import type { TreeStore } from "./tree"

// The element picker, search (Enter: next match, Shift+Enter: previous), the
// DOM elements filter and the page outline modes (one at a time). Laid out like SnapQL's search bar.
export function Toolbar(props: { tree: TreeStore }) {
  const outline = (mode: OutlineMode) =>
    props.tree.setOutlines(props.tree.outlines() === mode ? undefined : mode)
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
      <IconButton
        label="Outline Suspense on the page"
        testid="outlines"
        pressed={props.tree.outlines() === "suspense"}
        onClick={() => outline("suspense")}
      >
        <rect
          x="4"
          y="5"
          width="16"
          height="14"
          rx="1"
          stroke-dasharray="3 2"
        />
      </IconButton>
      <IconButton
        label="Light client islands"
        testid="islands"
        reason={
          props.tree.hasServers()
            ? undefined
            : "No Server Components on this page"
        }
        pressed={props.tree.outlines() === "islands"}
        onClick={() => outline("islands")}
      >
        <rect x="4" y="4" width="16" height="16" rx="1" />
        <path d="M4 20 20 4v16z" fill="currentColor" />
      </IconButton>
      <IconButton
        label="Flash renders on the page"
        testid="flash"
        pressed={props.tree.outlines() === "renders"}
        onClick={() => outline("renders")}
      >
        <rect x="7" y="7" width="10" height="10" rx="1" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
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

// A circular arrow, inside a 24-unit svg (Glyph).
export function ReloadGlyph() {
  return (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.2" />
      <path d="M20 4v7h-7" />
    </>
  )
}

// An hourglass (Show fallback) and a warning triangle (Show error), inside a
// 24-unit svg (Glyph).
export function SuspenseGlyph() {
  return (
    <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
  )
}
export function ErrorGlyph() {
  return (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17v.5" />
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
  // Why it can't be used now: disabled, and the reason is its title.
  reason?: string
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      data-testid={props.testid}
      aria-label={props.label}
      title={props.reason ?? props.label}
      disabled={props.reason !== undefined}
      aria-pressed={props.pressed}
      class="flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 hover:bg-selected hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
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
