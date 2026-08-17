/**
 * Environment allowlist for dispatched runtimes.
 *
 * The dispatched runtime (the codewith exec child) is spawned with an
 * explicitly allowlisted environment. Everything not on this list is dropped
 * by construction, so credential-bearing variables in the parent environment
 * can never reach the runtime. Our own tool invocations (target discovery,
 * account-lock acquire/release) run with the parent environment — they are
 * part of the dispatcher, not the dispatched runtime.
 */

export const ALLOWED_CHILD_ENV = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "NO_COLOR",
] as const

export function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of ALLOWED_CHILD_ENV) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}
