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
