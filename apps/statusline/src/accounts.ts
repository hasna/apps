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
   * a rename — see `layoutProfile`. Surfaced for diagnostics, not for display.
   */
  source: "registry" | "layout" | null;
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
    if (name) return { configDir, profile: name, tool: str(entry?.tool), source: "registry" };
    return layoutProfile(paths.profiles, configDir, env) ?? unresolved;
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
    const stateFile = sessionStateFile(env);
    const live = stateFile ? str(readJson(stateFile)?.oauthAccount?.emailAddress) : null;
    if (live) return live;
    const paths = await accountsPaths(env);
    return str(registryEntry(paths.store, sessionConfigDir(env), env, tool)?.email);
  } catch {
    return null;
  }
}
