import { type Env } from "./server-backend.js";
import { type BlackboxRunner } from "./conformance-client.js";
/**
 * `report` (1.1.0): the check found violations but is not yet enforced for
 * this repo — it never turns `ok` false. `strict` promotes `report` to `fail`.
 */
export type ConformanceStatus = "pass" | "fail" | "skip" | "report";
export interface ConformanceCheck {
    id: string;
    status: ConformanceStatus;
    detail: string;
}
export interface RepoConformanceReport {
    ok: boolean;
    repoRoot: string;
    name: string | null;
    class: string | null;
    checks: ConformanceCheck[];
}
export interface RepoConformanceOptions {
    /** Environment to parse for mode-enum compliance (defaults to process.env). */
    env?: Env;
    /** Optional sampled `GET /health` payload to shape-check. */
    healthSample?: unknown;
    /** Skip the no-cloud scan (useful when a caller runs it separately). */
    skipNoCloudScan?: boolean;
    /** Skip the credential-seam scan (useful when a caller runs it separately). */
    skipCredentialSeamScan?: boolean;
    /** Public manifests are checked for private infrastructure references. */
    manifestTier?: "public" | "private";
    /** Clock used for time-boxed checks such as storage-waiver expiry. */
    now?: Date;
    /**
     * Promote the 1.1.0 client-contract checks (`client_transport_declared`,
     * `client_sqlite_isolation`, `client_fail_closed_blackbox`,
     * `no_mode_vocabulary`, `no_legacy_hostnames`, `kit_version_pinned`) from
     * `report` to `fail`. Off by default in 1.1.x; the 1.2.0 default.
     */
    strict?: boolean;
    /** Run the black-box fail-closed probe against the built bin when the manifest declares `client.readProbe`. Default true. */
    blackbox?: boolean;
    /** Process runner for the black-box probe (tests). */
    blackboxRunner?: BlackboxRunner;
}
export declare function runRepoConformance(repoRoot: string, options?: RepoConformanceOptions): RepoConformanceReport;
