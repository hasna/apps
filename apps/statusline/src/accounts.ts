import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Which account is *this* session running as?
 *
 * The host agent's statusline payload carries no account or profile field, so
 * the answer has to come from the process environment. Tools that manage
 * several logins (`@hasna/accounts`, and Claude Code itself) isolate each
 * login in its own config dir and point the child process at it via
 * `CLAUDE_CONFIG_DIR`. That variable is per-process, so it is the only signal
 * that stays correct when several sessions run under different accounts at the
 * same time.
 *
 * Deliberately NOT used: any "active"/"current"/"applied" profile pointer.
 * Those are global — every concurrent session would report whichever profile
 * was switched to last, which is the staleness this module exists to avoid.
 */
export interface SessionAccount {
  /** Config dir this session is running against (canonicalized). */
  configDir: string;
  /** Managed profile name owning that dir, when it can be resolved. */
  profile: string | null;
  /** Tool id the profile belongs to (e.g. "claude"), when known. */
  tool: string | null;
  /**
   * How `profile` was resolved. `"layout"` means it was read off the dir path
   * rather than the registry, which is authoritative about the dir but can lag
   * a rename — see `layoutProfile`. `"switched"` means an in-place
   * `switch-account` marker named another profile's account as the dir's
   * current occupant. Surfaced for diagnostics, not for display.
   */
  source: "registry" | "layout" | "switched" | null;
}

/** Env var Claude Code uses to point a process at an isolated config dir. */
const CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
/** Config dir the agent uses for settings when not pointed at an isolated one. */
const DEFAULT_CONFIG_SUBDIR = ".claude";

/**
 * `@hasna/accounts` state layout. Both env vars are that package's own
 * documented overrides, and the paths below are its defaults. We read the
 * registry file rather than shelling out to the CLI: against a cloud-backed
 * registry the CLI costs ~1.4s, which a statusline cannot spend on every
 * render. When the package is installed alongside us we ask *it* where its
 * state lives instead of assuming (see `accountsPaths`).
 */
const STORE_PATH_ENV = "ACCOUNTS_STORE_PATH";
const ACCOUNTS_HOME_ENV = "ACCOUNTS_HOME";
const DEFAULT_ACCOUNTS_HOME = [".hasna", "accounts"];
const STORE_FILE = "accounts.json";
const PROFILES_SUBDIR = "profiles";

/**
 * `accounts switch-account` switches a session's account IN PLACE: it swaps
 * the live auth files inside the config dir and records the new occupant in
 * this marker, without moving the dir or re-pointing the registry. So both the
 * registry entry and the dir's path name keep describing the dir's *owner*
 * after a switch — only the marker knows who is actually logged in now. It is
 * cleared when the owner's account is restored or a fresh login lands.
 *
 * The filenames mirror `@hasna/accounts`'s claude-layout module, which owns
 * them but does not export a public reader; if one appears it should replace
 * these constants via the same lazy import used for `accountsPaths`.
 */
const AUTH_STATE_SUBDIR = ".accounts-auth";
const SWITCHED_ACCOUNT_MARKER_FILE = "switched-account.json";

/**
 * Where the host agent records which account is logged in. Mirrors Claude
 * Code's own resolution: a `.config.json` in the dir wins, otherwise
 * `.claude<oauth-variant>.json`. Note the base dir is the *config dir or the
 * home dir* — with `CLAUDE_CONFIG_DIR` unset the file is `~/.claude.json`,
 * a sibling of the `~/.claude` config dir and not inside it.
 */
const STATE_FILE_PREFERRED = ".config.json";
const STATE_FILE_PREFIX = ".claude";
const STATE_FILE_SUFFIX = ".json";
/** Set when the agent talks to a non-production OAuth host. */
const CUSTOM_OAUTH_ENV = "CLAUDE_CODE_CUSTOM_OAUTH_URL";
const OAUTH_VARIANTS = ["", "-custom-oauth", "-local-oauth", "-staging-oauth"];

/**
 * Where the accounts usage warmer keeps its per-account cache. `@hasna/accounts`
 * writes `<accountsHome>/cache/usage/<accountUuid>.json` on a background refresh,
 * so a statusline can read the pane account's headroom without the cloud round
 * trip the CLI would cost on every render. `accountsHome()` there is exactly
 * `ACCOUNTS_HOME` or the default below — no other override touches it — so this
 * resolves synchronously without importing the package.
 */
