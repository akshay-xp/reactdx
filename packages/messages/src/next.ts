import type { TreeKind } from "./index.ts"

// Next.js App Router internals, by kind and name, from Next 16.4.6's tree. The
// kind keeps an app's own class ErrorBoundary visible.
const NEXT_INTERNALS = new Set<string>([
  ...[
    "Root",
    "ServerRoot",
    "AppRouter",
    "RootErrorBoundary",
    "ErrorBoundary",
    "Router",
    "HistoryUpdater",
    "HotReload",
    "ReplaySsrOnlyErrors",
    "DevRootHTTPAccessFallbackBoundary",
    "HTTPAccessFallbackBoundary",
    "RedirectBoundary",
    "Head",
    "SegmentStateProvider",
    "ScrollHandler",
    "InnerScrollHandler",
    "LoadingBoundary",
    "InnerLayoutRouter",
    "SegmentTrieNode",
    "SegmentBoundaryTriggerNode",
    "SegmentViewStateNode",
    "AppRouterAnnouncer",
  ].map((name) => `function ${name}`),
  ...[
    "ErrorBoundaryHandler",
    "AppDevOverlayErrorBoundary",
    "HTTPAccessFallbackErrorBoundary",
    "RedirectErrorBoundary",
  ].map((name) => `class ${name}`),
  ...["ViewportWrapper", "MetadataWrapper", "Next.MetadataOutlet"].map(
    (name) => `server ${name}`,
  ),
  ...["OuterLayoutRouter", "RenderFromTemplateContext", "SegmentViewNode"].map(
    (name) => `lazy ${name}`,
  ),
  ...[
    "HeadManagerContext",
    "NavigationPromisesContext",
    "PathParamsContext",
    "PathnameContext",
    "SearchParamsContext",
    "GlobalLayoutRouterContext",
    "AppRouterContext",
    "LayoutRouterContext",
    "TemplateContext",
  ].map((name) => `provider ${name}`),
])

// Whether a node is one of Next's own. An unnamed Context under an internal and
// a Suspense under a __next_ boundary are Next's too; an app's never are.
export function nextInternal(
  name: string,
  kind: TreeKind,
  parent: { name: string; internal: boolean } | undefined,
): boolean {
  if (name.startsWith("__next_") || NEXT_INTERNALS.has(`${kind} ${name}`))
    return true
  if (kind === "provider" && name === "Context")
    return parent?.internal ?? false
  if (kind === "suspense") return parent?.name.startsWith("__next_") ?? false
  return false
}
