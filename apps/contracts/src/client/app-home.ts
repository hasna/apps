// The ONE home resolver for Hasna apps (2026-09-04 home-layout ruling).
//
//   public apps   (@hasna/<app>)                -> ~/.hasna/<app>
//   internal apps (the internal package scope)  -> the same root with the
//                                                  `-internal` suffix, /<app>
//
// The internal names are assembled from fragments below: a PUBLIC tarball must
// not carry the internal org's name as a literal (the publish guard scans for
// it), while the resolved paths stay exactly the ruled ones.
//
// Sub-layers inside the home: `config/` (credentials and non-secret routing
// config), `state/`, `cache/`, and DATA at the home root (the opted-in local
// store lives at `<home>/<app>.db` and nowhere else). The overrides are
// `HASNA_HOME` (replaces the scope root) and `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME`
// (each replaces one layer's root for every app at once, giving
// `<override>/<app>`). They follow XDG semantics — absolute only, blank is
// unset — but XDG's own variables are never read, and neither is
// `~/Library/Application Support`. There is no other root.
//
// `HOME` and every override come from the env object the caller passes, never
// from `os.homedir()`: an env with neither HOME nor HASNA_HOME resolves to
// nothing, which is what keeps callers hermetic.

import { isAbsolute, join } from "node:path";
import { type Env } from "../env-token.js";

export const APP_HOME_SCOPES = ["public", "internal"] as const;
export type AppHomeScope = (typeof APP_HOME_SCOPES)[number];

export const HASNA_HOME_ENV_KEY = "HASNA_HOME";
export const HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
export const HASNA_DATA_HOME_ENV_KEY = "HASNA_DATA_HOME";
export const HASNA_STATE_HOME_ENV_KEY = "HASNA_STATE_HOME";
export const HASNA_CACHE_HOME_ENV_KEY = "HASNA_CACHE_HOME";
/** Every override this resolver honours. Nothing else moves an app home. */
export const APP_HOME_ENV_KEYS = [
  HASNA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_DATA_HOME_ENV_KEY,
  HASNA_STATE_HOME_ENV_KEY,
  HASNA_CACHE_HOME_ENV_KEY,
] as const;

export const PUBLIC_HOME_DIR_NAME = ".hasna";
/** The suffix that turns the public root and the public package scope into the internal ones. */
export const INTERNAL_SCOPE_SUFFIX = "internal";
/** `.hasna` + `-` + the internal suffix. */
export const INTERNAL_HOME_DIR_NAME = [PUBLIC_HOME_DIR_NAME, INTERNAL_SCOPE_SUFFIX].join("-");
/** `@hasna-` + the internal suffix + `/` — the package scope prefix of internal apps. */
export const INTERNAL_PACKAGE_SCOPE_PREFIX = ["@hasna", `${INTERNAL_SCOPE_SUFFIX}/`].join("-");
export const APP_CONFIG_SUBDIR = "config";
export const APP_STATE_SUBDIR = "state";
export const APP_CACHE_SUBDIR = "cache";
export const APP_CREDENTIALS_FILE = "credentials";

/**
 * An app name that is safe to put in a filesystem path — the same grammar as
 * the DNS label the transport requires. Checked here because this module is a
 * FILESYSTEM sink.
 */
export const APP_HOME_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The scope for a package name: `@hasna/*` is public, the internal package scope is internal, anything else is unknown. */
export function appScopeForPackageName(packageName: string): AppHomeScope | null {
  if (packageName.startsWith("@hasna/")) return "public";
  if (packageName.startsWith(INTERNAL_PACKAGE_SCOPE_PREFIX)) return "internal";
  return null;
}

/** `.hasna`, or the same name with the `-internal` suffix. */
export function scopeHomeDirName(scope: AppHomeScope): string {
  return scope === "internal" ? INTERNAL_HOME_DIR_NAME : PUBLIC_HOME_DIR_NAME;
}

export interface ResolveAppHomeOptions {
  /** Defaults to `"public"`. Internal apps pass `"internal"` (from `hasna.contract.json` `scope`). */
  scope?: AppHomeScope;
}

export interface AppHomeSources {
  /** What anchored the scope root: `HASNA_HOME` or `HOME`. */
  root: string;
  /** What decided the config layer: `HASNA_CONFIG_HOME` or the home. */
  config: string;
  data: string;
  state: string;
  cache: string;
}

