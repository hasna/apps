import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  EXACT_BUN_REGISTRY_EXCLUSIONS,
  EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES,
  EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE,
  EXACT_BUN_REGISTRY_SECRET_REFS,
} from "../manifests.js";
import { buildSecretsExecShell } from "../child-env.js";
import { attachMutationPlanDigest } from "./mutation-approval.js";
import type { MachineCommandRunner } from "../remote.js";
import type {
  ExactBunAppsPlan,
  ExactBunAppsStatusResult,
  ExactBunPackageProbe,
  ExactBunRegistryPlanStep,
  ExactBunRegistrySourceRef,
  MachineManifest,
  ManifestPackageSpec,
} from "../types.js";

export const EXACT_BUN_PACKAGE_NAMES = ["@hasnaxyz/infinity", "@hasnaxyz/factory"] as const;
export const EXACT_BUN_PACKAGE_ORDERS = [10, 20] as const;
export const EXACT_BUN_MACHINES_PACKAGE_NAME = "@hasna/machines" as const;
export const EXACT_BUN_MACHINES_PACKAGE_ORDER = 10 as const;
export const EXACT_BUN_REGISTRY_URL = "https://registry.npmjs.org";
export const EXACT_BUN_TARGET_TIMEOUT_MS = 10 * 60 * 1_000;

const PROBE_KEYS = ["checks", "expectedVersion", "installed", "observedVersion", "package", "reasonCodes", "schema", "status"];
const CHECK_KEYS = ["cliHelp", "packageJson", "registryProvenance", "sdkImport"];
const PACKAGE_JSON_KEYS = ["ok", "version"];
const REGISTRY_PROVENANCE_KEYS = ["integrity", "lockSource", "ok"];
const SDK_IMPORT_KEYS = ["ok"];
const CLI_HELP_KEYS = ["bin", "exitCode", "ok"];
const STATUS_KEYS = ["machineId", "packages", "platform", "reasonCodes", "schema", "source", "status"];
const OBSERVATION_REASON_CODES = new Set([
  "package_not_installed",
  "installed_version_mismatch",
  "registry_lock_mismatch",
  "sdk_import_failed",
  "cli_help_failed",
]);
const EXACT_BUN_BOOTSTRAP_MAX_BYTES = 524_288;
const EXACT_BUN_BOOTSTRAP_MAX_INPUT_BYTES = 2_097_152;

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
export const EXACT_BUN_NPMRC_AUTH_LINES = [
  "//registry.npmjs.org/:_authToken=${HASNA_NPM_PUBLISH_TOKEN}",
  "//registry.npmjs.org/@hasnaxyz/:_authToken=${HASNAXYZ_NPM_PUBLISH_TOKEN}",
] as const;

export function writeExactBunNpmrc(root: string): void {
  writeFileSync(join(root, ".npmrc"), `${EXACT_BUN_NPMRC_AUTH_LINES.join("\n")}\n`, { mode: 0o600 });
}

export type ExactBunSourceChunkReader = (buffer: Buffer) => number;

export function readBoundedExactBunSource(
  expectedBytes: number,
  reader: ExactBunSourceChunkReader = (buffer) => readSync(0, buffer, 0, buffer.length, null),
): Buffer {
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES) {
    throw new Error("source_size_invalid");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remaining = expectedBytes + 1 - total;
    if (remaining <= 0) throw new Error("source_size_mismatch");
    const buffer = Buffer.allocUnsafe(Math.min(8_192, remaining));
    const bytesRead = reader(buffer);
    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length) throw new Error("source_reader_invalid");
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    total += bytesRead;
  }
  if (total !== expectedBytes) throw new Error("source_size_mismatch");
  return Buffer.concat(chunks, total);
}

