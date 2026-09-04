// ============================================================================
// API-key HTTPS client routing (self-hosted cloud, NO DSN on clients).
//
// Mission constraint (project CLAUDE.md, NON-NEGOTIABLE): fleet clients must
// reach the self-hosted cloud store over HTTPS with a bearer API key —
// `Authorization: Bearer <key>` against `https://<app>.hasna.xyz/v1`. The raw
// RDS DSN is NEVER distributed to client machines. This module is the sanctioned
// client transport: it turns the core memory operations (create/get/list/
// update/delete/search) into authed HTTP calls against the cloud server, which
// runs the exact same domain logic against cloud Postgres.
//
// Activation is fail-safe and reversible:
//   - API mode is ON  when BOTH `HASNA_MEMENTOS_API_URL` and
//     `HASNA_MEMENTOS_API_KEY` are set (aliases `MEMENTOS_API_URL` /
//     `MEMENTOS_API_KEY` accepted) AND no DATABASE_URL is present.
//   - API mode is OFF when NEITHER is set → pure local SQLite, the documented
//     single-operator default.
//   - Exactly ONE of them set is an ERROR, never a fall-back. Until 2026-07-30
//     this case silently resolved to local SQLite, and that fall-back was
//     documented here as intended behaviour. It was the defect: an operator whose
//     API key failed to load got a different, usually stale, dataset with no error
//     and no flag, which from the caller's side is indistinguishable from a store
//     that is working. See `assertUnambiguousStoreEnv` for the precedence table.
//   - If a DATABASE_URL is set, API mode refuses to engage (a DSN on a client
//     is forbidden; the operator must remove it). This keeps the two transports
//     mutually exclusive and never silently mixes them.
//
// Transport: a synchronous HTTP request via `Bun.spawnSync(["curl", …])`. The
// domain functions in this codebase are synchronous, so the client transport
// must be too. curl is spawned DIRECTLY (no `bash -c`), and the bearer key is
// fed to curl on stdin via `-H @-` (curl reads one header line per stdin line).
// The key therefore never appears in argv (`ps`/`/proc/<pid>/cmdline`) nor in
// the child's environment, and is never logged. The request body, when present,
// is written to a private 0600 temp file passed as `--data-binary @<file>` and
// removed immediately after the call, so it never touches argv either.
// ============================================================================

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";
import { resolveMementosApiBase } from "../sdk/index.js";

export interface ApiConfig {
  baseUrl: string; // normalized, includes the /v1 (or /api) prefix, no trailing slash
  apiKey: string;
}

// The env keys that select the transport, exported so callers can enumerate
// them instead of copying them. Their mere PRESENCE moves the store off local
// SQLite (see {@link isApiMode}), so anything that must guarantee a local store
// — notably the subprocess test harnesses — has to neutralize exactly this set.
// A hand-maintained copy of the list in a harness is the failure mode this
// guards: it silently stops covering the resolver the moment a key is added
// here. Keep the lists adjacent to the code that reads them.
export const API_URL_ENV_KEYS = ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL"] as const;
export const API_KEY_ENV_KEYS = ["HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"] as const;
export const DATABASE_URL_ENV_KEYS = ["HASNA_MEMENTOS_DATABASE_URL", "MEMENTOS_DATABASE_URL"] as const;

function firstEnv(keys: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** The env key that supplied a value, or `null`. Never returns the value. */
function firstEnvKey(keys: readonly string[], env: NodeJS.ProcessEnv = process.env): string | null {
  for (const k of keys) {
    if (env[k]?.trim()) return k;
  }
  return null;
}

function hasDatabaseUrl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(firstEnv(DATABASE_URL_ENV_KEYS, env));
}

/**
 * Which env keys currently select API mode, by name only — never the values.
 * Used by the operator-facing mode report so a human can see *why* the client
 * is pointed at the cloud without reading source or echoing a credential.
 */
export function getApiModeEnvSources(): { urlKey: string | null; keyKey: string | null; databaseUrlKey: string | null } {
  return {
    urlKey: firstEnvKey(API_URL_ENV_KEYS),
    keyKey: firstEnvKey(API_KEY_ENV_KEYS),
    databaseUrlKey: firstEnvKey(DATABASE_URL_ENV_KEYS),
  };
}

