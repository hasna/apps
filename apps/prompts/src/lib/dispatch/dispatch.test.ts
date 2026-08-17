import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { resetDatabase, getDatabase } from "../../db/database.js"
import { getPrompt, upsertPrompt } from "../../db/prompts.js"
import { createDispatchRun, getDispatchRun, listDispatchRuns, pruneDispatchRuns } from "../../db/dispatch-runs.js"
import { cancelDispatchRun, dispatchPrompt, mergeVars } from "./index.js"
import { capturePaths } from "./capture-helper.js"
import { UNTRUSTED_DATA_MARKER } from "./capture-helper.js"
import { DispatchError } from "./types.js"
import { createFakeBins, usageFixture, type FakeBins } from "./test-fakes.js"

const frag = (...parts: string[]): string => parts.join("")

let fakes: FakeBins
let dbPath: string
let runsDir: string

function savePrompt(body: string, slug = "dispatch-test"): string {
  const { prompt } = upsertPrompt({
    title: "Dispatch Test",
    slug,
    body,
    source: "manual",
  })
  return prompt.id
}

async function waitForStatus(runId: string, statuses: string[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = getDispatchRun(runId)
    if (run && statuses.includes(run.status)) return run.status
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return getDispatchRun(runId)?.status ?? "missing"
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "prompts-dispatch-"))
  dbPath = join(dir, "prompts.db")
  runsDir = join(dir, "runs")
  fakes = createFakeBins()
  process.env["HASNA_PROMPTS_DB_PATH"] = dbPath
  process.env["HASNA_PROMPTS_DISPATCH_RUNS_DIR"] = runsDir
  process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_BIN"] = fakes.codewithBin
  process.env["HASNA_PROMPTS_DISPATCH_LOCKS_BIN"] = fakes.locksBin
  process.env["HASNA_PROMPTS_DISPATCH_HELPER"] = join(
    import.meta.dir,
    "capture-helper.ts"
  )
  process.env["LANG"] = "C.UTF-8"
  process.env["FAKE_SECRET_VALUE_12345"] = "super-secret-test-value"
  resetDatabase()
})

afterEach(() => {
  delete process.env["HASNA_PROMPTS_DB_PATH"]
  delete process.env["HASNA_PROMPTS_DISPATCH_RUNS_DIR"]
  delete process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_BIN"]
  delete process.env["HASNA_PROMPTS_DISPATCH_LOCKS_BIN"]
  delete process.env["HASNA_PROMPTS_DISPATCH_HELPER"]
  delete process.env["HASNA_PROMPTS_DISPATCH_MODEL"]
  delete process.env["HASNA_PROMPTS_DISPATCH_TIMEOUT_MS"]
  delete process.env["HASNA_PROMPTS_DISPATCH_MAX_CAPTURE_BYTES"]
  delete process.env["HASNA_PROMPTS_DISPATCH_RETENTION_DAYS"]
  delete process.env["FAKE_SECRET_VALUE_12345"]
  delete process.env["LANG"]
  fakes.cleanup()
  resetDatabase()
})

