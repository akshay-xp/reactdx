import { spawn } from "node:child_process"
import path from "node:path"

// Resolves once nothing answers on the port (or rejects after 30 s).
async function portFree(port: number) {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      await fetch(`http://localhost:${port}`)
    } catch {
      return
    }
    if (Date.now() > deadline) throw new Error(`port ${port} stays in use`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// Starts `pnpm <script>` and resolves once the port answers. The previous test
// file's server may still be shutting down (stop() doesn't wait): it would answer
// for this one, and Next would move to another port, so the port must free first.
export async function startFixture(script: string, port: number) {
  await portFree(port)
  const child = spawn("pnpm", [script], {
    cwd: path.resolve(import.meta.dirname, ".."),
    detached: true,
    stdio: "ignore",
  })
  let exited = false
  const stop = () => {
    if (!exited && child.pid) process.kill(-child.pid, "SIGTERM")
  }
  return new Promise<() => void>((resolve, reject) => {
    const deadline = Date.now() + 60_000
    child.once("exit", (code) => {
      exited = true
      reject(new Error(`server for ${script} exited with code ${code}`))
    })
    const poll = async () => {
      if (exited) return
      try {
        await fetch(`http://localhost:${port}`)
        resolve(stop)
      } catch {
        if (Date.now() > deadline) {
          stop()
          reject(new Error(`server for ${script} never answered on ${port}`))
          return
        }
        setTimeout(poll, 250)
      }
    }
    poll()
  })
}
