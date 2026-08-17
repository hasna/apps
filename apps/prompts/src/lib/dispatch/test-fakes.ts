/**
 * Test-support fake codewith / conversations-locks binaries.
 *
 * The fake binaries read their behavior from a config file next to the script
 * (key=value lines), so they behave identically whether spawned with the full
 * parent environment (discovery, lock acquire/release) or the allowlisted
 * runtime environment (codewith exec).
 */

import { chmodSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

export interface FakeBins {
  dir: string
  codewithBin: string
  locksBin: string
  configFile: string
  heldFile: string
  execArgv: string
  execEnv: string
  execStdin: string
  locksLog: string
  setConfig(entries: Record<string, string | number | undefined>): void
  setUsageFixture(fixture: unknown): void
  cleanup(): void
}

const CODEWITH_SCRIPT = `#!/usr/bin/env bash
cfg="$(dirname "$0")/codewith.config"
[ -f "$cfg" ] && . "$cfg" || true
cmd="$1"
if [ "$cmd" = "usage" ]; then
  if [ -n "$FAKE_USAGE_FIXTURE" ]; then cat "$FAKE_USAGE_FIXTURE"; fi
  exit "\${FAKE_USAGE_EXIT:-0}"
fi
if [ "$cmd" = "exec" ]; then
  [ -n "$FAKE_EXEC_ARGV" ] && printf '%s\\n' "$@" > "$FAKE_EXEC_ARGV" || true
  [ -n "$FAKE_EXEC_ENV" ] && env > "$FAKE_EXEC_ENV" || true
  [ -n "$FAKE_EXEC_STDIN" ] && cat > "$FAKE_EXEC_STDIN" || true
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "-o" ] && [ -n "$FAKE_EXEC_LAST" ] && [ -n "$arg" ]; then
      printf '%s\\n' "$FAKE_EXEC_LAST" > "$arg" || true
    fi
    prev="$arg"
  done
  if [ -n "$FAKE_EXEC_STDOUT" ]; then printf '%s\\n' "$FAKE_EXEC_STDOUT"; fi
  if [ -n "$FAKE_EXEC_STDERR" ]; then printf '%s\\n' "$FAKE_EXEC_STDERR" >&2; fi
  if [ -n "$FAKE_EXEC_SLEEP" ]; then sleep "$FAKE_EXEC_SLEEP"; fi
  exit "\${FAKE_EXEC_EXIT:-0}"
fi
exit 1
`

const LOCKS_SCRIPT = `#!/usr/bin/env bash
cfg="$(dirname "$0")/locks.config"
[ -f "$cfg" ] && . "$cfg" || true
sub="$2"
key="$3"
if [ -n "$FAKE_LOCKS_LOG" ]; then printf 'locks %s %s\\n' "$sub" "$key" >> "$FAKE_LOCKS_LOG" || true; fi
if [ "$sub" = "acquire" ]; then
  if [ -n "$FAKE_LOCKS_HELD_FILE" ] && [ -f "$FAKE_LOCKS_HELD_FILE" ] && grep -qx "$key" "$FAKE_LOCKS_HELD_FILE" 2>/dev/null; then
    echo "held by another agent" >&2
    exit 2
  fi
  [ -n "$FAKE_LOCKS_HELD_FILE" ] && echo "$key" >> "$FAKE_LOCKS_HELD_FILE" || true
  exit "\${FAKE_LOCKS_ACQUIRE_EXIT:-0}"
fi
if [ "$sub" = "release" ]; then
  if [ -n "$FAKE_LOCKS_HELD_FILE" ] && [ -f "$FAKE_LOCKS_HELD_FILE" ]; then
    grep -vx "$key" "$FAKE_LOCKS_HELD_FILE" > "$FAKE_LOCKS_HELD_FILE.tmp" 2>/dev/null || true
    mv "$FAKE_LOCKS_HELD_FILE.tmp" "$FAKE_LOCKS_HELD_FILE" 2>/dev/null || true
  fi
  exit 0
fi
exit 1
`

export function createFakeBins(): FakeBins {
  const dir = mkdirSync(join(tmpdir(), `prompts-fakes-${process.pid}-${Date.now()}`), {
    recursive: true,
  }) as unknown as string
  const codewithBin = join(dir, "codewith")
  const locksBin = join(dir, "locks")
  const configFile = join(dir, "codewith.config")
  const locksConfigFile = join(dir, "locks.config")
  const heldFile = join(dir, "held.txt")
  const usageFixture = join(dir, "usage.json")
  const execArgv = join(dir, "exec-argv.txt")
  const execEnv = join(dir, "exec-env.txt")
  const execStdin = join(dir, "exec-stdin.txt")
  const locksLog = join(dir, "locks.log")

  writeFileSync(codewithBin, CODEWITH_SCRIPT)
  chmodSync(codewithBin, 0o755)
  writeFileSync(locksBin, LOCKS_SCRIPT)
  chmodSync(locksBin, 0o755)
  writeFileSync(heldFile, "")
  writeFileSync(
    configFile,
    configLines({
      FAKE_EXEC_ARGV: execArgv,
      FAKE_EXEC_ENV: execEnv,
      FAKE_EXEC_STDIN: execStdin,
    })
  )
  writeFileSync(locksConfigFile, configLines({ FAKE_LOCKS_HELD_FILE: heldFile, FAKE_LOCKS_LOG: locksLog }))

  return {
    dir,
    codewithBin,
    locksBin,
    configFile,
    heldFile,
    execArgv,
    execEnv,
    execStdin,
    locksLog,
    setConfig(entries) {
      // Merge: keep existing keys (e.g. FAKE_USAGE_FIXTURE) and update or add
      // only the given keys.
      const existing = new Map(
        readConfig(configFile).map((line) => {
          const eq = line.indexOf("=")
          if (eq === -1) return [line, ""]
          const raw = line.slice(eq + 1)
          const unquoted = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw
          return [line.slice(0, eq), unquoted]
        })
      )
      for (const [key, value] of Object.entries(entries)) {
        if (value === undefined) existing.delete(key)
        else existing.set(key, `'${String(value).replace(/'/g, "'\\''")}'`)
      }
      const lines = [...existing.entries()].map(([key, value]) => `${key}=${value}`)
      writeFileSync(configFile, lines.join("\n") + "\n")
    },
    setUsageFixture(fixture) {
      writeFileSync(usageFixture, typeof fixture === "string" ? fixture : JSON.stringify(fixture))
      const lines = readConfig(configFile).filter((line) => !line.startsWith("FAKE_USAGE_FIXTURE"))
      lines.push(`FAKE_USAGE_FIXTURE='${usageFixture}'`)
      writeFileSync(configFile, lines.join("\n") + "\n")
    },
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Best effort.
      }
    },
  }
}

