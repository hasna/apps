/**
 * @hasna/machines data-home resolution through the @hasna/paths resolver.
 *
 * machines stores its sqlite db (`machines.db`), manifest, roster, clipboard
 * and flip-ledger state under a single data root. Historically that root was
 * `~/.hasna/machines`. This module resolves the root through `@hasna/paths`
 * (XDG / macOS home layout) with a gated legacy adoption: the legacy
 * `~/.hasna/machines` stays the effective data root until the store has been
 * physically migrated to the XDG data home (`machines.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * (`HASNA_MACHINES_HOME` / `MACHINES_HOME`, plus the pre-existing
 * `HASNA_MACHINES_DIR`) win unconditionally, and the per-file path overrides
 * (`HASNA_MACHINES_*_PATH`) stay layered on top.
 */
/** The effective user home, mirroring the pre-existing machines resolution (`HOME` || `USERPROFILE`). */
export declare function getHomeDir(): string;
/** The legacy (pre-XDG) data root: `~/.hasna/machines`. */
export declare function getLegacyDataDir(): string;
/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for machines:
 * `~/.local/share/hasna/machines` on Linux, `~/Library/Application
 * Support/Hasna/machines` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export declare function getResolverDataDir(): string;
/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`machines.db` exists — machines' store file). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export declare function adoptResolverDataDir(resolved: string, env?: NodeJS.ProcessEnv): boolean;
/** The exact-app override root, when set: `HASNA_MACHINES_HOME`, then `MACHINES_HOME`, then the legacy `HASNA_MACHINES_DIR`. */
export declare function getExactDataDir(): string | undefined;
/**
 * The effective machines data root: an exact-app override
 * (`HASNA_MACHINES_HOME`, then `MACHINES_HOME`, then the pre-existing
 * `HASNA_MACHINES_DIR`) wins unconditionally; otherwise the resolver (XDG)
 * data root once adopted (`HASNA_DATA_HOME` set, or `machines.db` already
 * migrated there); otherwise the legacy `~/.hasna/machines` default — an
 * existing store never becomes invisible on upgrade.
 */
export declare function getDataDir(): string;
export declare function getDbPath(): string;
export declare function getManifestPath(): string;
/**
 * Resolve one exact manifest authority for candidate operations.
 * An explicit CLI path may not silently override a different environment path.
 */
export declare function resolveExactManifestPath(explicitPath?: string, env?: NodeJS.ProcessEnv): string;
export declare function getNotificationsPath(): string;
export declare function getFreezePath(): string;
export declare function getRolloutRecordsPath(): string;
export declare function getRosterConfigPath(): string;
export declare function getRosterRecordsPath(): string;
export declare function getRosterHeartbeatPath(): string;
export declare function getClipboardKeyPath(): string;
export declare function getClipboardHistoryPath(): string;
export declare function ensureParentDir(filePath: string): void;
export declare function ensureDataDir(): string;
/**
 * The per-run flip ledger (P1-C). JSONL, one entry per machine per flip run.
 * Every row is value-free: machine, app, ts, result, source-of-value, sha256,
 * provenance-gate verdict.
 */
export declare function getFlipLedgerPath(): string;
