/**
 * Codewith dispatch adapter (read-only).
 *
 * - Target discovery: `codewith usage --all --json` (provider-backed). Only
 *   safe projected fields are kept — profile names, availability, plan, and
 *   the opaque redactedAccountId fingerprint. Raw usage payloads are never
 *   persisted and never copied into run metadata.
 * - A target is usable only when the provider reports it healthy now
 *   (ok == true AND rateLimits.health.status == "healthy").
 * - The provider account is reserved through
 *   `conversations locks acquire codewith/provider-account/<provider>/<fingerprint>`
 *   before execution and released on terminal state. Two profiles with the
 *   same fingerprint are ONE account and are never reserved twice.
 * - Execution uses `codewith exec` with an argv array (never a shell string),
 *   a read-only sandbox, approval never, ephemeral sessions, structured JSON
 *   events, the rendered prompt on STDIN, and an allowlisted environment.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { boundAndRedact, TRUNCATED_MARKER } from "./redact.js"
import { DispatchError, type DispatchTarget } from "./types.js"

export const LOCK_KEY_PREFIX = "codewith/provider-account"

/**
 * Read bound for `codewith usage --all --json`. The real CLI emits ~2.9 KB
 * per target with indentation; a realistic population is tens of KB (measured
 * 2026-08-17: 81,511 bytes for 28 targets). 4096 bytes truncated real
 * populations mid-string and every dispatch/targets read failed with
 * TARGET_DISCOVERY_FAILED. 2 MiB covers the real population with headroom
 * while keeping the parse input bounded.
 */
export const USAGE_READ_MAX_BYTES = 2 * 1024 * 1024

export interface DiscoveredTarget extends DispatchTarget {}

export interface TargetDiscoveryResult {
  targets: DiscoveredTarget[]
  examined: number
  /** Bounded, redacted diagnostic when some targets could not be verified. */
  warning: string | null
}

export interface CapturedRun {
  exitCode: number | null
  signalCode: string | null
  stdout: string
  stderr: string
  /** True when the captured file exceeded the read bound and only its bounded head was read. */
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

/**
 * Run a short-lived dispatcher-side CLI (usage read, lock acquire/release)
 * with output redirected to temp files (capture-path discipline), read back
 * bounded and redacted, then deleted. Never persists raw output.
 */
async function runCaptured(
  argv: string[],
  timeoutMs: number,
  maxReadBytes: number
): Promise<CapturedRun> {
  const dir = mkdtempSync(join(tmpdir(), "prompts-cap-"))
  const outPath = join(dir, "out")
  const errPath = join(dir, "err")
  try {
    const proc = Bun.spawn(argv, {
      cwd: process.cwd(),
      env: process.env,
      stdout: Bun.file(outPath),
      stderr: Bun.file(errPath),
    })
    const killer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // Already gone.
      }
    }, timeoutMs)
    const exitCode = await proc.exited
    clearTimeout(killer)
    const stdout = await readBounded(outPath, maxReadBytes)
    const stderr = await readBounded(errPath, maxReadBytes)
    return {
      exitCode,
      signalCode: proc.signalCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort cleanup.
    }
  }
}

/**
 * Read a captured file bounded and redacted without ever materializing the
 * whole file in memory: when the file exceeds the byte bound, only the
 * bounded head is read (the JSON would then be mid-string and fail loudly,
 * which is the correct behavior for an over-bound population).
 */
async function readBounded(
  path: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  try {
    if (!existsSync(path)) return { text: "", truncated: false }
    const size = statSync(path).size
    if (size > maxBytes) {
      const sliced = await Bun.file(path).slice(0, maxBytes).arrayBuffer()
      const text = Buffer.from(sliced).toString("utf8")
      const bounded = boundAndRedact(text, maxBytes)
      return { text: bounded.text + TRUNCATED_MARKER, truncated: true }
    }
    return { text: boundAndRedact(readFileSync(path, "utf8"), maxBytes).text, truncated: false }
  } catch {
    return { text: "", truncated: false }
  }
}

/**
 * Discover codewith targets through the provider-backed population read.
 * `codewith usage --all` exits 2 when one or more targets could not be
 * verified while still returning a valid population; both 0 and 2 are
 * accepted. Raw payloads are projected to safe fields and never persisted.
 */
export async function discoverTargets(
  bin: string,
  timeoutMs = 30_000
): Promise<TargetDiscoveryResult> {
  const captured = await runCaptured([bin, "usage", "--all", "--json"], timeoutMs, USAGE_READ_MAX_BYTES)
  if (captured.exitCode !== 0 && captured.exitCode !== 2) {
    throw new DispatchError(
      "TARGET_DISCOVERY_FAILED",
      `codewith usage exited ${captured.exitCode ?? "signal " + String(captured.signalCode)}: ${captured.stderr.trim().slice(0, 300) || "no error output"}`
    )
  }
  const raw = captured.stdout
  if (raw.length === 0) {
    throw new DispatchError("TARGET_DISCOVERY_FAILED", "codewith usage returned no output")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    if (captured.stdoutTruncated) {
      throw new DispatchError(
        "TARGET_DISCOVERY_FAILED",
        `codewith usage output exceeded the ${USAGE_READ_MAX_BYTES}-byte read bound and could not be parsed`
      )
    }
    throw new DispatchError(
      "TARGET_DISCOVERY_FAILED",
      `codewith usage returned invalid JSON: ${captured.stderr.trim().slice(0, 200)}`
    )
  }
  const targets = projectTargets(parsed)
  const warning =
    captured.exitCode === 2 && captured.stderr.trim().length > 0
      ? captured.stderr.trim().slice(0, 2000)
      : null
  return { targets, examined: targets.length, warning }
}