function readConfig(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
  } catch {
    return []
  }
}

function configLines(entries: Record<string, string | number | undefined>): string {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}='${String(value).replace(/'/g, "'\\''")}'`)
    .join("\n") + "\n"
}

export interface FakeUsageTarget {
  name: string
  ok: boolean
  health: string | null
  plan?: string
  fingerprint?: string | null
  provider?: string
  displayName?: string
  profileName?: string | null
  reason?: string | null
}

export function usageFixture(targets: FakeUsageTarget[]): unknown {
  return {
    ok: targets.some((t) => t.ok),
    targets: targets.map((t) => ({
      target: {
        displayName: t.displayName ?? t.name,
        profileName: t.profileName === undefined ? (t.name === "root" ? null : t.name) : t.profileName,
        subscriptionProvider: t.provider ?? "chat-gpt",
      },
      authMode: "chatgpt",
      ok: t.ok,
      plan: t.plan ?? "Pro",
      rateLimits: {
        capturedAt: "2026-08-17T00:00:00Z",
        health: {
          status: t.health,
          remainingPercent: t.health === "healthy" ? 80 : null,
          resetsAt: null,
          reason: t.reason ?? (t.health === "healthy" ? null : "unsupported_or_missing_usage_windows"),
          usableLanes: [],
        },
      },
      spendStatus: { backendCredits: { reason: "ok", status: "ok" }, dollarSpend: { reason: "ok", status: "ok" } },
      redactedAccountId: t.fingerprint ?? null,
    })),
  }
}

