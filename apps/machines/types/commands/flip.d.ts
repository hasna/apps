/**
 * Fleet env-flip mechanism (local store <-> hosted API client).
 *
 * Coordinates flipping an @hasna OSS app's client backend across the
 * fleet from local (on-box sqlite/json) to **api** (the app's hosted
 * API at https://<app>.<fleet-domain>) — and back — by:
 *   1. writing a per-app fleet env file on each target machine,
 *   2. wiring that env file into the app's service manager (systemd / launchd),
 *   3. restarting the service,
 *   4. verifying `<app> storage status --json` reports the expected mode,
 *   5. supporting one-command revert (unset the two vars -> local original).
 *
 * ARCHITECTURE (LOCKED): the only sanctioned cloud path for a CLIENT machine is
 * the app HTTPS API — client -> https://<app>.<fleet-domain>/v1 with a bearer
 * `HASNA_<APP>_API_KEY`. The raw RDS DSN is NEVER distributed to machines and
 * `STORAGE_MODE=remote` + `DATABASE_URL` is FORBIDDEN on clients. RDS is only
 * reachable by the in-VPC ECS services + the admin tunnel. This module therefore
 * writes exactly two vars per app:
 *     HASNA_<APP>_API_URL=https://<app>.<fleet-domain>
 *     HASNA_<APP>_API_KEY=<key from Secrets Manager hasna/oss/<app>/api-key>
 *
 * The `<fleet-domain>` is REQUIRED for a real deployment: set
 * `HASNA_FLEET_API_DOMAIN` to the operator's own private root domain before
 * running this for real. This published package never bakes in a real
 * internal hostname — absent that env var it falls back to a neutral,
 * non-resolving placeholder domain.
 *
 * SECRETS: the API key is NEVER transported in cleartext by the orchestrator.
 * The remote script fetches it on the target machine via `secrets exec`; the
 * orchestrator only ever handles the secret *path*. Nothing here logs a value
 * or captures it from stdout.
 *
 * Rollout shape: canary (1 machine) -> batch -> all, OR a single atomic wave via
 * `--all-machines` (used by the coordination-store cutover so machines flip
 * together, never half-flipped / split-brain). An optional freeze-check hook
 * (coordination stores) must pass before any mutation proceeds.
 */
import type { FleetManifest, MachinePlatform } from "../types.js";
export type FlipMode = "api" | "local";
/** Normalize user-facing mode aliases to the canonical FlipMode. */
export declare function normalizeFlipMode(value?: string): FlipMode;
/** Per-app fleet-flip profile. Add a new app by adding an entry here. */
export interface FlipAppSpec {
    /** App identifier, e.g. "todos". */
    app: string;
    /** Env var carrying the app API base URL, e.g. HASNA_TODOS_API_URL. */
    apiUrlEnv: string;
    /** Env var carrying the app API bearer key, e.g. HASNA_TODOS_API_KEY. */
    apiKeyEnv: string;
    /** App API base URL, e.g. https://todos.<fleet-domain> (client appends /v1). */
    apiUrl: string;
    /** Secret PATH (never the value) resolved on-target via `secrets exec`. */
    apiKeySecretPath: string;
    /** systemd/launchd service unit/label base name, e.g. hasna-todos-mcp. */
    serviceUnit: string;
    /** CLI binary used to read storage status, e.g. "todos". */
    cliBin: string;
    /** Args passed to the CLI to emit redacted JSON storage status. */
    statusArgs: string;
    /**
     * Extra env lines (KEY=VALUE) applied only in api mode. Values here
     * are non-secret literals only (e.g. shadow flags). Never a secret/DSN.
     */
    extraApiEnv?: Record<string, string>;
    /**
     * When true this app requires a passing freeze-check before any flip
     * (coordination stores: drain the dual-write shadow to divergence==0 before
     * the atomic cutover). See runFreezeCheck.
     */
    freezeRequired?: boolean;
    /**
     * When true the credential is a Vault POINTER consumed by the app's own CLI:
     * the generated script writes `${apiKeyEnv}=${apiKeySecretPath}` (the
     * pointer — a non-secret path) into the fleet env file instead of fetching
     * the secret value on-target and materialising a literal key. Use for apps
     * whose consumer contract resolves a stored secret pointer itself (emails
     * resolves EMAILS_CLIENT_ENV_SECRET through `secrets` at runtime).
     */
    keyViaSecretPointer?: boolean;
    /**
     * Env keys the provisioned fleet env file MUST carry after an api-mode
     * write, verified ON the target machine before the file becomes the
     * provisioned state. Defaults to [apiUrlEnv, apiKeyEnv] — the effective
     * pair every app's script writes. A provision that would leave a reduced
     * env file aborts with FLIP_ERROR (exit 3) instead of starting a session
     * whose CLIs silently fall back to empty local stores (incident 715712:
     * a harness session-env re-provision dropped the hosted API env for
     * TODOS/KNOWLEDGE/EMAILS and the CLIs served false-empty SQLite at rc=0).
     */
    clientEnvRequiredKeys?: readonly string[];
    /**
     * Dotted JSON path to the reported mode string inside the app's
     * `<cliBin> <statusArgs>` payload. Default "mode" (all generic apps).
     * Emails reports its mode at `mode.current`.
     */
    verifyModePath?: string;
    /** Human note surfaced in plans/docs. */
    note?: string;
}
/**
 * Canonical per-app flip registry — ALL 25 @hasna OSS apps.
 *
 * Secret paths follow the shared convention `hasna/oss/<app>/api-key`.
 * LOCKED: the client talks to the app's HTTPS API; no DSN ever
 * reaches a machine.
 */
