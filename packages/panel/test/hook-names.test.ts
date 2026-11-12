import { expect, test } from "vitest"
import { hookNameAt, parseModule } from "../src/hook-names.ts"

const code = [
  'import { useState } from "react"', // 1
  "function App() {", // 2
  "  const [count, setCount] = useState(0)", // 3
  "  const ref = useRef()", // 4
  "  const { data, error } = useQuery()", // 5
  "  const cart = useCart()", // 6
  '  const [other] = (0, m["useState"])(0)', // 7
  "  useEffect(() => {})", // 8
  "  x = useState()", // 9
  "  const memo = useMemo(() => f(), [])", // 10
  "  return count", // 11
  "}", // 12
].join("\n")
const ast = parseModule(code)
// The 1-based column where `text` starts on `line`.
const at = (line: number, text: string) =>
  (code.split("\n")[line - 1] as string).indexOf(text) + 1
const name = (line: number, text: string) =>
  hookNameAt(ast, code, line, at(line, text))

test("the variable a call is assigned to", () => {
  expect(name(3, "useState")).toBe("count")
  expect(name(3, "(0)")).toBe("count")
  expect(name(4, "useRef")).toBe("ref")
  expect(name(5, "useQuery")).toBe("data")
  expect(name(6, "useCart")).toBe("cart")
  expect(name(7, '(0, m["useState"])')).toBe("other")
})

test("no name for an unassigned call or outside any call", () => {
  expect(name(8, "useEffect")).toBeNull()
  expect(name(9, "useState")).toBeNull()
  expect(name(11, "count")).toBeNull()
})

test("the call at the position, not one inside its arguments", () => {
  expect(name(10, "useMemo")).toBe("memo")
})

test("a script that isn't a module still parses", () => {
  const script = "with (o) {}\nconst ref = useRef()"
  expect(hookNameAt(parseModule(script), script, 2, 13)).toBe("ref")
})