const CACHE_SUBDIR = "cache";
const USAGE_CACHE_SUBDIR = "usage";
/**
 * How old a cache entry may be before it is treated as absent. The warmer
 * refreshes on the order of a minute; past this bound it is not running, and a
 * measurement that stale can no longer be trusted for the ~5-hour session
 * window — better a neutral marker than a wrong number.
 */
const USAGE_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
/**
 * A session window resets at most every 5 hours. A reset horizon beyond that
 * marks a weekly window when neither `group` nor `id` classifies it — the same
 * rule `@hasna/accounts` uses.
 */
const SESSION_WINDOW_MAX_MS = 5 * 60 * 60 * 1000;
/**
 * The cache filename is the account uuid. Refuse anything that is not a plain
 * uuid-shaped token so a doctored login record cannot point the read outside
 * the cache directory. Mirrors the accounts package's own `safeUuid` guard.
 */
const SAFE_UUID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

type Env = Record<string, string | undefined>;

interface RegistryEntry {
  name?: unknown;
  tool?: unknown;
  email?: unknown;
  dir?: unknown;
}

/** The slice of `@hasna/accounts/storage` we use, when it is installed. */
interface AccountsStorage {
  storePath(): string;
  profilesDir(): string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `$HOME` wins over the passwd entry, as it does for every other path here. */
function home(env: Env): string {
  return str(env.HOME) ?? homedir();
}

function expandHome(path: string, env: Env): string {
  return path === "~" || path.startsWith(`~${sep}`) ? join(home(env), path.slice(1)) : path;
}

/**
 * Resolve to a comparable absolute path. Symlinks are followed when the path
 * exists, so a config dir and a registry entry that differ only by a symlink
 * still match; a path that does not exist is just normalized.
 */
function canonical(path: string, env: Env): string {
  const abs = resolve(expandHome(path, env));
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Ask the owning package where it keeps accounts state. Imported lazily so the
 * cost lands only on sessions that actually enable an auth segment, and
 * tolerated as absent: this package does not depend on `@hasna/accounts`, and
 * the segment must degrade rather than fail when it is not installed.
 */
const ACCOUNTS_STORAGE_MODULE = "@hasna/accounts/storage";

let storagePromise: Promise<AccountsStorage | null> | undefined;
function accountsStorage(): Promise<AccountsStorage | null> {
  // The specifier is indirected through a constant on purpose: it is an
  // optional integration, not a dependency, so it must stay a runtime lookup
  // rather than something the bundler or type checker tries to resolve.
  storagePromise ??= import(ACCOUNTS_STORAGE_MODULE).then(
    (mod: any) =>
      typeof mod?.storePath === "function" && typeof mod?.profilesDir === "function"
        ? (mod as AccountsStorage)
        : null,
    () => null,
  );
  return storagePromise;
}

/** Registry file and managed-profiles root for this environment. */
async function accountsPaths(env: Env): Promise<{ store: string; profiles: string }> {
  const homeOverride = str(env[ACCOUNTS_HOME_ENV]);
  const storeOverride = str(env[STORE_PATH_ENV]);
  if (!homeOverride && !storeOverride) {
    const storage = await accountsStorage();
    try {
      if (storage) return { store: storage.storePath(), profiles: storage.profilesDir() };
    } catch {
      // a broken install must not break the statusline — use the documented default
    }
  }
  const base = homeOverride ?? join(home(env), ...DEFAULT_ACCOUNTS_HOME);
  return {
    store: storeOverride ?? join(base, STORE_FILE),
    profiles: join(base, PROFILES_SUBDIR),
  };
}

/**
 * Registry entry recorded for this config dir. A dir can be claimed by more
 * than one entry (different tools, or duplicates), so `tool` picks the one
 * belonging to the agent we are rendering for rather than whichever came
 * first in the file.
 */
function registryEntry(store: string, configDir: string, env: Env, tool?: string): RegistryEntry | null {
  if (!existsSync(store)) return null;
  const entries = readJson(store)?.profiles;
  if (!Array.isArray(entries)) return null;
  let untyped: RegistryEntry | null = null;
  let first: RegistryEntry | null = null;
  for (const entry of entries as RegistryEntry[]) {
    const dir = str(entry?.dir);
    if (!dir || canonical(dir, env) !== configDir) continue;
    const entryTool = str(entry?.tool);
    if (tool && entryTool === tool) return entry;
    // an entry that claims no tool is not a conflict; one claiming a
    // different tool describes someone else's login and is never used
    if (!entryTool) untyped ??= entry;
    first ??= entry;
  }
  return tool ? untyped : first;
}

/**
 * Layout fallback. Managed profile dirs are created as
 * `<accountsHome>/profiles/<tool>/<name>`, so a dir sitting exactly two levels
 * under the profiles root names its own tool and profile. This covers dirs the
 * local registry has no entry for — the registry can be a partial view of a
 * shared store, while the dir the process was handed is always real. Dirs
 * outside that root (an imported or hand-pointed config dir), and dirs that do
 * not exist, yield null rather than naming a profile that isn't there.
 *
 * Caveat: renaming a profile does not move its dir, so for a profile the local
 * registry has no entry for this reports the name the dir was created with.
 * The registry is checked first precisely so that a known profile wins.
 */
function layoutProfile(profilesRoot: string, configDir: string, env: Env): SessionAccount | null {
  if (!existsSync(configDir)) return null;
  const prefix = canonical(profilesRoot, env) + sep;
  if (!configDir.startsWith(prefix)) return null;
  const parts = configDir.slice(prefix.length).split(sep);
  if (parts.length !== 2) return null;
  const [tool, profile] = parts;
  if (!tool || !profile) return null;
  return { configDir, profile, tool, source: "layout" };
}

interface SwitchedOccupant {
  profile: string | null;
  email: string | null;
}

/**
 * The account currently occupying this config dir after an in-place
 * `switch-account`, or null when the dir carries its own account. A marker
 * with no usable fields is treated as absent rather than as an anonymous
 * occupant.
 */
function switchedOccupant(configDir: string): SwitchedOccupant | null {
  const raw = readJson(join(configDir, AUTH_STATE_SUBDIR, SWITCHED_ACCOUNT_MARKER_FILE));
  if (!raw) return null;
  const profile = str(raw.profile);
  const email = str(raw.email);
  return profile || email ? { profile, email } : null;
}

/** Config dir the current process is bound to, for settings and registry lookup. */
export function sessionConfigDir(env: Env = process.env): string {
  return canonical(str(env[CONFIG_DIR_ENV]) ?? join(home(env), DEFAULT_CONFIG_SUBDIR), env);
}

/**
 * Path of the host agent's account record for this session, or null when none
 * of its known filenames are present.
 */
export function sessionStateFile(env: Env = process.env): string | null {
  const base = canonical(str(env[CONFIG_DIR_ENV]) ?? home(env), env);
  const preferred = join(base, STATE_FILE_PREFERRED);
  if (existsSync(preferred)) return preferred;
  const variants = str(env[CUSTOM_OAUTH_ENV]) ? ["-custom-oauth", ...OAUTH_VARIANTS] : OAUTH_VARIANTS;
  for (const variant of variants) {
    const candidate = join(base, `${STATE_FILE_PREFIX}${variant}${STATE_FILE_SUFFIX}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Email the dir's own state file says this session is logged in as, or null
 * when the dir carries no record. Authoritative about the live login: it is the
 * same signal `sessionAccountEmail` trusts ahead of the registry and the marker.
 */
function liveAccountEmail(env: Env): string | null {
  const stateFile = sessionStateFile(env);
  return stateFile ? str(readJson(stateFile)?.oauthAccount?.emailAddress) : null;
}

/**
 * Whether a switch marker still describes the dir's current login. `accounts`
 * clears the marker when the owner's account is restored *in principle*, but in
 * practice a stale marker outlives the switch it recorded — so a marker whose
 * email the dir's LIVE login contradicts is honored only if the two agree.
 * Without a live record to compare against, the marker is the best signal there
 * is and is trusted, preserving the in-place-switch feature.
 */
function occupantMatchesLiveLogin(occupant: SwitchedOccupant, env: Env): boolean {
  const live = liveAccountEmail(env);
  if (!live) return true;
  return occupant.email != null && occupant.email === live;
}

/**
 * Resolve the profile owning this session. `tool` is the agent being rendered
 * for, used to disambiguate a config dir claimed by several tools. Never throws.
 */
export async function sessionAccount(env: Env = process.env, tool?: string): Promise<SessionAccount> {
  const configDir = sessionConfigDir(env);
  const unresolved: SessionAccount = { configDir, profile: null, tool: null, source: null };
  try {
    const paths = await accountsPaths(env);
    const entry = registryEntry(paths.store, configDir, env, tool);
    const name = str(entry?.name);
    const owner: SessionAccount = name
      ? { configDir, profile: name, tool: str(entry?.tool), source: "registry" }
      : (layoutProfile(paths.profiles, configDir, env) ?? unresolved);
    // An in-place switch overrides the owner, but only while it is still in
    // effect. A marker the dir's live login contradicts is stale and must be
    // ignored — otherwise every pane reports the last-switched profile no
    // matter who it is actually logged in as (bug 2089be70). A nameless but
    // still-current occupant suppresses the owner's name — reporting it would
    // be a stale identity — and lets callers fall back to `sessionAccountEmail`.
    const occupant = switchedOccupant(configDir);
    if (occupant && occupantMatchesLiveLogin(occupant, env))
      return { configDir, profile: occupant.profile, tool: owner.tool, source: "switched" };
    return owner;
  } catch {
    return unresolved;
  }
}

/**
 * Email this session is logged in as. The host agent's own record for this
 * config dir wins over the registry's copy, which can lag behind a re-login.
 * Read separately from `sessionAccount` because it parses the agent's state
 * blob, which is large enough to only touch when a segment asks for it.
 */
export async function sessionAccountEmail(env: Env = process.env, tool?: string): Promise<string | null> {
  try {
    const live = liveAccountEmail(env);
    if (live) return live;
    const configDir = sessionConfigDir(env);
    // After an in-place switch the registry's email describes the dir's
    // parked owner, not this session — the marker's copy is the occupant's.
    const occupant = switchedOccupant(configDir);
    if (occupant) return occupant.email;
    const paths = await accountsPaths(env);
    return str(registryEntry(paths.store, configDir, env, tool)?.email);
  } catch {
    return null;
  }
}

/**
 * Account state directory for this environment. `@hasna/accounts` keys every
 * cache path off `accountsHome()`, which is `ACCOUNTS_HOME` or the documented
 * default and nothing else — so resolving it here stays in step with the
 * package without paying for its (optional) import.
 */
function accountsHomeDir(env: Env): string {
  const override = str(env[ACCOUNTS_HOME_ENV]);
  return override ? expandHome(override, env) : join(home(env), ...DEFAULT_ACCOUNTS_HOME);
}

/**
 * The account uuid the host agent recorded as logged in for this config dir.
 * Read from the same live state blob `sessionAccountEmail` prefers, so it names
 * whoever is actually signed in now — the account whose usage the warmer
 * cached — rather than a registry entry that can lag a re-login or a switch.
 * Returns null when no record is present or the value is not a safe cache key.
 */
export function sessionAccountUuid(env: Env = process.env): string | null {
  try {
    const stateFile = sessionStateFile(env);
    if (!stateFile) return null;
    const uuid = str(readJson(stateFile)?.oauthAccount?.accountUuid);
    return uuid && SAFE_UUID.test(uuid) ? uuid : null;
  } catch {
    return null;
  }
}

/** Usage headroom for this session's account, as percent still available. */
export interface SessionUsage {
  /** The ~5-hour session window's remaining percent, or null when unknown. */
  sessionHeadroom: number | null;
  /** The weekly window's remaining percent — the binding limit — or null. */
  weeklyHeadroom: number | null;
}

interface UsageWindow {
  id?: unknown;
  utilization?: unknown;
  scoped?: unknown;
  group?: unknown;
  resetsAt?: unknown;
}

type WindowClass = "session" | "weekly" | "scoped" | "unknown";

/**
 * Classify a window the way accounts does: an explicit `scoped` flag or
 * `group`/`id` wins, and a reset horizon past the 5-hour session bound is the
 * last resort. Scoped windows describe a sub-limit and never set the headroom.
 */
function classifyWindow(w: UsageWindow, fetchedAt: number | null): WindowClass {
  if (w.scoped === true) return "scoped";
  const group = str(w.group);
  if (group === "session" || group === "weekly") return group;
  const id = str(w.id);
  if (id) {
    if (id.includes("session")) return "session";
    if (id.includes("weekly")) return "weekly";
  }
  const resetsAt = typeof w.resetsAt === "string" ? Date.parse(w.resetsAt) : Number.NaN;
  if (Number.isFinite(resetsAt) && fetchedAt !== null && resetsAt - fetchedAt > SESSION_WINDOW_MAX_MS) {
    return "weekly";
  }
  return "unknown";
}

/**
 * Remaining percent for one window. A window whose reset has passed since it
 * was fetched has rolled over and is fully replenished — reporting its stale
 * high utilization would be a wrong number. null when utilization is unusable.
 */
function windowHeadroom(w: UsageWindow, now: number, fetchedAt: number | null): number | null {
  const resetsAt = typeof w.resetsAt === "string" ? Date.parse(w.resetsAt) : Number.NaN;
  const rolled = Number.isFinite(resetsAt) && resetsAt <= now && (fetchedAt === null || resetsAt > fetchedAt);
  if (rolled) return 100;
  const util = typeof w.utilization === "number" && Number.isFinite(w.utilization) ? w.utilization : null;
  if (util === null) return null;
  return Math.max(0, Math.min(100, Math.round(100 - util)));
}

/** Reduce the cache's windows to session and weekly headroom. */
function deriveUsage(usage: unknown, now: number): SessionUsage {
  const u = (usage ?? {}) as { windows?: unknown; fetchedAt?: unknown };
  const windows: UsageWindow[] = Array.isArray(u.windows) ? (u.windows as UsageWindow[]) : [];
  const fetchedAtMs = typeof u.fetchedAt === "string" ? Date.parse(u.fetchedAt) : Number.NaN;
  const fetchedAt = Number.isFinite(fetchedAtMs) ? fetchedAtMs : null;
  let session: number | null = null;
  let weekly: number | null = null;
  let unknownMin: number | null = null;
  for (const w of windows) {
    const cls = classifyWindow(w, fetchedAt);
    if (cls === "scoped") continue;
    const h = windowHeadroom(w, now, fetchedAt);
    if (h === null) continue;
    if (cls === "session") session = session === null ? h : Math.min(session, h);
    else if (cls === "weekly") weekly = weekly === null ? h : Math.min(weekly, h);
    else unknownMin = unknownMin === null ? h : Math.min(unknownMin, h);
  }
  // An unclassified non-scoped window can only pull weekly headroom down, never
  // raise it — the same conservative fold accounts applies.
  const weeklyHeadroom =
    weekly !== null ? (unknownMin !== null ? Math.min(weekly, unknownMin) : weekly) : unknownMin;
  return { sessionHeadroom: session, weeklyHeadroom };
}

/**
 * Session and weekly usage headroom for the account this pane is running as,
 * read straight from the accounts usage cache — never the cloud API, which the
 * launched, registry-stripped session cannot reach and could not afford on
 * every render anyway. Returns nulls (so a segment shows a neutral marker)
 * whenever the account is unknown, the cache is missing, stale, corrupt, or
 * keyed to a different account. Never throws.
 */
export function sessionUsage(env: Env = process.env, now: Date = new Date()): SessionUsage {
  const empty: SessionUsage = { sessionHeadroom: null, weeklyHeadroom: null };
  try {
    const uuid = sessionAccountUuid(env);
    if (!uuid) return empty;
    const path = join(accountsHomeDir(env), CACHE_SUBDIR, USAGE_CACHE_SUBDIR, `${uuid}.json`);
    if (!existsSync(path)) return empty;
    const entry = readJson(path);
    // The cache stamps the account it belongs to; a filename match is not enough.
    if (!entry || entry.accountUuid !== uuid) return empty;
    const fetchedAt = typeof entry.fetchedAt === "string" ? Date.parse(entry.fetchedAt) : Number.NaN;
    if (!Number.isFinite(fetchedAt) || now.getTime() - fetchedAt > USAGE_CACHE_MAX_AGE_MS) return empty;
    return deriveUsage(entry.usage, now.getTime());
  } catch {
    return empty;
  }
}