/**
 * What the environment CONFIGURES, regardless of which store finally wins.
 *
 * Distinct from {@link getApiConfig}, which answers "may I build a cloud
 * request?" and returns null once an explicit DB_PATH outranks the credentials
 * (precedence 1). An operator report needs both halves separately: conflating
 * them prints "no API key configured" at someone whose key is configured and
 * merely outranked, which points them at a credential problem they do not have.
 *
 * Never returns a credential value — the endpoint is not secret, the key is
 * reported only as a boolean.
 */
export function getConfiguredApiEnv(): {
  baseUrl: string | null;
  apiKeyPresent: boolean;
  dbPathKey: string | null;
} {
  const rawBase = firstEnv(API_URL_ENV_KEYS);
  return {
    baseUrl: rawBase ? normalizeBase(rawBase) : null,
    apiKeyPresent: Boolean(firstEnvKey(API_KEY_ENV_KEYS)),
    dbPathKey: firstEnvKey(DB_PATH_ENV_KEYS),
  };
}

/**
 * Escape hatch for a test that genuinely must reach a non-loopback endpoint.
 * Opt-in by design: the default has to be safe, because the failure it prevents
 * is silent and lands in a shared store.
 */
export const ALLOW_REMOTE_API_IN_TESTS_ENV = "MEMENTOS_ALLOW_REMOTE_API_IN_TESTS";

/** Hosts that cannot be anything but this machine. */
function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

/**
 * Refuse an outbound cloud request from a test process unless it is loopback.
 *
 * The `bun test` preload clears the store selectors ONCE at process start. That
 * leaves two measured gaps, both of which end in a request from a test process
 * to the shared production store:
 *
 *   - a test file that sets a selector at MODULE SCOPE re-arms API mode after
 *     the preload has already run and finished; and
 *   - `bunfig.toml` is resolved from the cwd and bun does not walk up, so
 *     `cd src/db && bun test <file>` runs with no preload at all.
 *
 * Neither is visible to a process-start check or to a static repo sweep, so the
 * check belongs here — at the one point every cloud read and write funnels
 * through, evaluated when the request is actually made. Loopback stays allowed
 * so the suites that drive a local stub server are unaffected.
 */
function assertRequestAllowedUnderTest(baseUrl: string): void {
  if (process.env["NODE_ENV"] !== "test") return;
  if (process.env[ALLOW_REMOTE_API_IN_TESTS_ENV]?.trim()) return;

  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = "";
  }
  if (host && isLoopbackHost(host)) return;

  throw new Error(
    "api-mode: REFUSING to make a cloud request from a test process — this would write to or read " +
      "from the SHARED PRODUCTION memory store, where test fixtures are indistinguishable from real " +
      "memories.\n" +
      `  host           : ${host || "(unparseable base URL)"}\n` +
      `  how this happens: a selector set at module scope (after the bun test preload ran), or \`bun test\` ` +
      "invoked from a directory with no bunfig.toml so the preload never loaded.\n" +
      "  fix            : build the child/process env via src/test-support/store-isolation.ts, or point the " +
      "suite at a loopback stub.\n" +
      `  override       : set ${ALLOW_REMOTE_API_IN_TESTS_ENV}=1 only for a test that must reach a remote endpoint.`,
  );
}

/**
 * Normalize a configured base URL to always carry a `/v1` (or `/api`) prefix.
 *
 * Delegates to the SDK resolver so the CLI transport and `@hasna/mementos/sdk`
 * cannot drift apart. That matters for more than tidiness: this function used
 * to be a bare string concatenation with NO validation, so a base carrying a
 * query, fragment, userinfo or a non-http(s) scheme was pasted straight into
 * the request URL — `https://api.hasna.com/mementos?debug=1` became
 * `https://api.hasna.com/mementos?debug=1/v1/memories`, where the intended
 * path is silently query data and the request lands on the wrong route, and
 * `https://user:pass@…` carried operator credentials into every printed
 * endpoint line. The SDK half was hardened in hasna/apps#1763; this is the
 * same defect on the path the `mementos` CLI actually takes (hasna/apps#1601).
 *
 * Invalid input now throws rather than resolving to a wrong-but-plausible URL:
 * a misconfigured endpoint must fail closed, exactly like a half-configured
 * credential pair does in {@link assertUnambiguousStoreEnv}.
 */
