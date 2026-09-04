import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("storage CLI diagnostics", () => {
  test("prints remote registry fallback diagnostics as JSON without configured values", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "src/cli/index.tsx", "--json", "storage"],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: tempHome,
          PROMPTS_REGISTRY_POSTGRES_URL: "configured-postgres-url",
          PROMPTS_REGISTRY_S3_BUCKET: "configured-bucket",
          PROMPTS_REGISTRY_AWS_REGION: "configured-region",
          TMPDIR: tmpdir(),
        },
      })

      const stdout = result.stdout.toString()
      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).toBe("")

      const diagnostics = JSON.parse(stdout) as {
        active_storage: string
        registry_state: string
        sync: { remote_mutation: boolean }
        remote: { postgres: { configured: boolean }; object_storage: { provider: string } }
      }

      expect(diagnostics.active_storage).toBe("local-sqlite")
      expect(diagnostics.registry_state).toBe("remote-configured-local-fallback")
      expect(diagnostics.remote.postgres.configured).toBe(true)
      expect(diagnostics.remote.object_storage.provider).toBe("s3")
      expect(diagnostics.sync.remote_mutation).toBe(false)
      expect(stdout).not.toContain("configured-postgres-url")
      expect(stdout).not.toContain("configured-bucket")
      expect(stdout).not.toContain("configured-region")
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })
})