/**
 * Synthetic fixture faithful to the shape and size of the REAL
 * `codewith usage --all --json` payload measured 2026-08-17 (81,511 bytes,
 * 28 targets; entry keys accounts/accountsError/authMode/error/ok/plan/
 * redactedAccountId/spendStatus/target; 20 entries with rateLimits whose
 * health.status is "unknown" + 2 usage snapshots each; 1 root entry with
 * profileName null; 24 entries with a non-empty redactedAccountId; 4 no-auth
 * entries with authMode null and no fingerprint). All values are synthetic;
 * only the shape, sizes, and field names are reproduced. Stringify with
 * 2-space indentation to reproduce the real payload's byte profile (the CLI
 * emits indented JSON).
 */
export function realShapeUsageFixture(): unknown {
  const spendStatusReported = {
    backendCredits: { reason: "included_in_rate_limit_snapshots", status: "backend_reported" },
    dollarSpend: { reason: "no_backend_dollar_spend_endpoint", status: "unavailable" },
  }
  const spendStatusUnavailable = {
    backendCredits: { reason: "no_backend_credit_or_spend_control_status", status: "unavailable" },
    dollarSpend: { reason: "no_backend_dollar_spend_endpoint", status: "unavailable" },
  }

  function usageSnapshot(index: number): unknown {
    return {
      credits: {
        remaining: 840 + (index % 7),
        resetsAt: "2026-08-18T00:00:00Z",
        total: 1000,
      },
      individual_limit: {
        remaining: 840 + (index % 7),
        total: 1000,
      },
      limit_id: `usage-limit-${String(index).padStart(4, "0")}`,
      limit_name: `chatgpt-usage-window-${String(index).padStart(4, "0")}`,
      plan_type: "pro",
      primary: {
        code: "rate_limit_exceeded",
        message: "rate limit exceeded for this usage window, retry later",
        retryAfterSeconds: 60,
      },
      rate_limit_reached_type: "none",
      secondary: [],
    }
  }

  function healthyEntry(index: number, profileName: string | null): unknown {
    const num = String(index).padStart(3, "0")
    return {
      target: {
        displayName: profileName === null ? "default" : `account${num}`,
        profileName,
        subscriptionProvider: "chat-gpt",
      },
      authMode: "chatgpt",
      ok: true,
      error: null,
      plan: "Pro",
      rateLimits: {
        capturedAt: "2026-08-17T08:00:00Z",
        health: {
          status: "unknown",
          reason: "unsupported_or_missing_usage_windows",
          remainingPercent: null,
          resetsAt: null,
          usableLanes: [],
        },
        snapshots: [usageSnapshot(index * 2), usageSnapshot(index * 2 + 1)],
      },
      spendStatus: spendStatusReported,
      redactedAccountId: `acct_fake_${String(index).padStart(6, "0")}`,
      accounts: [
        {
          default: true,
          name: `account${num}`,
          rateLimits: { capturedAt: "2026-08-17T08:00:00Z", health: { status: "unknown" } },
          redactedAccountId: `acct_fake_${String(index).padStart(6, "0")}`,
          spendStatus: spendStatusReported,
          structure: { provider: "chatgpt", plan: "Pro" },
        },
      ],
    }
  }

  function failedEntry(index: number, noAuth: boolean): unknown {
    const num = String(index).padStart(3, "0")
    return {
      target: {
        displayName: `account${num}`,
        profileName: `account${num}`,
        subscriptionProvider: "chat-gpt",
      },
      authMode: noAuth ? null : "chatgpt",
      ok: false,
      error: "x",
      plan: noAuth ? null : "Pro",
      spendStatus: spendStatusUnavailable,
      redactedAccountId: noAuth ? null : `acct_fake_${String(index).padStart(6, "0")}`,
      accounts: noAuth ? null : [],
      accountsError: noAuth ? { message: "no authenticated account for this target" } : null,
    }
  }

  const targets: unknown[] = []
  targets.push(healthyEntry(0, null)) // root entry: unnamed auth profile
  for (let i = 1; i <= 19; i++) targets.push(healthyEntry(i, `account${String(i).padStart(3, "0")}`))
  for (let i = 20; i <= 23; i++) targets.push(failedEntry(i, true))
  for (let i = 24; i <= 27; i++) targets.push(failedEntry(i, false))
  return { ok: false, targets }
}
