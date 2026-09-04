// The credential provider chain for the Hasna client seam.
//
// WHY THIS EXISTS. Environment variables are a snapshot taken at process start;
// credentials are mutable state. Storing a rotating secret in a frozen snapshot
// is the defect. The measured failure: a tmux shell started before a key
// rotation holds the stale `HASNA_<NAME>_API_KEY` for its entire life, so every
// command from that shell fails 401 "API key has been revoked", while a fresh
// login shell on the same machine in the same second succeeds. The credential
// on disk was correct the whole time.
//
// THE SHAPE OF THE FIX, and why it is not the obvious one. The obvious fix is
// env-first with a retry-on-401 that re-reads disk. In mature CLIs a
// retry-on-401 always signals TWO-TIER auth — a durable secret minting
// short-lived tokens, where 401 means "mint another" (google-auth refresh,
// docker registry token exchange, kubectl exec-plugin invalidation). We have a
// single static key, so retrying emulates that badly: identity becomes
// nondeterministic per call, the retry sends a second request under a different
// principal, and — the correctness bug — it SILENTLY RESCUES A DELIBERATE
// OVERRIDE THAT WAS REVOKED. An operator testing tenant X wants that 401; a
// fallback would act as the wrong tenant. So there is no retry-on-401 here, and
// a deliberate tier never falls through to another identity.
//
// PRECEDENCE (resolved fresh on every call):
//   1. an explicit argument            — `--api-key` / `--profile`
//   2. a deliberate env pointer        — `HASNA_<NAME>_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
//                                        `HASNA_<NAME>_API_KEY_REF` (secrets-vault pointer)
//   3. the macOS Keychain (darwin only)— generic-password item
//                                        `hasna.credentials.<app>.api-key`, account
//                                        `HASNA_STATION`, else the short hostname, else `USER`
//   4. DISK, read at call time         — `~/.hasna/<app>/config/credentials`
//                                        (`HASNA_HOME` replaces `~/.hasna`; `HASNA_CONFIG_HOME`
//                                        replaces the config root, giving
//                                        `<HASNA_CONFIG_HOME>/<app>/credentials`; a profile
//                                        reads `credentials-<profile>` beside it)
//   5. the `HASNA_<NAME>_API_KEY` process env — a legitimate tier, below disk
//
// The service URL follows the same ladder (`HASNA_<NAME>_API_URL`, the Keychain
// `api-url` item, the credentials file) and, when nothing configures it,
// defaults to the fleet gateway — see `resolveClientTransport` in transport.ts.
//
// TIER 5 IS NOT DEPRECATED, and it sits BELOW disk on purpose. A station wrapper
// that injects `HASNA_<NAME>_API_KEY` into one child process from the Keychain
// is correct: it re-reads the store on every invocation, so nothing it injects
// can go stale. What goes stale is a shell `export`. Putting disk above env is
// what fixes that IMMEDIATELY, without waiting for shells to cycle: when both
// exist, a rotated on-disk key beats a stale export. (Home-layout ruling of
// 2026-09-04, knowledge k_ms4qm9tt_puf1rt; hasna/apps#1668, #1690.)
//
// TIER 3 reads the login keychain with `security find-generic-password … -w`,
// spawned by argv with no shell, on every call. A missing item is simply an
// absent tier; any other `security` failure is a loud error, because an item
// that exists but cannot be read must never be resolved around. The value is
// never logged. The tier is AMBIENT: it runs for the live `process.env` (and
// for an injected runner), never for a caller-built env object — see the
// hermetic seam on `homeDir`.
//
// RETIRED LOCATIONS, never inputs: `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
// `~/.config/hasna/` (with `$XDG_CONFIG_HOME/hasna/`), and any `*-cloud.env`.
// The `~/.hasna` root is a closed namespace of app folders, and
// `XDG_CONFIG_HOME` is not consulted at all. Explicit migration tooling may
// inspect the retired paths, but ordinary client resolution cannot acquire
// authority or credentials from them.
//
// NEVER FALL BACK TO LOCAL DATA ON A 401. Serving local results when auth fails
// prints healthy output while authentication is broken — a false green that is
// strictly worse than the loud failure. Offline reads are a legitimate feature,
// but they must be a deliberate mode decided BEFORE the request, never an error
// path. Nothing in this module may acquire such a fallback.

import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "node:constants";
import { createRequire } from "node:module";
import { hostname as osHostname } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Env } from "../env-token.js";
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
} from "./env-keys.js";

/** Which link of the chain supplied the credential. */
export type CredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

export interface ResolvedCredential {
  /**
   * The secret.
   *
   * NON-ENUMERABLE on purpose, so `Object.keys`, `{ ...resolved }`, and
   * `JSON.stringify(resolution)` cannot spill it; and separately REDACTED by a
   * custom-inspect hook, because non-enumerability alone does not stop an
   * inspector — `console.log` printed it verbatim under Bun until the hook was
   * added. CONTRACT.md §3a promises both. Property access (`resolved.apiKey`)
   * and destructuring still work; only enumeration, serialization, and printing
   * are blocked. Note that `{ ...resolved }` therefore DROPS the key — which is
   * the safe direction.
   */
  readonly apiKey: string;
  readonly tier: CredentialTier;
  /**
   * Where it came from: an env key NAME, an absolute file path, or a Keychain
   * item reference (`keychain:<service>@<account>`). Never a value.
   */
  readonly source: string;
  /** True for tiers an operator sets on purpose. These never fall through. */
  readonly deliberate: boolean;
  /**
   * When tier === "pointer", the vault ITEM KEY to resolve through the
   * @hasna/secrets SDK at request time. Never a credential value. Non-enumerable
   * like apiKey, so it cannot be spilled by enumeration or serialization.
   */
  readonly pointerVaultKey?: string;
  /**
   * The disk paths that were consulted before this credential was chosen.
   *
   * Carried so an auth failure can tell an operator exactly where the fleet
   * credential SHOULD live, instead of advising a fix that silently drops the
   * client onto its local store.
   */
  readonly diskCandidates: readonly string[];
  /** Human-readable advisory. Never contains key material. */
  readonly warning: string | null;
}

/** The captured outcome of one `security` invocation. `stdout` IS the secret; it is never logged. */
export interface KeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;

