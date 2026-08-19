export type LoopbackBindScope = "loopback" | "wildcard";
/**
 * Opt-in that downgrades a fail-closed loopback gate to an explicit skip.
 * `bun test` honours it (one named control test still fails, so the run can
 * never be green without the security suites). The publish gate does not.
 */
export declare const LOOPBACK_SKIP_ENV = "CONTRACTS_ALLOW_LOOPBACK_SKIP";
/**
 * Test seam: a comma-separated list of scopes whose probe is forced to report
 * "cannot bind", so the fail-closed paths stay reachable on a host that can in
 * fact bind. It can only ever DENY a capability — forcing a denial makes every
 * gate stricter, never laxer — so it cannot be used to walk an unverified
 * build past a release gate.
 */
export declare const LOOPBACK_PROBE_DENY_ENV = "CONTRACTS_LOOPBACK_PROBE_DENY";
export declare const loopbackBindHostnames: Record<LoopbackBindScope, string>;
type Environment = Record<string, string | undefined>;
export declare function loopbackSkipAllowed(env?: Environment): boolean;
/**
 * Probe one bind scope. The result of a real probe is cached — binding a port
 * per gated suite is wasteful — but the deny seam is re-read every call so a
 * test can flip it without poisoning the cache.
 */
export declare function canBind(scope: LoopbackBindScope, env?: Environment): boolean;
export declare function canBindLoopback(env?: Environment): boolean;
export declare function canBindWildcard(env?: Environment): boolean;
export type LoopbackDecision = "run" | "skip" | "fail";
export interface LoopbackRequirement {
    readonly requires: readonly LoopbackBindScope[];
    readonly missing: readonly LoopbackBindScope[];
    readonly decision: LoopbackDecision;
}
export interface ResolveLoopbackOptions {
    readonly probe?: (scope: LoopbackBindScope) => boolean;
    readonly skipAllowed?: boolean;
}
export declare function resolveLoopbackRequirement(requires: readonly LoopbackBindScope[], options?: ResolveLoopbackOptions): LoopbackRequirement;
export declare function loopbackUnavailableMessage(label: string, missing: readonly LoopbackBindScope[]): string;
type SuiteBody = () => void;
type CaseBody = () => void | Promise<void>;
export interface LoopbackTestRunner {
    readonly describe: ((name: string, body: SuiteBody) => unknown) & {
        skip: (name: string, body: SuiteBody) => unknown;
    };
    readonly test: ((name: string, body: CaseBody) => unknown) & {
        skip: (name: string, body: CaseBody) => unknown;
    };
}
export interface LoopbackTestGate {
    readonly requirement: LoopbackRequirement;
    describe(name: string, body: SuiteBody): void;
    test(name: string, body: CaseBody): void;
}
/**
 * Gate a suite or a case on the bind scopes it actually uses.
 *
 * `run`  — the real runner, unchanged.
 * `skip` — the runner's skip, reachable only via LOOPBACK_SKIP_ENV.
 * `fail` — a single registered case that throws. The gated body is deliberately
 *          NOT executed (its setup binds the servers the runtime just refused),
 *          but the suite still reports a failure, so a runner that loses bind
 *          capability breaks the build instead of quietly shrinking the
 *          security suite to nothing.
 */
export declare function createLoopbackTestGate(requires: readonly LoopbackBindScope[], runner: LoopbackTestRunner, options?: ResolveLoopbackOptions): LoopbackTestGate;
export {};
