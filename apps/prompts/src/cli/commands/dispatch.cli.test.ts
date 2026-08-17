import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createFakeBins, usageFixture, type FakeBins } from "../../lib/dispatch/test-fakes.js"

type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

let env: Record<string, string>
let fakes: FakeBins

function runCli(args: string[]): CliResult {
  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

function savePrompt(body: string, slug = "cli-dispatch-test"): string {
  const saved = runCli(["--json", "save", "CLI Dispatch Test", "--body", body, "--slug", slug, "--force"])
  expect(saved.exitCode).toBe(0)
  const parsed = JSON.parse(saved.stdout) as { id: string }
  return parsed.id
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "prompts-cli-dispatch-"))
  fakes = createFakeBins()
  env = {
    ...process.env as Record<string, string>,
    HASNA_PROMPTS_DB_PATH: join(dir, "prompts.db"),
    PROMPTS_DB_PATH: join(dir, "prompts.db"),
    HASNA_PROMPTS_DISPATCH_RUNS_DIR: join(dir, "runs"),
    HASNA_PROMPTS_DISPATCH_CODEMITH_BIN: fakes.codewithBin,
    HASNA_PROMPTS_DISPATCH_LOCKS_BIN: fakes.locksBin,
  }
  delete env["HASNA_PROMPTS_DISPATCH_MODEL"]
})

afterEach(() => {
  fakes.cleanup()
})

describe("prompts dispatch CLI", () => {
  test("omitted runtime defaults to emit and returns the rendered prompt", () => {
    const id = savePrompt("Hello {{name}}!")
    const result = runCli(["--json", "dispatch", id, "--var", "name=Alice"])
    expect(result.exitCode).toBe(0)
    const receipt = JSON.parse(result.stdout) as {
      run: { runtime: string; status: string; prompt_id: string }
      rendered: string
    }
    expect(receipt.run.runtime).toBe("emit")
    expect(receipt.run.status).toBe("succeeded")
    expect(receipt.run.prompt_id).toBe(id)
    expect(receipt.rendered).toBe("Hello Alice!")
  })

  test("--vars-json merges with --var", () => {
    const id = savePrompt("Hello {{first}} {{last}}!")
    const result = runCli([
      "--json", "dispatch", id,
      "--var", "first=Ada",
      "--vars-json", '{"last":"Lovelace"}',
    ])
    expect(result.exitCode).toBe(0)
    const receipt = JSON.parse(result.stdout) as { rendered: string }
    expect(receipt.rendered).toBe("Hello Ada Lovelace!")
  })

  test("strict render fails with a named code and exit 1", () => {
    const id = savePrompt("Hello {{name}}!")
    const result = runCli(["--json", "dispatch", id])
    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.stdout) as { error: string }
    expect(parsed.error).toContain("STRICT_RENDER_MISSING_VARS")
    expect(parsed.error).toContain("name")
  })

  test("dispatch get returns metadata only by default", () => {
    const id = savePrompt("Hello {{name}}!")
    const dispatched = runCli(["--json", "dispatch", id, "--var", "name=Bob"])
    const receipt = JSON.parse(dispatched.stdout) as { run: { id: string } }
    const got = runCli(["--json", "dispatch", "get", receipt.run.id])
    expect(got.exitCode).toBe(0)
    const run = JSON.parse(got.stdout) as Record<string, unknown>
    expect(run["id"]).toBe(receipt.run.id)
    expect(run["status"]).toBe("succeeded")
    expect(run["prompt_version"]).toBe(1)
    expect(run["render_hash"]).toBeTypeOf("string")
    expect(run["rendered"]).toBeUndefined()
  })

  test("codewith wait run finalizes succeeded and dispatch get --include-output shows the bounded capture", () => {
    fakes.setUsageFixture(
      usageFixture([{ name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" }])
    )
    fakes.setConfig({ FAKE_EXEC_LAST: "review summary", FAKE_EXEC_EXIT: 0 })
    const id = savePrompt("Review the changes {{area}}.")
    const result = runCli([
      "--json", "dispatch", id,
      "--runtime", "codewith",
      "--target", "account001",
      "--var", "area=dispatch",
      "--wait",
    ])
    expect(result.exitCode).toBe(0)
    const receipt = JSON.parse(result.stdout) as { run: { status: string; target: string | null; output_pointer: string | null } }
    expect(receipt.run.status).toBe("succeeded")
    expect(receipt.run.target).toBe("account001")

    const got = runCli(["--json", "dispatch", "get", (JSON.parse(result.stdout) as { run: { id: string } }).run.id, "--include-output"])
    expect(got.exitCode).toBe(0)
    const detail = JSON.parse(got.stdout) as { run: { status: string }; output: { out: string; err: string; last: string } }
    expect(detail.run.status).toBe("succeeded")
    expect(detail.output.last).toContain("review summary")
  })

  test("targets list is read-only discovery with availability", () => {
    fakes.setUsageFixture(
      usageFixture([
        { name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" },
        { name: "account002", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0002" },
      ])
    )
    const result = runCli(["--json", "targets", "list"])
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { targets: Array<{ name: string; available: boolean }>; examined: number }
    expect(payload.examined).toBe(2)
    const byName = Object.fromEntries(payload.targets.map((t) => [t.name, t.available]))
    expect(byName["account001"]).toBe(true)
    expect(byName["account002"]).toBe(false)
  })

  test("dispatch with a non-codewith runtime fails with UNSUPPORTED_RUNTIME", () => {
    const id = savePrompt("Hello {{name}}!")
    const result = runCli(["--json", "dispatch", id, "--runtime", "claude", "--var", "name=Ada"])
    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.stdout) as { error: string }
    expect(parsed.error).toContain("UNSUPPORTED_RUNTIME")
  })
})

describe("prompts dispatch CLI human output", () => {
  test("emit prints the rendered prompt for human consumers", () => {
    const id = savePrompt("Human {{name}}!", "cli-human-dispatch")
    const result = runCli(["dispatch", id, "--var", "name=output"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Human output!")
  })
})