function normalizeBase(raw: string): string {
  const { baseUrl, prefix } = resolveMementosApiBase(raw);
  return `${baseUrl}${prefix}`;
}

/** Resolve the API client config from env, or `null` when not configured. */
/** The env keys that explicitly select the local SQLite store. */
export const DB_PATH_ENV_KEYS = ["HASNA_MEMENTOS_DB_PATH", "MEMENTOS_DB_PATH"] as const;

/** Raised when the environment does not unambiguously select one store. */
export class MementosStoreConfigError extends Error {
  readonly code = "MEMENTOS_STORE_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "MementosStoreConfigError";
  }
}

/**
 * Throw unless the environment unambiguously selects one store.
 *
 * AMBIGUOUS CONFIGURATION IS AN ERROR, NOT A DEFAULT. Half an API configuration
 * used to resolve to `null`, which every caller read as "local SQLite" — so an
 * operator whose API key failed to load silently got a different, usually stale,
 * dataset with no error and no flag. From the caller's side that is
 * indistinguishable from a store that is working.
 *
 * THIS FUNCTION ONLY ASSERTS. It returns `void`, so it cannot select anything —
 * the precedence table below describes the RESOLVER, which is `getApiConfig()`
 * immediately after it, and each early `return` here only suppresses the
 * ambiguity error for a case that is already unambiguous. Steps 1 and 2 are
 * therefore implemented in `getApiConfig()` and `isApiMode()` respectively, and
 * the table is documented here because this is where the error text lives.
 *
 * Keeping the table honest about that is not cosmetic. Until 2026-08-03 step 1
 * was implemented NOWHERE: the `return` below reads as a selection, and an
 * operator who read it concluded that a scratch DB_PATH made them safe while a
 * fully-configured environment still routed every read and write to the shared
 * production store.
 *
 * Precedence, highest first:
 *  0. A retired storage-mode variable (HASNA_MEMENTOS_STORAGE_MODE or any of
 *     its aliases) throws via `assertNoLegacyStorageMode`, even when blank.
 *     Deployment modes no longer exist; a stale variable is an error, never a
 *     selector. ENFORCED HERE, before anything else.
 *  1. An explicit SQLite path (`HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH`) is
 *     the narrowest, most specific signal and selects LOCAL, so local dev,
 *     tooling and import/export keep working when a stray credential is exported
 *     globally. ENFORCED in `getApiConfig()`, which returns null for it.
 *  2. A client DSN present disables API mode. ENFORCED in `isApiMode()`. A DSN
 *     on a client is forbidden and is tracked separately in database.ts.
 *  3. Both API URL and API key present -> API mode.
 *  4. Exactly ONE of them present -> ERROR naming the missing variable.
 *  5. Neither present -> no transport selected. This used to resolve to LOCAL
 *     (the "documented single-operator default"); since the 2026-09-04 fail-closed
 *     ruling a client that needs the store REFUSES instead — an explicit
 *     DB_PATH (step 1) is now the only way into the on-box SQLite store, and
 *     `assertClientStoreConfigured()` (below) enforces that at every entry point
 *     that would otherwise open the default local file.
 *
 * Never reads, logs, or embeds a credential value — only variable NAMES.
 */
