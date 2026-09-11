// Client-side store resolver for @hasna/shortlinks.
//
// This is the single seam the CLI, MCP server, and SDK consult to obtain a
// `Store`. It returns the hosted-API `ApiStore` when the @hasna/contracts
// client resolver finds a shortlinks credential — the Keychain item
// `hasna.credentials.shortlinks.api-key`, the disk credential file
// `~/.hasna/shortlinks/config/credentials` (0400/0600), or
// `HASNA_SHORTLINKS_API_KEY` (alias `SHORTLINKS_API_KEY`) — and otherwise
// FAILS CLOSED: a missing backend is an error naming the credential chain,
// never a silent switch to the on-box SQLite store. A CLI run without a
// resolvable credential must never serve ~/.hasna/shortlinks/shortlinks.db and
// exit 0 (owner ruling 2026-09-04: no silent local fallback).
//
// The on-box SQLite `LocalStore` is reachable ONLY through the explicit
// environment opt-in `HASNA_SHORTLINKS_LOCAL=1` (alias `SHORTLINKS_LOCAL=1`).
// `--db <path>` / `options.dbPath` CHOOSES THE FILE for that opt-in; since
// 0.4.0 it no longer opens local storage on its own (owner ruling (d),
// 2026-09-11: local storage lives behind one env opt-in and nothing else), and
// a `--db` passed without the opt-in is refused with a line naming it.
// A hosted configuration always wins over the opt-in, and selecting the local
// backend ANNOUNCES it on stderr (once per process) — the local backend is
// never silent.
//
// `bun:sqlite` is NOT in this module's static graph: the local store is loaded
// through ONE gated `await import("./local-store.js")`, taken only after the
// opt-in was checked, so the sqlite engine never lands in `dist/cli` or
// `dist/mcp` (the build splits it into `dist/chunks/`). That is why
// `resolveStore()` is async.
//
// There is NO postgres/DSN branch here: a client never reads or writes the raw
// RDS. Partial hosted configuration (a URL without a credential, a
// declared-but-blank variable, disagreeing authorities, an unreadable
// credential file) THROWS via CloudShortlinksStore.fromEnv — a client can
// never silently drift back to the wrong dataset.

import { CloudShortlinksStore } from "./cloud-store.js";
import { shortlinksResolverInputs } from "./client-resolver-inputs.js";
import type { Env, Store } from "./store-interface.js";
import type { ShortlinksTransportOverrides } from "./client-types.js";

/** The hosted-API HTTP transport. */
export { CloudShortlinksStore as ApiStore } from "./cloud-store.js";
export type { Store } from "./store-interface.js";
/**
 * The on-box SQLite store — TYPE ONLY here. A value import would drag
 * `bun:sqlite` back into every bundle that touches this seam; the class is
 * loaded through the gated dynamic import in {@link resolveStore}.
 */
export type { LocalStore } from "./local-store.js";

/**
 * Environment opt-in for the on-box SQLite store, canonical name first. The
 * legacy `SHORTLINKS_LOCAL` spelling stays accepted (it is documented and in
 * the wild). This is the ONLY door to local storage: without a hosted
 * credential AND without this flag the CLI fails closed instead of serving
 * local data, and `--db <path>` alone is refused.
 */
export const LOCAL_OPT_IN_ENV_KEYS = ["HASNA_SHORTLINKS_LOCAL", "SHORTLINKS_LOCAL"] as const;

/** The canonical local opt-in env key, named in errors and notices. */
export const LOCAL_OPT_IN_ENV_KEY = LOCAL_OPT_IN_ENV_KEYS[0];

/**
 * True when the environment explicitly opts into the on-box SQLite store via
 * `HASNA_SHORTLINKS_LOCAL` / `SHORTLINKS_LOCAL`. Any value except an empty
 * string / 0 / false / no / off opts in. A fully configured hosted API still
 * wins over this flag — opt-in never silently shadows an explicit hosted
 * configuration.
 */
export function isLocalOptIn(env: Env): boolean {
  for (const key of LOCAL_OPT_IN_ENV_KEYS) {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) continue;
    if (raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off") return true;
  }
  return false;
}

/** Actionable fail-closed message: names the credential chain and the local opt-in. */
export function missingBackendMessage(): string {
  return (
    `No shortlinks data backend is configured; the CLI never falls back to local storage on its own. ` +
    `The @hasna/contracts client resolver found no shortlinks credential: look in the Keychain item ` +
    `hasna.credentials.shortlinks.api-key (macOS), write ~/.hasna/shortlinks/config/credentials ` +
    `(0400/0600, HASNA_SHORTLINKS_API_KEY=...), or set HASNA_SHORTLINKS_API_KEY ` +
    `(alias SHORTLINKS_API_KEY; the authority defaults to https://api.hasna.com/shortlinks and can be ` +
    `overridden with HASNA_SHORTLINKS_API_URL). To use the on-box SQLite store explicitly, set ` +
    `${LOCAL_OPT_IN_ENV_KEY}=1 (alias SHORTLINKS_LOCAL); --db <path> then chooses the database file.`
  );
}

/**
 * Refusal for `--db <path>` / `options.dbPath` without the environment opt-in.
 * `--db` used to select the on-box store by itself — a second, undocumented
 * door into local storage. It now only NAMES THE FILE for a run that already
 * opted in, so one line naming the opt-in is the whole fix an operator needs.
 */
