import type { MachineCommandRunner } from "../remote.js";
import type { ExactBunAppsPlan, ExactBunAppsStatusResult, ExactBunPackageProbe, ExactBunRegistryPlanStep, ExactBunRegistrySourceRef, MachineManifest, ManifestPackageSpec } from "../types.js";
export declare const EXACT_BUN_PACKAGE_NAMES: readonly ["@hasnaxyz/infinity", "@hasnaxyz/factory"];
export declare const EXACT_BUN_PACKAGE_ORDERS: readonly [10, 20];
export declare const EXACT_BUN_MACHINES_PACKAGE_NAME: "@hasna/machines";
export declare const EXACT_BUN_MACHINES_PACKAGE_ORDER: 10;
export declare const EXACT_BUN_REGISTRY_URL = "https://registry.npmjs.org";
export declare const EXACT_BUN_TARGET_TIMEOUT_MS: number;
export interface ExactBunSourceLoader {
    (source: ExactBunRegistrySourceRef): Buffer;
}
export interface ExactBunBootstrapSourceLoader {
    (): Buffer;
}
export interface ExactBunTargetTransactionPayload {
    schema: "machines.exact_bun_transaction.v1";
    machineId: string;
    platform: "linux" | "macos";
    bunPath: string;
    steps: ExactBunRegistryPlanStep[];
}
export interface ExactBunTargetTransactionResult {
    schema: "machines.exact_bun_transaction_result.v1";
    machineId: string;
    platform: "linux" | "macos";
    state: "COMMITTED" | "ROLLED_BACK" | "ROLLBACK_FAILED";
    executed: number;
    probes: ExactBunPackageProbe[];
    reasonCodes: string[];
}
export interface TargetSourceRunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}
export interface ExactBunTargetDependencies {
    runSource?: (command: string, env: NodeJS.ProcessEnv, cwd?: string) => TargetSourceRunResult;
    temporaryRoot?: string;
}
/**
 * npmrc auth lines bun actually reads. The transaction delivers the publish
 * tokens to the child environment as HASNA_NPM_PUBLISH_TOKEN and
 * HASNAXYZ_NPM_PUBLISH_TOKEN (via `secrets exec --as`), but bun never reads
 * those variables for registry authentication — its auth surfaces are .npmrc
 * `_authToken` entries (with `${NAME}` environment expansion) and the
 * BUN_CONFIG_TOKEN / NPM_CONFIG_TOKEN environment variables. Without a
 * bun-readable surface, a fresh machine (no private-scope packages in the bun
 * cache) cannot fetch @hasnaxyz/* tarballs and the install fails — on macOS
 * bun's clonefile backend reports it as "failed opening cache/package/version
 * dir for package @hasnaxyz/infinity" (O15-00346).
 *
 * The file holds placeholder text only; the values exist only in the child
 * environment for the duration of the source run.
 */
export declare const EXACT_BUN_NPMRC_AUTH_LINES: readonly ["//registry.npmjs.org/:_authToken=${HASNA_NPM_PUBLISH_TOKEN}", "//registry.npmjs.org/@hasnaxyz/:_authToken=${HASNAXYZ_NPM_PUBLISH_TOKEN}"];
export declare function writeExactBunNpmrc(root: string): void;
export type ExactBunSourceChunkReader = (buffer: Buffer) => number;
export declare function readBoundedExactBunSource(expectedBytes: number, reader?: ExactBunSourceChunkReader): Buffer;
export declare function defaultExactBunSourceLoader(source: ExactBunRegistrySourceRef): Buffer;
export declare function defaultExactBunBootstrapSourceLoader(): Buffer;
export declare function parseExactBunPackageProbe(stdout: string, step: ExactBunRegistryPlanStep): ExactBunPackageProbe;
export declare function parseExactBunPackageObservation(stdout: string, step: ExactBunRegistryPlanStep): ExactBunPackageProbe;
export declare function exactBunPackages(machine: MachineManifest): ManifestPackageSpec[];
export declare function validateExactBunMachine(machine: MachineManifest): string[];
export declare function exactBunPlanStep(pkg: ManifestPackageSpec): ExactBunRegistryPlanStep;
export declare function buildExactBunAppsPlan(machine: MachineManifest, installedState?: ExactBunAppsStatusResult): ExactBunAppsPlan;
export declare function verifyExactSourceBytes(source: ExactBunRegistrySourceRef, bytes: Uint8Array): void;
export declare function resolveExactSourceOnce(steps: ExactBunRegistryPlanStep[], loader: ExactBunSourceLoader): Buffer;
export declare function executeExactBunTargetStatus(payload: ExactBunTargetTransactionPayload): ExactBunTargetTransactionResult;
export declare function executeExactBunTargetTransaction(payload: ExactBunTargetTransactionPayload, sourceBytes: Buffer, dependencies?: ExactBunTargetDependencies): ExactBunTargetTransactionResult;
export declare function exactBunTargetPayload(machine: MachineManifest, plan: ExactBunAppsPlan): ExactBunTargetTransactionPayload;
export declare function decodeExactBunTargetPayload(value: string): ExactBunTargetTransactionPayload;
export declare function encodeExactBunTargetPayload(payload: ExactBunTargetTransactionPayload): string;
export declare function parseExactBunTargetResult(stdout: string, plan: ExactBunAppsPlan, mode?: "transaction" | "status"): ExactBunTargetTransactionResult;
export declare function runExactBunControllerTransaction(machine: MachineManifest, plan: ExactBunAppsPlan, loader: ExactBunSourceLoader, runner: MachineCommandRunner, bootstrapLoader?: ExactBunBootstrapSourceLoader): ExactBunTargetTransactionResult;
export declare function runExactBunControllerStatus(machine: MachineManifest, plan: ExactBunAppsPlan, runner: MachineCommandRunner, bootstrapLoader?: ExactBunBootstrapSourceLoader): {
    source: "local" | "lan" | "tailscale" | "ssh";
    result: ExactBunTargetTransactionResult;
};