export function assertUnambiguousStoreEnv(env: NodeJS.ProcessEnv = process.env): void {
  // 0. The fail-loud ratchet: a retired storage-mode variable is an error,
  //    never a hint. This must run BEFORE everything else so a stale variable
  //    does not get rescued by a DB path, a DSN, or a complete API pair.
  assertNoLegacyStorageMode(env);
  // 1. Explicit local path: unambiguous, so there is no error to raise. The
  // SELECTION itself happens in getApiConfig(); this return only skips the
  // half-configured check below, which would otherwise fire on a stray API URL.
  if (firstEnvKey(DB_PATH_ENV_KEYS, env)) return;
  if (hasDatabaseUrl(env)) return; // 2. unchanged DSN behaviour

  const urlKey = firstEnvKey(API_URL_ENV_KEYS, env);
  const keyKey = firstEnvKey(API_KEY_ENV_KEYS, env);

  if (urlKey && !keyKey) {
    throw new MementosStoreConfigError(
      `${urlKey} points at the cloud memory store but ${API_KEY_ENV_KEYS[0]} is not set. ` +
        `Refusing to serve the on-box SQLite store in its place, because it holds a different ` +
        `dataset. Set ${API_KEY_ENV_KEYS[0]} to reach the cloud store. If you meant to use the ` +
        `on-box SQLite store, unset ${urlKey} or set ${DB_PATH_ENV_KEYS[0]} explicitly.`,
    );
  }
  if (keyKey && !urlKey) {
    throw new MementosStoreConfigError(
      `${keyKey} is set but ${API_URL_ENV_KEYS[0]} is not, so the cloud memory store cannot be ` +
        `reached. Refusing to serve the on-box SQLite store in its place, because it holds a ` +
        `different dataset. Set ${API_URL_ENV_KEYS[0]} to reach the cloud store. If you meant to ` +
        `use the on-box SQLite store, unset ${keyKey} or set ${DB_PATH_ENV_KEYS[0]} explicitly.`,
    );
  }
}

/**
 * FAIL-CLOSED store gate (owner ruling 2026-09-04, fleet fail-closed wave).
 *
 * The transport rules above answer "which store is configured?" and treat
 * "none" as a question, not an answer: `isApiMode()` returns false and
 * `getApiConfig()` returns null, and every domain call site reads that as
 * "open the local store". That was the defect: a fleet CLI run WITHOUT its API
 * env (`HASNA_MEMENTOS_API_URL` + `HASNA_MEMENTOS_API_KEY`, aliases
 * `MEMENTOS_API_URL` / `MEMENTOS_API_KEY`) silently opened the default on-box
 * SQLite store (~/.hasna/mementos/mementos.db), served it as if it were the
 * memory store, and exited 0 — a false green against a different dataset.
 *
 * This function is the guard every store-access entry point calls BEFORE it
 * may open the default local file (CLI command startup, `getDatabase()`
 * default-path fallthrough, ...). It throws unless one of these is true:
 *
 *   - the retired storage-mode ratchet / half-an-API-pair errors above apply
 *     first (assertUnambiguousStoreEnv), or
 *   - an explicit SQLite path is set (`HASNA_MEMENTOS_DB_PATH` /
 *     `MEMENTOS_DB_PATH`) — the documented EXPLICIT LOCAL OPT-IN, or
 *   - a client DSN is present (its own server-only guard already fails closed
 *     in getDatabase; the DSN tier is untouched here), or
 *   - BOTH API URL and API key are present (fleet API mode).
 *
 * Anything else — no API env, no opt-in — is a REFUSAL, never a local default.
 * Never reads, logs, or embeds a credential value — only variable NAMES.
 */
export function assertClientStoreConfigured(env: NodeJS.ProcessEnv = process.env): void {
  // Retired storage-mode vars, an explicit local path, a DSN, and a half API
  // pair are all handled by the ambiguity resolver (steps 0–2 return early,
  // step 4 throws). Only the unconfigured case reaches the refusal below.
  assertUnambiguousStoreEnv(env);
  if (firstEnvKey(DB_PATH_ENV_KEYS, env)) return; // explicit local opt-in
  if (hasDatabaseUrl(env)) return; // client DSN — fails closed in its own guard
  if (firstEnv(API_URL_ENV_KEYS, env) && firstEnv(API_KEY_ENV_KEYS, env)) return; // fleet API mode
  throw new MementosStoreConfigError(
    "mementos is not configured to reach any memory store, and will NOT fall back to the " +
      "on-box SQLite store (~/.hasna/mementos/mementos.db). Set " +
      `${API_URL_ENV_KEYS[0]} and ${API_KEY_ENV_KEYS[0]} (aliases ` +
      `${API_URL_ENV_KEYS[1]} and ${API_KEY_ENV_KEYS[1]} are accepted) to use the fleet memory ` +
      `API, or opt into an explicit local SQLite file with ${DB_PATH_ENV_KEYS[0]} / ` +
      `${DB_PATH_ENV_KEYS[1]}.`,
  );
}