export declare const FLIP_APPS: Record<string, FlipAppSpec>;
export declare function getFlipApp(app: string): FlipAppSpec;
export declare function listFlipApps(): FlipAppSpec[];
export interface FlipTarget {
    id: string;
    platform: MachinePlatform;
}
export interface SelectTargetsOptions {
    /** Explicit machine ids (comma/space accepted upstream, array here). */
    machines?: string[];
    /** Restrict to machines carrying ALL of these tags. */
    tags?: string[];
    /** Exclude these machine ids. */
    exclude?: string[];
}
/**
 * Resolve an ordered, de-duplicated target list from the fleet manifest.
 * Order is stable (manifest order) so the canary is deterministic.
 */
export declare function selectTargets(manifest: FleetManifest, options?: SelectTargetsOptions): FlipTarget[];
export interface FlipWave {
    name: string;
    index: number;
    targets: FlipTarget[];
}
export interface PlanWavesOptions {
    /** Machines in the canary wave (default 1). */
    canarySize?: number;
    /** Machines per batch wave after the canary (default 4). */
    batchSize?: number;
    /**
     * Atomic mode: put EVERY target into a single wave (no canary, no batching).
     * Used by `--all-machines` for the coordination-store cutover so the fleet
     * flips together and is never half-flipped.
     */
    atomic?: boolean;
}
/**
 * Split ordered targets into canary -> batch(es). The final batch is the
 * remainder ("all"). Guarantees: canary is first, every target appears once,
 * order preserved. With `atomic`, produces exactly one wave containing all
 * targets.
 */
export declare function planWaves(targets: FlipTarget[], options?: PlanWavesOptions): FlipWave[];
export interface BuildScriptOptions {
    /** Override the fleet env dir (default $HOME/.hasna/fleet-env). */
    envDir?: string;
    /** Skip the service restart (env written but not activated). */
    skipRestart?: boolean;
}
/**
 * Build the remote bash script that applies (mode="api") or reverts
 * (mode="local") the flip for one app on one machine.
 *
 * The API key is fetched on-target from the secret store; it never appears in
 * the script text, argv, or orchestrator logs. The env file is written 0600.
 * Revert removes the env file and the service drop-in entirely so the two vars
 * are fully unset and the app falls back to its untouched local original.
 */
export declare function buildFlipScript(spec: FlipAppSpec, mode: FlipMode, options?: BuildScriptOptions): string;
export interface StorageStatusVerification {
    ok: boolean;
    observedMode: string | null;
    apiEnabled: boolean | null;
    reason?: string;
    /** Result of the provenance gates (P1-C): ok only when the new fleet-env file supplied the connection. */
    provenanceOk?: boolean;
    /** The source the app reported for its API key (absolute path or env key), or null. Never a value. */
    apiKeySource?: string | null;
    /** The source the app reported for its API URL, or null. Never a value. */
    apiUrlSource?: string | null;
    /** The credential tier the app reported (e.g. fleet-env / legacy-cloud / legacy-env), or null. */
    apiKeyTier?: string | null;
    /** The source that proved the new file supplied the connection. */
    sourceOfValue?: string | null;
    /** sha256 of the env file the flip wrote (from the FLIP_SHA256 marker), or null. */
    envSha256?: string | null;
}
/** Extract the sha256 the flip script reported for the env file it wrote. */
export declare function extractFlipSha256(rawOutput: string): string | null;
/**
 * Provenance gates for a flip (P1-C, review P0-3 / Sol 5).
 *
 * The flip must PROVE the freshly written fleet-env file supplied the
 * connection, not merely that required vars exist and the app reports api
 * mode. When the app's status JSON reports the credential resolution fields
 * (`apiKeyTier` / `apiUrlSource` / `apiKeySource`, the `@hasna/contracts`
 * client-transport fields), this verifies them and rejects:
 *
 *   1. `apiKeyTier === "legacy-env"` — the key came from a process env var,
 *      not the fleet file;
 *   2. a `transportSource`/`apiUrlSource`/`apiKeySource` that names a file
 *      under `~/.hasna/cloud` — the app is still resolving from the legacy
 *      cloud dir;
 *   3. api mode whose exact source cannot be reported — api-backed mode with
 *      no reportable source fields (or a tier that is not a fleet/disk tier).
 *
 * Positive case: the reported key/URL source is the fleet-env file the flip
 * just wrote (matched on its `/fleet-env/<app>.env` suffix so any HOME
 * resolves), which proves the new file supplied the connection.
 */
