"use client"

import { createContext } from "react"

const Theme = createContext("light")

// A client wrapper around server content: an island whose box is the Server
// Components it was passed (e2e/outlines.test.ts).
export default function ThemeProvider({ children }) {
  return (
    <Theme value="light">
      <div data-testid="themed">{children}</div>
    </Theme>
  )
}