/** Tier 3 controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object.
   *
   * The tier is AMBIENT: by default it runs only when the resolver is handed
   * the live `process.env`, because a caller-built env is the whole world (the
   * hermetic seam) and the machine's Keychain is outside it. `true` turns the
   * tier on for a caller-built env; `false` turns it off even for the live
   * environment (a CI job on a Mac runner that must never touch a login
   * keychain). Injecting `run` implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /**
   * The machine's host name, used as the account when `HASNA_STATION` is
   * unset. Only the label before the first dot is used (`hostname -s`).
   * Defaults to `os.hostname()`.
   */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: KeychainCommandRunner;
}

export interface CredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: KeychainTierOptions;
}

/**
 * A deliberate credential selection could not be honoured, or a credential
 * source produced something unusable.
 *
 * Thrown rather than resolved-around: an override or profile pointer that
 * cannot produce a key must fail loudly, because the alternative is acting as
 * a different principal than the operator asked for. A corrupt credential file
 * throws for the same reason.
 */
export class CredentialResolutionError extends Error {
  readonly appName: string;
  readonly attempted: readonly string[];
  constructor(appName: string, message: string, attempted: readonly string[]) {
    super(message);
    this.name = "CredentialResolutionError";
    this.appName = appName;
    this.attempted = attempted;
  }
}

/** An existing credential/config file is unsafe and is never treated as absent. */
export class CredentialFileUnsafeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Refusing unsafe credential/config file ${path}: ${reason}.`);
    this.name = "CredentialFileUnsafeError";
    this.path = path;
  }
}

// The `~/.hasna` root is a closed namespace of app folders (the 2026-09-04
// home-layout ruling): every app owns exactly `~/.hasna/<app>/`, and its
// credentials plus non-secret routing config live in the `config/` subfolder.
// The overrides follow XDG semantics — absolute only, blank is unset — but
// XDG's own variables are not read: `HASNA_HOME` replaces the root and
// `HASNA_CONFIG_HOME` replaces the config root for every app at once.
export const HASNA_HOME_ENV_KEY = "HASNA_HOME";
export const HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
/** The Keychain account; absent, the short hostname is used, then `USER`. */
export const KEYCHAIN_STATION_ENV_KEY = "HASNA_STATION";
const HASNA_HOME_DIR = ".hasna";
const CONFIG_SUBDIR = "config";
const CREDENTIALS_FILE = "credentials";
const KEYCHAIN_SECURITY_BIN = "/usr/bin/security";
const KEYCHAIN_SERVICE_PREFIX = "hasna.credentials";
/** `errSecItemNotFound`: `security find-generic-password` exits 44 when no item matches. */
const KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44;
const KEYCHAIN_SPAWN_TIMEOUT_MS = 10_000;

/**
 * A credential file is small. The cap bounds how much a hostile or corrupt file
 * can make a per-request read cost, since this now runs on every request.
 */
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;

/**
 * An app name that is safe to put in a filesystem path.
 *
 * Same grammar as the DNS label the transport requires, checked here
 * independently because this is a FILESYSTEM sink and the transport's check
 * runs later. An unsafe name yields no disk sources at all rather than
 * throwing, so the transport's own `validateAppSlug` keeps producing the
 * canonical error for a bad slug.
 */
const SAFE_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A profile name that is safe to put in a filesystem path. */
const SAFE_PROFILE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Bytes that cannot appear in an HTTP header value.
 *
 * The resolved key is sent as `x-api-key` and `Authorization`. A credential
 * file written with CR-only line endings survives `split(/\r?\n/)` as a single
 * line, leaving a CR inside the value; `fetch` then throws a `TypeError` whose
 * message embeds THE WHOLE HEADER VALUE — i.e. the plaintext key — into logs
 * and stack traces. Rejecting here, naming only the source, is what keeps that
 * from ever reaching the header.
 */
const ILLEGAL_IN_HEADER_VALUE = /[^\t\x20-\x7e]/;

/**
 * The shape of a secrets-vault pointer: a path-shaped reference like
 * `hasna/apps/todos/live/api_key` — at least three lowercase path segments.
 *
 * This is the grammar the resolver REFUSES to treat as a literal API key. A
 * real API key (an `sk-…`, `npm_…`, base64, hex, or JWT value) never has this
 * shape, so refusing it in the literal tiers is what makes "NEVER accept a
 * vault path inside `HASNA_<APP>_API_KEY`" enforceable rather than a promise.
 */
const VAULT_POINTER_SHAPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-_.]*){2,}$/;

/**
 * The home directory comes from the SAME env object that is passed in — never
 * from `os.homedir()`.
 *
 * This is the hermetic seam. A caller that passes an explicit env is declaring
 * that object to be the whole environment, so an env with neither HOME nor
 * HASNA_HOME performs no disk read at all, and — the same principle applied to
 * an ambient store — a caller-built env never reaches the machine's Keychain
 * unless a runner is injected. That is what keeps the test suite independent
 * of whatever credentials happen to exist on the machine running it. Callers
 * that take the `process.env` default get the real HOME, the real disk, and
 * the real Keychain.
 */
function homeDir(env: Env): string | null {
  const home = env.HOME?.trim();
  return home ? home : null;
}

/** An XDG-style override: an absolute, non-blank value; anything else is unset. */
function absoluteOverride(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : null;
}

/** The `~/.hasna` root: `HASNA_HOME`, else `$HOME/.hasna`; null with neither. */
function hasnaHomeDir(env: Env): string | null {
  const override = absoluteOverride(env, HASNA_HOME_ENV_KEY);
  if (override) return override;
  const home = homeDir(env);
  return home ? join(home, HASNA_HOME_DIR) : null;
}

/**
 * The app's config directory: `<HASNA_CONFIG_HOME>/<app>` when the config root
 * is overridden, else `<hasna home>/<app>/config`.
 */
function appConfigDir(name: string, env: Env): string | null {
  const configRoot = absoluteOverride(env, HASNA_CONFIG_HOME_ENV_KEY);
  if (configRoot) return join(configRoot, name);
  const root = hasnaHomeDir(env);
  return root ? join(root, name, CONFIG_SUBDIR) : null;
}

/** One on-disk credential source: its absolute path and its tier. */
export interface DiskCredentialSource {
  path: string;
  tier: CredentialTier;
}

/**
 * All on-disk credential sources for an app, in precedence order.
 *
 * Exactly one disk layer exists: `~/.hasna/<app>/config/credentials`, or the
 * `credentials-<profile>` file beside it. Returns an empty list when neither
 * HOME nor HASNA_HOME anchors the root, or when the app name is not safe to
 * place in a path.
 */
export function credentialDiskSourceList(
  name: string,
  env: Env,
  profile: string | null = null,
): DiskCredentialSource[] {
  // A name that is not a safe slug never reaches the filesystem. Without this,
  // `resolveCredential("../../elsewhere", env)` composes a path outside the
  // credential directory, and the transport's slug check runs too late to stop
  // the read.
  if (!SAFE_APP_SLUG.test(name)) return [];
  const directory = appConfigDir(name, env);
  if (!directory) return [];
  const file = profile ? `${CREDENTIALS_FILE}-${profile}` : CREDENTIALS_FILE;
  return [{ path: join(directory, file), tier: "disk" }];
}

/**
 * The disk files that may hold an app's credential, in precedence order.
 *
 * Exactly one disk layer exists. Exported so callers and error messages can
 * name the exact path consulted.
 */
export function credentialDiskSources(name: string, env: Env): string[] {
  return credentialDiskSourceList(name, env, null).map((s) => s.path);
}

function profileDiskSources(name: string, env: Env, profile: string | null): string[] {
  return credentialDiskSourceList(name, env, profile).map((s) => s.path);
}

/**
 * Parse a shell-style env file.
 *
 * Handles every shape that exists in the field: bare `KEY=value`, an `export `
 * prefix, single- or double-quoted values, `#` comments, and blank lines. A
 * line that is not a valid assignment is SKIPPED rather than half-parsed — an
 * unterminated quote used to yield a truncated value, which then failed
 * authentication in a way that looked like a revoked key rather than a corrupt
 * file.
 */
