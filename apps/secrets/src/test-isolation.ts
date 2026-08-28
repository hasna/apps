// Structural isolation between a test process and any REAL secrets vault.
//
// THE INCIDENT THIS EXISTS FOR (HC-00304, measured 2026-07-27). This repo's own
// test suite wrote fixtures into the hosted production vault, four separate runs,
// and destroyed two production secrets when a fixture key name drifted onto a real
// one. The mechanism was not exotic: `getStore()` resolves its transport from the
// ambient process environment, and a fleet machine's environment carries
// HASNA_SECRETS_STORAGE_MODE + HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY. Tests
// set OPEN_SECRETS_DB — which only ever steered LocalStore — and were then trusted
// by convention to stay local. Anything reaching src/env.ts or src/aws.ts, both of
// which call `getStore()` internally, went to production instead.
//
// THE PROPERTY THIS MODULE PROVIDES. A test process must be structurally incapable
// of reaching a real vault, not merely trusted not to:
//
//   * FAILS CLOSED. Reaching a non-loopback vault host from a test process throws
//     `SecretsTestIsolationError`. It does not warn, downgrade, or proceed.
//   * NO OPT-IN. Test-context detection comes from the runner (the preload marker,
//     NODE_ENV=test) and the entrypoint filename, never from anything a test author
//     has to remember to write. Forgetting to configure isolation cannot disable it.
//   * AMBIENT-ENV RESISTANT. There is deliberately NO environment variable that
//     turns this off, and no host allowlist that the environment can extend. The
//     one env key read here (HASNA_SECRETS_TEST_ISOLATION) can only turn the guard
//     ON. An environment that has been poisoned cannot un-poison the guard.
//
// TWO PREDICATES, NOT ONE — AND THE REASON IS THE INCIDENT ITSELF. A guard that
// throws and a guard that silently swaps a file path are not the same kind of thing
// and must not share a trigger:
//
//   * `isTestContext()`   — broad, incl. bare NODE_ENV. Gates the LOUD guards
//     (network egress, explicit-path refusal). Over-triggering costs an error
//     message that names its own cause.
//   * `isTestVaultRedirectContext()` — narrow: preload marker or a `*.test.ts`
//     entrypoint. Gates the SILENT filesystem redirect. Over-triggering costs
//     discarded writes and empty reads at exit code 0, which is the failure mode
//     this file was written to eliminate — so bare NODE_ENV is not enough for it.
//
// SAFETY NOTE ON MEASUREMENT: `env -i` and `env -u VAR cmd` do NOT sanitize a bash
// child on the Hasna fleet — a login shell re-sources the fleet profile and restores
// ~61 HASNA_* variables, so a test believed to be running credential-free is not.
// That is why the guard lives in-process rather than in a wrapper script.

import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { effectiveOperatorDataDir } from "./data-dir.js";

/** Thrown when a test process tries to reach a real vault. Never carries a value. */
export class SecretsTestIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsTestIsolationError";
  }
}

/**
 * Set to "1" by the test preload (tests/setup/isolate-vault.ts). It can only force
 * the guard ON; there is no value that turns it off.
 */
export const TEST_ISOLATION_ENV_KEY = "HASNA_SECRETS_TEST_ISOLATION";

const TEST_ENTRYPOINT_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

type EnvLike = Record<string, string | undefined>;

/** True when the entrypoint of this process is itself a test file. */
function hasTestEntrypoint(): boolean {
  const entry = (typeof Bun !== "undefined" ? Bun.main : undefined) || process.argv[1];
  return typeof entry === "string" && TEST_ENTRYPOINT_RE.test(entry);
}

/**
 * True when this process is an automated test run, for the purposes of the guards
 * that FAIL LOUDLY: the network egress guard and the explicit-vault-path refusal.
 *
 * Deliberately broad. `NODE_ENV=test` is included because every JS test runner sets
 * it across its whole process tree, so it catches a CLI child spawned by a foreign
 * suite that inherited nothing else. Being broad is safe *here* precisely because
 * the consequence is a thrown `SecretsTestIsolationError` — a false positive is a
 * loud, diagnosable error, never a quiet wrong answer.
 *
 * Do NOT use this to select a file path. See {@link isTestVaultRedirectContext}.
 */
export function isTestContext(env: EnvLike = process.env): boolean {
  if (env[TEST_ISOLATION_ENV_KEY] === "1") return true;
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "test") return true;
  return hasTestEntrypoint();
}

