type Environment = Record<string, string | undefined>;
/**
 * Opt-in that lets the pack smoke run the offline archive-extraction
 * diagnostic when an isolated `bun install` is unavailable. It never turns a
 * degraded run into a pass: the diagnostic still exits with the UNVERIFIED
 * code, so `verify:release` — and with it `prepack`/`prepublishOnly` — fails.
 */
export declare const PACK_INSTALL_FALLBACK_ENV = "CONTRACTS_ALLOW_PACK_INSTALL_FALLBACK";
/**
 * Test seam: forces the pack smoke to treat the isolated `bun install` as
 * unavailable, so the fail-closed refusal stays reachable on a host that can in
 * fact install. It can only ever DENY the install — forcing a denial makes the
 * gate stricter, never laxer — so it cannot walk an unverified build past the
 * publish gate.
 */
export declare const PACK_INSTALL_DENY_ENV = "CONTRACTS_PACK_INSTALL_DENY";
export declare function packInstallFallbackAllowed(env?: Environment): boolean;
export declare function packInstallDenied(env?: Environment): boolean;
export declare function isEnvironmentRestrictedInstall(output: string): boolean;
export declare function packInstallUnavailableMessage(label: string, detail: string): string;
export declare function packSmokeUnverifiedMessage(label: string, detail: string): string;
export interface PackedTreeAudit {
    readonly ok: boolean;
    readonly failures: readonly string[];
}
/** File entries of a packed archive listing, relative to the package root. */
export declare function archivePackageEntries(entries: Iterable<string>, prefix?: string): string[];
export declare function auditExtractedPackage(packageRoot: string, expectedFiles: readonly string[]): PackedTreeAudit;
export interface PackedConsumerInstallOptions {
    /** Tarball produced by `bun pm pack`. */
    readonly archivePath: string;
    /** Consumer workspace whose `node_modules` is (re)built from the archive. */
    readonly consumerRoot: string;
    /** Repository root the runtime dependencies are copied out of. */
    readonly repoRoot: string;
    /** Raw `tar -tzf` listing of the archive, used as the audit's expectation. */
    readonly archiveEntries: Iterable<string>;
    /** Runtime dependencies the consumer smoke imports. */
    readonly runtimeDependencies: readonly string[];
}
/**
 * Populate an isolated consumer tree from the packed archive and audit it
 * against the archive's own entry list. Throws when the extraction or the audit
 * fails; callers still have to treat a successful return as UNVERIFIED, because
 * nothing here resolves a dependency range.
 *
 * Returns the package root the consumer will resolve.
 */
export declare function installPackedConsumerFromArchive(options: PackedConsumerInstallOptions): string;
export {};
