import Counter from "./Counter"

export default function Page() {
  return (
    <main>
      <p data-testid="server">Rendered on the server</p>
      <Counter label="Count" />
    </main>
  )
}
