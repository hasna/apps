/**
 * The single paths resolver for the Hasna fleet.
 *
 * Ruling hasna/apps#1668 (2026-09-04): one resolver lives here — in
 * `@hasna/contracts` — and every app resolves its local data/config/state/
 * cache roots through it. Apps must NOT reimplement or embed this logic
 * (repo-conformance check: tooling/ci/tests/standard/paths-conformance.test.ts
 * fails on copies) and must NOT hard-code `.hasna/<app>` or
 * `Application Support` literals.
 *
 * Placement (ruled):
 *   - macOS (`darwin`): every kind resolves under `~/.hasna/<app>/` — the
 *     layout every station wrapper, the `.hasna/projects` rule and the home
 *     taxonomy assume.
 *   - other platforms: XDG — `~/.config/hasna/<app>` (config),
 *     `~/.local/share/hasna/<app>` (data), `~/.local/state/hasna/<app>`
 *     (state), `~/.cache/hasna/<app>` (cache).
 *
 * Overrides (kind-level, same semantics the deleted @hasna/paths had):
 * `HASNA_CONFIG_HOME` / `HASNA_DATA_HOME` / `HASNA_STATE_HOME` /
 * `HASNA_CACHE_HOME` win unconditionally over the platform layout.
 * Per-app exact-app overrides (`HASNA_<APP>_HOME`, `MONITOR_CONFIG_DIR`, …)
 * are app-level policy layered on top by each app's thin wrapper; the
 * resolver itself only knows kind-level overrides and the app slug.
 *
 * Hosted mode must not create local data directories at all (hasna/apps#1613);
 * this resolver only matters for local placement and caches.
 */
export type PathKind = "config" | "data" | "state" | "cache";
/** The kind-level override env vars, in resolver order. */
export declare const PATH_KIND_ENV: Readonly<Record<PathKind, string>>;
export interface PathsResolverOptions {
    /** Lowercase kebab-case app slug (`[a-z0-9]+(-[a-z0-9]+)*`). */
    app: string;
    /** Nest under `internal/<app>` (kept for @hasna/paths parity; unused today). */
    internal?: boolean;
    /** Override the OS platform (tests). Defaults to `process.platform`. */
    platform?: string;
    /** Override the home directory. Defaults to `effectiveHome()`. */
    home?: string;
    /** Override the environment. Defaults to `process.env`. */
    env?: Record<string, string | undefined>;
}
/**
 * Resolve the user's home directory: `$HOME`, then `$USERPROFILE` (Windows),
 * then the OS user database. A home that cannot be resolved is a hard error —
 * never a literal "~" path (relative to cwd) and never an
 * "undefined"-prefixed path.
 */
export declare function effectiveHome(env?: NodeJS.ProcessEnv): string;
/** The kind-level override env var for a path kind, e.g. `HASNA_DATA_HOME`. */
export declare function kindEnv(kind: PathKind): string;
/**
 * The base directory for a path kind: the `HASNA_<KIND>_HOME` override when
 * set, otherwise the ruled platform layout — `~/.hasna` on macOS, XDG on
 * other platforms. The app slug is NOT part of the base.
 */
export declare function baseDir(kind: PathKind, options: PathsResolverOptions): string;
/**
 * Resolve a kind root for an app: `baseDir` + the app segment
 * (`internal/<app>` when `options.internal`).
 */
export declare function resolveDir(kind: PathKind, options: PathsResolverOptions): string;
/** The local data root for an app: `~/.hasna/<app>` (macOS) / XDG data (Linux). */
export declare function dataDir(options: PathsResolverOptions): string;
/** The local config root for an app. */
export declare function configDir(options: PathsResolverOptions): string;
/** The local state root for an app. */
export declare function stateDir(options: PathsResolverOptions): string;
/** The local cache root for an app. */
export declare function cacheDir(options: PathsResolverOptions): string;