/**
 * Project the raw usage payload onto the safe target surface. Never keep
 * account labels, raw auth payloads, token details, or uncontrolled fields.
 */
export function projectTargets(parsed: unknown): DiscoveredTarget[] {
  const targets: DiscoveredTarget[] = []
  if (typeof parsed !== "object" || parsed === null) return targets
  const root = parsed as { targets?: unknown }
  if (!Array.isArray(root.targets)) return targets
  for (const entry of root.targets) {
    if (typeof entry !== "object" || entry === null) continue
    const t = entry as Record<string, unknown>
    const targetObj =
      typeof t["target"] === "object" && t["target"] !== null
        ? (t["target"] as Record<string, unknown>)
        : ({} as Record<string, unknown>)
    const displayName = typeof targetObj["displayName"] === "string" ? targetObj["displayName"] : ""
    const profileName = typeof targetObj["profileName"] === "string" ? targetObj["profileName"] : null
    const provider =
      typeof targetObj["subscriptionProvider"] === "string"
        ? targetObj["subscriptionProvider"]
        : null
    const plan = typeof t["plan"] === "string" ? t["plan"] : null
    const ok = t["ok"] === true
    const health =
      typeof t["rateLimits"] === "object" && t["rateLimits"] !== null
        ? ((t["rateLimits"] as Record<string, unknown>)["health"] as Record<string, unknown> | undefined)
        : undefined
    const healthStatus = typeof health?.["status"] === "string" ? (health["status"] as string) : null
    const healthReason = typeof health?.["reason"] === "string" ? (health["reason"] as string) : null
    const fingerprint =
      typeof t["redactedAccountId"] === "string" && (t["redactedAccountId"] as string).length > 0
        ? (t["redactedAccountId"] as string)
        : null
    const name = profileName ?? (displayName.length > 0 ? displayName : null)
    if (!name) continue
    targets.push({
      name,
      profile_name: profileName,
      display_name: displayName,
      provider,
      plan,
      ok,
      health_status: healthStatus,
      health_reason: healthReason,
      available: ok && healthStatus === "healthy",
      fingerprint,
    })
  }
  return targets
}

export function isSparkModel(model: string): boolean {
  return model.toLowerCase().includes("spark")
}

/**
 * Select a healthy non-Spark target. An explicitly requested target must be
 * present and healthy; auto-selection prefers a named profile with a
 * fingerprint, never an unverified one.
 */
export function selectTarget(targets: DiscoveredTarget[], requested?: string): DiscoveredTarget {
  const usable = targets.filter((t) => t.available)
  if (requested) {
    const match = targets.find((t) => t.name === requested)
    if (!match) {
      throw new DispatchError("TARGET_NOT_FOUND", `No codewith target named "${requested}" was discovered`)
    }
    if (!match.available) {
      const reason = match.health_reason ?? match.health_status ?? "unknown"
      throw new DispatchError(
        "TARGET_NOT_AVAILABLE",
        `Codewith target "${requested}" is not healthy now (ok=${String(match.ok)}, health=${reason})`
      )
    }
    return match
  }
  // Auto-selection only considers named auth profiles (never the default/root
  // entry, whose --auth-profile name is unverified).
  const auto = usable.find((t) => t.profile_name !== null && t.fingerprint !== null)
  if (!auto) {
    throw new DispatchError(
      "NO_HEALTHY_TARGET",
      `No healthy codewith target available (examined ${targets.length}; usable ${usable.length})`
    )
  }
  return auto
}

export function accountLockKey(provider: string, fingerprint: string): string {
  return `${LOCK_KEY_PREFIX}/${provider}/${fingerprint}`
}

export interface AcquireLockResult {
  acquired: boolean
  held: boolean
  error?: string
}

/**
 * Acquire the provider-account reservation. Exit 0 = acquired, exit 2 = held
 * by another agent (documented contract of the installed conversations CLI).
 */
export async function acquireAccountLock(
  locksBin: string,
  key: string,
  ttlSeconds: number,
  timeoutMs = 30_000
): Promise<AcquireLockResult> {
  const captured = await runCaptured(
    [locksBin, "locks", "acquire", key, "--ttl", String(ttlSeconds)],
    timeoutMs,
    2048
  )
  if (captured.exitCode === 0) return { acquired: true, held: false }
  if (captured.exitCode === 2) {
    return { acquired: false, held: true, error: captured.stderr.trim().slice(0, 300) }
  }
  return {
    acquired: false,
    held: false,
    error: `locks acquire exited ${captured.exitCode ?? "signal " + String(captured.signalCode)}: ${captured.stderr.trim().slice(0, 300)}`,
  }
}

export interface ReleaseLockResult {
  released: boolean
  error?: string
}

/**
 * Release the provider-account reservation. Idempotent per the installed CLI
 * contract (exit 0 whether or not a lock was released).
 */
export async function releaseAccountLock(
  locksBin: string,
  key: string,
  timeoutMs = 30_000
): Promise<ReleaseLockResult> {
  const captured = await runCaptured([locksBin, "locks", "release", key], timeoutMs, 2048)
  if (captured.exitCode === 0) return { released: true }
  return {
    released: false,
    error: `locks release exited ${captured.exitCode ?? "signal " + String(captured.signalCode)}: ${captured.stderr.trim().slice(0, 300)}`,
  }
}

export function resolveBin(name: string, envOverride: string | undefined, required: string): string {
  const override = envOverride
  if (override) return override
  if (typeof Bun.which === "function") {
    const found = Bun.which(name)
    if (found) return found
  }
  throw new DispatchError(`${required}_BIN_NOT_FOUND`, `${name} binary not found on PATH`)
}
