import React from "react"
import Counter from "./Counter"

export default function App() {
  return (
    <>
      <p data-testid="react-version">{React.version}</p>
      <Counter label="Count" />
    </>
  )
}