export declare function verifyFlipProvenance(rawOutput: string, spec: FlipAppSpec, expected: FlipMode, options?: {
    expectedEnvFile?: string;
}): Pick<StorageStatusVerification, "provenanceOk" | "apiKeySource" | "apiUrlSource" | "apiKeyTier" | "sourceOfValue" | "envSha256" | "reason">;
/**
 * Parse `<app> storage status --json` output (possibly wrapped in the
 * FLIP_STATUS_BEGIN/END markers) and check it matches the expected mode.
 * Accepts either `api_enabled` or the legacy `remote_enabled` boolean.
 *
 * Read-side compat: the fleet updates in waves, so a not-yet-updated app may
 * still REPORT a retired mode word (e.g. `self_hosted`) in its status JSON.
 * Any non-local reported mode counts as api-backed; this code never emits the
 * retired words itself.
 */
export declare function verifyStorageMode(rawOutput: string, expected: FlipMode, spec?: FlipAppSpec): StorageStatusVerification;
/** Minimal shape of the injected remote command runner (see remote.ts). */
export type RunnerFn = (machineId: string, command: string, options?: {
    timeoutMs?: number;
}) => {
    stdout: string;
    stderr: string;
    exitCode: number;
};
export interface FreezeCheckResult {
    ok: boolean;
    reason?: string;
}
/**
 * Freeze-check hook for coordination-store cutovers.
 *
 * Before flipping a freeze-required app we require an explicit freeze command
 * to succeed (exit 0). Callers supply `freezeCommand` — e.g. a maintenance
 * script that pauses writers / drains the shadow queue to divergence==0. If the
 * app does not require a freeze, this is a no-op pass.
 */
export declare function runFreezeCheck(spec: FlipAppSpec, runner: RunnerFn, options: {
    machineId: string;
    freezeCommand?: string;
    timeoutMs?: number;
}): FreezeCheckResult;
export interface FlipMachineResult {
    machineId: string;
    wave: string;
    applied: boolean;
    verification: StorageStatusVerification;
    exitCode: number;
    error?: string;
}
/** One row of the per-run flip ledger (P1-C). No credential values, ever. */
export interface FlipLedgerEntry {
    ts: string;
    machine: string;
    app: string;
    wave: string;
    mode: FlipMode;
    /** dry-run | ok | FAIL */
    result: string;
    /** The source that supplied the connection (fleet-env file path) or null. */
    sourceOfValue: string | null;
    /** sha256 of the fleet env file the flip wrote, or null (dry-run / revert). */
    envSha256: string | null;
    /** Provenance gate verdict. */
    provenanceOk: boolean;
}
/** Ledger sink, injectable for tests and CLI `--ledger` overrides. */
export type FlipLedgerWriter = (entries: FlipLedgerEntry[]) => void;
/** Default no-op ledger sink — the CLI wires the file writer. */
export declare const NOOP_LEDGER_WRITER: FlipLedgerWriter;
export interface RunFlipOptions {
    spec: FlipAppSpec;
    mode: FlipMode;
    waves: FlipWave[];
    runner: RunnerFn;
    /** When false (default) nothing is executed; the plan is returned. */
    execute?: boolean;
    /** Freeze command required for freeze-required apps. */
    freezeCommand?: string;
    scriptOptions?: BuildScriptOptions;
    timeoutMs?: number;
    /** Abort remaining waves if any machine in a wave fails (default true). */
    stopOnWaveFailure?: boolean;
    /** Ledger sink; defaults to NOOP (the CLI wires the file writer). */
    ledger?: FlipLedgerWriter;
}
export interface RunFlipReport {
    app: string;
    mode: FlipMode;
    execute: boolean;
    results: FlipMachineResult[];
    aborted: boolean;
    abortReason?: string;
    /** Per-run ledger rows (P1-C): machine, app, ts, result, source-of-value, sha256. */
    ledger: FlipLedgerEntry[];
}
/**
 * Execute (or dry-run) the flip wave-by-wave. Verifies each machine's storage
 * status after applying. On any wave failure, halts before the next wave
 * (fail-safe) so a bad canary never cascades to the fleet.
 */
export declare function runFlip(options: RunFlipOptions): RunFlipReport;
/** Machine-readable plan (no execution) for `flip plan`. */
export interface FlipPlan {
    app: string;
    mode: FlipMode;
    freezeRequired: boolean;
    waves: {
        name: string;
        machines: string[];
    }[];
    scriptPreview: string;
    secretPathsReferenced: string[];
}
export declare function buildFlipPlan(spec: FlipAppSpec, mode: FlipMode, waves: FlipWave[], scriptOptions?: BuildScriptOptions): FlipPlan;