export function dbPathWithoutOptInMessage(dbPath: string): string {
  return (
    `--db ${dbPath} no longer selects the on-box SQLite store on its own: set ${LOCAL_OPT_IN_ENV_KEY}=1 ` +
    `(alias SHORTLINKS_LOCAL) to use local storage, and --db to choose its file.`
  );
}

let localNoticePrinted = false;

/** Reset the once-per-process local-backend notice. Test seam only. */
export function __resetShortlinksLocalNotice(): void {
  localNoticePrinted = false;
}

/**
 * The one-line stderr announcement the local backend makes (once per process):
 * an operator running the on-box store while believing they are on the hosted
 * API is the false-green this ruling exists to end, so the local backend is
 * never silent.
 */
function announceLocalBackend(reason: string, target: string, notice?: (line: string) => void): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `shortlinks: LOCAL mode — on-box SQLite store in use (${reason}); reading and writing ` +
    `${target} instead of the hosted API. To use the hosted API, set ` +
    `HASNA_SHORTLINKS_API_KEY, add the Keychain item hasna.credentials.shortlinks.api-key, or write ` +
    `~/.hasna/shortlinks/config/credentials.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/**
 * Load the on-box SQLite store. THE ONE GATED DYNAMIC IMPORT: it is only ever
 * reached after {@link resolveStore} decided that no hosted backend is
 * configured AND that the environment explicitly opted into local storage, so
 * the sqlite engine is never even loaded on a hosted (or refusing) run — and,
 * because the specifier is dynamic and the build uses `--splitting`, it is not
 * bundled into `dist/cli` or `dist/mcp` at all.
 */
async function openLocalStore(dbPath: string | undefined, env: Env): Promise<Store> {
  const { LocalStore } = await import("./local-store.js");
  return new LocalStore(dbPath, env);
}

export interface ResolveStoreOptions {
  /**
   * Explicit local SQLite path (CLI `--db`). It CHOOSES THE FILE for a run
   * that already opted into local storage; it is NOT itself an opt-in (a
   * `dbPath` without `HASNA_SHORTLINKS_LOCAL` is refused), and it is ignored
   * when the hosted API is selected.
   */
  dbPath?: string;
  /** Transport overrides for the hosted-API client (test injection: fetchImpl, ...). */
  cloudOverrides?: ShortlinksTransportOverrides;
  /** Where the one-line local-backend notice goes. Defaults to `process.stderr`. */
  notice?: (line: string) => void;
}

/**
 * Resolve the active {@link Store} for the current environment.
 *
 * - The hosted-API {@link ApiStore} wins when the @hasna/contracts client
 *   resolver finds a shortlinks credential (Keychain, disk credential file, or
 *   `HASNA_SHORTLINKS_API_KEY`); a partially configured hosted client throws.
 * - Otherwise the on-box `LocalStore` is used ONLY when the environment
 *   explicitly opted in (`HASNA_SHORTLINKS_LOCAL=1`, alias `SHORTLINKS_LOCAL=1`);
 *   `dbPath` (`--db`) names the file for such a run but never opens one by
 *   itself — a `dbPath` without the opt-in is REFUSED.
 * - Otherwise resolution FAILS CLOSED: it throws an error naming the credential
 *   chain instead of silently serving the local SQLite dataset.
 *
 * Async because the local store — and with it `bun:sqlite` — is behind a gated
 * dynamic import; the hosted and fail-closed paths never touch it.
 */
export async function resolveStore(
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Promise<Store> {
  // Normalise declared-but-blank authority variables WITHOUT handing the
  // resolver a silent copy: the Keychain tier's ambient gate travels with the
  // copy when one is forced (hasna/apps#1788). See ./client-resolver-inputs.ts.
  const { env: resolverEnv, credentials } = shortlinksResolverInputs(env, options.cloudOverrides?.credentials);
  const cloud = CloudShortlinksStore.fromEnv(resolverEnv, {
    ...options.cloudOverrides,
    credentials,
  });
  if (cloud) return cloud;
  // No hosted backend resolved. The local SQLite backend is never the silent
  // default and has exactly ONE door: the documented environment opt-in
  // (HASNA_SHORTLINKS_LOCAL=1 / SHORTLINKS_LOCAL=1). Selecting it is announced
  // on stderr (once per process).
  const optedIn = isLocalOptIn(env);
  if (!optedIn && options.dbPath !== undefined) {
    // `--db <path>` used to be a second opt-in of its own. It is now only the
    // file name for an opted-in run, so say so in one line instead of quietly
    // opening a database the operator did not ask the fleet for.
    throw new Error(dbPathWithoutOptInMessage(options.dbPath));
  }
  if (optedIn) {
    const reason = options.dbPath !== undefined
      ? `${LOCAL_OPT_IN_ENV_KEY}=1, --db ${options.dbPath}`
      : `${LOCAL_OPT_IN_ENV_KEY}=1`;
    announceLocalBackend(reason, options.dbPath ?? "~/.hasna/shortlinks/shortlinks.db", options.notice);
    return openLocalStore(options.dbPath, env);
  }
  throw new Error(missingBackendMessage());
}

/**
 * Run `fn` with a resolved {@link Store}, always closing it afterward. The
 * canonical helper for one-shot CLI/MCP operations. Fails closed (throws
 * naming the credential chain) when no backend is configured and the local
 * backend was not explicitly opted into.
 */
export async function withStore<T>(
  fn: (store: Store) => T | Promise<T>,
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Promise<T> {
  const store = await resolveStore(env, options);
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}