/**
 * Dispatch engine for @hasna/prompts.
 *
 * `prompts dispatch <id>` strictly renders a stored prompt and hands it to a
 * runtime. Initial release: emit (rendered prompt only, no process) and
 * codewith (read-only headless execution). Every accepted run records one
 * dispatch_runs receipt and increments prompt usage exactly once.
 *
 * Safety invariants (hard):
 * - read-only is the only execution policy; no push/merge/publish/deploy/repo write
 * - the runtime env is allowlisted; credentials never enter prompt text, run
 *   metadata, or logs
 * - rendered external content is marked untrusted data
 * - output and stderr are bounded and redacted before persistence
 * - one accepted run increments prompt usage once
 * - every result binds prompt id, prompt version, resolved references,
 *   target, and render hash
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { runsDir } from "../paths.js"
import { requirePrompt, usePrompt } from "../../db/prompts.js"
import { renderTemplate } from "../template.js"
import {
  createDispatchRun,
  getDispatchRun,
  requireDispatchRun,
  pruneDispatchRuns,
  updateDispatchRun,
} from "../../db/dispatch-runs.js"
import {
  accountLockKey,
  acquireAccountLock,
  releaseAccountLock,
  discoverTargets,
  resolveBin,
  selectTarget,
  isSparkModel,
} from "./codewith.js"
import { capturePaths, type CaptureJob } from "./capture-helper.js"
import { DispatchError, type DispatchReceipt, type DispatchRuntime } from "./types.js"

export { getDispatchRun, listDispatchRuns, pruneDispatchRuns } from "../../db/dispatch-runs.js"
export { discoverTargets, selectTarget, projectTargets } from "./codewith.js"
export type {
  DispatchRun,
  DispatchRuntime,
  DispatchStatus,
  DispatchTarget,
  DispatchReceipt,
} from "./types.js"
export { DispatchError } from "./types.js"

const SUPPORTED_RUNTIMES = new Set<DispatchRuntime>(["emit", "codewith"])

export interface DispatchOptions {
  runtime?: DispatchRuntime
  target?: string
  vars?: Record<string, string>
  cwd?: string
  wait?: boolean
  model?: string | null
  timeoutMs?: number
  maxCaptureBytes?: number
  lockTtlSeconds?: number
  /** Resolved references (stable full IDs). Empty in the initial release. */
  resolvedReferences?: string[]
}

export function defaultRunsDir(): string {
  return (
    process.env["HASNA_PROMPTS_DISPATCH_RUNS_DIR"] ??
    // The dispatch run records live under the effective data root's `runs`
    // subdir, resolved through the @hasna/paths resolver (gated legacy
    // adoption — see src/lib/paths.ts).
    runsDir()
  )
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function canonicalVarsHash(vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort()
  const canonical: Record<string, string> = {}
  for (const key of keys) {
    const value = vars[key]
    if (value !== undefined) canonical[key] = value
  }
  return sha256Hex(JSON.stringify(canonical))
}

export function mergeVars(
  assignments: Array<[string, string]>,
  varsJson: string | undefined
): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of assignments) {
    if (key.length === 0) {
      throw new DispatchError("INVALID_VAR", `Invalid variable assignment: ${key}=${value}`)
    }
    vars[key] = value
  }
  if (varsJson !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(varsJson)
    } catch {
      throw new DispatchError("INVALID_VARS_JSON", "Vars JSON is not valid JSON")
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new DispatchError("INVALID_VARS_JSON", "Vars JSON must be an object of string values")
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new DispatchError("INVALID_VARS_JSON", `Vars JSON value for "${key}" must be a string`)
      }
      vars[key] = value
    }
  }
  return vars
}

/**
 * Strict render gate: dispatch renders strictly by default. Missing required
 * variables fail before a run is accepted and before usage is incremented.
 */
export function strictRender(
  body: string,
  vars: Record<string, string>
): { rendered: string; renderHash: string } {
  const result = renderTemplate(body, vars)
  if (result.missing_vars.length > 0) {
    throw new DispatchError(
      "STRICT_RENDER_MISSING_VARS",
      `Missing required variables: ${result.missing_vars.join(", ")}`
    )
  }
  return { rendered: result.rendered, renderHash: sha256Hex(result.rendered) }
}

async function recordDispatchFailure(
  runId: string,
  code: string,
  message: string
): Promise<DispatchError> {
  updateDispatchRun(runId, {
    status: "failed",
    error_code: code,
    finished_at: new Date().toISOString(),
    notes: message.slice(0, 500),
  })
  return new DispatchError(code, message)
}