export function defaultExactBunSourceLoader(source: ExactBunRegistrySourceRef): Buffer {
  if (source.provider !== "files") throw new Error("source_provider_unavailable:task-attachment");
  const directory = mkdtempSync(join(tmpdir(), "machines-exact-source-"));
  chmodSync(directory, 0o700);
  const destination = join(directory, "source");
  try {
    const result = spawnSync("files", ["download", source.ref, destination], {
      encoding: "utf8",
      env: process.env,
      timeout: 120_000,
      maxBuffer: 65_536,
    });
    if (result.status !== 0 || !existsSync(destination)) throw new Error("source_resolution_failed:files");
    chmodSync(destination, 0o600);
    const bytes = readFileSync(destination);
    verifyExactSourceBytes(source, bytes);
    return bytes;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function defaultExactBunBootstrapSourceLoader(): Buffer {
  const candidates = [
    join(import.meta.dir, "..", "exact-bun-bootstrap.js"),
    join(import.meta.dir, "..", "..", "dist", "exact-bun-bootstrap.js"),
  ];
  try {
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) throw new Error("missing");
    const source = readFileSync(path);
    if (source.byteLength < 1 || source.byteLength > EXACT_BUN_BOOTSTRAP_MAX_BYTES) throw new Error("invalid");
    return source;
  } catch {
    throw new Error("exact_bun_bootstrap_unavailable");
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}_keys_mismatch`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExactBunPackageProbe(
  stdout: string,
  step: ExactBunRegistryPlanStep,
): ExactBunPackageProbe {
  const parsed = parseExactBunPackageObservation(stdout, step);
  if (parsed.observedVersion !== step.package.version) throw new Error("probe_version_mismatch");
  if (parsed.installed !== true
    || parsed.status !== "pass"
    || parsed.reasonCodes.length !== 0
    || parsed.checks.packageJson.ok !== true
    || parsed.checks.packageJson.version !== step.package.version
    || parsed.checks.registryProvenance.ok !== true
    || parsed.checks.registryProvenance.integrity !== step.package.registryIntegrity
    || parsed.checks.sdkImport.ok !== true
    || parsed.checks.cliHelp.ok !== true
    || parsed.checks.cliHelp.bin !== step.package.bin
    || parsed.checks.cliHelp.exitCode !== 0) {
    throw new Error("probe_status_mismatch");
  }
  return parsed;
}

export function parseExactBunPackageObservation(
  stdout: string,
  step: ExactBunRegistryPlanStep,
): ExactBunPackageProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error("probe_not_single_json_object");
  }
  if (!isRecord(parsed)) throw new Error("probe_not_single_json_object");
  exactKeys(parsed, PROBE_KEYS, "probe");
  if (parsed["schema"] !== "machines.bun_package_probe.v1") throw new Error("probe_schema_mismatch");
  if (parsed["package"] !== step.package.name) throw new Error("probe_package_mismatch");
  if (parsed["expectedVersion"] !== step.package.version) throw new Error("probe_expected_version_mismatch");
  if (typeof parsed["observedVersion"] !== "string"
    || (parsed["observedVersion"] !== "" && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(parsed["observedVersion"]))) {
    throw new Error("probe_version_mismatch");
  }
  if (typeof parsed["installed"] !== "boolean" || (parsed["status"] !== "pass" && parsed["status"] !== "fail")) {
    throw new Error("probe_status_mismatch");
  }
  if (!Array.isArray(parsed["reasonCodes"])
    || parsed["reasonCodes"].some((value) => typeof value !== "string" || !OBSERVATION_REASON_CODES.has(value))) {
    throw new Error("probe_reason_codes_invalid");
  }
  if (!isRecord(parsed["checks"])) throw new Error("probe_checks_malformed");
  const checks = parsed["checks"];
  exactKeys(checks, CHECK_KEYS, "probe_checks");

  const packageJson = checks["packageJson"];
  const registry = checks["registryProvenance"];
  const sdkImport = checks["sdkImport"];
  const cliHelp = checks["cliHelp"];
  if (!isRecord(packageJson)) {
    throw new Error("probe_package_json_mismatch");
  }
  exactKeys(packageJson, PACKAGE_JSON_KEYS, "probe_package_json");
  if (typeof packageJson["ok"] !== "boolean"
    || typeof packageJson["version"] !== "string"
    || (packageJson["version"] !== "" && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson["version"] as string))
    || (parsed["installed"] === false && parsed["observedVersion"] !== "")) {
    throw new Error("probe_package_json_mismatch");
  }
  if (!isRecord(registry)) {
    throw new Error("probe_registry_provenance_mismatch");
  }
  exactKeys(registry, REGISTRY_PROVENANCE_KEYS, "probe_registry_provenance");
  if (typeof registry["ok"] !== "boolean"
    || (registry["integrity"] !== "" && registry["integrity"] !== step.package.registryIntegrity)
    || registry["lockSource"] !== "registry") {
    throw new Error("probe_registry_provenance_mismatch");
  }
  if (!isRecord(sdkImport)) {
    throw new Error("probe_sdk_import_mismatch");
  }
  exactKeys(sdkImport, SDK_IMPORT_KEYS, "probe_sdk_import");
  if (typeof sdkImport["ok"] !== "boolean") throw new Error("probe_sdk_import_mismatch");
  if (!isRecord(cliHelp)) {
    throw new Error("probe_cli_help_mismatch");
  }
  exactKeys(cliHelp, CLI_HELP_KEYS, "probe_cli_help");
  if (typeof cliHelp["ok"] !== "boolean"
    || cliHelp["bin"] !== step.package.bin
    || !Number.isInteger(cliHelp["exitCode"])
    || (cliHelp["exitCode"] as number) < 0
    || (cliHelp["exitCode"] as number) > 255) {
    throw new Error("probe_cli_help_mismatch");
  }
  return {
    schema: "machines.bun_package_probe.v1",
    package: step.package.name,
    expectedVersion: step.package.version,
    observedVersion: parsed["observedVersion"],
    installed: parsed["installed"],
    checks: {
      packageJson: { ok: packageJson["ok"], version: packageJson["version"] },
      registryProvenance: {
        ok: registry["ok"],
        integrity: registry["integrity"],
        lockSource: "registry",
      },
      sdkImport: { ok: sdkImport["ok"] },
      cliHelp: { ok: cliHelp["ok"], bin: cliHelp["bin"], exitCode: cliHelp["exitCode"] as number },
    },
    status: parsed["status"],
    reasonCodes: [...parsed["reasonCodes"]] as string[],
  };
}

export function exactBunPackages(machine: MachineManifest): ManifestPackageSpec[] {
  return (machine.packages ?? [])
    .filter((pkg) => pkg.exactBunRegistry !== undefined)
    .sort((left, right) => left.exactBunRegistry!.order - right.exactBunRegistry!.order);
}

export function validateExactBunMachine(machine: MachineManifest): string[] {
  const errors: string[] = [];
  const packages = exactBunPackages(machine);
  const machinesOnly = packages.length === 1 && packages[0]!.name === EXACT_BUN_MACHINES_PACKAGE_NAME;
  if (!machinesOnly && packages.length !== EXACT_BUN_PACKAGE_NAMES.length) {
    errors.push(`exact_package_count:${packages.length}`);
    return errors;
  }
  const expectedNames: readonly string[] = machinesOnly
    ? [EXACT_BUN_MACHINES_PACKAGE_NAME]
    : EXACT_BUN_PACKAGE_NAMES;
  const expectedOrders: readonly number[] = machinesOnly
    ? [EXACT_BUN_MACHINES_PACKAGE_ORDER]
    : EXACT_BUN_PACKAGE_ORDERS;
  if (machine.platform !== "linux" && machine.platform !== "macos") errors.push("unsupported_platform");
  if (!machine.bunPath || !machine.bunPath.startsWith("/") || !machine.bunPath.endsWith("/bin/bun")) errors.push("bun_path_invalid");
  packages.forEach((pkg, index) => {
    if (pkg.name !== expectedNames[index]) errors.push(`package_order_mismatch:${index}`);
    if (pkg.exactBunRegistry!.order !== expectedOrders[index]) errors.push(`step_order_mismatch:${index}`);
    if (!pkg.version) errors.push(`version_missing:${index}`);
    if (pkg.manager !== "bun") errors.push(`manager_mismatch:${index}`);
    if (pkg.bin !== pkg.exactBunRegistry!.probe.cli.bin) errors.push(`bin_mismatch:${index}`);
    if (index > 0 && JSON.stringify(pkg.exactBunRegistry!.source) !== JSON.stringify(packages[0]!.exactBunRegistry!.source)) {
      errors.push(`source_reference_mismatch:${index}`);
    }
  });
  return errors;
}

function exactBunPackageOrder(name: string): number | undefined {
  if (name === EXACT_BUN_MACHINES_PACKAGE_NAME) return EXACT_BUN_MACHINES_PACKAGE_ORDER;
  const desiredIndex = (EXACT_BUN_PACKAGE_NAMES as readonly string[]).indexOf(name);
  return desiredIndex >= 0 ? EXACT_BUN_PACKAGE_ORDERS[desiredIndex] : undefined;
}

function validateTargetSteps(steps: ExactBunRegistryPlanStep[]): void {
  if (steps.length < 1 || steps.length > EXACT_BUN_PACKAGE_NAMES.length) throw new Error("exact_package_count_mismatch");
  if (steps.some((step) => step.package.name === EXACT_BUN_MACHINES_PACKAGE_NAME) && steps.length !== 1) {
    throw new Error("transaction_step_mismatch");
  }
  const seen = new Set<string>();
  let previousOrder = -1;
  steps.forEach((step) => {
    const expectedOrder = exactBunPackageOrder(step.package.name);
    if (expectedOrder === undefined || seen.has(step.package.name) || step.order <= previousOrder) {
      throw new Error("transaction_step_mismatch");
    }
    seen.add(step.package.name);
    previousOrder = step.order;
    if (step.kind !== "bun-registry-exact"
      || step.order !== expectedOrder
      || step.package.selector !== `${step.package.name}@${step.package.version}`
      || step.probe.schema !== "machines.bun_package_probe.v1"
      || step.probe.sdkImport !== step.package.name
      || step.probe.cliBin !== step.package.bin
      || step.probe.cliArgs.length !== 1
      || step.probe.cliArgs[0] !== "--help"
      || step.rollback.mode !== "byte-preimage"
      || step.rollback.scope !== "target-transaction") {
      throw new Error("transaction_step_mismatch");
    }
    if (!step.policy
      || step.policy.minimumReleaseAge !== EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE
      || !Array.isArray(step.policy.exactExclusions)
      || step.policy.exactExclusions.length !== EXACT_BUN_REGISTRY_EXCLUSIONS.length
      || step.policy.exactExclusions.some((value, exclusionIndex) => value !== EXACT_BUN_REGISTRY_EXCLUSIONS[exclusionIndex])) {
      throw new Error("quarantine_policy_mismatch");
    }
    if (!/^[a-f0-9]{64}$/.test(step.source.sha256)
      || !/^[a-f0-9]{64}$/.test(step.package.archiveSha256)
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(step.package.registryIntegrity)) {
      throw new Error("registry_digest_mismatch");
    }
    if ((step.source.provider !== "files" && step.source.provider !== "task-attachment")
      || !step.source.ref
      || !Number.isInteger(step.source.sizeBytes)
      || step.source.sizeBytes <= 0
      || step.source.sizeBytes > EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES) {
      throw new Error("source_reference_invalid");
    }
  });
  if (steps.some((step) => JSON.stringify(step.source) !== JSON.stringify(steps[0]!.source))) {
    throw new Error("source_reference_mismatch");
  }
}

export function exactBunPlanStep(pkg: ManifestPackageSpec): ExactBunRegistryPlanStep {
  const delivery = pkg.exactBunRegistry;
  if (!delivery || !pkg.version || !pkg.bin) throw new Error("exact_package_contract_incomplete");
  return {
    id: `bun-exact-${delivery.order}-${pkg.name}`,
    kind: "bun-registry-exact",
    order: delivery.order,
    package: {
      name: pkg.name,
      version: pkg.version,
      selector: `${pkg.name}@${pkg.version}`,
      bin: pkg.bin,
      archiveSha256: delivery.archiveSha256,
      registryIntegrity: delivery.registryIntegrity,
    },
    source: { ...delivery.source },
    policy: {
      minimumReleaseAge: delivery.quarantine.minimumReleaseAge,
      exactExclusions: [...delivery.quarantine.exactExclusions],
    },
    probe: {
      schema: "machines.bun_package_probe.v1",
      sdkImport: delivery.probe.sdkImport,
      cliBin: delivery.probe.cli.bin,
      cliArgs: [...delivery.probe.cli.args],
    },
    rollback: { mode: "byte-preimage", scope: "target-transaction" },
  };
}

function parseInstalledState(
  installedState: ExactBunAppsStatusResult,
  machine: MachineManifest,
  steps: ExactBunRegistryPlanStep[],
): ExactBunPackageProbe[] {
  if (!isRecord(installedState)) throw new Error("installed_state_invalid");
  exactKeys(installedState as unknown as Record<string, unknown>, STATUS_KEYS, "installed_state");
  if (installedState.schema !== "machines.apps.status.v2"
    || installedState.machineId !== machine.id
    || installedState.platform !== machine.platform
    || !["local", "lan", "tailscale", "ssh"].includes(installedState.source)
    || (installedState.status !== "pass" && installedState.status !== "unmanaged")
    || !Array.isArray(installedState.reasonCodes)
    || installedState.reasonCodes.length !== 0
    || !Array.isArray(installedState.packages)
    || installedState.packages.length !== steps.length) {
    throw new Error("installed_state_invalid");
  }
  return installedState.packages.map((probe, index) => parseExactBunPackageObservation(JSON.stringify(probe), steps[index]!));
}

function probeSatisfiesStep(probe: ExactBunPackageProbe, step: ExactBunRegistryPlanStep): boolean {
  return probe.package === step.package.name
    && probe.expectedVersion === step.package.version
    && probe.observedVersion === step.package.version
    && probe.installed
    && probe.status === "pass"
    && probe.reasonCodes.length === 0
    && probe.checks.packageJson.ok
    && probe.checks.packageJson.version === step.package.version
    && probe.checks.registryProvenance.ok
    && probe.checks.registryProvenance.integrity === step.package.registryIntegrity
    && probe.checks.registryProvenance.lockSource === "registry"
    && probe.checks.sdkImport.ok
    && probe.checks.cliHelp.ok
    && probe.checks.cliHelp.bin === step.package.bin
    && probe.checks.cliHelp.exitCode === 0;
}

export function buildExactBunAppsPlan(
  machine: MachineManifest,
  installedState?: ExactBunAppsStatusResult,
): ExactBunAppsPlan {
  const errors = validateExactBunMachine(machine);
  if (errors.length > 0) throw new Error(`exact_bun_candidate_invalid:${errors.join(",")}`);
  const desiredSteps = exactBunPackages(machine).map(exactBunPlanStep);
  const probes = installedState ? parseInstalledState(installedState, machine, desiredSteps) : undefined;
  const steps = probes
    ? desiredSteps.filter((step, index) => !probeSatisfiesStep(probes[index]!, step))
    : desiredSteps;
  return attachMutationPlanDigest({
    schema: "machines.apps.plan.v2",
    machineId: machine.id,
    platform: machine.platform as "linux" | "macos",
    mode: "plan",
    steps,
    executed: 0,
    collateral: {
      removals: 0,
      unrelatedUpdates: 0,
      serviceOperations: 0,
      configurationWrites: 0,
      privilegedSteps: 0,
      otherMachines: 0,
    },
    ...(probes ? { probes } : {}),
  });
}

export function verifyExactSourceBytes(source: ExactBunRegistrySourceRef, bytes: Uint8Array): void {
  if (bytes.byteLength !== source.sizeBytes) throw new Error("source_size_mismatch");
  if (bytes.byteLength > EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES) throw new Error("source_size_exceeds_limit");
  if (sha256(bytes) !== source.sha256) throw new Error("source_sha256_mismatch");
}

export function resolveExactSourceOnce(steps: ExactBunRegistryPlanStep[], loader: ExactBunSourceLoader): Buffer {
  const [first, ...rest] = steps;
  if (!first) throw new Error("source_missing");
  for (const step of rest) {
    if (JSON.stringify(step.source) !== JSON.stringify(first.source)) throw new Error("source_reference_mismatch");
  }
  const bytes = loader(first.source);
  verifyExactSourceBytes(first.source, bytes);
  return bytes;
}

interface SnapshotEntry {
  sourcePath: string;
  backupPath: string;
  existed: boolean;
  digest: string;
}

function digestPath(path: string): string {
  const hash = createHash("sha256");
  if (!existsSync(path)) {
    hash.update("absent\0");
    return hash.digest("hex");
  }
  const visit = (current: string, root: string): void => {
    const stats = lstatSync(current);
    const name = relative(root, current) || ".";
    hash.update(`${name}\0${stats.mode & 0o7777}\0`);
    if (stats.isSymbolicLink()) {
      hash.update(`link\0${readlinkSync(current)}\0`);
      return;
    }
    if (stats.isDirectory()) {
      hash.update("dir\0");
      for (const entry of readdirSync(current).sort()) visit(join(current, entry), root);
      return;
    }
    if (stats.isFile()) {
      hash.update("file\0");
      hash.update(readFileSync(current));
      hash.update("\0");
      return;
    }
    hash.update("other\0");
  };
  visit(path, path);
  return hash.digest("hex");
}

function createSnapshot(paths: string[], snapshotRoot: string): SnapshotEntry[] {
  return paths.map((sourcePath, index) => {
    const existed = existsSync(sourcePath);
    const backupPath = join(snapshotRoot, String(index));
    if (existed) cpSync(sourcePath, backupPath, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    return { sourcePath, backupPath, existed, digest: digestPath(sourcePath) };
  });
}

function restoreSnapshot(entries: SnapshotEntry[]): boolean {
  try {
    for (const entry of entries) {
      rmSync(entry.sourcePath, { recursive: true, force: true });
      if (entry.existed) {
        mkdirSync(dirname(entry.sourcePath), { recursive: true });
        cpSync(entry.backupPath, entry.sourcePath, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      }
    }
    return entries.every((entry) => digestPath(entry.sourcePath) === entry.digest);
  } catch {
    return false;
  }
}

function readGlobalPackageVersions(globalRoot: string): Map<string, string> {
  const result = new Map<string, string>();
  const nodeModules = join(globalRoot, "node_modules");
  if (!existsSync(nodeModules)) return result;
  for (const entry of readdirSync(nodeModules).sort()) {
    if (entry.startsWith("@")) {
      const scope = join(nodeModules, entry);
      if (!statSync(scope).isDirectory()) continue;
      for (const child of readdirSync(scope).sort()) readPackage(join(scope, child), `${entry}/${child}`, result);
    } else {
      readPackage(join(nodeModules, entry), entry, result);
    }
  }
  return result;
}

function readPackage(path: string, expectedName: string, target: Map<string, string>): void {
  const manifestPath = join(path, "package.json");
  if (!existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown; version?: unknown };
    if (manifest.name === expectedName && typeof manifest.version === "string") target.set(expectedName, manifest.version);
  } catch {}
}

function assertOnlyExpectedPackageChanges(
  before: Map<string, string>,
  after: Map<string, string>,
  allowed: Set<string>,
): void {
  const names = new Set([...before.keys(), ...after.keys()]);
  for (const name of names) {
    if (allowed.has(name)) continue;
    if (before.get(name) !== after.get(name)) throw new Error("unrelated_global_package_changed");
  }
}

function parseBunPolicy(path: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error("bun_policy_missing");
  const source = readFileSync(path, "utf8");
  const runtime = globalThis as unknown as { Bun?: { TOML?: { parse(value: string): unknown } } };
  if (!runtime.Bun?.TOML?.parse) throw new Error("bun_policy_parser_unavailable");
  const parsed = runtime.Bun.TOML.parse(source);
  if (!isRecord(parsed)) throw new Error("bun_policy_malformed");
  return parsed;
}

function configuredRegistryUrl(value: unknown): unknown {
  return isRecord(value) ? value["url"] : value;
}

function exactBunPackageScope(name: string): string | undefined {
  const match = /^@([^/]+)\//.exec(name);
  return match?.[1];
}

function validateBunPolicy(path: string, steps: ExactBunRegistryPlanStep[]): void {
  const parsed = parseBunPolicy(path);
  const install = isRecord(parsed["install"]) ? parsed["install"] : parsed;
  if (install["minimumReleaseAge"] !== EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE) throw new Error("quarantine_age_mismatch");
  const exclusions = install["minimumReleaseAgeExcludes"];
  const requiredExclusions = new Set<string>([
    ...EXACT_BUN_REGISTRY_EXCLUSIONS,
    ...steps.map((step) => step.package.name),
  ]);
  if (!Array.isArray(exclusions)
    || exclusions.some((value) => typeof value !== "string")
    || [...requiredExclusions].some((required) => !exclusions.includes(required))) {
    throw new Error("quarantine_exclusions_mismatch");
  }
  const hasInstallRegistry = Object.prototype.hasOwnProperty.call(install, "registry");
  const hasRootRegistry = install !== parsed && Object.prototype.hasOwnProperty.call(parsed, "registry");
  const configuredRegistry = hasInstallRegistry
    ? install["registry"]
    : hasRootRegistry
      ? parsed["registry"]
      : undefined;
  const registry = configuredRegistry === undefined
    ? EXACT_BUN_REGISTRY_URL
    : configuredRegistryUrl(configuredRegistry);
  if (registry !== EXACT_BUN_REGISTRY_URL) throw new Error("registry_mismatch");

  const scopes = install["scopes"];
  if (scopes !== undefined && !isRecord(scopes)) throw new Error("registry_mismatch");
  if (isRecord(scopes)) {
    for (const step of steps) {
      const scope = exactBunPackageScope(step.package.name);
      if (scope
        && Object.prototype.hasOwnProperty.call(scopes, scope)
        && configuredRegistryUrl(scopes[scope]) !== EXACT_BUN_REGISTRY_URL) {
        throw new Error("registry_mismatch");
      }
    }
  }
}

function safeSourceEnvironment(base: NodeJS.ProcessEnv, step: ExactBunRegistryPlanStep, sourcePath: string, globalRoot: string): NodeJS.ProcessEnv {
  const safeNames = ["HOME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "HASNA_SECRETS_API_URL"];
  const env: NodeJS.ProcessEnv = {};
  for (const name of safeNames) if (base[name] !== undefined) env[name] = base[name];
  return {
    ...env,
    HASNA_MACHINES_EXACT_BUN_SCHEMA: "machines.exact_bun_registry.v1",
    HASNA_MACHINES_EXACT_BUN_MODE: "live-global",
    HASNA_MACHINES_EXACT_BUN_PACKAGE: step.package.name,
    HASNA_MACHINES_EXACT_BUN_VERSION: step.package.version,
    HASNA_MACHINES_EXACT_BUN_SELECTOR: step.package.selector,
    HASNA_MACHINES_EXACT_BUN_ARCHIVE_SHA256: step.package.archiveSha256,
    HASNA_MACHINES_EXACT_BUN_REGISTRY_INTEGRITY: step.package.registryIntegrity,
    HASNA_MACHINES_EXACT_BUN_SOURCE_PATH: sourcePath,
    HASNA_MACHINES_EXACT_BUN_GLOBAL_DIR: globalRoot,
  };
}

function defaultSourceRun(command: string, env: NodeJS.ProcessEnv, cwd?: string): TargetSourceRunResult {
  const result = spawnSync("sh", ["-c", command], {
    encoding: "utf8",
    env,
    cwd,
    timeout: EXACT_BUN_TARGET_TIMEOUT_MS,
    maxBuffer: 1_048_576,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runQuiet(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): TargetSourceRunResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    cwd,
    timeout: 30_000,
    maxBuffer: 65_536,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function assertExactBunPath(path: string): void {
  if (!isAbsolute(path)
    || normalize(path) !== path
    || !path.endsWith("/bin/bun")
    || !existsSync(path)
    || !statSync(path).isFile()
    || (statSync(path).mode & 0o111) === 0) {
    throw new Error("bun_path_not_executable");
  }
}

function registryLockMatches(globalRoot: string, step: ExactBunRegistryPlanStep): boolean {
  const lockPath = join(globalRoot, "bun.lock");
  if (!existsSync(lockPath)) return false;
  const lock = readFileSync(lockPath, "utf8");
  return lock.includes(step.package.name)
    && lock.includes(step.package.version)
    && lock.includes(step.package.registryIntegrity);
}

function assertRegistryLock(globalRoot: string, step: ExactBunRegistryPlanStep): void {
  if (!registryLockMatches(globalRoot, step)) throw new Error(`registry_lock_mismatch:${step.order}`);
}

function sdkProbeEnvironment(globalRoot: string): NodeJS.ProcessEnv {
  return { BUN_INSTALL_GLOBAL_DIR: globalRoot };
}

function cliProbeEnvironment(bunPath: string, globalRoot: string): NodeJS.ProcessEnv {
  return {
    BUN_INSTALL_GLOBAL_DIR: globalRoot,
    PATH: dirname(bunPath),
  };
}

function statusProbeForStep(payload: ExactBunTargetTransactionPayload, step: ExactBunRegistryPlanStep): ExactBunPackageProbe {
  const bunRoot = dirname(dirname(payload.bunPath));
  const globalRoot = join(bunRoot, "install", "global");
  const packageJsonPath = join(globalRoot, "node_modules", ...step.package.name.split("/"), "package.json");
  let observedVersion = "";
  let installed = false;
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown; version?: unknown };
    installed = manifest.name === step.package.name && typeof manifest.version === "string";
    observedVersion = installed ? String(manifest.version) : "";
  } catch {}
  const packageJsonOk = installed && observedVersion === step.package.version;
  const registryOk = registryLockMatches(globalRoot, step);
  const provenanceOk = packageJsonOk && registryOk;
  const sdk = provenanceOk
    ? runQuiet(
        payload.bunPath,
        ["-e", `import(${JSON.stringify(step.probe.sdkImport)})`],
        sdkProbeEnvironment(globalRoot),
        globalRoot,
      )
    : { status: 1, stdout: "", stderr: "" };
  const sdkOk = sdk.status === 0;
  const cliPath = join(bunRoot, "bin", step.package.bin);
  const cliPresent = existsSync(cliPath) && statSync(cliPath).isFile() && (statSync(cliPath).mode & 0o111) !== 0;
  const cli = provenanceOk && cliPresent
    ? runQuiet(cliPath, step.probe.cliArgs, cliProbeEnvironment(payload.bunPath, globalRoot))
    : { status: 1, stdout: "", stderr: "" };
  const cliExitCode = Number.isInteger(cli.status) ? cli.status! : 1;
  const cliOk = cliPresent && cliExitCode === 0;
  const reasonCodes = [
    !installed ? "package_not_installed" : undefined,
    installed && !packageJsonOk ? "installed_version_mismatch" : undefined,
    !registryOk ? "registry_lock_mismatch" : undefined,
    !sdkOk ? "sdk_import_failed" : undefined,
    !cliOk ? "cli_help_failed" : undefined,
  ].filter((value): value is string => value !== undefined);
  const passed = reasonCodes.length === 0;
  return {
    schema: "machines.bun_package_probe.v1",
    package: step.package.name,
    expectedVersion: step.package.version,
    observedVersion,
    installed,
    checks: {
      packageJson: { ok: packageJsonOk, version: observedVersion },
      registryProvenance: { ok: registryOk, integrity: registryOk ? step.package.registryIntegrity : "", lockSource: "registry" },
      sdkImport: { ok: sdkOk },
      cliHelp: { ok: cliOk, bin: step.package.bin, exitCode: cliExitCode },
    },
    status: passed ? "pass" : "fail",
    reasonCodes,
  };
}

export function executeExactBunTargetStatus(payload: ExactBunTargetTransactionPayload): ExactBunTargetTransactionResult {
  if (payload.schema !== "machines.exact_bun_transaction.v1") throw new Error("transaction_schema_mismatch");
  validateTargetSteps(payload.steps);
  assertExactBunPath(payload.bunPath);
  validateBunPolicy(join(dirname(dirname(dirname(payload.bunPath))), ".bunfig.toml"), payload.steps);
  const probes = payload.steps.map((step) => statusProbeForStep(payload, step));
  return {
    schema: "machines.exact_bun_transaction_result.v1",
    machineId: payload.machineId,
    platform: payload.platform,
    state: "COMMITTED",
    executed: probes.length,
    probes,
    reasonCodes: [],
  };
}

function reasonCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[a-z0-9_:,-]+$/.test(message) ? message.slice(0, 256) : "exact_bun_transaction_failed";
}

export function executeExactBunTargetTransaction(
  payload: ExactBunTargetTransactionPayload,
  sourceBytes: Buffer,
  dependencies: ExactBunTargetDependencies = {},
): ExactBunTargetTransactionResult {
  if (payload.schema !== "machines.exact_bun_transaction.v1") throw new Error("transaction_schema_mismatch");
  if (payload.platform !== "linux" && payload.platform !== "macos") throw new Error("unsupported_platform");
  validateTargetSteps(payload.steps);
  verifyExactSourceBytes(payload.steps[0]!.source, sourceBytes);
  if (payload.steps.some((step) => JSON.stringify(step.source) !== JSON.stringify(payload.steps[0]!.source))) {
    throw new Error("source_reference_mismatch");
  }
  assertExactBunPath(payload.bunPath);

  const bunRoot = dirname(dirname(payload.bunPath));
  const globalRoot = join(bunRoot, "install", "global");
  const binRoot = join(bunRoot, "bin");
  const bunfigPath = join(dirname(bunRoot), ".bunfig.toml");
  validateBunPolicy(bunfigPath, payload.steps);

  const transactionRoot = mkdtempSync(join(dependencies.temporaryRoot ?? tmpdir(), "machines-exact-bun-"));
  chmodSync(transactionRoot, 0o700);
  const sourcePath = join(transactionRoot, "installer.ts");
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  verifyExactSourceBytes(payload.steps[0]!.source, readFileSync(sourcePath));
  // The source runs from this root, so a bun-readable .npmrc here makes the
  // secrets-exec-delivered tokens actually reach bun's registry auth (bun
  // reads ./.npmrc from the process cwd and expands ${NAME} from the env).
  writeExactBunNpmrc(transactionRoot);
  const snapshotRoot = join(transactionRoot, "preimage");
  mkdirSync(snapshotRoot, { mode: 0o700 });
  const snapshot = createSnapshot([globalRoot, binRoot, bunfigPath], snapshotRoot);
  const beforePackages = readGlobalPackageVersions(globalRoot);
  const bunfigDigest = digestPath(bunfigPath);
  const probes: ExactBunPackageProbe[] = [];
  let executed = 0;

  try {
    for (const step of payload.steps) {
      const inner = `${shellQuote(payload.bunPath)} ${shellQuote(sourcePath)}`;
      const second = buildSecretsExecShell(EXACT_BUN_REGISTRY_SECRET_REFS[1], "HASNAXYZ_NPM_PUBLISH_TOKEN", inner);
      const command = buildSecretsExecShell(EXACT_BUN_REGISTRY_SECRET_REFS[0], "HASNA_NPM_PUBLISH_TOKEN", second);
      const run = (dependencies.runSource ?? defaultSourceRun)(
        command,
        safeSourceEnvironment(process.env, step, sourcePath, globalRoot),
        transactionRoot,
      );
      if (run.status !== 0) throw new Error(`source_execution_failed:${step.order}`);
      if (run.stderr.trim().length > 0) throw new Error(`source_stderr_not_empty:${step.order}`);
      const probe = parseExactBunPackageProbe(run.stdout, step);
      const packageJsonPath = join(globalRoot, "node_modules", ...step.package.name.split("/"), "package.json");
      if (!existsSync(packageJsonPath)) throw new Error(`package_json_missing:${step.order}`);
      const installed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown; version?: unknown };
      if (installed.name !== step.package.name || installed.version !== step.package.version) {
        throw new Error(`installed_version_mismatch:${step.order}`);
      }
      assertRegistryLock(globalRoot, step);
      if (digestPath(bunfigPath) !== bunfigDigest) throw new Error("bun_policy_changed");
      assertOnlyExpectedPackageChanges(
        beforePackages,
        readGlobalPackageVersions(globalRoot),
        new Set(payload.steps.slice(0, executed + 1).map((entry) => entry.package.name)),
      );
      probes.push(probe);
      executed += 1;
    }

    return {
      schema: "machines.exact_bun_transaction_result.v1",
      machineId: payload.machineId,
      platform: payload.platform,
      state: "COMMITTED",
      executed,
      probes,
      reasonCodes: [],
    };
  } catch (error) {
    const restored = restoreSnapshot(snapshot);
    return {
      schema: "machines.exact_bun_transaction_result.v1",
      machineId: payload.machineId,
      platform: payload.platform,
      state: restored ? "ROLLED_BACK" : "ROLLBACK_FAILED",
      executed,
      probes: [],
      reasonCodes: [reasonCode(error)],
    };
  } finally {
    rmSync(transactionRoot, { recursive: true, force: true });
  }
}

export function exactBunTargetPayload(machine: MachineManifest, plan: ExactBunAppsPlan): ExactBunTargetTransactionPayload {
  if (!machine.bunPath || (machine.platform !== "linux" && machine.platform !== "macos")) {
    throw new Error("exact_bun_target_invalid");
  }
  return {
    schema: "machines.exact_bun_transaction.v1",
    machineId: machine.id,
    platform: machine.platform,
    bunPath: machine.bunPath,
    steps: structuredClone(plan.steps),
  };
}

export function decodeExactBunTargetPayload(value: string): ExactBunTargetTransactionPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("transaction_payload_invalid");
  }
  if (!isRecord(decoded) || decoded["schema"] !== "machines.exact_bun_transaction.v1") {
    throw new Error("transaction_payload_invalid");
  }
  return decoded as unknown as ExactBunTargetTransactionPayload;
}

export function encodeExactBunTargetPayload(payload: ExactBunTargetTransactionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseExactBunTargetResult(
  stdout: string,
  plan: ExactBunAppsPlan,
  mode: "transaction" | "status" = "transaction",
): ExactBunTargetTransactionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error("transaction_result_not_json");
  }
  if (!isRecord(parsed)) throw new Error("transaction_result_not_json");
  exactKeys(parsed, ["executed", "machineId", "platform", "probes", "reasonCodes", "schema", "state"], "transaction_result");
  if (parsed["schema"] !== "machines.exact_bun_transaction_result.v1"
    || parsed["machineId"] !== plan.machineId
    || parsed["platform"] !== plan.platform
    || !["COMMITTED", "ROLLED_BACK", "ROLLBACK_FAILED"].includes(String(parsed["state"]))) {
    throw new Error("transaction_result_mismatch");
  }
  if (!Number.isInteger(parsed["executed"])
    || (parsed["executed"] as number) < 0
    || (parsed["executed"] as number) > plan.steps.length) {
    throw new Error("transaction_result_executed_invalid");
  }
  if (!Array.isArray(parsed["reasonCodes"])
    || parsed["reasonCodes"].some((value) => typeof value !== "string"
      || value.length < 1
      || value.length > 256
      || !/^[a-z0-9_:,-]+$/.test(value))) {
    throw new Error("transaction_result_reasons_invalid");
  }
  if (!Array.isArray(parsed["probes"])) throw new Error("transaction_result_probes_invalid");
  const probes = parsed["probes"].map((probe, index) => {
    if (index >= plan.steps.length) throw new Error("transaction_result_probes_invalid");
    return mode === "status"
      ? parseExactBunPackageObservation(JSON.stringify(probe), plan.steps[index]!)
      : parseExactBunPackageProbe(JSON.stringify(probe), plan.steps[index]!);
  });
  if (parsed["state"] === "COMMITTED"
    && (parsed["executed"] !== plan.steps.length
      || probes.length !== plan.steps.length
      || parsed["reasonCodes"].length !== 0)) {
    throw new Error("transaction_result_commit_incomplete");
  }
  if (parsed["state"] !== "COMMITTED" && probes.length !== 0) throw new Error("transaction_result_rollback_probes_present");
  return {
    schema: "machines.exact_bun_transaction_result.v1",
    machineId: plan.machineId,
    platform: plan.platform,
    state: parsed["state"] as ExactBunTargetTransactionResult["state"],
    executed: parsed["executed"] as number,
    probes,
    reasonCodes: [...parsed["reasonCodes"]] as string[],
  };
}

interface ExactBunBootstrapEnvelope {
  schema: "machines.exact_bun_bootstrap.v1";
  mode: "status" | "transaction";
  payload: ExactBunTargetTransactionPayload;
  sourceBase64?: string;
}

function loadExactBunBootstrap(loader: ExactBunBootstrapSourceLoader): Buffer {
  try {
    const source = loader();
    if (!Buffer.isBuffer(source) || source.byteLength < 1 || source.byteLength > EXACT_BUN_BOOTSTRAP_MAX_BYTES) {
      throw new Error("invalid");
    }
    return source;
  } catch {
    throw new Error("exact_bun_bootstrap_unavailable");
  }
}

function exactBunBootstrapInput(source: Buffer, envelope: ExactBunBootstrapEnvelope): Buffer {
  const prefix = Buffer.from(
    `globalThis.__MACHINES_EXACT_BUN_BOOTSTRAP_INPUT__=${JSON.stringify(envelope)};\n`,
    "utf8",
  );
  const input = Buffer.concat([prefix, source]);
  if (input.byteLength > EXACT_BUN_BOOTSTRAP_MAX_INPUT_BYTES) throw new Error("exact_bun_bootstrap_input_too_large");
  return input;
}

export function runExactBunControllerTransaction(
  machine: MachineManifest,
  plan: ExactBunAppsPlan,
  loader: ExactBunSourceLoader,
  runner: MachineCommandRunner,
  bootstrapLoader: ExactBunBootstrapSourceLoader = defaultExactBunBootstrapSourceLoader,
): ExactBunTargetTransactionResult {
  const bootstrap = loadExactBunBootstrap(bootstrapLoader);
  const source = resolveExactSourceOnce(plan.steps, loader);
  const input = exactBunBootstrapInput(bootstrap, {
    schema: "machines.exact_bun_bootstrap.v1",
    mode: "transaction",
    payload: exactBunTargetPayload(machine, plan),
    sourceBase64: source.toString("base64"),
  });
  const result = runner(machine.id, `${shellQuote(machine.bunPath!)} run -`, {
    timeoutMs: EXACT_BUN_TARGET_TIMEOUT_MS,
    maxOutputChars: 65_536,
    redactOutput: true,
    stdin: input,
    maxInputBytes: EXACT_BUN_BOOTSTRAP_MAX_INPUT_BYTES,
  });
  if (result.exitCode !== 0) throw new Error(`exact_bun_target_failed:${result.exitCode}`);
  if (result.stderr.trim().length > 0 || result.stdoutTruncated || result.stderrTruncated) {
    throw new Error("exact_bun_target_output_invalid");
  }
  return parseExactBunTargetResult(result.stdout, plan);
}

export function runExactBunControllerStatus(
  machine: MachineManifest,
  plan: ExactBunAppsPlan,
  runner: MachineCommandRunner,
  bootstrapLoader: ExactBunBootstrapSourceLoader = defaultExactBunBootstrapSourceLoader,
): { source: "local" | "lan" | "tailscale" | "ssh"; result: ExactBunTargetTransactionResult } {
  const bootstrap = loadExactBunBootstrap(bootstrapLoader);
  const input = exactBunBootstrapInput(bootstrap, {
    schema: "machines.exact_bun_bootstrap.v1",
    mode: "status",
    payload: exactBunTargetPayload(machine, plan),
  });
  const result = runner(machine.id, `${shellQuote(machine.bunPath!)} run -`, {
    timeoutMs: 60_000,
    maxOutputChars: 65_536,
    redactOutput: true,
    stdin: input,
    maxInputBytes: EXACT_BUN_BOOTSTRAP_MAX_INPUT_BYTES,
  });
  if (result.exitCode !== 0) throw new Error(`exact_bun_status_failed:${result.exitCode}`);
  if (result.stderr.trim().length > 0 || result.stdoutTruncated || result.stderrTruncated) {
    throw new Error("exact_bun_status_output_invalid");
  }
  return { source: result.source, result: parseExactBunTargetResult(result.stdout, plan, "status") };
}
