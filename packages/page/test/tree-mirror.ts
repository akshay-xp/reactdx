import type { TreeOp } from "@reactdx/messages"

type Node = Extract<TreeOp, { op: "add" }> & { children: number[] }

// Applies tree ops the way the panel will, and prints the result as indented lines.
export function mirror() {
  const nodes = new Map<number, Node>()
  const tops = new Map<number, number[]>()
  const list = (rootId: number, parentId: number) => {
    if (parentId) return (nodes.get(parentId) as Node).children
    if (!tops.has(rootId)) tops.set(rootId, [])
    return tops.get(rootId) as number[]
  }
  const forget = (id: number) => {
    for (const child of nodes.get(id)?.children ?? []) forget(child)
    nodes.delete(id)
  }
  const apply = (ops: TreeOp[]) => {
    for (const op of ops) {
      if (op.op === "reset") {
        nodes.clear()
        tops.clear()
      } else if (op.op === "add") {
        nodes.set(op.id, { ...op, children: [] })
        list(op.rootId, op.parentId).splice(op.index, 0, op.id)
      } else if (op.op === "remove") {
        const node = nodes.get(op.id) as Node
        const siblings = list(node.rootId, node.parentId)
        siblings.splice(siblings.indexOf(op.id), 1)
        forget(op.id)
      } else if (op.op === "reorder") {
        const siblings = list(op.rootId, op.parentId)
        siblings.splice(0, siblings.length, ...op.children)
      } else (nodes.get(op.id) as Node).name = op.name
    }
  }
  const outline = (rootId?: number) => {
    const lines: string[] = []
    const visit = (id: number, depth: number) => {
      const { name, kind, key, children } = nodes.get(id) as Node
      lines.push(
        `${"  ".repeat(depth)}${name} ${kind}${key === null ? "" : ` key=${key}`}`,
      )
      for (const child of children) visit(child, depth + 1)
    }
    for (const [id, top] of tops)
      if (rootId === undefined || id === rootId)
        for (const child of top) visit(child, 0)
    return lines
  }
  return { apply, outline, nodes }
}
