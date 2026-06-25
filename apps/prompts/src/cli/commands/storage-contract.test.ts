import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function runCli(args: string[]): CliResult {
  const dir = mkdtempSync(join(tmpdir(), "open-prompts-storage-cli-"))
  const dbPath = join(dir, "prompts.db")
  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      HASNA_PROMPTS_DB_PATH: dbPath,
      PROMPTS_DB_PATH: dbPath,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

describe("storage CLI contract", () => {
  test("exposes storage command", () => {
    const result = runCli(["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("storage")
    expect(result.stdout).toContain("Manage prompts local/remote storage sync")
  })

  test("does not accept the old migration command", () => {
    const result = runCli(["cloud", "status", "--json"])

    expect(result.exitCode).not.toBe(0)
  })
})