interface ParsedConfigFile {
  values: Map<string, string>;
  unusable: Set<string>;
}

function parseEnvFile(text: string): ParsedConfigFile {
  const values = new Map<string, string>();
  const unusable = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;
    const key = withoutExport.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(equals + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // Opened a quote: it must close, or this line is not a value we can trust.
      if (value.length < 2 || !value.endsWith(quote)) {
        unusable.add(key);
        continue;
      }
      value = value.slice(1, -1);
    }
    if (value.trim().length === 0) {
      unusable.add(key);
      continue;
    }
    if (values.has(key) && values.get(key) !== value) unusable.add(key);
    values.set(key, value);
  }
  return { values, unusable };
}

/**
 * True when a security-relevant file's permission bits are exactly owner-only
 * 0400 or 0600 across the FULL 07777 mask (setuid/setgid/sticky refused — a
 * 04600 never passes because masking with 0777 keeps the setuid bit).
 */
export function configFileModeAllowed(mode: number): boolean {
  const permissions = mode & 0o7777;
  return permissions === 0o400 || permissions === 0o600;
}

/**
 * True when two fstat snapshots of the same descriptor describe the same
 * file. A change on any axis (dev/ino/size/mtime/ctime) means the path was
 * replaced or mutated while it was being read — the read must be refused.
 */
export function configFileReadsCoherent(
  before: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  after: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/**
 * Read and parse one app-config file (the credentials file). Missing paths are
 * absent; unsafe, unreadable, oversized, and non-regular paths fail closed.
 *
 * Open without following the leaf symlink and without blocking on a FIFO;
 * validate ownership, mode, size and file type on that same descriptor. A
 * second fstat refuses files changed during the read.
 *
 * Both the credential tier and the non-secret config tier go through here, so
 * there is exactly ONE spelling of those guards. A second reader added beside
 * this one is a second place for the FIFO and size checks to drift out of sync.
 */
function readAppConfigFile(path: string): ParsedConfigFile | null {
  const unsafe = (reason: string): never => {
    throw new CredentialFileUnsafeError(path, reason);
  };
  let fd = -1;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    if (code === "ELOOP") unsafe("the path is a symlink");
    unsafe(`the path could not be opened (${code ?? "unknown error"})`);
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) unsafe("the path is not a regular file");
    if (!configFileModeAllowed(before.mode)) {
      unsafe(`permission mode ${(before.mode & 0o7777).toString(8).padStart(4, "0")} is not owner-only 0400 or 0600`);
    }
    const uid = process.getuid?.() ?? process.geteuid?.();
    if (uid !== undefined && before.uid !== uid) unsafe("the file is not owned by the current user");
    if (before.size > MAX_CREDENTIAL_FILE_BYTES) unsafe("the file exceeds the size limit");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!configFileReadsCoherent(before, after)) {
      unsafe("the file changed while being read");
    }
    return parseEnvFile(bytes.toString("utf8"));
  } finally {
    if (fd !== -1) closeSync(fd);
  }
}

function readCredentialFile(path: string, apiKeyKeys: readonly string[]): string | null {
  const parsed = readAppConfigFile(path);
  if (!parsed) return null;
  for (const key of apiKeyKeys) {
    if (parsed.unusable.has(key)) {
      throw new CredentialFileUnsafeError(path, `${key} is declared but blank or malformed`);
    }
  }
  const values = apiKeyKeys.map((key) => parsed.values.get(key)?.trim()).filter((value): value is string => Boolean(value));
  if (new Set(values).size > 1) {
    throw new CredentialFileUnsafeError(path, "credential aliases disagree");
  }
  return values[0] ?? null;
}

/** A non-secret config value read off disk, with the file that supplied it. */
export interface AppConfigDiskHit {
  /** The key that matched, in the caller's precedence order. */
  key: string;
  /** The value as written in the file. Never a credential — see below. */
  value: string;
  /** Absolute path of the file that supplied it, so a diagnostic can name it. */
  path: string;
  /** The key was explicitly declared but blank or malformed. */
  unusable?: boolean;
}