/**
 * True when this process may have its vault FILES silently redirected to a
 * throwaway location.
 *
 * Narrower than {@link isTestContext} on purpose, and the difference is the whole
 * point. Redirecting a file path is a SILENT act: the caller still gets exit code 0,
 * reads just come back empty and writes are discarded after printing success. Under
 * `NODE_ENV=test` alone that turned the production CLI into a data-loss device — any
 * foreign suite that shells out to `secrets get` concludes the credential is missing,
 * and `secrets set` reports "✓ Stored" for a value it threw away. That is the same
 * silent-failure shape this module exists to abolish, so bare `NODE_ENV` does not
 * qualify.
 *
 * The two accepted signals both mean "this process is genuinely part of a test run",
 * not merely "something upstairs exported NODE_ENV":
 *
 *   * the preload marker, set only by tests/setup/isolate-vault.ts; and
 *   * an entrypoint that is itself a test file — which, measured on bun 1.3.14, is
 *     what `bun test` sets `Bun.main` to for every file it runs.
 *
 * Because `bun test` supplies BOTH, this repo's own suite keeps the full guarantee
 * even if bunfig.toml is deleted. What a process with only `NODE_ENV=test` loses is
 * the silent redirect — it now reads and writes the real local vault, exactly as the
 * operator asked, while the hosted vault stays barred by the loud network guard.
 */
export function isTestVaultRedirectContext(env: EnvLike = process.env): boolean {
  if (env[TEST_ISOLATION_ENV_KEY] === "1") return true;
  return hasTestEntrypoint();
}

/** True for hosts that can only be this machine (the only vaults a test may reach). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function requestTarget(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && typeof (input as { url?: unknown }).url === "string") {
    return (input as { url: string }).url;
  }
  return null;
}

/**
 * Refuse, from a test process, to contact a vault that is not on this machine.
 * No-op outside a test context. Reports the hostname only — never a URL that could
 * carry credentials in its userinfo or query.
 */
export function assertTestNetworkTargetAllowed(input: unknown, env: EnvLike = process.env): void {
  if (!isTestContext(env)) return;

  const target = requestTarget(input);
  let hostname: string | null = null;
  if (target !== null) {
    try {
      hostname = new URL(target).hostname;
    } catch {
      hostname = null;
    }
  }
  if (hostname === null) {
    throw new SecretsTestIsolationError(
      "Test isolation: refusing a vault request whose target could not be parsed as a URL. " +
        "A test process may only reach a loopback vault.",
    );
  }
  if (isLoopbackHost(hostname)) return;

  throw new SecretsTestIsolationError(
    `Test isolation: refusing to contact the vault at '${hostname}' from a test process. ` +
      "A test may only reach a loopback vault (localhost / 127.0.0.0/8 / ::1). " +
      "This is the guard for HC-00304, where the suite wrote fixtures into the hosted " +
      "production vault. If a test needs a hosted transport, inject a fake `fetchImpl` " +
      "instead of pointing the real one at a remote host.",
  );
}

/**
 * The real fetch, wrapped so a test process cannot send a vault request off-box.
 * Used as the DEFAULT transport fetch, so the protection applies to every caller
 * that has not deliberately injected its own (a caller with its own `fetchImpl`
 * performs no real network I/O).
 */
export const guardedFetch = (input: string, init?: RequestInit): Promise<Response> => {
  assertTestNetworkTargetAllowed(input);
  return fetch(input, init);
};

/**
 * The on-box vault a real operator uses. Never touched from a test process.
 * Routes through `data-dir.ts` so the guard follows the SAME effective data
 * dir the operator's reads/writes use (the `@hasna/paths` XDG data home once
 * adopted, otherwise the legacy `~/.hasna/secrets` default).
 */
export function operatorVaultDir(): string {
  return effectiveOperatorDataDir();
}

/** Per-process throwaway vault directory used when a test configures nothing. */
export function testVaultDir(): string {
  return join(tmpdir(), `hasna-secrets-test-vault-${process.pid}`);
}

/** Vault database a test process gets when it sets no path of its own. */
export function testVaultPath(): string {
  return join(testVaultDir(), "vault.db");
}

/** Encryption-key directory a test process gets when it sets no path of its own. */
export function testKeyDir(): string {
  return join(testVaultDir(), "keys");
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Refuse, from a test process, an EXPLICIT vault path that points into the
 * operator's own vault directory. A test that sets no path at all is redirected to
 * {@link testVaultPath} instead — forgetting to configure isolation must not be a
 * way to reach real data.
 */
export function assertTestVaultPathAllowed(path: string, env: EnvLike = process.env): void {
  if (!isTestContext(env)) return;
  if (path === ":memory:") return;
  if (!isInside(path, operatorVaultDir())) return;

  throw new SecretsTestIsolationError(
    "Test isolation: refusing to open the operator's own vault directory " +
      `(${operatorVaultDir()}) from a test process. Point HASNA_SECRETS_DB_PATH at a ` +
      "temporary directory, or set nothing and take the throwaway per-process vault.",
  );
}