describe("dispatchPrompt strict render gate", () => {
  test("fails before acceptance when a required variable is missing", async () => {
    const id = savePrompt("Hello {{name}}!")
    let error: unknown
    try {
      await dispatchPrompt(id)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(DispatchError)
    expect((error as DispatchError).code).toBe("STRICT_RENDER_MISSING_VARS")
    expect((error as DispatchError).message).toContain("name")
    // No run was accepted and usage was not incremented.
    expect(listDispatchRuns({ prompt_id: id })).toHaveLength(0)
    expect(getPrompt(id)?.use_count).toBe(0)
  })

  test("strict gate applies to codewith runs before any runtime is touched", async () => {
    const id = savePrompt("Hello {{name}}!")
    let error: unknown
    try {
      await dispatchPrompt(id, { runtime: "codewith" })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("STRICT_RENDER_MISSING_VARS")
    expect(listDispatchRuns({ prompt_id: id })).toHaveLength(0)
    expect(getPrompt(id)?.use_count).toBe(0)
  })

  test("mergeVars rejects invalid JSON with a named code", () => {
    expect(() => mergeVars([], "not json{")).toThrow(
      expect.objectContaining({ code: "INVALID_VARS_JSON" })
    )
    expect(() => mergeVars([], "[1,2]")).toThrow(
      expect.objectContaining({ code: "INVALID_VARS_JSON" })
    )
    expect(mergeVars([["a", "1"]], '{"b":"2"}')).toEqual({ a: "1", b: "2" })
  })
})

describe("dispatchPrompt emit", () => {
  test("emit returns the rendered prompt and increments usage exactly once", async () => {
    const id = savePrompt("Hello {{name}} — {{topic}}")
    const receipt = await dispatchPrompt(id, { vars: { name: "Alice", topic: "dispatch" } })
    expect(receipt.run.runtime).toBe("emit")
    expect(receipt.run.status).toBe("succeeded")
    expect(receipt.rendered).toBe("Hello Alice — dispatch")
    expect(receipt.run.prompt_id).toBe(id)
    expect(receipt.run.prompt_version).toBe(getPrompt(id)?.version)
    expect(receipt.run.resolved_references).toEqual([])
    expect(receipt.run.render_hash.length).toBe(64)
    expect(receipt.run.target).toBeNull()
    expect(getPrompt(id)?.use_count).toBe(1)

    // A second accepted run increments again — exactly one per run.
    await dispatchPrompt(id, { vars: { name: "Bob", topic: "again" } })
    expect(getPrompt(id)?.use_count).toBe(2)
  })

  test("unsupported runtimes are rejected", async () => {
    const id = savePrompt("Hello {{name}}!")
    let error: unknown
    try {
      await dispatchPrompt(id, { runtime: "claude" as never })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("UNSUPPORTED_RUNTIME")
  })

  test("--target with emit is rejected", async () => {
    const id = savePrompt("Hello {{name}}!")
    let error: unknown
    try {
      await dispatchPrompt(id, { target: "account001" })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("TARGET_WITH_EMIT")
  })
})

describe("dispatchPrompt codewith", () => {
  const healthyFixture = () =>
    usageFixture([
      { name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" },
      { name: "account002", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0002" },
    ])

  test("wait run succeeds with argv/stdin/env invariants and releases the lock", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({
      FAKE_EXEC_LAST: "final answer for the task",
      FAKE_EXEC_EXIT: 0,
    })
    const id = savePrompt("Review the code {{area}} carefully.")
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      vars: { area: "dispatch" },
      wait: true,
      model: "gpt-5.6-sol",
    })

    expect(receipt.run.status).toBe("succeeded")
    expect(receipt.run.exit_code).toBe(0)
    expect(receipt.run.error_code).toBeNull()
    expect(receipt.run.target).toBe("account001")
    expect(receipt.run.prompt_id).toBe(id)
    expect(receipt.run.render_hash.length).toBe(64)
    expect(receipt.target?.name).toBe("account001")
    // Exactly one accepted run increments usage once.
    expect(getPrompt(id)?.use_count).toBe(1)

    // Output pointer exists and holds the bounded, redacted last message.
    expect(receipt.run.output_pointer).not.toBeNull()
    expect(existsSync(receipt.run.output_pointer!)).toBe(true)
    const lastMessage = readFileSync(receipt.run.output_pointer!, "utf8")
    expect(lastMessage).toContain("final answer for the task")

    // argv: array-based, no shell; read-only sandbox; approval never; prompt on stdin via "-".
    const argvLines = readFileSync(fakes.execArgv, "utf8").split("\n").filter((line) => line.length > 0)
    expect(argvLines).toContain("exec")
    expect(argvLines).toContain("--auth-profile")
    expect(argvLines).toContain("account001")
    expect(argvLines).toContain("-s")
    expect(argvLines).toContain("read-only")
    expect(argvLines).toContain("-a")
    expect(argvLines).toContain("never")
    expect(argvLines).toContain("--ephemeral")
    expect(argvLines).toContain("--json")
    expect(argvLines).toContain("--skip-git-repo-check")
    expect(argvLines).toContain("-m")
    expect(argvLines).toContain("gpt-5.6-sol")
    expect(argvLines).toContain("-o")
    expect(argvLines[argvLines.length - 1]).toBe("-")

    // stdin carries the untrusted-data marker and the rendered prompt.
    const stdinText = readFileSync(fakes.execStdin, "utf8")
    expect(stdinText.startsWith(UNTRUSTED_DATA_MARKER)).toBe(true)
    expect(stdinText).toContain("Review the code dispatch carefully.")

    // Env allowlist: benign vars present, credential-bearing vars dropped.
    const envText = readFileSync(fakes.execEnv, "utf8")
    expect(envText).toContain("LANG=C.UTF-8")
    expect(envText).toContain("HOME=")
    expect(envText).not.toContain("FAKE_SECRET_VALUE_12345")

    // Reservation: acquire + release both recorded for the account key.
    const locksLog = readFileSync(fakes.locksLog, "utf8")
    expect(locksLog).toContain("locks acquire codewith/provider-account/chat-gpt/acct_fake_0001")
    expect(locksLog).toContain("locks release codewith/provider-account/chat-gpt/acct_fake_0001")
  })

  test("shell metacharacters in the rendered prompt are passed via stdin, never executed", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({ FAKE_EXEC_LAST: "ok", FAKE_EXEC_EXIT: 0 })
    const pwnPath = join(runsDir, "pwned")
    const id = savePrompt(`Content: $(touch ${pwnPath}) \`touch ${pwnPath}2\` | rm -rf /etc || true; ; && \`''\"`)
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      wait: true,
    })
    expect(receipt.run.status).toBe("succeeded")
    const stdinText = readFileSync(fakes.execStdin, "utf8")
    expect(stdinText).toContain("$(touch")
    expect(existsSync(pwnPath)).toBe(false)
    expect(existsSync(`${pwnPath}2`)).toBe(false)
  })

  test("non-zero exit is recorded as failed with the exit code", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({ FAKE_EXEC_EXIT: 3 })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, { runtime: "codewith", target: "account001", wait: true })
    expect(receipt.run.status).toBe("failed")
    expect(receipt.run.exit_code).toBe(3)
    expect(receipt.run.error_code).toBe("3")
    // A failed accepted run still counts as one use.
    expect(getPrompt(id)?.use_count).toBe(1)
  })

  test("timeout kills the child and records failed/TIMEOUT", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({ FAKE_EXEC_SLEEP: 30 })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      wait: true,
      timeoutMs: 1000,
    })
    expect(receipt.run.status).toBe("failed")
    expect(receipt.run.error_code).toBe("TIMEOUT")
    expect(receipt.run.finished_at).not.toBeNull()
  })

  test("cancel marks a running run cancelled", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({ FAKE_EXEC_SLEEP: 30 })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      wait: false,
      timeoutMs: 60_000,
    })
    expect(receipt.run.status).toBe("running")
    const procPath = capturePaths(runsDir, receipt.run.id).proc
    expect(await waitForFile(procPath, 5000)).toBe(true)
    cancelDispatchRun(receipt.run.id)
    const status = await waitForStatus(receipt.run.id, ["cancelled", "failed"], 10_000)
    expect(status).toBe("cancelled")
    expect(getDispatchRun(receipt.run.id)?.error_code).toBe("CANCELLED")
  })

  test("stdout and stderr captures are bounded", async () => {
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({
      FAKE_EXEC_LAST: "final",
      FAKE_EXEC_STDOUT: "o".repeat(200_000),
      FAKE_EXEC_STDERR: "e".repeat(200_000),
    })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      wait: true,
      maxCaptureBytes: 4096,
    })
    expect(receipt.run.status).toBe("succeeded")
    expect(receipt.run.notes).toContain("stdout truncated")
    expect(receipt.run.notes).toContain("stderr truncated")
    const paths = capturePaths(runsDir, receipt.run.id)
    const outBytes = (await Bun.file(paths.out).size) ?? 0
    const errBytes = (await Bun.file(paths.err).size) ?? 0
    expect(outBytes).toBeLessThanOrEqual(5000)
    expect(errBytes).toBeLessThanOrEqual(5000)
  })

  test("captures are redacted before persistence", async () => {
    const token = frag("sk-", "ant-", "TestToken0123456789AbCdEf012345")
    fakes.setUsageFixture(healthyFixture())
    fakes.setConfig({
      FAKE_EXEC_LAST: `the secret is ${token}`,
      FAKE_EXEC_STDOUT: `stdout leak: ${token}`,
    })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, { runtime: "codewith", target: "account001", wait: true })
    expect(receipt.run.status).toBe("succeeded")
    const paths = capturePaths(runsDir, receipt.run.id)
    const outText = await Bun.file(paths.out).text()
    const lastText = readFileSync(receipt.run.output_pointer!, "utf8")
    expect(outText).not.toContain(token)
    expect(outText).toContain("[REDACTED]")
    expect(lastText).not.toContain(token)
    expect(lastText).toContain("[REDACTED]")
  })

  test("alias collision: two profiles with one fingerprint acquire the same key and the second is held", async () => {
    fakes.setUsageFixture(
      usageFixture([
        { name: "account001", ok: true, health: "healthy", fingerprint: "acct_same_0001" },
        { name: "account002", ok: true, health: "healthy", fingerprint: "acct_same_0001" },
      ])
    )
    fakes.setConfig({ FAKE_EXEC_LAST: "ok", FAKE_EXEC_EXIT: 0 })
    const id = savePrompt("Do the thing.")
    const receipt = await dispatchPrompt(id, {
      runtime: "codewith",
      target: "account001",
      wait: true,
      timeoutMs: 30_000,
    })
    expect(receipt.run.status).toBe("succeeded")

    // The account is still reserved while the first run holds it — but the
    // first run released on terminal state, so simulate a concurrent lane by
    // holding the key before the second dispatch.
    const key = "codewith/provider-account/chat-gpt/acct_same_0001"
    const heldPath = fakes.heldFile
    writeFileSync(heldPath, key + "\n")
    const id2 = savePrompt("Do the thing.", "dispatch-test-2")
    let error: unknown
    try {
      await dispatchPrompt(id2, { runtime: "codewith", target: "account002", wait: true })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("LOCK_HELD")
    // The failed attempt is recorded on its run row.
    const runs = listDispatchRuns({ prompt_id: id2 })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe("failed")
    expect(runs[0]?.error_code).toBe("LOCK_HELD")
  })

  test("no healthy target fails with examined/usable counts and records the run", async () => {
    fakes.setUsageFixture(
      usageFixture([
        { name: "account001", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0001" },
      ])
    )
    const id = savePrompt("Do the thing.")
    let error: unknown
    try {
      await dispatchPrompt(id, { runtime: "codewith" })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("NO_HEALTHY_TARGET")
    expect((error as DispatchError).message).toContain("examined 1")
    const runs = listDispatchRuns({ prompt_id: id })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe("failed")
    expect(runs[0]?.error_code).toBe("NO_HEALTHY_TARGET")
  })

  test("spark models are rejected and the run is recorded failed", async () => {
    fakes.setUsageFixture(healthyFixture())
    const id = savePrompt("Do the thing.")
    let error: unknown
    try {
      await dispatchPrompt(id, { runtime: "codewith", model: "gpt-5.3-codex-spark" })
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("SPARK_MODEL_REJECTED")
    const runs = listDispatchRuns({ prompt_id: id })
    expect(runs[0]?.status).toBe("failed")
    expect(runs[0]?.error_code).toBe("SPARK_MODEL_REJECTED")
  })
})

describe("dispatch run retention", () => {
  test("terminal runs older than the retention window are pruned with their files", () => {
    const id = savePrompt("Retention {{name}}", "retention-test")
    const run = createDispatchRun({
      runtime: "emit",
      status: "succeeded",
      prompt_id: id,
      prompt_slug: "retention-test",
      prompt_version: 1,
      render_hash: "a".repeat(64),
    })
    mkdirSync(runsDir, { recursive: true })
    const paths = capturePaths(runsDir, run.id)
    writeFileSync(paths.out, "old capture")
    writeFileSync(paths.err, "")
    getDatabase().run("UPDATE dispatch_runs SET created_at = '2000-01-01 00:00:00' WHERE id = ?", [run.id])

    const result = pruneDispatchRuns(30, (r) => {
      const p = capturePaths(runsDir, r.id)
      return [p.out, p.err, p.last, p.status, p.proc, p.job]
    })
    expect(result.pruned).toBe(1)
    expect(existsSync(paths.out)).toBe(false)
    expect(getDispatchRun(run.id)).toBeNull()
    // A recent terminal run survives.
    const recent = createDispatchRun({
      runtime: "emit",
      status: "succeeded",
      prompt_id: id,
      prompt_slug: "retention-test",
      prompt_version: 1,
      render_hash: "b".repeat(64),
    })
    const result2 = pruneDispatchRuns(30, () => [])
    expect(result2.pruned).toBe(0)
    expect(getDispatchRun(recent.id)).not.toBeNull()
  })
})
