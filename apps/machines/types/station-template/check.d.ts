import { type WorkstationTestVerification } from "../test-profile.js";
import type { EffectiveTemplate } from "./schema.js";
export type CheckStatus = "ok" | "drift" | "violation" | "skipped";
export interface TemplateCheckItem {
    id: string;
    kind: "file" | "ordering" | "sysctl" | "runtime-value" | "package" | "command" | "service" | "workstation-test-profile" | "access-floor" | "unit-convention" | "tailscale" | "absence" | "swap" | "disk" | "journald";
    status: CheckStatus;
    detail: string;
}
export interface TemplateCheckResult {
    schemaId: string;
    /**
     * Which box this report describes. The check reads the local filesystem, so
     * a fleet sweep that forgets that would otherwise attribute the
     * coordinator's own state to every station.
     */
    machineId: string;
    template: string;
    version: string;
    layers: string[];
    /**
     * "clean" only when no drift AND no violation.
     *
     * The rc is now load-bearing too — see `checkExitCode`. Before template
     * 1.8.0 it was always 0 and every caller in the fleet had to parse this field and
     * explicitly distrust the exit code ("check_rc=0 (NOT trusted)" in every
     * driver measurement). Both are now truthful; the JSON stays the richer
     * answer because it names WHICH item failed.
     */
    verdict: "clean" | "drift";
    checkedAt: string;
    items: TemplateCheckItem[];
}
export type CommandProbe = (command: string, args: string[]) => {
    ok: boolean;
    stdout: string;
};
/**
 * Process exit code for a drift check.
 *
 * `0 clean / 1 findings / 2 incomplete`, matching the exit-code contract on the
 * table for `todos doctor` (task 71f7faba). That contract is scoped to the
 * todos CLI and has not landed, so it does not bind this one — but the estate
 * gets ONE numeric language for "did the check pass", not two, so this
 * conforms rather than inventing a second convention.
 *
 * Findings outrank incompleteness: if something was found, that is the answer,
 * regardless of what else could not be probed.
 *
 * 2 matters as much as 1. A check with `skipped` items has not proven the box
 * clean, it has proven it could not look — and "could not look" reported as
 * success is how the previous version of this gate passed a station running a
 * live tailscale it was supposed to assert was absent.
 */
export declare function checkExitCode(result: TemplateCheckResult): 0 | 1 | 2;
export interface CheckOptions {
    /** Filesystem root for all absolute targets (tests use a fixture dir). */
    rootDir?: string;
    /** Home directory for ~/ targets. */
    homeDir?: string;
    /**
     * Probe for command-backed checks (dpkg-query, systemctl, bun). Pass null to
     * skip those checks entirely (they report status=skipped). Defaults to real
     * execution when rootDir is "/" and to skipped otherwise, so a fixture check
     * never shells out by accident.
     */
    commandProbe?: CommandProbe | null;
    /** Exact semantic controller result for fixture checks; local checks read the live package-owned controller. */
    workstationTestProfileVerification?: WorkstationTestVerification;
    /** Additional systemd unit dirs to scan for unit conventions. */
    unitDirs?: string[];
    /**
     * Root of bun's global install tree. Defaults to $BUN_INSTALL or ~/.bun,
     * matching bun's own resolution, so `bun install -g` results are checkable.
     */
    bunInstallDir?: string;
    /** Identity stamped into the result. Defaults to the local machine id. */
    machineId?: string;
}
/**
 * Compare two semver core versions. Returns <0, 0, >0, or null when either
 * side is not readable as x.y.z — an unreadable version is never silently
 * treated as satisfying a floor.
 *
 * Prerelease handling follows semver: 1.2.3-rc.1 sorts BELOW 1.2.3, so a
 * release candidate does not satisfy a floor of the release it precedes.
 * Build metadata (+sha) is ignored, as semver requires.
 */
export declare function compareVersions(left: string, right: string): number | null;
/** Systemd applies drop-ins by filename, independent of directory enumeration order. */
export declare function sortSystemdDropinNames(names: readonly string[]): string[];
/**
 * Read-only drift check of a box against the effective template. NEVER
 * mutates anything — every probe is a read. The verdict lives in the returned
 * JSON, and as of template 1.8.0 the CLI's exit code carries it too (`checkExitCode`):
 * station contract §2 said exit codes from hasna CLIs are unreliable, and the
 * answer to that was to fix the exit code, not to keep writing gates that
 * distrust it.
 */
export declare function checkStationTemplate(effective: EffectiveTemplate, options?: CheckOptions): TemplateCheckResult;