function resolveHelperPath(): string {
  const override = process.env["HASNA_PROMPTS_DISPATCH_HELPER"]
  if (override) return override
  // The engine is bundled into dist/cli, dist/mcp, and dist/server, so
  // import.meta.dir points at the bundle's directory, not the module's
  // source location. Walk up to the package root and resolve the helper in
  // src (development) or dist (installed package; src is not shipped).
  let dir = import.meta.dir
  for (let i = 0; i < 10; i++) {
    const srcCandidate = join(dir, "src", "lib", "dispatch", "capture-helper.ts")
    if (existsSync(srcCandidate)) return srcCandidate
    const distCandidate = join(dir, "dist", "lib", "dispatch", "capture-helper.js")
    if (existsSync(distCandidate)) return distCandidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new DispatchError(
    "HELPER_NOT_FOUND",
    "dispatch capture helper could not be resolved (build the package or set HASNA_PROMPTS_DISPATCH_HELPER)"
  )
}

/**
 * Dispatch a strictly rendered prompt to a runtime.
 *
 * Omitted runtime defaults to emit (returns the rendered prompt only, no
 * process). Emit runs are always synchronous. Codewith runs are synchronous
 * with --wait and fire-and-forget (with a detached capture helper) without.
 */
export async function dispatchPrompt(
  idOrSlug: string,
  options: DispatchOptions = {}
): Promise<DispatchReceipt> {
  const prompt = requirePrompt(idOrSlug)
  const runtime: DispatchRuntime = options.runtime ?? "emit"
  if (!SUPPORTED_RUNTIMES.has(runtime)) {
    throw new DispatchError(
      "UNSUPPORTED_RUNTIME",
      `Unsupported dispatch runtime "${runtime}". Supported: emit, codewith`
    )
  }
  if (runtime === "emit" && options.target) {
    throw new DispatchError("TARGET_WITH_EMIT", "--target is not applicable to the emit runtime")
  }

  const vars = mergeVars(Object.entries(options.vars ?? {}), undefined)
  const { rendered, renderHash } = strictRender(prompt.body, vars)
  const varsHash = canonicalVarsHash(vars)
  const resolvedReferences = options.resolvedReferences ?? []

  // Retention is bounded: prune terminal runs older than the retention window
  // before accepting a new run.
  const retentionDays = parseInt(process.env["HASNA_PROMPTS_DISPATCH_RETENTION_DAYS"] ?? "30", 10) || 30
  const runsDir = defaultRunsDir()
  pruneDispatchRuns(retentionDays, (run) => {
    const paths = capturePaths(runsDir, run.id)
    return [paths.out, paths.err, paths.last, paths.status, paths.proc, paths.job]
  })

  // Accept the run: create the receipt row first, then increment usage once.
  let run = createDispatchRun({
    runtime,
    target: runtime === "codewith" ? (options.target ?? null) : null,
    status: "pending",
    prompt_id: prompt.id,
    prompt_slug: prompt.slug,
    prompt_version: prompt.version,
    render_hash: renderHash,
    vars_hash: varsHash,
    resolved_references: resolvedReferences,
  })
  try {
    usePrompt(prompt.id)
  } catch (error) {
    // Compensate: a run that was not accepted must not leave a receipt row.
    const { getDatabase } = await import("../../db/database.js")
    getDatabase().run("DELETE FROM dispatch_runs WHERE id = ?", [run.id])
    throw new DispatchError(
      "DISPATCH_ACCEPT_FAILED",
      `Failed to record prompt usage: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (runtime === "emit") {
    run = updateDispatchRun(run.id, {
      status: "succeeded",
      output_hash: renderHash,
      output_bytes: Buffer.byteLength(rendered, "utf8"),
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    return { run, rendered }
  }

  // Codewith path. Failures after acceptance are recorded on the run row so
  // a failed dispatch is never left as a silent pending receipt.
  const codewithBin = resolveBin(
    "codewith",
    process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_BIN"],
    "CODEMITH"
  )
  const locksBin = resolveBin(
    "conversations",
    process.env["HASNA_PROMPTS_DISPATCH_LOCKS_BIN"],
    "CONVERSATIONS"
  )
  const model = options.model ?? process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_MODEL"] ?? null
  if (model && isSparkModel(model)) {
    throw await recordDispatchFailure(
      run.id,
      "SPARK_MODEL_REJECTED",
      `Model "${model}" is prohibited (Codex Spark must not be used)`
    )
  }
  const timeoutMs =
    options.timeoutMs ?? (parseInt(process.env["HASNA_PROMPTS_DISPATCH_TIMEOUT_MS"] ?? "120000", 10) || 120000)
  const maxCaptureBytes =
    options.maxCaptureBytes ??
    (parseInt(process.env["HASNA_PROMPTS_DISPATCH_MAX_CAPTURE_BYTES"] ?? String(256 * 1024), 10) || 256 * 1024)
  const lockTtlSeconds =
    options.lockTtlSeconds ?? (parseInt(process.env["HASNA_PROMPTS_DISPATCH_LOCK_TTL"] ?? "1800", 10) || 1800)

  const { targets } = await discoverTargets(codewithBin)
  let target
  try {
    target = selectTarget(targets, options.target)
  } catch (error) {
    if (error instanceof DispatchError) {
      throw await recordDispatchFailure(run.id, error.code, error.message)
    }
    throw error
  }

  // Reserve the provider account before execution. Two profiles with the same
  // fingerprint are one account; a held lock means another lane is executing
  // on that account.
  let lockKey: string | null = null
  if (target.fingerprint) {
    lockKey = accountLockKey(target.provider ?? "unknown", target.fingerprint)
    const acquired = await acquireAccountLock(locksBin, lockKey, lockTtlSeconds)
    if (!acquired.acquired) {
      if (acquired.held) {
        throw await recordDispatchFailure(
          run.id,
          "LOCK_HELD",
          `Provider account for "${target.name}" is reserved by another dispatch lane`
        )
      }
      throw await recordDispatchFailure(
        run.id,
        "LOCK_FAILED",
        `Failed to reserve provider account for "${target.name}": ${acquired.error ?? "unknown"}`
      )
    }
  }

  mkdirSync(runsDir, { recursive: true })
  const job: CaptureJob = {
    runId: run.id,
    runsDir,
    codewithBin,
    locksBin,
    profile: target.name,
    model,
    cwd: options.cwd ?? process.cwd(),
    timeoutMs,
    maxCaptureBytes,
    lockKey,
    target: target.name,
  }
  const jobPath = capturePaths(runsDir, run.id).job
  writeFileSync(jobPath, JSON.stringify(job), { mode: 0o600 })

  run = updateDispatchRun(run.id, {
    status: "running",
    target: target.name,
    started_at: new Date().toISOString(),
  })

  let helper: ReturnType<typeof Bun.spawn>
  try {
    const helperPath = resolveHelperPath()
    helper = Bun.spawn([process.execPath, helperPath, "--job", jobPath], {
      cwd: process.cwd(),
      env: process.env,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    })
  } catch (error) {
    // The helper could not start; the run must not stay running forever.
    if (lockKey) {
      const release = await releaseAccountLock(locksBin, lockKey)
      if (!release.released) {
        console.error(`dispatch: failed to release account lock after helper failure: ${release.error ?? "unknown"}`)
      }
    }
    throw await recordDispatchFailure(
      run.id,
      "HELPER_SPAWN_FAILED",
      `Failed to start the dispatch capture helper: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const helperStdin = helper.stdin
  if (helperStdin === undefined || typeof helperStdin === "number") {
    if (lockKey) {
      const release = await releaseAccountLock(locksBin, lockKey)
      if (!release.released) {
        console.error(`dispatch: failed to release account lock: ${release.error ?? "unknown"}`)
      }
    }
    throw await recordDispatchFailure(run.id, "HELPER_SPAWN_FAILED", "dispatch capture helper stdin unavailable")
  }
  try {
    helperStdin.write(rendered)
  } finally {
    helperStdin.end()
  }

  const targetSummary = {
    name: target.name,
    provider: target.provider,
    plan: target.plan,
    health_status: target.health_status,
  }

  if (!options.wait) {
    return { run, target: targetSummary }
  }

  const exitCode = await helper.exited
  if (exitCode !== 0) {
    // Non-zero only signals "not succeeded"; the run row is the source of
    // truth for failed/cancelled details.
    const statusPath = capturePaths(runsDir, run.id).status
    if (existsSync(statusPath)) {
      try {
        readFileSync(statusPath, "utf8")
      } catch {
        // Fall through to the generic receipt.
      }
    }
  }
  run = requireDispatchRun(run.id)
  return { run, target: targetSummary }
}

/**
 * Cancel a running codewith run. Writes the cancel marker and terminates the
 * runtime child; the capture helper finalizes the run as cancelled.
 */
export function cancelDispatchRun(runId: string): { id: string; status: string } {
  const run = requireDispatchRun(runId)
  if (run.status !== "running") {
    throw new DispatchError("RUN_NOT_RUNNING", `Run ${runId} is not running (status: ${run.status})`)
  }
  const paths = capturePaths(defaultRunsDir(), runId)
  writeFileSync(paths.cancel, new Date().toISOString(), { mode: 0o600 })
  if (existsSync(paths.proc)) {
    try {
      const procInfo = JSON.parse(readFileSync(paths.proc, "utf8")) as { childPid: number }
      if (typeof procInfo.childPid === "number") {
        try {
          process.kill(procInfo.childPid, "SIGTERM")
        } catch {
          // Child already gone.
        }
        setTimeout(() => {
          try {
            process.kill(procInfo.childPid, "SIGKILL")
          } catch {
            // Already gone.
          }
        }, 3000)
      }
    } catch {
      // Malformed proc file — the helper still observes the cancel marker.
    }
  }
  return { id: runId, status: "cancelled" }
}

export function getRunReceipt(runId: string): { run: DispatchReceipt["run"] } {
  const run = getDispatchRun(runId)
  if (!run) throw new DispatchError("RUN_NOT_FOUND", `Dispatch run not found: ${runId}`)
  return { run }
}
