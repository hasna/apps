export interface CheckSigningSecretOptions {
    app?: unknown;
    signingSecretEnv?: unknown;
    json?: unknown;
}
export interface CheckSigningSecretDeps {
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
    errorLog?: (line: string) => void;
}
export interface CheckSigningSecretResult {
    /** Process exit code: 0 clean, 1 a secret that needs trimming, 2 a usage error. */
    exitCode: number;
    payload: Record<string, unknown>;
}
/**
 * Check one app's signing secret as the environment presents it.
 *
 * Fails (exit 1) when the stored value carries leading or trailing whitespace,
 * and (exit 2) when no key holds a usable value at all: a provisioning lane that
 * cannot see the secret has not verified anything, and reporting that as a pass
 * is the failure mode this command exists to remove.
 */
export declare function checkSigningSecret(options: CheckSigningSecretOptions, deps?: CheckSigningSecretDeps): CheckSigningSecretResult;
/** CLI entry point: prints the report (never the value) and returns the exit code. */
export declare function runCheckSigningSecret(options: CheckSigningSecretOptions, deps?: CheckSigningSecretDeps): number;