/**
 * Keys this function will never hand back, however the caller asks for them.
 *
 * The credentials file holds a credential AND non-secret routing config in
 * the same place. That is exactly why this boundary has to be explicit: without
 * it, `appConfigDiskValue(name, env, ["HASNA_TODOS_API_KEY"])` would be a
 * second, UNSEALED way to read the secret out of a file whose only other reader
 * returns it sealed, non-enumerable and redacted on inspection. A plain
 * `{ key, value }` hit would defeat that seal completely.
 *
 * Matched on shape rather than on an app-specific list, so a key this module
 * has never heard of — a future `*_CLIENT_SECRET` — is refused too.
 *
 * The credential word is matched as an underscore-delimited SEGMENT ANYWHERE in
 * the key, not anchored to the end. An end-anchored version of this pattern was
 * written first and shipped a hole: `HASNA_<APP>_API_KEY_OVERRIDE` ends in
 * `OVERRIDE`, so it was not refused and this function handed back the live
 * override credential in a plain `{ key, value }`. Its own boundary test caught
 * it. Any qualifier suffix — `_OVERRIDE`, `_FILE`, `_ID` — reintroduces that
 * hole the moment the match is anchored.
 */
const CREDENTIAL_SHAPED_KEY =
  /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/;

/**
 * Read a NON-SECRET config value from the app's credentials file on disk.
 *
 * This is the tier that closes the gap the credential chain left open: the same
 * file already supplies the API key, and every other field in it was discarded.
 * A non-interactive shell may inherit no service environment, so this source
 * keeps the authority and credential together without introducing a local-data
 * fallback.
 *
 * Precedence is file-major, then the caller's key order within a file: the first
 * disk layer that can answer wins, and inside it the caller's first key wins
 * over the file's line order.
 *
 * Values found here are NOT policed for legacy-ness. A live fleet file may still
 * carry keys this reader never asks for; it simply ignores them. Throwing on a
 * file's contents would take down every client on the fleet for a stale line
 * nobody reads.
 */
export function appConfigDiskValue(
  name: string,
  env: Env,
  keys: readonly string[],
): AppConfigDiskHit | null {
  const wanted = keys.filter((key) => !CREDENTIAL_SHAPED_KEY.test(key));
  if (wanted.length === 0) return null;
  for (const path of credentialDiskSources(name, env)) {
    const parsed = readAppConfigFile(path);
    if (!parsed) continue;
    if (wanted.some((key) => parsed.unusable.has(key))) {
      return { key: wanted.find((key) => parsed.unusable.has(key))!, value: "", path, unusable: true };
    }
    const values = wanted.map((key) => parsed.values.get(key)?.trim()).filter((value): value is string => Boolean(value));
    if (new Set(values).size > 1) throw new CredentialFileUnsafeError(path, "configuration aliases disagree");
    for (const key of wanted) {
      if (parsed.unusable.has(key)) return { key, value: "", path, unusable: true };
      const value = parsed.values.get(key)?.trim();
      if (value) return { key, value, path };
    }
  }
  return null;
}

/**
 * Reject a credential that cannot be sent as a header, naming the SOURCE only.
 *
 * Throws rather than falling through: a corrupt file at a deliberate location
 * must not silently hand the request to whatever identity is next in the chain.
 *
 * Also rejects a LITERAL that is shaped like a secrets-vault pointer. The
 * literal API-key tiers (`HASNA_<APP>_API_KEY`, its disk-file values, the
 * override, an explicit `--api-key`) NEVER dereference: a path-shaped value is
 * a mistake — the operator meant `HASNA_<APP>_API_KEY_REF` — and acting on it
 * verbatim would send a vault path as the API key. Refusing names the correct
 * variable instead.
 */
function assertUsableCredential(appName: string, source: string, value: string): void {
  if (VAULT_POINTER_SHAPE.test(value)) {
    throw new CredentialResolutionError(
      appName,
      `The credential from ${source} looks like a secrets-vault pointer (a path-shaped reference like ` +
        `'namespace/app/live/api_key'). A vault path is NEVER accepted as a literal API key. ` +
        `Use ${credentialPointerEnvKey(appName)} to resolve the key through the vault, or provide the actual key value.`,
      [source],
    );
  }
  if (!ILLEGAL_IN_HEADER_VALUE.test(value)) return;
  throw new CredentialResolutionError(
    appName,
    `The credential from ${source} contains characters that cannot be sent in an HTTP header ` +
      `(a control character or non-ASCII byte). A file written with CR-only line endings is the usual ` +
      `cause. Rewrite that credential file with one LF-terminated KEY=value line. ` +
      `The value is not shown here, and is deliberately never logged.`,
    [source],
  );
}

/**
 * The runtime's custom-inspect hook.
 *
 * Non-enumerability keeps the key out of `Object.keys`, spreads, and
 * `JSON.stringify`, but it does NOT hide an own property from an INSPECTOR:
 * under Bun — the engine this package declares — `console.log(resolved)` printed
 * `apiKey: "..."` verbatim, so the CONTRACT.md §3a promise about `console.log`
 * was unenforced. Both `console.log` and `Bun.inspect` honour this hook even
 * when it is defined non-enumerably, which is what lets the guarantee be met
 * without putting anything into `Object.keys` or into a `{ ...resolved }`
 * spread. (A redacting `toJSON` is NOT an alternative — see below.)
 */
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
const CREDENTIAL_SEAL = Symbol.for("hasna:contracts:sealedCredential");
export const CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE = "caller-supplied CredentialProvider";

/**
 * Build a resolution whose secret cannot be enumerated, serialized, or printed.
 *
 * CONTRACT.md §3a states the key value is never logged, embedded, or
 * serialized. An ordinary property makes that claim unenforceable — one
 * `JSON.stringify` of the resolution breaks it — and an unenforced normative
 * guarantee is worse than no guarantee.
 */
