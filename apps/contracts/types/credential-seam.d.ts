export interface CredentialSeamFinding {
    /** Repo-relative path. */
    path: string;
    /** 1-based line number. */
    line: number;
    /** The env variable being read. */
    variable: string;
    /** Why it is a finding. */
    message: string;
}
export interface CredentialSeamWaiver {
    path: string;
    line: number;
    reason: string;
}
export interface CredentialSeamScan {
    findings: CredentialSeamFinding[];
    waivers: CredentialSeamWaiver[];
    /** Waivers rejected for carrying no usable justification. */
    invalidWaivers: CredentialSeamWaiver[];
    /** Number of source files actually inspected. A zero here means the scan proved nothing. */
    filesScanned: number;
}
export interface CredentialSeamScanOptions {
    /** The app name from the manifest. Its own client-flip keys are the strictest case. */
    appName: string;
}
/**
 * Scan a repo for hand-rolled resolutions of a Hasna client credential.
 *
 * Own-app keys and other services' client-flip keys are both findings: reading
 * another service's credential directly bypasses the seam exactly as reading
 * your own does.
 */
export declare function scanCredentialSeam(repoRoot: string, options: CredentialSeamScanOptions): CredentialSeamScan;