export function getApiConfig(): ApiConfig | null {
  assertUnambiguousStoreEnv();

  // Precedence 1, ACTUALLY APPLIED. Until 2026-08-03 this rule existed only in
  // the docstring on assertUnambiguousStoreEnv: that function returns `void`, so
  // its `if (firstEnvKey(DB_PATH_ENV_KEYS)) return;` exits the ERROR CHECK and
  // selects nothing. An explicit local path therefore suppressed the
  // half-configured error but did NOT stop a fully-configured environment from
  // routing to the cloud — so an operator who set a scratch DB_PATH by hand,
  // read the precedence table, and concluded they were isolated was still
  // reading and writing the shared production store, silently and successfully.
  //
  // The guard lives HERE rather than in isApiMode() on purpose. getApiConfig()
  // is the single chokepoint every cloud read and write funnels through
  // (apiRequestRaw calls it and cannot build a request without it), whereas
  // isApiMode() is a mode check that 30+ domain call sites must each remember to
  // consult. This file already made exactly that call once, for the same reason
  // — see assertRequestAllowedUnderTest, which was placed in the transport
  // rather than at process start because a check one layer up left gaps.
  if (firstEnvKey(DB_PATH_ENV_KEYS)) return null;

  const rawBase = firstEnv(API_URL_ENV_KEYS);
  const apiKey = firstEnv(API_KEY_ENV_KEYS);
  if (!rawBase || !apiKey) return null;
  return { baseUrl: normalizeBase(rawBase), apiKey };
}

/**
 * True when the client should route memory operations to the cloud API.
 * Fail-closed against a client-side DSN: if DATABASE_URL is present, API mode
 * refuses to engage so the two transports never mix.
 */
export function isApiMode(): boolean {
  if (hasDatabaseUrl()) return false;
  return getApiConfig() !== null;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface RawResponse {
  status: number;
  body: string;
}

const DEFAULT_TIMEOUT_S = "45";

/**
 * Synchronous authed HTTP request to the cloud API. Returns the raw status +
 * body. The bearer key is fed to curl on stdin (`-H @-`) so it never appears in
 * argv or the environment. The body (if any) is written to a private 0600 temp
 * file and passed as `--data-binary @file` so it never appears in argv either.
 */
function apiRequestRaw(method: string, path: string, body?: unknown): RawResponse {
  const cfg = getApiConfig();
  if (!cfg) throw new Error("api-mode: not configured (HASNA_MEMENTOS_API_URL / HASNA_MEMENTOS_API_KEY)");

  // Fail closed before anything leaves the process. See the function's comment
  // for the two preload bypasses this exists to catch.
  assertRequestAllowedUnderTest(cfg.baseUrl);

  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const hasBody = body !== undefined && body !== null;
  const timeout = process.env["HASNA_MEMENTOS_API_TIMEOUT"] || DEFAULT_TIMEOUT_S;

  // Secret headers are read by curl from stdin via `-H @-` (one header per
  // line). The key is NEVER placed on argv or in the process environment, so it
  // cannot leak via `ps` / `/proc/<pid>/cmdline` / `/proc/<pid>/environ`.
  const headerLines = `Authorization: Bearer ${cfg.apiKey}\nx-api-key: ${cfg.apiKey}\n`;

  // Only non-secret values ever reach argv (method, url, timeout, static headers).
  const args = [
    "curl",
    "-sS",
    "--fail-with-body",
    "-m",
    timeout,
    "-X",
    method,
    "-H",
    "@-", // read the auth headers from stdin
    "-H",
    "Content-Type: application/json",
    "-H",
    "Accept: application/json",
    "-w",
    "\\n%{http_code}",
  ];

  let bodyFile: string | undefined;
  if (hasBody) {
    bodyFile = join(tmpdir(), `mem-req-${process.pid}-${randomUUID()}.json`);
    writeFileSync(bodyFile, JSON.stringify(body), { mode: 0o600 });
    args.push("--data-binary", `@${bodyFile}`);
  }
  args.push(url);

  // Hand curl an environment with the key vars stripped, so the secret is not
  // even present in the child's `/proc/<pid>/environ` (it travels only on stdin).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "HASNA_MEMENTOS_API_KEY" || k === "MEMENTOS_API_KEY") continue;
    childEnv[k] = v;
  }

  let out = "";
  let err = "";
  try {
    const proc = Bun.spawnSync(args, {
      stdin: Buffer.from(headerLines),
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv,
    });
    out = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
    err = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
  } finally {
    if (bodyFile) {
      try {
        unlinkSync(bodyFile);
      } catch {
        // temp file already gone — nothing to clean up
      }
    }
  }

  // curl exit 7/28/etc → transport failure (server unreachable / timeout).
  // With --fail-with-body, a non-2xx still returns exit!=0 but we parse the code.
  const nl = out.lastIndexOf("\n");
  const codeStr = nl >= 0 ? out.slice(nl + 1).trim() : "";
  const respBody = nl >= 0 ? out.slice(0, nl) : out;
  const status = parseInt(codeStr, 10);

  if (!Number.isFinite(status) || status === 0) {
    throw new ApiRequestError(
      `mementos cloud request failed (${method} ${path}): ${err.trim() || "no HTTP status"}`,
      0,
      respBody,
    );
  }
  return { status, body: respBody };
}

