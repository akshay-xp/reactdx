import { spawn } from "node:child_process"
import path from "node:path"

// Starts `pnpm <script>` and resolves once the port answers.
export function startFixture(script: string, port: number) {
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