export interface AppHome {
  name: string;
  scope: AppHomeScope;
  /** The scope root: `~/.hasna`, or the same root with the `-internal` suffix (or `HASNA_HOME`). */
  root: string;
  /** `<root>/<app>` — the app home. Data lives here. */
  home: string;
  /** `<home>/config` (or `<HASNA_CONFIG_HOME>/<app>`). */
  config: string;
  /** `<config>/credentials` — read by the credential resolver, written only by provisioning. */
  credentials: string;
  /** `<home>` (or `<HASNA_DATA_HOME>/<app>`). */
  data: string;
  /** `<home>/state` (or `<HASNA_STATE_HOME>/<app>`). */
  state: string;
  /** `<home>/cache` (or `<HASNA_CACHE_HOME>/<app>`). */
  cache: string;
  /** `<data>/<app>.db` — the ONLY place an opted-in on-box store may live. */
  localDb: string;
  /** Env key NAMES that decided each layer. Never values. */
  sources: AppHomeSources;
}

/** Thrown by {@link appPaths} when no HOME or HASNA_HOME anchors a root, or the name is unsafe. */
export class AppHomeUnresolvableError extends Error {
  readonly appName: string;
  constructor(appName: string, message: string) {
    super(message);
    this.name = "AppHomeUnresolvableError";
    this.appName = appName;
  }
}

/** An XDG-style override: an absolute, non-blank value; anything else is unset. */
function absoluteOverride(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : null;
}

function homeDir(env: Env): string | null {
  const home = env.HOME?.trim();
  return home ? home : null;
}

/**
 * Resolve an app's home and sub-layers, or `null` when neither `HOME` nor
 * `HASNA_HOME` anchors a root. Throws only for a name that is not a safe slug.
 */
export function resolveAppHome(name: string, env: Env = process.env, options: ResolveAppHomeOptions = {}): AppHome | null {
  if (!APP_HOME_SLUG_PATTERN.test(name)) {
    throw new AppHomeUnresolvableError(name, `App name '${name}' is not a safe path segment; use a lowercase dashed slug.`);
  }
  const scope: AppHomeScope = options.scope ?? "public";
  const rootOverride = absoluteOverride(env, HASNA_HOME_ENV_KEY);
  const home = homeDir(env);
  const root = rootOverride ?? (home ? join(home, scopeHomeDirName(scope)) : null);
  if (!root) return null;
  const appHome = join(root, name);

  const layer = (key: string, fallback: string): { path: string; source: string } => {
    const override = absoluteOverride(env, key);
    return override ? { path: join(override, name), source: key } : { path: fallback, source: "home" };
  };
  const config = layer(HASNA_CONFIG_HOME_ENV_KEY, join(appHome, APP_CONFIG_SUBDIR));
  const data = layer(HASNA_DATA_HOME_ENV_KEY, appHome);
  const state = layer(HASNA_STATE_HOME_ENV_KEY, join(appHome, APP_STATE_SUBDIR));
  const cache = layer(HASNA_CACHE_HOME_ENV_KEY, join(appHome, APP_CACHE_SUBDIR));

  return Object.freeze({
    name,
    scope,
    root,
    home: appHome,
    config: config.path,
    credentials: join(config.path, APP_CREDENTIALS_FILE),
    data: data.path,
    state: state.path,
    cache: cache.path,
    localDb: join(data.path, `${name}.db`),
    sources: Object.freeze({
      root: rootOverride ? HASNA_HOME_ENV_KEY : "HOME",
      config: config.source,
      data: data.source,
      state: state.source,
      cache: cache.source,
    }),
  });
}

/**
 * {@link resolveAppHome} that THROWS when no root can be anchored — for
 * callers about to open the on-box store, where "no home" is not a place to
 * write.
 */
export function appPaths(name: string, env: Env = process.env, options: ResolveAppHomeOptions = {}): AppHome {
  const resolved = resolveAppHome(name, env, options);
  if (!resolved) {
    throw new AppHomeUnresolvableError(
      name,
      `No HOME or ${HASNA_HOME_ENV_KEY} in this environment, so no home can be resolved for '${name}'.`,
    );
  }
  return resolved;
}