export interface ApiJsonOptions {
  /**
   * Treat `404` as a normal outcome and return `{status: 404, data: undefined}`
   * instead of throwing. ONLY for callers where "absent" is a real answer —
   * a GET of one record by id, a DELETE that tolerates an already-gone row, or
   * a call that has an explicit fallback for a route an older server image does
   * not serve yet (see `runCleanupViaApi`).
   *
   * It must never be set on a create/upsert path. A 404 there means the route
   * did not exist on the server (client/server version skew, wrong base URL),
   * so nothing was written; returning success-shaped data made the CLI print
   * "Saved:" and exit 0 having persisted nothing. Default is fail-closed.
   */
  allow404?: boolean;
}

/**
 * Authed JSON request. Throws {@link ApiRequestError} on every non-2xx,
 * including 404, unless the caller opts into 404 pass-through via
 * {@link ApiJsonOptions.allow404}.
 */
export function apiJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiJsonOptions,
): { status: number; data: T } {
  const raw = apiRequestRaw(method, path, body);
  if (raw.status >= 200 && raw.status < 300) {
    let data: T;
    if (raw.body.trim()) {
      try {
        data = JSON.parse(raw.body) as T;
      } catch (e) {
        // The CLI's own stdout is the data contract for structured commands, so
        // an internal failure must never read as "the CLI produced unparseable
        // output". A truncated 2xx body (proxy cap, server crash mid-write) is
        // a CLOUD failure: name it as one, with the remedy.
        throw new ApiRequestError(
          `mementos cloud ${method} ${path} returned status ${raw.status} with a body that is not valid JSON (${e instanceof Error ? e.message : String(e)}) — the response is truncated or the server is unhealthy`,
          raw.status,
          raw.body.slice(0, 500),
        );
      }
    } else {
      data = undefined as unknown as T;
    }
    return { status: raw.status, data };
  }
  if (raw.status === 404 && options?.allow404) {
    return { status: 404, data: undefined as unknown as T };
  }
  let msg = `mementos cloud ${method} ${path} → ${raw.status}`;
  try {
    const parsed = JSON.parse(raw.body) as { error?: string; message?: string };
    if (parsed.error || parsed.message) msg += `: ${parsed.error || parsed.message}`;
  } catch {
    if (raw.body.trim()) msg += `: ${raw.body.slice(0, 200)}`;
  }
  throw new ApiRequestError(msg, raw.status, raw.body);
}

/** Build a query string from a filter object (skips undefined/null/empty). */
export function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      sp.set(k, v.join(","));
    } else if (typeof v === "boolean") {
      sp.set(k, v ? "true" : "false");
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
