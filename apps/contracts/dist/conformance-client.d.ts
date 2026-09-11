import type { ConformanceCheck } from "./conformance.js";
import { type ServiceContractManifest } from "./schemas.js";
import { type ImportGraph } from "./conformance-import-graph.js";
/** The result of running a bin once for the black-box check. `stdout` and `stderr` are diagnostics, never credential material. */
export interface BlackboxRunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}
/** Runs `argv` with EXACTLY `env` (nothing inherited) in `cwd`. Injected by tests. */
export type BlackboxRunner = (argv: readonly string[], env: Record<string, string>, cwd: string) => BlackboxRunResult;
export interface ClientContractCheckOptions {
    /** Report findings as `fail` instead of `report`. Off in 1.1.x. */
    strict?: boolean;
    /** Run the black-box fail-closed probe against the BUILT bin when the manifest declares `client.readProbe`. Default true. */
    blackbox?: boolean;
    /** Per-run timeout for the black-box probe. Default 60 s. */
    blackboxTimeoutMs?: number;
    /** The process runner for the black-box probe. Defaults to `spawnSync` of the current runtime. */
    blackboxRunner?: BlackboxRunner;
}
/** Every check id this module emits, in emission order. */
export declare const CLIENT_CONTRACT_CHECK_IDS: readonly ["client_transport_declared", "client_sqlite_isolation", "client_fail_closed_blackbox", "no_mode_vocabulary", "no_legacy_hostnames", "kit_version_pinned"];
export type ClientContractCheckId = (typeof CLIENT_CONTRACT_CHECK_IDS)[number];
/**
 * `client_transport_declared`: a repo with a CLI or MCP surface and a store
 * must say how its client reaches data — `client.transport: hosted`, or an
 * explicit `client: null` / `placement.hosted: never` for a local-by-design tool.
 */
export declare function clientTransportDeclaredCheck(manifest: ServiceContractManifest, options?: ClientContractCheckOptions): ConformanceCheck;
/**
 * `client_sqlite_isolation`: no CLI or MCP bin may reach a module that opens a
 * SQLite store through its relative-import graph, except the ONE module the
 * manifest names as `client.localStoreModule` — and that module must import
 * `selectsLocalStore` from `@hasna/contracts` so the door is asked first.
 */
export declare function clientSqliteIsolationCheck(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions, graph?: ImportGraph): ConformanceCheck;
/**
 * `client_fail_closed_blackbox`: run the BUILT `<name>` bin with an empty HOME,
 * `HASNA_STATION=no-such-station`, `USER=nobody` and no `HASNA_*` variables.
 * The read probe must exit 2 naming `CREDENTIAL_ABSENT` and create no store
 * or JSON file under HOME. With the local door open it must exit 0 and keep
 * its store at `<HOME>/<scope root>/<name>/<name>.db`; with the door open AND a
 * hosted key declared it must exit 6 naming `LOCAL_OPT_IN_CONFLICT`.
 * "Unreadable" cannot be produced black-box; the injected-runner unit tests
 * cover it.
 */
export declare function clientFailClosedBlackboxCheck(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions): ConformanceCheck;
interface VocabularyPattern {
    label: string;
    pattern: RegExp;
    /** Only outside the kit itself, which legitimately implements these. */
    outsideContracts?: boolean;
}
/** The retired vocabulary; labels are what a report prints. */
export declare function noModeVocabularyPatterns(): VocabularyPattern[];
/** `no_mode_vocabulary`: shipped source (comments masked, tests excluded) carries none of the retired words or second doors. */
export declare function noModeVocabularyCheck(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions, graph?: ImportGraph): ConformanceCheck;
/** The legacy hostname shapes; labels only, the hostnames themselves are never printed. */
export declare function noLegacyHostnamePatterns(): VocabularyPattern[];
/** `no_legacy_hostnames`: shipped source names no per-app origin, internal apex, or loopback default endpoint. */
export declare function noLegacyHostnamesCheck(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions, graph?: ImportGraph): ConformanceCheck;
/** `kit_version_pinned`: `kitVersion` equals the exact `@hasna/contracts` dependency pin (no range) and meets the fleet floor. */
export declare function kitVersionPinnedCheck(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions): ConformanceCheck;
/** All six client-contract checks, in the documented order. */
export declare function clientContractChecks(repoRoot: string, manifest: ServiceContractManifest, options?: ClientContractCheckOptions): ConformanceCheck[];
export {};
