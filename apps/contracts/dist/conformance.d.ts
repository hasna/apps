import { type Env } from "./server-backend";
export type ConformanceStatus = "pass" | "fail" | "skip";
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
}
export declare function runRepoConformance(repoRoot: string, options?: RepoConformanceOptions): RepoConformanceReport;
