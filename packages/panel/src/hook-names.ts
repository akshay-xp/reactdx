import { type Node, parse } from "acorn"

// Loaded only when hook names are on (src/names.ts imports it dynamically).

// Served scripts are modules (Vite) or classic scripts (Next's chunks).
export function parseModule(code: string): Node {
  try {
    return parse(code, { ecmaVersion: "latest", sourceType: "module" })
  } catch {
    return parse(code, { ecmaVersion: "latest", sourceType: "script" })
  }
}

type AnyNode = Node & Record<string, unknown>
const isNode = (value: unknown): value is AnyNode =>
  typeof (value as Node | null)?.type === "string"

// The innermost call containing `offset`, and the node it sits in.
function callAt(node: AnyNode, offset: number) {
  let found: { call: AnyNode; parent: AnyNode | undefined } | undefined
  const visit = (at: AnyNode, parent: AnyNode | undefined) => {
    if (offset < at.start || offset >= at.end) return
    if (at.type === "CallExpression") found = { call: at, parent }
    for (const value of Object.values(at))
      for (const child of Array.isArray(value) ? value : [value])
        if (isNode(child)) visit(child, at)
  }
  visit(node, undefined)
  return found
}

function bound(pattern: AnyNode): string | null {
  if (pattern.type === "Identifier") return pattern.name as string
  if (pattern.type === "ArrayPattern") {
    const first = (pattern.elements as (AnyNode | null)[])[0]
    return first ? bound(first) : null
  }
  if (pattern.type === "ObjectPattern") {
    const first = (pattern.properties as AnyNode[])[0]
    return first?.type === "Property" ? bound(first.value as AnyNode) : null
  }
  return null
}

// The variable the call at a stack frame's 1-based line and column is assigned
// to: `const [count] = useState()` gives "count"; a bare call gives null.
export function hookNameAt(
  ast: Node,
  code: string,
  line: number,
  column: number,
): string | null {
  let offset = 0
  for (let i = 1; i < line; i++) offset = code.indexOf("\n", offset) + 1
  const found = callAt(ast as AnyNode, offset + column - 1)
  if (found?.parent?.type !== "VariableDeclarator") return null
  if (found.parent.init !== found.call) return null
  return bound(found.parent.id as AnyNode)
}