function sealCredential(fields: {
  apiKey: string;
  tier: CredentialTier;
  source: string;
  deliberate: boolean;
  diskCandidates: readonly string[];
  warning: string | null;
  pointerVaultKey?: string;
}): ResolvedCredential {
  const { apiKey } = fields;
  const visible = {
    tier: fields.tier,
    source: fields.source,
    deliberate: fields.deliberate,
    diskCandidates: Object.freeze([...fields.diskCandidates]),
    warning: fields.warning,
  };
  const sealed = { ...visible } as ResolvedCredential;
  Object.defineProperty(sealed, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  // The pointer carries the vault ITEM KEY (never a value). Non-enumerable for
  // the same reason apiKey is: enumeration and serialization must not expose
  // which vault item this process authenticates with.
  if (fields.pointerVaultKey !== undefined) {
    Object.defineProperty(sealed, "pointerVaultKey", {
      value: fields.pointerVaultKey,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  // Non-enumerability covers enumeration and serialization: `Object.keys`,
  // `{ ...resolution }`, and `JSON.stringify` all omit the key, enforced by the
  // language rather than by a method a caller could strip or forget.
  //
  // A redacting `toJSON` was tried here and REMOVED: a NON-ENUMERABLE `toJSON`
  // is not honoured by `JSON.stringify` in this runtime (measured — the object
  // serializes without ever calling it), and making it enumerable would put a
  // function into `Object.keys` and into every `{ ...resolution }` spread. So
  // the serialized form simply omits the key, which is the outcome that
  // matters. Do not re-add a non-enumerable `toJSON` expecting it to run.
  //
  // INSPECTION is a separate channel, and non-enumerability does not close it:
  // Bun's inspector prints own non-enumerable properties, so `console.log` spilled
  // the key in plaintext. Unlike `toJSON`, a NON-ENUMERABLE custom-inspect hook IS
  // honoured — by `console.log` and `Bun.inspect` alike — so the redaction happens
  // without the hook ever appearing in `Object.keys` or in a spread. The redacted
  // form keeps `tier` and `source`, which are the fields a diagnostic dump is
  // actually for.
  Object.defineProperty(sealed, INSPECT_CUSTOM, {
    value: () => ({ ...visible, apiKey: "[redacted]" }),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(sealed, CREDENTIAL_SEAL, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(sealed);
}

function isSealedCredential(credential: ResolvedCredential): boolean {
  return (credential as unknown as Record<symbol, unknown>)[CREDENTIAL_SEAL] === true;
}

/**
 * Build the credential for a key a caller handed in DIRECTLY as a string.
 *
 * `createHasnaHttpTransport({ apiKey })` accepts a bare string, and that branch
 * used to construct its resolution as an object literal — reaching the request
 * having run NEITHER {@link assertUsableCredential} NOR {@link sealCredential},
 * so the one public constructor most consumers call bypassed both protections
 * this module exists to provide. A key carrying a CR then travelled all the way
 * into `fetch`, which rejects it with a `TypeError` whose message quotes THE
 * WHOLE HEADER VALUE — putting the plaintext key into logs and stack traces,
 * which is the exact failure `ILLEGAL_IN_HEADER_VALUE` was added to prevent.
 *
 * Every credential in this system is now built here or by
 * {@link resolveCredential}. There is deliberately no third construction site.
 */
export function explicitCredential(appName: string, apiKey: string): ResolvedCredential {
  const source = "explicit apiKey option";
  assertUsableCredential(appName, source, apiKey);
  return sealCredential({
    apiKey,
    tier: "argument",
    source,
    deliberate: true,
    diskCandidates: [],
    warning: null,
  });
}

/**
 * Reapply the credential protections at a caller-supplied provider boundary.
 *
 * A {@link ResolvedCredential} is structurally typed, so a caller can satisfy
 * the provider contract with a plain object instead of a value returned by one
 * of the credential constructors. Snapshot its key once, validate it, and
 * preserve diagnostic metadata only when the value already carries the internal
 * seal those constructors apply. Raw provider-shaped objects keep the key, but
 * not untrusted metadata that could be printed by an auth failure.
 */
export function validateAndSealResolvedCredential(
  appName: string,
  credential: ResolvedCredential,
): ResolvedCredential {
  const apiKey = credential.apiKey;
  assertUsableCredential(appName, CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE, apiKey);
  if (!isSealedCredential(credential)) {
    return sealCredential({
      apiKey,
      tier: "argument",
      source: CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE,
      deliberate: true,
      diskCandidates: [],
      warning: null,
    });
  }
  // A pointer resolution's apiKey is an empty sentinel until the transport
  // completes it through the vault — its vault ITEM KEY must survive the
  // re-seal so the request path can resolve it.
  return sealCredential({
    apiKey,
    tier: credential.tier,
    source: credential.source,
    deliberate: credential.deliberate,
    diskCandidates: credential.diskCandidates,
    warning: credential.warning,
    ...(credential.pointerVaultKey !== undefined ? { pointerVaultKey: credential.pointerVaultKey } : {}),
  });
}

function firstEnvValue(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

// The Keychain is an AMBIENT source — it belongs to the machine, not to any env
// object — so the resolver has to know whether it was handed the live process
// environment or a caller-built one. The snapshot carries that fact as a
// non-enumerable symbol, so it survives the re-snapshot `resolveCredential`
// performs on an env the transport has already snapshotted. Colon-separated,
// not dotted: `tests/state-layout.test.ts` forbids the dotted legacy
// package-global home-directory names in any source file.
const AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

function isAmbientEnvironment(env: Env): boolean {
  return env === process.env || (env as unknown as Record<symbol, unknown>)[AMBIENT_ENVIRONMENT] === true;
}

/** Spawn `/usr/bin/security` by argv — no shell, nothing on stdin, both streams captured. */
function defaultKeychainRunner(argv: readonly string[]): KeychainCommandResult {
  const result = spawnSync(KEYCHAIN_SECURITY_BIN, [...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: KEYCHAIN_SPAWN_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : (result.stderr ?? ""),
  };
}

function keychainTierEnabled(env: Env, options: KeychainTierOptions): boolean {
  if ((options.platform ?? process.platform) !== "darwin") return false;
  if (options.enabled !== undefined) return options.enabled;
  return options.run !== undefined || isAmbientEnvironment(env);
}

/** `HASNA_STATION`, else the short hostname, else `USER`; null when all are blank. */
function keychainAccount(env: Env, options: KeychainTierOptions): string | null {
  const station = env[KEYCHAIN_STATION_ENV_KEY]?.trim();
  if (station) return station;
  // `hostname -s`: the label before the first dot, whatever form the source gives.
  const host = (options.hostname ?? osHostname)().split(".")[0]?.trim() ?? "";
  if (host) return host;
  const user = env.USER?.trim();
  return user || null;
}

/** One line of diagnostic text, control characters removed and bounded. NEVER stdout. */
function keychainFailureHint(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)?.trim() ?? "";
  const clean = line.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  return clean ? `: ${clean}` : "";
}

/** A Keychain item's value and its diagnostic source. The value is never logged. */
export interface KeychainItemHit {
  value: string;
  /** `keychain:<service>@<account>` — names the item, never its value. */
  source: string;
}

/**
 * Read one generic-password item from the login keychain, fresh.
 *
 * Absent (null) when the tier is off for this env/platform, when no account can
 * be derived, or when the item does not exist (`security` exit 44). Every other
 * failure — the tool cannot run, the keychain is locked or interaction is not
 * allowed, the item exists but is empty — is a TERMINAL
 * {@link CredentialResolutionError}: an item that exists but cannot be read is
 * never resolved around, because falling through would authenticate as
 * whatever identity comes next in the chain. No message ever carries stdout.
 */
function readKeychainItem(
  name: string,
  env: Env,
  kind: "api-key" | "api-url",
  options: KeychainTierOptions,
): KeychainItemHit | null {
  if (!SAFE_APP_SLUG.test(name) || !keychainTierEnabled(env, options)) return null;
  const account = keychainAccount(env, options);
  if (!account) return null;
  const service = `${KEYCHAIN_SERVICE_PREFIX}.${name}.${kind}`;
  const source = `keychain:${service}@${account}`;
  const run = options.run ?? defaultKeychainRunner;
  let result: KeychainCommandResult;
  try {
    result = run(["find-generic-password", "-a", account, "-s", service, "-w"]);
  } catch (error) {
    const reason = keychainFailureHint(error instanceof Error ? error.message : String(error));
    throw new CredentialResolutionError(
      name,
      `The Keychain lookup for ${source} could not run${reason}. A Keychain failure is never resolved ` +
        `around: fix the keychain, or delete the item to fall through to the credential on disk.`,
      [source],
    );
  }
  if (result.status === KEYCHAIN_ITEM_NOT_FOUND_STATUS) return null;
  if (result.status !== 0) {
    throw new CredentialResolutionError(
      name,
      `The Keychain lookup for ${source} failed (security exited ` +
        `${result.status ?? "without a status"}${keychainFailureHint(result.stderr)}). A Keychain item that ` +
        `exists but cannot be read is never resolved around: unlock the keychain, run from a session that ` +
        `may use it, or delete the item to fall through to the credential on disk.`,
      [source],
    );
  }
  const value = result.stdout.trim();
  if (!value) {
    throw new CredentialResolutionError(
      name,
      `${source} exists but holds an empty value; a declared item never falls through to another ` +
        `identity. Store a value in it or delete the item.`,
      [source],
    );
  }
  return { value, source };
}

/**
 * The Keychain's `api-url` item for an app — the authority tier that sits
 * beside the credential item, so a station can pin a non-default service URL
 * without a file or an env var. Same account rules and failure semantics as
 * the credential item.
 */
export function keychainConfigValue(name: string, env: Env, options: KeychainTierOptions = {}): KeychainItemHit | null {
  return readKeychainItem(name, env, "api-url", options);
}

/** @internal Snapshot only this client's configuration, without executing getters. */
export function snapshotClientEnvironment(name: string, env: Env): Env {
  const keys = clientTransportEnvKeys(name);
  const ambient = isAmbientEnvironment(env);
  const snapshot: Env = Object.create(null);
  for (const key of [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY,
    "HOME",
    HASNA_HOME_ENV_KEY,
    HASNA_CONFIG_HOME_ENV_KEY,
    KEYCHAIN_STATION_ENV_KEY,
    "USER",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      throw new CredentialResolutionError(name, `${key} is accessor-backed; client configuration requires own data properties.`, [key]);
    }
    if (descriptor.value !== undefined && typeof descriptor.value !== "string") {
      throw new CredentialResolutionError(name, `${key} must be a string data property.`, [key]);
    }
    snapshot[key] = descriptor.value;
  }
  if (ambient) {
    Object.defineProperty(snapshot, AMBIENT_ENVIRONMENT, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(snapshot);
}

/**
 * Resolve an app's API key through the provider chain, at call time.
 *
 * Returns `null` when no tier produces a credential. THROWS
 * {@link CredentialResolutionError} when a DELIBERATE tier was selected but
 * could not be honoured, or when a credential is unusable — silently
 * continuing in either case would authenticate as somebody other than the
 * principal the operator named.
 */
export function resolveCredential(
  name: string,
  env: Env,
  options: CredentialChainOptions = {},
): ResolvedCredential | null {
  env = snapshotClientEnvironment(name, env);
  const { apiKeyKeys } = clientTransportEnvKeys(name);
  const diskPaths = credentialDiskSources(name, env);

  // ---- Tier 1: an explicit argument. -------------------------------------
  if (options.apiKey !== undefined) {
    const explicitKey = options.apiKey.trim();
    if (!explicitKey) {
      throw new CredentialResolutionError(
        name,
        "The explicit apiKey argument is blank; an explicit credential never falls through to another identity.",
        ["explicit apiKey argument"],
      );
    }
    assertUsableCredential(name, "the explicit apiKey argument", explicitKey);
    return sealCredential({
      apiKey: explicitKey,
      tier: "argument",
      source: "explicit apiKey argument",
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null,
    });
  }

  // ---- Tier 2: deliberate env pointers. ----------------------------------
  // The per-service override is more specific than the global profile pointer,
  // so it wins when both are set. Either way the chain STOPS here: a deliberate
  // selection that turns out to be revoked must surface as a 401, never as a
  // quiet switch to a different identity.
  const overrideKeyName = credentialOverrideEnvKey(name);
  const overrideRaw = Object.prototype.hasOwnProperty.call(env, overrideKeyName) ? env[overrideKeyName] : undefined;
  if (overrideRaw !== undefined) {
    const override = overrideRaw.trim();
    if (!override) {
      throw new CredentialResolutionError(
        name,
        `${overrideKeyName} is set but empty. It is a deliberate override, so it is not resolved around: ` +
          `either give it a real key or unset it to fall back to the credential on disk.`,
        [overrideKeyName],
      );
    }
    assertUsableCredential(name, overrideKeyName, override);
    return sealCredential({
      apiKey: override,
      tier: "override",
      source: overrideKeyName,
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null,
    });
  }

  // ---- Tier 2.5: the secrets-vault pointer. -------------------------------
  // `HASNA_<APP>_API_KEY_REF` is a DELIBERATE pointer to a vault ITEM KEY. It
  // never falls through: the literal tiers never accept a vault path (see
  // assertUsableCredential), and when the vault cannot be reached the transport
  // that completes the pointer at request time throws TERMINAL. The per-service
  // override outranks it, so a manual emergency key beats a pointer when both
  // are set.
  const pointerKeyName = credentialPointerEnvKey(name);
  const pointerRaw = Object.prototype.hasOwnProperty.call(env, pointerKeyName) ? env[pointerKeyName] : undefined;
  if (pointerRaw !== undefined) {
    const pointer = pointerRaw.trim();
    if (!pointer) {
      throw new CredentialResolutionError(
        name,
        `${pointerKeyName} is set but empty. It is a deliberate vault pointer, so it is not resolved around: ` +
          `either give it a vault item key or unset it to fall back to the credential on disk.`,
        [pointerKeyName],
      );
    }
    if (!VAULT_POINTER_SHAPE.test(pointer)) {
      throw new CredentialResolutionError(
        name,
        `${pointerKeyName} must name a vault ITEM KEY (a path-shaped reference like ` +
          `'namespace/app/live/api_key'), not a credential value. A pointer that carries a literal is refused.`,
        [pointerKeyName],
      );
    }
    return sealCredential({
      apiKey: "",
      pointerVaultKey: pointer,
      tier: "pointer",
      source: pointerKeyName,
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null,
    });
  }

  if (options.profile !== undefined && !options.profile.trim()) {
    throw new CredentialResolutionError(
      name,
      "The explicit profile argument is blank; an explicit identity selection never falls through.",
      ["explicit profile argument"],
    );
  }
  const profileRaw = Object.prototype.hasOwnProperty.call(env, CREDENTIAL_PROFILE_ENV_KEY) ? env[CREDENTIAL_PROFILE_ENV_KEY] : undefined;
  if (profileRaw !== undefined && !profileRaw.trim()) {
    throw new CredentialResolutionError(name, `${CREDENTIAL_PROFILE_ENV_KEY} is set but blank.`, [CREDENTIAL_PROFILE_ENV_KEY]);
  }
  const profile = options.profile?.trim() || profileRaw?.trim();
  if (profile) {
    const profileSource = options.profile?.trim()
      ? "explicit profile argument"
      : CREDENTIAL_PROFILE_ENV_KEY;
    if (!SAFE_PROFILE.test(profile)) {
      throw new CredentialResolutionError(
        name,
        `Profile name from ${profileSource} is not usable in a path. ` +
          `Use letters, digits, dot, dash, or underscore.`,
        [profileSource],
      );
    }
    const paths = profileDiskSources(name, env, profile);
    for (const path of paths) {
      const value = readCredentialFile(path, apiKeyKeys);
      if (value) {
        assertUsableCredential(name, path, value);
        return sealCredential({
          apiKey: value,
          tier: "profile",
          source: path,
          deliberate: true,
          diskCandidates: paths,
          warning: null,
        });
      }
    }
    throw new CredentialResolutionError(
      name,
      `Profile '${profile}' (from ${profileSource}) has no ${apiKeyKeys[0]} for '${name}'. ` +
        `Looked in: ${paths.join(", ") || "<no HOME in this environment>"}. ` +
        `A profile names WHICH identity to use, so it is never resolved around — ` +
        `create the profile's credential file or unset ${CREDENTIAL_PROFILE_ENV_KEY}.`,
      paths,
    );
  }

  // The process-env tier is validated up front, whichever tier ends up winning:
  // a DECLARED-but-blank alias, or two aliases that disagree, is a
  // misconfiguration that must not be papered over by a higher tier.
  const definedEnvEntries = apiKeyKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
    .map((key) => ({ key, value: String(env[key]).trim() }));
  const blankEnv = definedEnvEntries.find((entry) => entry.value.length === 0);
  if (blankEnv) {
    throw new CredentialResolutionError(
      name,
      `${blankEnv.key} is set but blank; a declared credential never falls through to another alias or identity.`,
      [blankEnv.key],
    );
  }
  if (definedEnvEntries.length > 1 && new Set(definedEnvEntries.map((entry) => entry.value)).size > 1) {
    throw new CredentialResolutionError(
      name,
      `${definedEnvEntries.map((entry) => entry.key).join(" and ")} disagree; credential aliases must be identical or only one may be set.`,
      definedEnvEntries.map((entry) => entry.key),
    );
  }
  const envHit = firstEnvValue(env, apiKeyKeys);

  // ---- Tier 3: the macOS Keychain, read at call time. --------------------
  // The station's own store, consulted before disk so a machine that keeps its
  // key in the login keychain needs neither a file nor a wrapper. A missing
  // item is an absent tier; any other failure threw above. There is no cache:
  // a cache is the same snapshot defect at a smaller timescale.
  const keychainHit = readKeychainItem(name, env, "api-key", options.keychain ?? {});
  if (keychainHit) {
    assertUsableCredential(name, keychainHit.source, keychainHit.value);
    // Only the env is compared here — comparing the disk file too would cost a
    // file read on every call for a tier that has already decided.
    const warning =
      envHit && envHit.value !== keychainHit.value
        ? `Credential sources disagree for '${name}': ${keychainHit.source} and ${envHit.key} hold ` +
          `different keys. ${keychainHit.source} wins, because the Keychain is re-read on every call while ` +
          `an environment variable is a snapshot. Reconcile them — a rotation that updated only one leaves ` +
          `the other to fail 401 wherever it is loaded first.`
        : null;
    return sealCredential({
      apiKey: keychainHit.value,
      tier: "keychain",
      source: keychainHit.source,
      deliberate: false,
      diskCandidates: diskPaths,
      warning,
    });
  }

  // ---- Tier 4: disk, read at call time. ----------------------------------
  // This is what makes a rotation heal in any shell, however old: the file is
  // re-read on every call, so there is no snapshot to go stale. There is
  // deliberately NO CACHE here — a cache is the same defect at a smaller
  // timescale.
  //
  // The sole automatic disk source is the owner-only credentials file in the
  // app's config directory.
  const diskSourceList = credentialDiskSourceList(name, env, null);
  const diskHits = diskSourceList
    .map((src) => ({ src, value: readCredentialFile(src.path, apiKeyKeys) }))
    .filter((hit): hit is { src: DiskCredentialSource; value: string } => hit.value !== null);

  if (diskHits.length > 0) {
    const winner = diskHits[0]!;
    assertUsableCredential(name, winner.src.path, winner.value);
    // The paths and the FACT of disagreement are the whole diagnostic. A
    // fingerprint of the secret — even a truncated digest — is a derived
    // encoding of credential material and a confirmation oracle, so none is
    // emitted.
    //
    // Disk OUTRANKS the process env, which introduces a failure this chain did
    // not previously have: an operator whose environment key works today
    // starts using a DIFFERENT key the moment a stale file exists on disk, and
    // would otherwise get no signal at all.
    const divergentSources = [
      ...diskHits.slice(1).filter((hit) => hit.value !== winner.value).map((hit) => hit.src.path),
      ...(envHit && envHit.value !== winner.value ? [envHit.key] : []),
    ];
    const warning =
      divergentSources.length > 0
        ? `Credential sources disagree for '${name}': ${winner.src.path} and ` +
          `${divergentSources.join(", ")} hold different keys. ${winner.src.path} wins, because a file on ` +
          `disk is re-read on every call while an environment variable is a snapshot. Reconcile them — ` +
          `a rotation that updated only one leaves the other to fail 401 wherever it is loaded first.`
        : null;

    return sealCredential({
      apiKey: winner.value,
      tier: winner.src.tier,
      source: winner.src.path,
      deliberate: false,
      diskCandidates: diskPaths,
      warning,
    });
  }

  // ---- Tier 5: the process environment. ----------------------------------
  // A legitimate tier, not a deprecated one: a station wrapper that injects
  // the key per process from the Keychain is exactly right, and re-reads its
  // store on every invocation. It sits below disk so that a rotated on-disk
  // key beats a stale shell export when both exist. Reaching here PROVES the
  // Keychain and the disk had nothing — the auth-failure guidance in
  // transport.ts relies on that when it says where to put the current key.
  if (envHit) {
    assertUsableCredential(name, envHit.key, envHit.value);
    return sealCredential({
      apiKey: envHit.value,
      tier: "env",
      source: envHit.key,
      deliberate: false,
      diskCandidates: diskPaths,
      warning: null,
    });
  }

  return null;
}

/** The runtime shape of the @hasna/secrets client used by the pointer tier. */
interface SecretsPointerClient {
  getSecret(query: { key: string }): Promise<{ value: string }>;
}

/** The runtime-loaded module shape of `@hasna/secrets` used by the pointer tier. */
interface SecretsPointerModule {
  createSecretsClientFromEnv(env: Record<string, string | undefined>): SecretsPointerClient;
}

// Non-literal by design — the same seam `src/cli/secrets-bridge.ts` uses, so
// `bun build` leaves the import as a runtime import (the pointer is a rare,
// deliberate path) and `tsc` never statically resolves it against a sibling
// member whose dist is absent at install time.
const SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";

// Runtime-only load of the secrets SDK. `createRequire` + a non-literal
// specifier keeps this a runtime require in consumer bundles (`bun build
// --compile` and friends), unlike `await import(<non-literal>)` which the
// bundler refuses. The pointer tier is a rare, deliberate path; its SDK is
// loaded only when a pointer is actually resolved.
const requireSecretsSdk = createRequire(import.meta.url);

/**
 * Complete a pointer-tier resolution through the secrets vault.
 *
 * Called by the transport at REQUEST time, never at construction. The pointer
 * is a DELIBERATE selection, so every failure — SDK not installed, client
 * unconfigured, vault unreachable, item missing or empty — is a TERMINAL
 * {@link CredentialResolutionError}. The chain never falls through to a
 * literal, an env var, or a local store: authenticating as a different
 * principal than the one the operator named is exactly the failure a
 * deliberate pointer exists to prevent.
 *
 * The @hasna/secrets module is imported lazily (via a non-literal specifier)
 * so consumers that never set a pointer pay no import cost and need no peer
 * dependency at load time; a pointer REQUIRES it, and its absence is one of
 * the TERMINAL cases.
 */
export async function completePointerCredential(
  name: string,
  pointerResolution: ResolvedCredential,
  env: Env = process.env,
): Promise<ResolvedCredential> {
  const vaultKey = pointerResolution.pointerVaultKey;
  const pointerEnvKey = pointerResolution.source;
  if (!vaultKey) {
    throw new CredentialResolutionError(
      name,
      `Pointer resolution from ${pointerEnvKey} carries no vault item key; this is a defect in the resolver.`,
      [pointerEnvKey],
    );
  }
  let secretsSdk: SecretsPointerModule;
  try {
    secretsSdk = requireSecretsSdk(SECRETS_PACKAGE_SPECIFIER) as SecretsPointerModule;
  } catch {
    throw new CredentialResolutionError(
      name,
      `${pointerEnvKey} names vault item '${vaultKey}', but the secrets SDK (@hasna/secrets) is not installed ` +
        `in this process. A vault pointer is TERMINAL: install @hasna/secrets to resolve it, or unset ${pointerEnvKey}.`,
      [pointerEnvKey],
    );
  }
  let client: SecretsPointerClient;
  try {
    client = secretsSdk.createSecretsClientFromEnv(env);
  } catch {
    throw new CredentialResolutionError(
      name,
      `${pointerEnvKey} names vault item '${vaultKey}', but the secrets client could not be configured from this ` +
        `environment (the secrets service URL and key env are missing or invalid). A vault pointer is TERMINAL and ` +
        `never falls through to a literal or disk credential.`,
      [pointerEnvKey],
    );
  }
  let secret: { value: string };
  try {
    secret = await client.getSecret({ key: vaultKey });
  } catch {
    throw new CredentialResolutionError(
      name,
      `${pointerEnvKey} names vault item '${vaultKey}', but the vault could not be reached or the item is ` +
        `unavailable. A vault pointer is TERMINAL and never falls through to a literal or disk credential.`,
      [pointerEnvKey],
    );
  }
  const value = secret.value;
  if (!value) {
    throw new CredentialResolutionError(
      name,
      `${pointerEnvKey} resolved vault item '${vaultKey}', but it holds no value. A vault pointer is TERMINAL.`,
      [pointerEnvKey],
    );
  }
  assertUsableCredential(name, `${pointerEnvKey} -> vault:${vaultKey}`, value);
  return sealCredential({
    apiKey: value,
    tier: "pointer",
    source: `${pointerEnvKey} -> vault:${vaultKey}`,
    deliberate: true,
    diskCandidates: pointerResolution.diskCandidates,
    warning: null,
  });
}
