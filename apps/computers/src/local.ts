import { createHash, randomBytes } from "node:crypto";
import { dlopen, FFIType, type Library } from "bun:ffi";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT, ComputersError, type Computer, type ComputerStatus, type ProviderAssuranceEvidence, type ProviderOutcome, type ProviderReadiness,
} from "./contracts";
import { createProviderPorts, type ProviderCreateRequest, type ProviderExecutionGuard, type ProviderOperationRequest, type ProviderPort } from "./providers";
import { validateArgv, validateId, validatePath } from "./validation";

const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STATE_BYTES = 64 * 1024;
const MAX_COMMAND_ENV_ENTRIES = 128;
const MAX_COMMAND_ENV_BYTES = 64 * 1024;
const MAX_JSONL_RECORDS = 4096;
const MAX_EXPECTED_UID = 0xffff_fffe;
const GIB = 1024 ** 3;
const LIMA_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const F_FULLFSYNC = 51;
const ADOPTION_RESOURCE_KEY = "adoption:state-root";

const FLOCK_SYMBOLS = { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } } as const;
let flockLibrary: Library<typeof FLOCK_SYMBOLS> | undefined;
const FCNTL_SYMBOLS = { fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 } } as const;
let fcntlLibrary: Library<typeof FCNTL_SYMBOLS> | undefined;

function flock(fd: number, operation: number): number {
  flockLibrary ??= dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", FLOCK_SYMBOLS);
  return flockLibrary.symbols.flock(fd, operation);
}

interface RecoverySyncOperations { fsync(fd: number): void; fullFsync?: (fd: number) => number }
const RECOVERY_SYNC_OPERATIONS: RecoverySyncOperations = {
  fsync: fsyncSync,
  fullFsync(fd) {
    fcntlLibrary ??= dlopen("/usr/lib/libSystem.B.dylib", FCNTL_SYMBOLS);
    return fcntlLibrary.symbols.fcntl(fd, F_FULLFSYNC, 0);
  },
};

function synchronizeRecoveryDescriptor(fd: number, target: "file" | "directory", platform: NodeJS.Platform = process.platform,
  operations: RecoverySyncOperations = RECOVERY_SYNC_OPERATIONS): void {
  if (platform === "darwin" && target === "file") {
    if (operations.fullFsync === undefined) throw new ComputersError("storage_error", "Darwin F_FULLFSYNC is unavailable", 500);
    if (operations.fullFsync(fd) !== 0) throw new ComputersError("storage_error", "Darwin F_FULLFSYNC failed", 500);
    return;
  }
  operations.fsync(fd);
}

/** @internal Test-only injection proof; not re-exported by the public local surface. */
export function synchronizeRecoveryDescriptorForTesting(fd: number, target: "file" | "directory", platform: NodeJS.Platform,
  operations: RecoverySyncOperations): void {
  synchronizeRecoveryDescriptor(fd, target, platform, operations);
}

export interface CommandRequest { argv: string[]; cwd?: string; env?: Record<string, string>; stdin?: string; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }
export interface CommandResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; outputExceeded: boolean }
export interface CommandRunner { run(request: CommandRequest): Promise<CommandResult>; runSupervised?(request: CommandRequest, supervision: CommandSupervision): Promise<CommandResult> }

export interface CommandSupervision {
  prepare(): void;
  abortPrepared(): void;
  publish(pid: number, pgid: number): void;
  clear(): void;
}

interface SupervisedCommandRequest extends CommandRequest { supervision?: CommandSupervision }

function checkedCommand(request: CommandRequest): CommandRequest {
  const argv = validateArgv(request.argv);
  if (!isAbsolute(argv[0] ?? "")) throw new ComputersError("invalid_request", "Command executable must be absolute", 500);
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > MAX_COMMAND_TIMEOUT_MS) throw new ComputersError("invalid_request", "Invalid command timeout", 500);
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1 || request.maxOutputBytes > MAX_COMMAND_OUTPUT_BYTES) throw new ComputersError("invalid_request", "Invalid command output limit", 500);
  if (request.cwd !== undefined) validatePath(request.cwd, "command cwd");
  const environment = Object.entries(request.env ?? {});
  if (environment.length > MAX_COMMAND_ENV_ENTRIES) throw new ComputersError("invalid_request", "Invalid command environment", 500);
  let environmentBytes = 0;
  for (const [key, value] of environment) {
    environmentBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || value.includes("\0") || value.length > 4096 || environmentBytes > MAX_COMMAND_ENV_BYTES) {
      throw new ComputersError("invalid_request", "Invalid command environment", 500);
    }
  }
  if (request.stdin !== undefined && Buffer.byteLength(request.stdin) > MAX_COMMAND_OUTPUT_BYTES) throw new ComputersError("invalid_request", "Command input is too large", 500);
  return { ...request, argv, env: request.env ?? {} };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function configuredProfileDocument(profile: LocalVmProfile): Record<string, unknown> {
  return { provider: "local_vm", cpus: profile.cpus, memoryGiB: profile.memoryGiB, rootDiskGiB: profile.rootDiskGiB,
    homeDiskGiB: profile.homeDiskGiB, imageLocation: new URL(profile.imageLocation).toString(), imageDigest: profile.imageDigest };
}

function digestDocument(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function resolvedProfileDocument(profile: LocalVmProfile, homeDiskName: string): Record<string, unknown> {
  return {
    minimumLimaVersion: SUPPORTED_LIMA_VERSION, vmType: "vz", os: "Linux", arch: "aarch64", plain: true,
    user: { name: "computers", comment: "Computers resident", home: "/home/computers", shell: "/bin/bash", uid: 1000 },
    cpus: profile.cpus, memoryBytes: profile.memoryGiB * GIB, rootDiskBytes: profile.rootDiskGiB * GIB,
    image: { location: new URL(profile.imageLocation).toString(), arch: "aarch64", digest: profile.imageDigest },
    firmware: { legacyBIOS: false, images: [] }, audio: { device: "none" }, video: { display: "none", vnc: { display: "none" } },
    upgradePackages: false, nestedVirtualization: false, timezone: "", guestInstallPrefix: "/usr/local",
    mounts: [], portForwards: [], copyToHost: [], provision: [], probes: [], networks: [], dns: [], caCerts: { removeDefaults: false, files: [], certs: [] },
    env: {}, param: {}, propagateProxyEnv: false,
    hostResolver: { enabled: false, ipv6: false, hosts: {} }, containerd: { system: false, user: false }, rosetta: { enabled: false, binfmt: false },
    ssh: { localPort: 0, loadDotSSHPubKeys: false, forwardAgent: false, forwardX11: false, forwardX11Trusted: false, overVsock: false },
    additionalDisks: [{ name: homeDiskName, format: false }],
  };
}

async function boundedStream(stream: ReadableStream<Uint8Array>, budget: { remaining: number; exceeded: boolean }, kill: () => void): Promise<{ text: string; exceeded: boolean }> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0; let exceeded = false;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      const remaining = budget.remaining;
      if (value.byteLength > remaining) {
        if (remaining > 0) { chunks.push(value.slice(0, remaining)); size += remaining; budget.remaining = 0; }
        budget.exceeded = true; exceeded = true; kill(); break;
      }
      chunks.push(value); size += value.byteLength; budget.remaining -= value.byteLength;
    }
  } finally { try { await reader.cancel(); } catch { /* closed */ } }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(joined), exceeded };
}

export class BunCommandRunner implements CommandRunner {
  async runSupervised(request: CommandRequest, supervision: CommandSupervision): Promise<CommandResult> { return this.run({ ...request, supervision }); }
  async run(raw: SupervisedCommandRequest): Promise<CommandResult> {
    const request = checkedCommand(raw) as SupervisedCommandRequest;
    const options = { env: request.env ?? {}, stdin: request.stdin === undefined ? "ignore" as const : new Blob([request.stdin]), stdout: "pipe" as const, stderr: "pipe" as const, detached: true };
    request.supervision?.prepare();
    const child = (() => {
      try { return request.cwd === undefined ? Bun.spawn(request.argv, options) : Bun.spawn(request.argv, { ...options, cwd: request.cwd }); }
      catch (spawnError) {
        try { request.supervision?.abortPrepared(); }
        catch (abortError) { throw new AggregateError([spawnError, abortError], "Command spawn failed and its prepared supervision journal could not be safely aborted"); }
        throw spawnError;
      }
    })();
    try { request.supervision?.publish(child.pid, child.pid); }
    catch (error) {
      try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ }
      try { child.kill("SIGKILL"); } catch { /* exited */ }
      try { await child.exited; } catch { /* exited */ }
      throw error;
    }
    let timedOut = false; let outputExceeded = false;
    const kill = (): void => {
      try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ }
      try { child.kill("SIGKILL"); } catch { /* exited */ }
    };
    const abort = (): void => { kill(); };
    if (request.signal?.aborted) abort(); else request.signal?.addEventListener("abort", abort, { once: true });
    const budget = { remaining: request.maxOutputBytes, exceeded: false };
    const stdout = boundedStream(child.stdout, budget, () => { outputExceeded = true; kill(); });
    const stderr = boundedStream(child.stderr, budget, () => { outputExceeded = true; kill(); });
    const timer = setTimeout(() => { timedOut = true; kill(); }, request.timeoutMs);
    let exitCode: number | null = null;
    try { exitCode = await child.exited; } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", abort); }
    const [out, err] = await Promise.all([stdout, stderr]);
    request.supervision?.clear();
    return { exitCode, stdout: out.text, stderr: err.text, timedOut, outputExceeded: outputExceeded || budget.exceeded || out.exceeded || err.exceeded };
  }
}

export type ObservedMachineState = "running" | "stopped" | "quarantined" | "unknown";
export interface AdoptedMachineObservation {
  hostId: string; bootId: string; state: ObservedMachineState; ownership: "dedicated" | "shared" | "unknown";
  controllerExternallyProtected: boolean; residentHeartbeatCurrent: boolean;
}
export interface AdoptionClaimContext {
  adoptionId: string; tenantId: string; computerId: string; ownerPrincipalId: string; claimGeneration: number; claimFence: string;
}
export interface AdoptedMachineController {
  observe(claim: AdoptionClaimContext, execution?: ProviderExecutionGuard): Promise<AdoptedMachineObservation>;
  transition?(desired: "running" | "stopped" | "quarantined", claim: AdoptionClaimContext, execution?: ProviderExecutionGuard): Promise<void>;
  release?(claim: AdoptionClaimContext, execution?: ProviderExecutionGuard): Promise<{ released: boolean }>;
}
export interface LocalMachineAdoptionConfig {
  adoptionId: string; hostId: string; profileId: string; allowedTenantId: string; allowedOwnerPrincipalId: string;
  homeRoot: string; homeRelativePath: string; expectedHomeUid: number;
  controller: AdoptedMachineController;
}

interface ValidatedAdoptionConfiguration { homeRoot: string; home: string }
type AdoptionProviderEntryPoint = "create" | "start" | "stop" | "quarantine" | "delete" | "reconcile";

function validateAdoptionConfiguration(config: LocalMachineAdoptionConfig): ValidatedAdoptionConfiguration {
  validateId(config.adoptionId, "adoptionId"); validateId(config.hostId, "hostId"); validateId(config.profileId, "profileId");
  validateId(config.allowedTenantId, "allowedTenantId"); validateId(config.allowedOwnerPrincipalId, "allowedOwnerPrincipalId");
  if (typeof config.homeRoot !== "string" || !isAbsolute(config.homeRoot) || config.homeRoot.includes("\0")
    || resolve(config.homeRoot) !== config.homeRoot) throw new ComputersError("invalid_request", "Invalid adoption configuration", 500);
  if (typeof config.homeRelativePath !== "string" || config.homeRelativePath.length < 1 || config.homeRelativePath.length > 4096
    || isAbsolute(config.homeRelativePath) || config.homeRelativePath.includes("\0")
    || config.homeRelativePath.split(sep).some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ComputersError("invalid_request", "Invalid adoption configuration", 500);
  }
  if (!Number.isSafeInteger(config.expectedHomeUid) || config.expectedHomeUid < 0 || config.expectedHomeUid > MAX_EXPECTED_UID) {
    throw new ComputersError("invalid_request", "Invalid adoption configuration", 500);
  }
  if (typeof config.controller !== "object" || config.controller === null || typeof config.controller.observe !== "function"
    || config.controller.transition !== undefined && typeof config.controller.transition !== "function"
    || config.controller.release !== undefined && typeof config.controller.release !== "function") {
    throw new ComputersError("invalid_request", "Invalid adoption configuration", 500);
  }
  inspectPathAncestry(config.homeRoot);
  const home = confined(config.homeRoot, config.homeRelativePath); inspectPathAncestry(home, config.expectedHomeUid);
  return { homeRoot: config.homeRoot, home };
}

export interface LocalVmProfile {
  id: string; cpus: number; memoryGiB: number; rootDiskGiB: number; homeDiskGiB: number; imageLocation: string; imageDigest: string;
}
export interface ResolvedLimaAdditionalDisk { name: string; format: boolean }
export interface ResolvedLimaInspection {
  exists: boolean; status: "Running" | "Stopped" | "Broken" | "Unknown"; vmType: string; arch: string; plain: boolean;
  cpus: number; memoryBytes: number; rootDiskBytes: number; imageLocation: string; imageDigest: string; profileDigest: string;
  mountCount: number; portForwardCount: number; provisionCount: number; probeCount: number; networkCount: number; envEntryCount: number;
  additionalDisks: ResolvedLimaAdditionalDisk[];
  hostResolverEnabled: boolean; hostResolverIpv6: boolean; hostResolverHostsCount: number;
  containerdSystem: boolean; containerdUser: boolean; rosettaEnabled: boolean; rosettaBinFmt: boolean;
  sshLocalPort: number; forwardAgent: boolean; loadDotSshPubKeys: boolean; forwardX11: boolean; forwardX11Trusted: boolean; sshOverVsock: boolean;
  guestAgentEnabled: boolean; propagateProxyEnv: boolean;
}
export interface ResolvedLimaDisk {
  name: string; sizeBytes: number; format: string; dir: string; instance: string; instanceDir: string; mountPoint: string;
}
export interface LimaInspector {
  inspect(instanceName: string, requestConfigPath?: string): Promise<ResolvedLimaInspection>;
  inspectDisk(diskName: string, expectedInstanceName?: string): Promise<ResolvedLimaDisk | undefined>;
}
export interface LocalVmConfig { limactlPath: string; limaHome: string; profile: LocalVmProfile; inspector?: LimaInspector }
export interface LocalProviderOptions {
  stateRoot: string; platform?: NodeJS.Platform; arch?: string; runner?: CommandRunner;
  adoption?: LocalMachineAdoptionConfig; vm?: LocalVmConfig;
}

interface LocalManifest {
  version: 1; tenantId: string; computerId: string; ownerPrincipalId: string; provider: "local_machine" | "local_vm";
  resourceId: string; instanceId: string; bootId?: string; profileId: string; profileGeneration: number; profileRevisionDigest: string; resolvedProfileDigest: string;
  home: { kind: "adopted_path" | "lima_disk"; reference: string; retained: boolean };
  adoption?: { version: 1; adoptionId: string; hostId: string; claimGeneration: number; claimFence: string };
  lifecycle: "stopped" | "running" | "quarantined" | "deleted"; assurance: ProviderAssuranceEvidence; attachmentGeneration: number; updatedAt: string;
}

interface VmCreatePhaseDocument {
  version: 1; tenantId: string; computerId: string; operationId: string; providerIdempotencyKey: string;
  instanceId: string; diskName: string; profileId: string; profileGeneration: number; profileRevisionDigest: string; resolvedProfileDigest: string;
  diskAbsentBeforeCreate: true; phase: "disk_pending" | "disk_owned" | "vm_attempted"; updatedAt: string;
}

function vmCreatePhasePath(root: string, computer: Computer): string {
  return confined(root, "computers", computer.tenantId, computer.id, "create-phase.json");
}
function readVmCreatePhase(root: string, computer: Computer): VmCreatePhaseDocument | undefined {
  const path = vmCreatePhasePath(root, computer); if (!existsSync(path)) return undefined;
  const value = boundedJson<Record<string, unknown>>(path);
  const keys = ["version", "tenantId", "computerId", "operationId", "providerIdempotencyKey", "instanceId", "diskName", "profileId", "profileGeneration",
    "profileRevisionDigest", "resolvedProfileDigest", "diskAbsentBeforeCreate", "phase", "updatedAt"];
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.version !== 1 || value.tenantId !== computer.tenantId || value.computerId !== computer.id
    || typeof value.operationId !== "string" || typeof value.providerIdempotencyKey !== "string" || typeof value.instanceId !== "string" || typeof value.diskName !== "string"
    || typeof value.profileId !== "string" || !Number.isSafeInteger(value.profileGeneration) || Number(value.profileGeneration) < 1
    || typeof value.profileRevisionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.profileRevisionDigest)
    || typeof value.resolvedProfileDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.resolvedProfileDigest)
    || value.diskAbsentBeforeCreate !== true || !["disk_pending", "disk_owned", "vm_attempted"].includes(String(value.phase)) || typeof value.updatedAt !== "string") {
    throw new ComputersError("storage_error", "Local VM create-phase journal is invalid", 500);
  }
  return value as unknown as VmCreatePhaseDocument;
}

interface AdoptionClaimDocument extends AdoptionClaimContext {
  version: 2; hostId: string; profileId: string; profileGeneration: number; profileRevisionDigest: string; resolvedProfileDigest: string;
  manifestRequired: boolean; state: "active" | "releasing" | "released"; updatedAt: string;
}
interface AdoptionProfileIdentity {
  profileId: string; profileGeneration: number; profileRevisionDigest: string; resolvedProfileDigest: string;
}

function fail(code: string, message: string, resource?: ProviderOutcome["resource"]): ProviderOutcome {
  return resource === undefined ? { kind: "definite_failure", code, message } : { kind: "definite_failure", code, message, resource };
}
function unknown(request: ProviderOperationRequest, message: string, manifest?: LocalManifest): ProviderOutcome {
  const outcome: Extract<ProviderOutcome, { kind: "unknown" }> = { kind: "unknown", providerOperationId: request.attempt.providerIdempotencyKey, message };
  if (manifest !== undefined) outcome.resource = resource(manifest);
  return outcome;
}
function resource(manifest: LocalManifest): NonNullable<ProviderOutcome["resource"]> {
  const value: NonNullable<ProviderOutcome["resource"]> = { resourceId: manifest.resourceId, instanceId: manifest.instanceId };
  if (manifest.bootId !== undefined) value.bootId = manifest.bootId;
  return value;
}
function result(manifest: LocalManifest, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { assurance: manifest.assurance, profileId: manifest.profileId, lifecycle: manifest.lifecycle, volumes: { root: manifest.resourceId, home: manifest.home.reference },
    retainHome: manifest.home.retained, attachmentGeneration: manifest.attachmentGeneration,
    ...(manifest.provider === "local_vm" ? { homeUsable: false, strictGuestPending: true } : {}), ...extra };
}
function unverifiedAssurance(): ProviderAssuranceEvidence {
  return { confinementClass: "unverified_vm", providerSpecificControlsPassed: false, externalEgressEnforced: false, residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false };
}
function dedicatedAssurance(): ProviderAssuranceEvidence {
  return { confinementClass: "dedicated_machine", providerSpecificControlsPassed: true, externalEgressEnforced: false, residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false };
}
function secureRoot(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new ComputersError("invalid_request", "Local provider root must be absolute", 500);
  const resolved = resolve(path); const missing: string[] = []; let cursor = resolved;
  while (!existsSync(cursor)) { missing.push(cursor); const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; }
  inspectPathAncestry(cursor);
  for (const directory of missing.reverse()) {
    mkdirSync(directory, { mode: 0o700 });
    inspectPathAncestry(directory, undefined, true);
    syncDirectory(dirname(directory));
  }
  inspectPathAncestry(resolved, undefined, true); return resolved;
}
function inspectPathAncestry(path: string, expectedLeafUid?: number, privateLeaf = false): void {
  const resolved = resolve(path); const parts = resolved.split(sep).filter(Boolean); let cursor: string = sep;
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part); const stat = lstatSync(cursor); const leaf = index === parts.length - 1;
    if (stat.isSymbolicLink()) throw new ComputersError("storage_error", "Configured local paths may not contain symlinks", 500);
    if (!stat.isDirectory()) throw new ComputersError("storage_error", "Configured local path is not a directory", 500);
    const trustedUid = process.getuid?.() ?? stat.uid;
    if (stat.uid !== trustedUid && stat.uid !== 0) throw new ComputersError("storage_error", "Configured path ownership is untrusted", 500);
    if (leaf && expectedLeafUid !== undefined && stat.uid !== expectedLeafUid) throw new ComputersError("storage_error", "Configured home ownership does not match inventory", 500);
    if (leaf && privateLeaf && (stat.mode & 0o077) !== 0) throw new ComputersError("storage_error", "Configured controller directory is not private", 500);
    if ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0) throw new ComputersError("storage_error", "Configured path has an unsafe writable ancestor", 500);
  }
  if (realpathSync(resolved) !== resolved) throw new ComputersError("storage_error", "Configured local path is not canonical", 500);
}
function confined(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments); const suffix = relative(root, target);
  if (suffix === "" || suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new ComputersError("invalid_request", "Local provider path escaped its root", 500);
  let cursor = root;
  for (const segment of suffix.split(sep)) { cursor = join(cursor, segment); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new ComputersError("storage_error", "Local provider paths may not contain symlinks", 500); }
  return target;
}
function boundedJson<T>(path: string): T {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd); const linked = lstatSync(path); const trustedUid = process.getuid?.() ?? before.uid;
    if (!before.isFile() || !linked.isFile() || linked.isSymbolicLink() || before.dev !== linked.dev || before.ino !== linked.ino
      || before.nlink !== 1 || linked.nlink !== 1 || (before.uid !== trustedUid && before.uid !== 0)
      || (before.mode & 0o777) !== 0o600 || before.size > MAX_STATE_BYTES) throw new ComputersError("storage_error", "Local provider state is invalid", 500);
    const text = readFileSync(fd, "utf8"); const after = fstatSync(fd); const post = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || before.uid !== after.uid || before.mode !== after.mode || after.nlink !== 1
      || post.isSymbolicLink() || post.dev !== after.dev || post.ino !== after.ino || post.nlink !== 1) throw new ComputersError("storage_error", "Local provider state changed during read", 500);
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof ComputersError) throw error;
    throw new ComputersError("storage_error", "Local provider state is invalid", 500);
  } finally { closeSync(fd); }
}
interface PrivateFileIdentity { dev: number; ino: number; uid: number; mode: number; size: number; nlink: number }
function privateFileIdentity(path: string, expectedLinks: number): PrivateFileIdentity {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd); const linked = lstatSync(path); const trustedUid = process.getuid?.() ?? stat.uid;
    if (!stat.isFile() || !linked.isFile() || linked.isSymbolicLink() || stat.dev !== linked.dev || stat.ino !== linked.ino
      || stat.nlink !== expectedLinks || linked.nlink !== expectedLinks || (stat.uid !== trustedUid && stat.uid !== 0)
      || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_STATE_BYTES) {
      throw new ComputersError("storage_error", "Local provider state identity is invalid", 500);
    }
    return { dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, size: stat.size, nlink: stat.nlink };
  } finally { closeSync(fd); }
}
function sameFileIdentity(path: string, expected: PrivateFileIdentity, expectedLinks: number): void {
  const actual = privateFileIdentity(path, expectedLinks);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.uid !== expected.uid || actual.mode !== expected.mode
    || actual.size !== expected.size || actual.nlink !== expectedLinks) {
    throw new ComputersError("storage_error", "Local provider state identity changed", 500);
  }
}
function syncDirectory(path: string): void {
  inspectPathAncestry(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd); const linked = lstatSync(path); const trustedUid = process.getuid?.() ?? before.uid;
    if (!before.isDirectory() || !linked.isDirectory() || linked.isSymbolicLink() || before.dev !== linked.dev || before.ino !== linked.ino
      || (before.uid !== trustedUid && before.uid !== 0)) throw new ComputersError("storage_error", "Local provider state directory is invalid", 500);
    synchronizeRecoveryDescriptor(fd, "directory");
    const after = fstatSync(fd); const post = lstatSync(path);
    if (!after.isDirectory() || post.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino
      || post.dev !== after.dev || post.ino !== after.ino) throw new ComputersError("storage_error", "Local provider state directory changed during sync", 500);
  } catch (error) {
    if (error instanceof ComputersError) throw error;
    throw new ComputersError("storage_error", "Local provider state directory could not be durably synchronized", 500);
  } finally { closeSync(fd); }
}
function writeSyncedPrivateFile(path: string, contents: string): PrivateFileIdentity {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const before = fstatSync(fd); const trustedUid = process.getuid?.() ?? before.uid;
    if (!before.isFile() || before.nlink !== 1 || (before.uid !== trustedUid && before.uid !== 0) || (before.mode & 0o777) !== 0o600) {
      throw new ComputersError("storage_error", "Local provider temporary state identity is invalid", 500);
    }
    writeFileSync(fd, contents);
    synchronizeRecoveryDescriptor(fd, "file");
    const after = fstatSync(fd);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1 || after.size !== Buffer.byteLength(contents)
      || after.uid !== before.uid || after.mode !== before.mode) throw new ComputersError("storage_error", "Local provider state changed during durable write", 500);
    return { dev: after.dev, ino: after.ino, uid: after.uid, mode: after.mode, size: after.size, nlink: after.nlink };
  } catch (error) {
    if (error instanceof ComputersError) throw error;
    throw new ComputersError("storage_error", "Local provider state file could not be durably synchronized", 500);
  } finally { closeSync(fd); }
}
function durableUnlink(path: string, expected?: PrivateFileIdentity, expectedLinks = 1): void {
  const identity = expected ?? privateFileIdentity(path, expectedLinks);
  sameFileIdentity(path, identity, expectedLinks);
  unlinkSync(path);
  syncDirectory(dirname(path));
}
function atomicPrivateFile(path: string, contents: string, exclusive = false): void {
  if (Buffer.byteLength(contents) > MAX_STATE_BYTES) throw new ComputersError("storage_error", "Local provider state is too large", 500);
  const parent = secureRoot(dirname(path));
  const temporary = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  let temporaryIdentity: PrivateFileIdentity | undefined;
  let published = false;
  try {
    temporaryIdentity = writeSyncedPrivateFile(temporary, contents);
    if (exclusive) {
      linkSync(temporary, path);
      published = true;
      sameFileIdentity(path, { ...temporaryIdentity, nlink: 2 }, 2);
      syncDirectory(parent);
      durableUnlink(temporary, { ...temporaryIdentity, nlink: 2 }, 2);
      sameFileIdentity(path, { ...temporaryIdentity, nlink: 1 }, 1);
      return;
    }
    if (existsSync(path)) privateFileIdentity(path, 1);
    renameSync(temporary, path);
    published = true;
    syncDirectory(parent);
    sameFileIdentity(path, temporaryIdentity, 1);
  } catch (error) {
    if (!published && existsSync(temporary)) {
      try { durableUnlink(temporary, temporaryIdentity); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Local provider state publication and durable cleanup both failed"); }
    }
    throw error;
  }
}
function atomicJson(path: string, value: unknown, exclusive = false): void {
  atomicPrivateFile(path, `${JSON.stringify(value)}\n`, exclusive);
}

interface CommandJournalDocument {
  version: 1;
  commandId: string;
  resourceKey: string;
  argvDigest: string;
  phase: "prepared" | "published";
  pid?: number;
  pgid?: number;
  createdAt: string;
  updatedAt: string;
}

function commandJournalPath(root: string, resourceKey: string): string {
  const digest = createHash("sha256").update(resourceKey).digest("hex");
  return confined(root, "command-journals", `${digest}.json`);
}

function readCommandJournal(path: string): CommandJournalDocument {
  const value = boundedJson<Record<string, unknown>>(path);
  const common = ["version", "commandId", "resourceKey", "argvDigest", "phase", "createdAt", "updatedAt"];
  const keys = value.phase === "published" ? [...common, "pid", "pgid"] : common;
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.version !== 1
    || typeof value.commandId !== "string" || !/^cmd_[a-f0-9]{32}$/.test(value.commandId)
    || typeof value.resourceKey !== "string" || value.resourceKey.length < 1 || value.resourceKey.length > 512
    || typeof value.argvDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.argvDigest)
    || !["prepared", "published"].includes(String(value.phase)) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
    || (value.phase === "published" && (!Number.isSafeInteger(value.pid) || Number(value.pid) < 1 || !Number.isSafeInteger(value.pgid) || Number(value.pgid) < 1))) {
    throw new ComputersError("storage_error", "Local command-supervision journal is invalid", 500);
  }
  return value as unknown as CommandJournalDocument;
}

export function createCommandSupervision(root: string, resourceKey: string, argv: string[]): CommandSupervision {
  const path = commandJournalPath(root, resourceKey); const commandId = `cmd_${randomBytes(16).toString("hex")}`;
  const argvDigest = digestDocument(argv); const createdAt = new Date().toISOString();
  const prepared: CommandJournalDocument = { version: 1, commandId, resourceKey, argvDigest, phase: "prepared", createdAt, updatedAt: createdAt };
  return {
    prepare() { atomicJson(path, prepared, true); },
    abortPrepared() {
      const current = readCommandJournal(path);
      if (current.commandId !== commandId || current.phase !== "prepared") throw new ComputersError("storage_error", "Local command-supervision journal changed before spawn abort", 500);
      durableUnlink(path);
    },
    publish(pid, pgid) {
      const current = readCommandJournal(path);
      if (current.commandId !== commandId || current.phase !== "prepared") throw new ComputersError("storage_error", "Local command-supervision journal changed before publication", 500);
      atomicJson(path, { ...current, phase: "published", pid, pgid, updatedAt: new Date().toISOString() });
    },
    clear() {
      const current = readCommandJournal(path);
      if (current.commandId !== commandId || current.phase !== "published") throw new ComputersError("storage_error", "Local command-supervision journal changed before completion", 500);
      clearDeadSupervision(root, resourceKey);
    },
  };
}

function inspectStaleSupervision(root: string, resourceKey: string): "none" | "partial" | "live" | "dead" {
  const path = commandJournalPath(root, resourceKey);
  if (!existsSync(path)) return "none";
  const journal = readCommandJournal(path);
  if (journal.resourceKey !== resourceKey || journal.phase !== "published" || journal.pid === undefined || journal.pgid === undefined) return "partial";
  try { process.kill(-journal.pgid, 0); return "live"; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ESRCH") return "dead";
    return "live";
  }
}

function clearDeadSupervision(root: string, resourceKey: string): void {
  const path = commandJournalPath(root, resourceKey); const journal = readCommandJournal(path);
  if (journal.resourceKey !== resourceKey || journal.phase !== "published") throw new ComputersError("storage_error", "Local command-supervision journal cannot be reclaimed", 500);
  try { process.kill(-Number(journal.pgid), 0); throw new ComputersError("conflict", "Local mutating process group is still live", 409); }
  catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ESRCH")) throw error;
  }
  durableUnlink(path);
}
function manifestPath(root: string, computer: Computer): string {
  validateId(computer.tenantId, "tenantId"); validateId(computer.id, "computerId");
  return confined(root, "computers", computer.tenantId, computer.id, "manifest.json");
}
function validateManifest(value: LocalManifest, computer: Computer): LocalManifest {
  const commonKeys = ["version", "tenantId", "computerId", "ownerPrincipalId", "provider", "resourceId", "instanceId", "profileId", "profileGeneration",
    "profileRevisionDigest", "resolvedProfileDigest", "home", "lifecycle", "assurance", "attachmentGeneration", "updatedAt"];
  const expectedKeys = [...commonKeys, ...(value.bootId === undefined ? [] : ["bootId"]), ...(value.provider === "local_machine" ? ["adoption"] : [])];
  const record = value as unknown as Record<string, unknown>;
  const home = value.home as unknown as Record<string, unknown> | undefined;
  const assurance = value.assurance as unknown as Record<string, unknown> | undefined;
  const assuranceKeys = ["confinementClass", "providerSpecificControlsPassed", "externalEgressEnforced", "residentIndependentIsolation",
    "hostMounts", "hostSockets", "portForwards", "containerd"];
  const expectedAssurance = value.provider === "local_machine" ? dedicatedAssurance() : unverifiedAssurance();
  const validId = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(candidate);
  const validTimestamp = typeof value.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)
    && Number.isFinite(Date.parse(value.updatedAt));
  if (value.version !== 1 || value.tenantId !== computer.tenantId || value.computerId !== computer.id || value.ownerPrincipalId !== computer.ownerPrincipalId || value.provider !== computer.provider
    || Object.keys(record).sort().join(",") !== expectedKeys.sort().join(",")
    || typeof value.resourceId !== "string" || value.resourceId.length < 1 || value.resourceId.length > 256
    || typeof value.instanceId !== "string" || value.instanceId.length < 1 || value.instanceId.length > 256
    || !validId(value.profileId) || (value.bootId !== undefined && (typeof value.bootId !== "string" || value.bootId.length < 1 || value.bootId.length > 256))
    || !["stopped", "running", "quarantined", "deleted"].includes(value.lifecycle) || !Number.isSafeInteger(value.attachmentGeneration) || value.attachmentGeneration < 1
    || !Number.isSafeInteger(value.profileGeneration) || value.profileGeneration < 1 || !/^sha256:[a-f0-9]{64}$/.test(value.profileRevisionDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(value.resolvedProfileDigest)
    || home === undefined || Array.isArray(home) || Object.keys(home).sort().join(",") !== ["kind", "reference", "retained"].sort().join(",")
    || typeof home.reference !== "string" || home.reference.length < 1 || home.reference.length > 4096 || typeof home.retained !== "boolean"
    || assurance === undefined || Array.isArray(assurance) || Object.keys(assurance).sort().join(",") !== assuranceKeys.sort().join(",")
    || canonicalJson(assurance) !== canonicalJson(expectedAssurance) || !validTimestamp
    || (value.provider === "local_vm" && (value.resourceId !== `lima:${instanceName(computer)}` || value.instanceId !== instanceName(computer)
      || home.kind !== "lima_disk" || home.reference !== diskName(computer) || value.adoption !== undefined))
    || (value.provider === "local_machine" && (home.kind !== "adopted_path" || !isAbsolute(String(home.reference))))
    || (value.provider === "local_machine" && (value.adoption === undefined
      || Object.keys(value.adoption as unknown as Record<string, unknown>).sort().join(",") !== ["version", "adoptionId", "hostId", "claimGeneration", "claimFence"].sort().join(",")
      || value.adoption.version !== 1 || typeof value.adoption.adoptionId !== "string" || typeof value.adoption.hostId !== "string"
      || value.resourceId !== `machine:${value.adoption.hostId}` || value.instanceId !== value.adoption.hostId
      || !Number.isSafeInteger(value.adoption.claimGeneration) || value.adoption.claimGeneration < 1 || !/^fence_[a-f0-9]{32}$/.test(value.adoption.claimFence)))) {
    throw new ComputersError("storage_error", "Local provider manifest identity mismatch", 500);
  }
  return value;
}
function readManifest(root: string, computer: Computer): LocalManifest | undefined {
  const path = manifestPath(root, computer); return existsSync(path) ? validateManifest(boundedJson<LocalManifest>(path), computer) : undefined;
}
function writeManifest(root: string, computer: Computer, manifest: LocalManifest, exclusive = false): void { atomicJson(manifestPath(root, computer), manifest, exclusive); }
function hashName(prefix: string, computer: Computer, suffix = ""): string {
  return `${prefix}${createHash("sha256").update(`${computer.tenantId}\0${computer.id}\0${suffix}`).digest("hex").slice(0, 24)}`;
}
function instanceName(computer: Computer): string { return hashName("computers-", computer); }
function diskName(computer: Computer): string { return hashName("home_", computer, "home"); }

interface LocalResourceLock { release(): void }

function acquireResourceLock(root: string, key: string): LocalResourceLock | undefined {
  const lockRoot = confined(root, "locks");
  secureRoot(lockRoot);
  inspectPathAncestry(lockRoot, undefined, true);
  const path = confined(lockRoot, `${createHash("sha256").update(key).digest("hex")}.lock`);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | noFollow, 0o600);
  let held = false;
  try {
    const opened = fstatSync(fd); const linked = lstatSync(path); const uid = process.getuid?.() ?? opened.uid;
    if (!opened.isFile() || !linked.isFile() || linked.isSymbolicLink() || opened.dev !== linked.dev || opened.ino !== linked.ino
      || opened.nlink !== 1 || linked.nlink !== 1 || (opened.uid !== uid && opened.uid !== 0) || (opened.mode & 0o077) !== 0) {
      throw new ComputersError("storage_error", "Local resource lock identity is unsafe", 500);
    }
    if (flock(fd, LOCK_EX | LOCK_NB) !== 0) return undefined;
    held = true;
    return { release: () => { if (!held) return; held = false; try { flock(fd, LOCK_UN); } finally { closeSync(fd); } } };
  } finally {
    if (!held) closeSync(fd);
  }
}

export function renderLimaConfig(profile: LocalVmProfile, homeDiskName: string): string {
  validateId(profile.id, "profileId"); validateId(homeDiskName, "homeDiskName");
  if (!Number.isSafeInteger(profile.cpus) || profile.cpus < 1 || profile.cpus > 64 || !Number.isSafeInteger(profile.memoryGiB) || profile.memoryGiB < 1 || profile.memoryGiB > 256
    || !Number.isSafeInteger(profile.rootDiskGiB) || profile.rootDiskGiB < 8 || profile.rootDiskGiB > 4096 || !Number.isSafeInteger(profile.homeDiskGiB) || profile.homeDiskGiB < 1 || profile.homeDiskGiB > 4096) {
    throw new ComputersError("invalid_request", "Invalid local VM profile resources", 500);
  }
  let image: URL; try { image = new URL(profile.imageLocation); } catch { throw new ComputersError("invalid_request", "Invalid local VM image", 500); }
  if (image.protocol !== "https:" || image.username || image.password || !/^sha256:[a-f0-9]{64}$/.test(profile.imageDigest)) throw new ComputersError("invalid_request", "Local VM image must be pinned credential-free HTTPS", 500);
  return [
    `minimumLimaVersion: "${SUPPORTED_LIMA_VERSION}"`, 'vmType: "vz"', 'os: "Linux"', 'arch: "aarch64"', "plain: true",
    "user:", '  name: "computers"', '  comment: "Computers resident"', '  home: "/home/computers"', '  shell: "/bin/bash"', "  uid: 1000",
    `cpus: ${profile.cpus}`, `memory: "${profile.memoryGiB}GiB"`, `disk: "${profile.rootDiskGiB}GiB"`,
    "firmware:", "  legacyBIOS: false", "  images: []", "audio:", '  device: "none"', "video:", '  display: "none"', "  vnc:", '    display: "none"',
    "upgradePackages: false", "nestedVirtualization: false", 'timezone: ""', 'guestInstallPrefix: "/usr/local"',
    "mounts: []", "portForwards: []", "copyToHost: []", "provision: []", "probes: []", "networks: []", "dns: []",
    "caCerts:", "  removeDefaults: false", "  files: []", "  certs: []", "propagateProxyEnv: false", "env: {}", "param: {}",
    "hostResolver:", "  enabled: false", "  ipv6: false", "  hosts: {}", "containerd:", "  system: false", "  user: false",
    "rosetta:", "  enabled: false", "  binfmt: false", "ssh:", "  localPort: 0", "  loadDotSSHPubKeys: false", "  forwardAgent: false",
    "  forwardX11: false", "  forwardX11Trusted: false", "  overVsock: false", "additionalDisks:", `  - name: "${homeDiskName}"`, "    format: false",
    "images:", `  - location: "${image.toString()}"`, '    arch: "aarch64"', `    digest: "${profile.imageDigest}"`, "",
  ].join("\n");
}

export function validateLimaInspection(value: ResolvedLimaInspection, homeDiskName: string, expectedProfileDigest?: string): void {
  if (!value.exists || value.vmType !== "vz" || value.arch !== "aarch64" || value.plain !== true || value.mountCount !== 0 || value.portForwardCount !== 0
    || value.provisionCount !== 0 || value.probeCount !== 0 || value.networkCount !== 0 || value.envEntryCount !== 0
    || value.hostResolverEnabled || value.hostResolverIpv6 || value.hostResolverHostsCount !== 0 || value.containerdSystem || value.containerdUser
    || value.rosettaEnabled || value.rosettaBinFmt || value.sshLocalPort !== 0 || value.forwardAgent || value.loadDotSshPubKeys
    || value.forwardX11 || value.forwardX11Trusted || value.sshOverVsock || value.guestAgentEnabled || value.propagateProxyEnv
    || value.additionalDisks.length !== 1 || value.additionalDisks[0]?.name !== homeDiskName || value.additionalDisks[0]?.format !== false
    || expectedProfileDigest !== undefined && value.profileDigest !== expectedProfileDigest) {
    throw new ComputersError("provider_not_configured", "Resolved Lima configuration failed safe local-VM diagnostics", 503);
  }
}

function limaInspectionError(message = "Lima instance inspection is indeterminate"): never {
  throw new ComputersError("provider_not_configured", message, 503);
}
function limaRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return limaInspectionError(`Invalid Lima ${label}`);
  return value as Record<string, unknown>;
}
function limaArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return limaInspectionError(`Invalid Lima ${label}`);
  return value;
}
function limaBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return limaInspectionError(`Invalid Lima ${label}`);
  return value;
}
function limaString(value: unknown, label: string): string {
  if (typeof value !== "string") return limaInspectionError(`Invalid Lima ${label}`);
  return value;
}
function limaInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return limaInspectionError(`Invalid Lima ${label}`);
  return Number(value);
}
function limaGiB(value: unknown, label: string): number {
  const match = /^([1-9][0-9]*)GiB$/.exec(limaString(value, label));
  if (match === null) return limaInspectionError(`Invalid Lima ${label}`);
  const gib = Number(match[1]);
  if (!Number.isSafeInteger(gib) || gib * GIB > Number.MAX_SAFE_INTEGER) return limaInspectionError(`Invalid Lima ${label}`);
  return gib * GIB;
}
function limaStringRecord(value: unknown, label: string): Record<string, string> {
  const record = limaRecord(value, label);
  for (const item of Object.values(record)) if (typeof item !== "string") return limaInspectionError(`Invalid Lima ${label}`);
  return record as Record<string, string>;
}
function limaExactKeys(record: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(record).some((key) => !keys.includes(key))) return limaInspectionError(`Invalid Lima ${label}`);
}
const SUPPORTED_LIMA_VERSION = "2.1.1";
const SUPPORTED_LIMA_TOP_LEVEL_KEYS = [
  "minimumLimaVersion", "vmType", "os", "arch", "plain", "user", "cpus", "memory", "disk", "firmware", "audio", "video", "upgradePackages",
  "nestedVirtualization", "timezone", "guestInstallPrefix", "mounts", "portForwards", "copyToHost", "provision", "probes", "networks", "dns", "caCerts",
  "propagateProxyEnv", "env", "param", "hostResolver", "containerd", "rosetta", "ssh", "additionalDisks", "images",
];
function validateLimaConfigShape(config: Record<string, unknown>): void {
  limaExactKeys(config, SUPPORTED_LIMA_TOP_LEVEL_KEYS, "instance configuration");
  const hostResolver = limaRecord(config.hostResolver, "host resolver"); limaExactKeys(hostResolver, ["enabled", "ipv6", "hosts"], "host resolver");
  const containerd = limaRecord(config.containerd, "containerd configuration"); limaExactKeys(containerd, ["system", "user"], "containerd configuration");
  const rosetta = limaRecord(config.rosetta, "Rosetta configuration"); limaExactKeys(rosetta, ["enabled", "binfmt"], "Rosetta configuration");
  const ssh = limaRecord(config.ssh, "SSH configuration");
  limaExactKeys(ssh, ["localPort", "loadDotSSHPubKeys", "forwardAgent", "forwardX11", "forwardX11Trusted", "overVsock"], "SSH configuration");
  const user = limaRecord(config.user, "user configuration"); limaExactKeys(user, ["name", "comment", "home", "shell", "uid"], "user configuration");
  const firmware = limaRecord(config.firmware, "firmware configuration"); limaExactKeys(firmware, ["legacyBIOS", "images"], "firmware configuration");
  const audio = limaRecord(config.audio, "audio configuration"); limaExactKeys(audio, ["device"], "audio configuration");
  const video = limaRecord(config.video, "video configuration"); limaExactKeys(video, ["display", "vnc"], "video configuration");
  const vnc = limaRecord(video.vnc, "VNC configuration"); limaExactKeys(vnc, ["display"], "VNC configuration");
  const ca = limaRecord(config.caCerts, "CA certificate configuration"); limaExactKeys(ca, ["removeDefaults", "files", "certs"], "CA certificate configuration");
}
function validatePerComputerLimaGlobals(limaHome: string): void {
  const home = resolve(limaHome); inspectPathAncestry(home, process.getuid?.(), true);
  const configDirectory = confined(home, "_config");
  if (!existsSync(configDirectory)) return;
  inspectPathAncestry(configDirectory, process.getuid?.(), true);
  for (const name of ["default.yaml", "override.yaml", "base.yaml"]) {
    const path = confined(configDirectory, name);
    if (existsSync(path)) throw new ComputersError("provider_not_configured", `Per-Computer Lima ${name} is unsupported`, 503);
  }
}
function readAuthoritativeLimaYaml(limaHome: string, name: string): Record<string, unknown> {
  if (!/^computers-[a-f0-9]{24}$/.test(name)) return limaInspectionError("Invalid Lima instance identity");
  const home = resolve(limaHome); inspectPathAncestry(home, process.getuid?.(), true);
  const instanceDirectory = confined(home, name); inspectPathAncestry(instanceDirectory, process.getuid?.(), true);
  const configPath = confined(home, name, "lima.yaml");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor); const linked = lstatSync(configPath); const uid = process.getuid?.() ?? before.uid;
    if (!before.isFile() || !linked.isFile() || linked.isSymbolicLink() || before.dev !== linked.dev || before.ino !== linked.ino
      || before.nlink !== 1 || linked.nlink !== 1 || before.size !== linked.size || before.mtimeMs !== linked.mtimeMs || before.ctimeMs !== linked.ctimeMs
      || before.size < 1 || before.size > MAX_STATE_BYTES || (before.uid !== uid && before.uid !== 0) || linked.uid !== before.uid
      || (before.mode & 0o022) !== 0 || (linked.mode & 0o022) !== 0) {
      return limaInspectionError("Authoritative Lima instance configuration is unsafe");
    }
    const text = readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(text) !== before.size) return limaInspectionError("Authoritative Lima instance configuration changed during inspection");
    const after = fstatSync(descriptor); const pathStat = lstatSync(configPath);
    if (!after.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== before.nlink
      || after.uid !== before.uid || after.mode !== before.mode
      || pathStat.dev !== before.dev || pathStat.ino !== before.ino || pathStat.size !== before.size || pathStat.mtimeMs !== before.mtimeMs
      || pathStat.ctimeMs !== before.ctimeMs || pathStat.nlink !== before.nlink || pathStat.uid !== before.uid || pathStat.mode !== linked.mode) {
      return limaInspectionError("Authoritative Lima instance configuration changed during inspection");
    }
    const config = limaRecord(Bun.YAML.parse(text), "instance configuration"); validateLimaConfigShape(config); return config;
  } catch (error) {
    if (error instanceof ComputersError) throw error;
    return limaInspectionError("Authoritative Lima instance configuration is unreadable");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
export class LimactlInspector implements LimaInspector {
  constructor(private readonly path: string, private readonly limaHome: string, private readonly runner: CommandRunner,
    private readonly executablePin?: PinnedExecutable) {}
  async inspect(name: string, _requestConfigPath?: string): Promise<ResolvedLimaInspection> {
    validatePerComputerLimaGlobals(this.limaHome);
    const list = await this.run([this.path, "list", "--all-fields", "--format", "json"], 30_000, 256 * 1024);
    if (list.exitCode !== 0 || list.timedOut || list.outputExceeded) return limaInspectionError();
    const record = this.parseList(list.stdout, name);
    if (record === undefined) return this.absent();
    if (limaString(record.limaVersion, "listed Lima version") !== SUPPORTED_LIMA_VERSION) return limaInspectionError("Unsupported Lima instance version");
    const config = readAuthoritativeLimaYaml(this.limaHome, name);
    const vmType = limaString(config.vmType, "vmType"); const arch = limaString(config.arch, "arch");
    if (limaString(record.vmType, "listed vmType") !== vmType || limaString(record.arch, "listed arch") !== arch) {
      return limaInspectionError("Lima list and instance configuration disagree");
    }
    const ssh = limaRecord(config.ssh, "SSH configuration"); const hostResolver = limaRecord(config.hostResolver, "host resolver");
    const containerd = limaRecord(config.containerd, "containerd configuration"); const rosetta = limaRecord(config.rosetta, "Rosetta configuration");
    const disks = limaArray(config.additionalDisks, "additional disks").map((value) => {
      const disk = limaRecord(value, "additional disk"); limaExactKeys(disk, ["name", "format"], "additional disk");
      return { name: limaString(disk.name, "additional disk name"), format: limaBoolean(disk.format, "additional disk format") };
    });
    const images = limaArray(config.images, "images");
    if (images.length !== 1) return limaInspectionError("Invalid Lima images");
    const image = limaRecord(images[0], "image"); limaExactKeys(image, ["location", "arch", "digest"], "image");
    const imageLocation = limaString(image.location, "image location"); const imageArch = limaString(image.arch, "image arch");
    const imageDigest = limaString(image.digest, "image digest");
    let normalizedImage: string;
    try { normalizedImage = new URL(imageLocation).toString(); } catch { return limaInspectionError("Invalid Lima image location"); }
    const cpus = limaInteger(config.cpus, "cpus"); const memoryBytes = limaGiB(config.memory, "memory"); const rootDiskBytes = limaGiB(config.disk, "disk");
    if (limaInteger(record.cpus, "listed cpus") !== cpus || limaInteger(record.memory, "listed memory") !== memoryBytes
      || limaInteger(record.disk, "listed disk") !== rootDiskBytes) return limaInspectionError("Lima list and instance resources disagree");
    const plain = limaBoolean(config.plain, "plain mode"); const env = limaStringRecord(config.env, "environment");
    const user = limaRecord(config.user, "user configuration"); const firmware = limaRecord(config.firmware, "firmware configuration");
    const audio = limaRecord(config.audio, "audio configuration"); const video = limaRecord(config.video, "video configuration");
    const vnc = limaRecord(video.vnc, "VNC configuration"); const ca = limaRecord(config.caCerts, "CA certificate configuration");
    if (limaString(config.minimumLimaVersion, "minimum Lima version") !== SUPPORTED_LIMA_VERSION || limaString(config.os, "guest OS") !== "Linux"
      || limaString(user.name, "user name") !== "computers" || limaString(user.comment, "user comment") !== "Computers resident"
      || limaString(user.home, "user home") !== "/home/computers" || limaString(user.shell, "user shell") !== "/bin/bash" || limaInteger(user.uid, "user uid") !== 1000
      || limaBoolean(firmware.legacyBIOS, "legacy BIOS") || limaArray(firmware.images, "firmware images").length !== 0
      || limaString(audio.device, "audio device") !== "none" || limaString(video.display, "video display") !== "none" || limaString(vnc.display, "VNC display") !== "none"
      || limaBoolean(config.upgradePackages, "package upgrades") || limaBoolean(config.nestedVirtualization, "nested virtualization")
      || limaString(config.timezone, "timezone") !== "" || limaString(config.guestInstallPrefix, "guest install prefix") !== "/usr/local"
      || limaArray(config.copyToHost, "copy-to-host rules").length !== 0 || limaArray(config.dns, "DNS servers").length !== 0
      || limaBoolean(ca.removeDefaults, "CA default removal") || limaArray(ca.files, "CA files").length !== 0 || limaArray(ca.certs, "CA certificates").length !== 0
      || Object.keys(limaStringRecord(config.param, "parameters")).length !== 0) return limaInspectionError("Unsupported Lima resolved defaults");
    const hosts = limaStringRecord(hostResolver.hosts, "host resolver hosts");
    const profile = {
      minimumLimaVersion: SUPPORTED_LIMA_VERSION, vmType, os: "Linux", arch, plain,
      user: { name: "computers", comment: "Computers resident", home: "/home/computers", shell: "/bin/bash", uid: 1000 },
      cpus, memoryBytes, rootDiskBytes, image: { location: normalizedImage, arch: imageArch, digest: imageDigest },
      firmware: { legacyBIOS: false, images: [] }, audio: { device: "none" }, video: { display: "none", vnc: { display: "none" } },
      upgradePackages: false, nestedVirtualization: false, timezone: "", guestInstallPrefix: "/usr/local",
      mounts: limaArray(config.mounts, "mounts"), portForwards: limaArray(config.portForwards, "port forwards"), copyToHost: [],
      provision: limaArray(config.provision, "provision"), probes: limaArray(config.probes, "probes"), networks: limaArray(config.networks, "networks"),
      dns: [], caCerts: { removeDefaults: false, files: [], certs: [] }, env, param: {},
      propagateProxyEnv: limaBoolean(config.propagateProxyEnv, "proxy environment propagation"),
      hostResolver: { enabled: limaBoolean(hostResolver.enabled, "host resolver enabled"), ipv6: limaBoolean(hostResolver.ipv6, "host resolver IPv6"), hosts },
      containerd: { system: limaBoolean(containerd.system, "system containerd"), user: limaBoolean(containerd.user, "user containerd") },
      rosetta: { enabled: limaBoolean(rosetta.enabled, "Rosetta enabled"), binfmt: limaBoolean(rosetta.binfmt, "Rosetta binfmt") },
      ssh: { localPort: limaInteger(ssh.localPort, "SSH local port"), loadDotSSHPubKeys: limaBoolean(ssh.loadDotSSHPubKeys, "user SSH public-key loading"),
        forwardAgent: limaBoolean(ssh.forwardAgent, "SSH agent forwarding"), forwardX11: limaBoolean(ssh.forwardX11, "SSH X11 forwarding"),
        forwardX11Trusted: limaBoolean(ssh.forwardX11Trusted, "trusted SSH X11 forwarding"), overVsock: limaBoolean(ssh.overVsock, "SSH over vsock") },
      additionalDisks: disks,
    };
    return {
      exists: true, status: this.status(record.status), vmType, arch, plain, cpus, memoryBytes, rootDiskBytes,
      imageLocation: normalizedImage, imageDigest, profileDigest: digestDocument(profile),
      mountCount: profile.mounts.length, portForwardCount: profile.portForwards.length, provisionCount: profile.provision.length,
      probeCount: profile.probes.length, networkCount: profile.networks.length, envEntryCount: Object.keys(env).length, additionalDisks: disks,
      hostResolverEnabled: profile.hostResolver.enabled, hostResolverIpv6: profile.hostResolver.ipv6, hostResolverHostsCount: Object.keys(hosts).length,
      containerdSystem: profile.containerd.system, containerdUser: profile.containerd.user, rosettaEnabled: profile.rosetta.enabled,
      rosettaBinFmt: profile.rosetta.binfmt, sshLocalPort: profile.ssh.localPort, forwardAgent: profile.ssh.forwardAgent,
      loadDotSshPubKeys: profile.ssh.loadDotSSHPubKeys, forwardX11: profile.ssh.forwardX11, forwardX11Trusted: profile.ssh.forwardX11Trusted,
      sshOverVsock: profile.ssh.overVsock, guestAgentEnabled: !plain, propagateProxyEnv: profile.propagateProxyEnv,
    };
  }
  async inspectDisk(name: string, expectedInstanceName?: string): Promise<ResolvedLimaDisk | undefined> {
    const output = await this.run([this.path, "disk", "list", "--json"], 30_000, 256 * 1024);
    if (output.exitCode !== 0 || output.timedOut || output.outputExceeded) throw new ComputersError("provider_not_configured", "Lima disk inspection failed", 503);
    const records = this.parseJsonLines(output.stdout, "disk list"); const seen = new Set<string>(); let match: Record<string, unknown> | undefined;
    for (const record of records) {
      limaExactKeys(record, ["name", "size", "format", "dir", "instance", "instanceDir", "mountPoint", "fsType"], "disk list record");
      const diskName = limaString(record.name, "disk name");
      if (seen.has(diskName)) return limaInspectionError("Lima disk list result is duplicated");
      seen.add(diskName); if (diskName === name) match = record;
    }
    if (match === undefined) return undefined;
    const expectedDir = resolve(this.limaHome, "_disks", name); const dir = limaString(match.dir, "disk directory");
    const instance = limaString(match.instance, "disk instance"); const instanceDir = limaString(match.instanceDir, "disk instance directory");
    if (resolve(dir) !== expectedDir || dir !== expectedDir || realpathSync(expectedDir) !== expectedDir) return limaInspectionError("Lima disk directory is not canonical");
    const stat = lstatSync(expectedDir); const uid = process.getuid?.() ?? stat.uid;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0) return limaInspectionError("Lima disk directory is unsafe");
    if (expectedInstanceName !== undefined && instance !== expectedInstanceName) return limaInspectionError("Lima disk is not attached to the expected instance");
    const expectedInstanceDir = expectedInstanceName === undefined ? "" : resolve(this.limaHome, expectedInstanceName);
    if (instanceDir !== expectedInstanceDir) return limaInspectionError("Lima disk instance directory is invalid");
    return { name, sizeBytes: limaInteger(match.size, "disk size"), format: limaString(match.format, "disk format"), dir,
      instance, instanceDir, mountPoint: limaString(match.mountPoint, "disk mount point") };
  }
  private async run(argv: string[], timeoutMs: number, maxOutputBytes: number): Promise<CommandResult> {
    if (this.executablePin !== undefined) assertPinnedExecutable(this.executablePin);
    const result = await this.runner.run({ argv, env: { LIMA_HOME: this.limaHome, PATH: LIMA_SYSTEM_PATH }, timeoutMs, maxOutputBytes });
    if (this.executablePin !== undefined) assertPinnedExecutable(this.executablePin);
    return result;
  }
  private parseList(text: string, name: string): Record<string, unknown> | undefined {
    if (Buffer.byteLength(text) > 256 * 1024) throw new ComputersError("provider_not_configured", "Lima list output is too large", 503);
    const records = this.parseJsonLines(text, "list"); const seen = new Set<string>(); let match: Record<string, unknown> | undefined;
    for (const record of records) {
      const instanceName = limaString(record.name, "instance name");
      if (seen.has(instanceName)) return limaInspectionError("Lima named instance result is duplicated");
      seen.add(instanceName); if (instanceName === name) match = record;
    }
    return match;
  }
  private parseJsonLines(text: string, label: string): Record<string, unknown>[] {
    if (text === "") return [];
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (lines.length > MAX_JSONL_RECORDS || lines.some((line) => line.trim() === "")) return limaInspectionError(`Lima ${label} output is invalid`);
    try { return lines.map((line) => limaRecord(JSON.parse(line), `${label} record`)); }
    catch { throw new ComputersError("provider_not_configured", `Lima ${label} output is invalid`, 503); }
  }
  private status(value: unknown): ResolvedLimaInspection["status"] { return value === "Running" || value === "Stopped" || value === "Broken" ? value : "Unknown"; }
  private absent(): ResolvedLimaInspection { return { exists: false, status: "Unknown", vmType: "", arch: "", plain: false, cpus: 0, memoryBytes: 0,
    rootDiskBytes: 0, imageLocation: "", imageDigest: "", profileDigest: "", mountCount: 0, portForwardCount: 0, provisionCount: 0,
    probeCount: 0, networkCount: 0, envEntryCount: 0, additionalDisks: [], hostResolverEnabled: false, hostResolverIpv6: false,
    hostResolverHostsCount: 0, containerdSystem: false, containerdUser: false, rosettaEnabled: false, rosettaBinFmt: false,
    sshLocalPort: 0, forwardAgent: false, loadDotSshPubKeys: false, forwardX11: false, forwardX11Trusted: false, sshOverVsock: false,
    guestAgentEnabled: false, propagateProxyEnv: false }; }
}

abstract class LocalProviderBase implements ProviderPort {
  abstract readonly kind: "local_machine" | "local_vm"; protected readonly root: string; protected readonly runner: CommandRunner;
  constructor(options: LocalProviderOptions) { this.root = secureRoot(options.stateRoot); this.runner = options.runner ?? new BunCommandRunner(); }
  abstract readiness(): Promise<ProviderReadiness>; abstract create(request: ProviderCreateRequest): Promise<ProviderOutcome>;
  abstract start(request: ProviderOperationRequest): Promise<ProviderOutcome>; abstract stop(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  abstract quarantine(request: ProviderOperationRequest): Promise<ProviderOutcome>; abstract delete(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  abstract reconcile(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  async restore(_request: ProviderOperationRequest): Promise<ProviderOutcome> { return fail("unsupported_operation", "Local restore is unavailable"); }
  protected async withResourceGuard(request: ProviderCreateRequest, key: string, action: () => Promise<ProviderOutcome>, reconciling = false): Promise<ProviderOutcome> {
    try { request.execution.assertCurrent(); }
    catch { return unknown(request, "Local provider execution ownership is no longer current"); }
    let lock: LocalResourceLock | undefined;
    try { lock = acquireResourceLock(this.root, key); }
    catch { return unknown(request, "Local resource lock state is indeterminate"); }
    if (lock === undefined) return unknown(request, "Local resource mutation is already supervised by another owner");
    try {
      request.execution.assertCurrent();
      const stale = inspectStaleSupervision(this.root, key);
      if (stale === "partial") return unknown(request, "Local command supervision was only partially published; manual recovery is required");
      if (stale === "live") return unknown(request, "A detached local mutator is still running; provider state is unknown");
      if (stale === "dead") {
        clearDeadSupervision(this.root, key);
        if (!reconciling) return unknown(request, "A stale local mutator was fenced; reconciliation is required before another mutation");
      }
      const outcome = await action();
      request.execution.assertCurrent();
      return outcome;
    } catch (error) {
      if (error instanceof ComputersError && error.code === "conflict") return unknown(request, "Local provider execution ownership was lost during mutation");
      throw error;
    } finally { lock.release(); }
  }
  protected writeManifestOwned(request: ProviderCreateRequest, manifest: LocalManifest, exclusive = false): void {
    request.execution.assertCurrent(); writeManifest(this.root, request.computer, manifest, exclusive); request.execution.assertCurrent();
  }
}

export class AdoptedMachineProvider extends LocalProviderBase {
  readonly kind = "local_machine" as const; private readonly config: LocalMachineAdoptionConfig | undefined;
  constructor(options: LocalProviderOptions) { super(options); this.config = options.adoption; }
  async readiness(): Promise<ProviderReadiness> {
    const configured = this.config !== undefined;
    let ready = false; if (this.config !== undefined) try { validateAdoptionConfiguration(this.config); ready = true; } catch { /* fail closed */ }
    return { provider: this.kind, configured, ready, confinementClass: "dedicated_machine", controls: { entireHostDedicated: false, controllerExternallyProtected: false, authoritativeObservationRequired: true }, limitations: configured
      ? ["Readiness does not attest dedication; adoption requires a live authoritative observation.", "The resident shares the adopted host OS and is not independently isolated."]
      : ["A controller-owned adoption inventory and authoritative lifecycle observer are required."] };
  }
  async create(request: ProviderCreateRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "create"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.createOwned(request));
  }
  private async createOwned(request: ProviderCreateRequest): Promise<ProviderOutcome> {
    const config = this.config; if (config === undefined) return fail("provider_not_configured", "Adopted-machine provider is not configured");
    const validated = this.validatedConfiguration(config); if ("kind" in validated) return validated;
    const bindingMismatch = this.requestBindingMismatch(request, config, "create"); if (bindingMismatch !== undefined) return bindingMismatch;
    const profile = this.profileIdentity(request, config);
    if (profile === undefined) return fail("profile_mismatch", "Adopted-machine profile binding does not match controller inventory");
    const establishedManifest = readManifest(this.root, request.computer);
    const establishedClaim = establishedManifest === undefined ? undefined : this.currentClaim(establishedManifest);
    if (establishedManifest !== undefined) {
      const mismatch = this.establishedIdentityMismatch(request, config, profile, establishedManifest, establishedClaim);
      if (mismatch !== undefined) return mismatch;
    }
    if (establishedManifest !== undefined && (establishedClaim === undefined || establishedClaim.state !== "active")) {
      return unknown(request, "Adopted-machine manifest does not match an active durable claim", establishedManifest);
    }
    if (establishedManifest === undefined && existsSync(this.claimPath())) {
      const current = this.readClaim(); const mismatch = this.reusableClaimMismatch(request, config, profile, current, current.state === "released");
      if (mismatch !== undefined) return mismatch;
      if (current.state === "released") {
        const releasedMismatch = this.releasedClaimManifestMismatch(request, config, profile, current);
        if (releasedMismatch !== undefined) return releasedMismatch;
      }
    }
    const ownership = establishedClaim ?? this.ensureClaim(request, config, profile);
    const observation = await this.observe(config, ownership, request.execution); const rejected = this.rejectObservation(config, observation);
    if (rejected !== undefined) return establishedClaim === undefined
      ? this.releaseRejectedClaim(request, ownership, rejected)
      : unknown(request, "Authoritative adoption rejection left the established claim held for reconciliation", establishedManifest);
    const manifest = this.claimManifest(request, config, observation, ownership, validated.home);
    if (observation.state !== "running") return unknown(request, "Adopted host state is not yet authoritatively running", manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { adopted: true, residentBindingVerified: observation.residentHeartbeatCurrent }) };
  }
  async start(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "start"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.transition(request, "running"));
  }
  async stop(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "stop"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.transition(request, "stopped"));
  }
  async quarantine(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "quarantine"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.transition(request, "quarantined"));
  }
  async delete(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "delete"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.deleteOwned(request));
  }
  private async deleteOwned(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const config = this.config; const manifest = readManifest(this.root, request.computer);
    if (config === undefined || manifest === undefined) return fail("not_adopted", "Adopted-machine claim is unavailable");
    const validated = this.validatedConfiguration(config); if ("kind" in validated) return validated;
    const bindingMismatch = this.requestBindingMismatch(request, config, "delete"); if (bindingMismatch !== undefined) return bindingMismatch;
    const profile = this.profileIdentity(request, config);
    if (profile === undefined) return fail("profile_mismatch", "Adopted-machine profile binding has drifted", resource(manifest));
    if (config.controller.release === undefined) return fail("unsupported_operation", "Adopted-machine release requires an authoritative controller adapter", resource(manifest));
    const claimPath = this.claimPath(); const claim = this.currentClaim(manifest);
    const mismatch = this.establishedIdentityMismatch(request, config, profile, manifest, claim);
    if (mismatch !== undefined) return mismatch;
    if (claim === undefined) return unknown(request, "Adopted-machine claim was superseded", manifest);
    if (claim.state === "released") {
      manifest.lifecycle = "deleted"; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
      return { kind: "success", resource: resource(manifest), result: result(manifest, { retainHome: true, reconciled: true }) };
    }
    if (claim.state === "active") {
      let observation: AdoptedMachineObservation;
      try { observation = await this.observe(config, claim, request.execution); }
      catch { return unknown(request, "Adopted-machine release preflight observation is indeterminate", manifest); }
      const rejected = this.rejectObservation(config, observation);
      if (rejected !== undefined) return unknown(request, "Authoritative adoption rejection left the exact claim held", manifest);
      if (observation.state === "running" || observation.state === "unknown") {
        return unknown(request, "Adopted-machine release requires an authoritatively stopped or quarantined host", manifest);
      }
      request.execution.assertCurrent(); atomicJson(claimPath, { ...claim, state: "releasing", updatedAt: new Date().toISOString() }); request.execution.assertCurrent();
    } else if (claim.state !== "releasing") return unknown(request, "Adopted-machine release claim is not current", manifest);
    let released: { released: boolean };
    try {
      request.execution.assertCurrent();
      released = await config.controller.release(claim, request.execution);
      request.execution.assertCurrent();
    } catch { return unknown(request, "Adopted-machine release outcome is indeterminate", manifest); }
    if (released.released !== true) return unknown(request, "Adopted-machine release was not confirmed", manifest);
    const current = this.currentClaim(manifest);
    if (current === undefined || current.state !== "releasing") return unknown(request, "Adopted-machine release claim was superseded", manifest);
    request.execution.assertCurrent(); atomicJson(claimPath, { ...current, state: "released", updatedAt: new Date().toISOString() }); request.execution.assertCurrent();
    manifest.lifecycle = "deleted"; manifest.attachmentGeneration += 1; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { retainHome: true }) };
  }
  async reconcile(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const preflight = this.requestPreflight(request, "reconcile"); if (preflight !== undefined) return preflight;
    return this.withResourceGuard(request, this.lockKey(), () => this.reconcileOwned(request), true);
  }
  private async reconcileOwned(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const config = this.config; if (config === undefined) return fail("provider_not_configured", "Adopted-machine provider is not configured");
    const validated = this.validatedConfiguration(config); if ("kind" in validated) return validated;
    const bindingMismatch = this.requestBindingMismatch(request, config, "reconcile");
    if (bindingMismatch !== undefined) return bindingMismatch;
    const existingManifest = readManifest(this.root, request.computer);
    const profile = this.profileIdentity(request, config);
    if (profile === undefined) {
      return fail("profile_mismatch", "Adopted-machine profile binding has drifted", existingManifest === undefined ? undefined : resource(existingManifest));
    }
    const existingClaim = existingManifest === undefined ? undefined : this.currentClaim(existingManifest);
    if (existingManifest !== undefined) {
      const mismatch = this.establishedIdentityMismatch(request, config, profile, existingManifest, existingClaim);
      if (mismatch !== undefined) return mismatch;
    }
    if (request.operation.kind === "delete") {
      const manifest = readManifest(this.root, request.computer);
      if (manifest === undefined || !existsSync(this.claimPath())) return unknown(request, "Adopted-machine deletion reconciliation requires an exact durable claim", manifest);
      return this.deleteOwned(request);
    }
    const establishedClaim = existingClaim;
    if (existingManifest !== undefined && (establishedClaim === undefined || establishedClaim.state !== "active")) {
      return unknown(request, "Adopted-machine manifest does not match an active durable claim", existingManifest);
    }
    const ownership = establishedClaim ?? this.ensureClaim(request, config, profile);
    const observation = await this.observe(config, ownership, request.execution); const rejected = this.rejectObservation(config, observation);
    if (rejected !== undefined) return establishedClaim === undefined
      ? this.releaseRejectedClaim(request, ownership, rejected)
      : unknown(request, "Authoritative adoption rejection left the established claim held for reconciliation", existingManifest);
    const manifest = existingManifest ?? this.claimManifest(request, config, observation, ownership, validated.home);
    if (observation.state === "unknown") return unknown(request, "Authoritative adopted-machine state is unknown", manifest);
    if (request.operation.kind === "stop" || request.operation.kind === "quarantine") {
      const desired = request.operation.kind === "quarantine" ? "quarantined" : "stopped";
      if (this.restrictiveness(observation.state) < this.restrictiveness(desired)) return this.transition(request, desired, observation);
      manifest.lifecycle = observation.state; manifest.bootId = observation.bootId; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
      return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true, residentBindingVerified: observation.residentHeartbeatCurrent }) };
    }
    if (request.operation.desiredComputerStatus !== observation.state) return unknown(request, "Authoritative adopted-machine state differs from the requested state", manifest);
    manifest.lifecycle = observation.state; manifest.bootId = observation.bootId; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true, residentBindingVerified: observation.residentHeartbeatCurrent }) };
  }
  private lockKey(): string { return ADOPTION_RESOURCE_KEY; }
  private async transition(request: ProviderOperationRequest, desired: Exclude<ObservedMachineState, "unknown">,
    observed?: AdoptedMachineObservation): Promise<ProviderOutcome> {
    const config = this.config; const manifest = readManifest(this.root, request.computer);
    if (config === undefined || manifest === undefined) return fail("not_adopted", "Adopted-machine claim is unavailable");
    const validated = this.validatedConfiguration(config); if ("kind" in validated) return validated;
    const entryPoint = desired === "running" ? "start" : desired === "stopped" ? "stop" : "quarantine";
    const bindingMismatch = this.requestBindingMismatch(request, config, entryPoint); if (bindingMismatch !== undefined) return bindingMismatch;
    const profile = this.profileIdentity(request, config);
    if (profile === undefined) return fail("profile_mismatch", "Adopted-machine profile binding has drifted", resource(manifest));
    const claim = this.currentClaim(manifest); const mismatch = this.establishedIdentityMismatch(request, config, profile, manifest, claim);
    if (mismatch !== undefined) return mismatch;
    if (claim === undefined || claim.state !== "active") return unknown(request, "Adopted-machine claim is not current", manifest);
    let initial: AdoptedMachineObservation;
    try { initial = observed ?? await this.observe(config, claim, request.execution); }
    catch { return unknown(request, "Adopted-machine lifecycle preflight observation is indeterminate", manifest); }
    const initialRejection = this.rejectObservation(config, initial);
    if (initialRejection !== undefined) return unknown(request, "Authoritative adoption rejection left the established claim held for reconciliation", manifest);
    if (initial.state === "unknown") return unknown(request, "Authoritative adopted-machine state is unknown", manifest);
    const alreadyRestrictive = desired === "running" ? initial.state === "running"
      : this.restrictiveness(initial.state) >= this.restrictiveness(desired);
    if (alreadyRestrictive) {
      manifest.lifecycle = initial.state; manifest.bootId = initial.bootId; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
      return { kind: "success", resource: resource(manifest), result: result(manifest, { residentBindingVerified: initial.residentHeartbeatCurrent }) };
    }
    if (config.controller.transition === undefined) return fail("unsupported_operation", "Adopted-machine lifecycle requires an authoritative controller adapter", resource(manifest));
    try {
      request.execution.assertCurrent(); await config.controller.transition(desired, claim, request.execution); request.execution.assertCurrent();
    } catch { return unknown(request, "Adopted-machine lifecycle outcome is indeterminate", manifest); }
    const observation = await this.observe(config, claim, request.execution); const rejected = this.rejectObservation(config, observation);
    if (rejected !== undefined) return unknown(request, "Authoritative adoption rejection left the established claim held for reconciliation", manifest);
    if (observation.state !== desired) return unknown(request, "Authoritative adopted-machine state did not reach the requested state", manifest);
    manifest.lifecycle = desired; manifest.bootId = observation.bootId; manifest.attachmentGeneration += 1; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { residentBindingVerified: observation.residentHeartbeatCurrent }) };
  }
  private restrictiveness(state: Exclude<ObservedMachineState, "unknown">): number {
    return state === "running" ? 0 : state === "stopped" ? 1 : 2;
  }
  private async observe(config: LocalMachineAdoptionConfig, claim: AdoptionClaimContext, execution: ProviderExecutionGuard): Promise<AdoptedMachineObservation> {
    execution.assertCurrent(); const value = await config.controller.observe(claim, execution); execution.assertCurrent();
    validateId(value.hostId, "observed hostId"); validateId(value.bootId, "observed bootId"); return value;
  }
  private rejectObservation(config: LocalMachineAdoptionConfig, value: AdoptedMachineObservation): ProviderOutcome | undefined {
    if (value.hostId !== config.hostId || value.ownership !== "dedicated" || !value.controllerExternallyProtected) return fail("adoption_unproven", "Host identity, dedication, or controller protection is not authoritatively proven");
    return undefined;
  }
  private releaseRejectedClaim(request: ProviderCreateRequest, expected: AdoptionClaimDocument, rejection: ProviderOutcome): ProviderOutcome {
    try {
      request.execution.assertCurrent(); const current = this.readClaim();
      if (!this.sameClaim(current, expected) || current.state !== "active") return unknown(request, "Rejected adoption claim was superseded before release");
      atomicJson(this.claimPath(), { ...current, manifestRequired: false, state: "released", updatedAt: new Date().toISOString() }); request.execution.assertCurrent();
      return rejection;
    } catch { return unknown(request, "Rejected adoption claim could not be safely released"); }
  }
  private claimManifest(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig, observation: AdoptedMachineObservation,
    claim: AdoptionClaimDocument, home: string): LocalManifest {
    const computer = request.computer;
    const existing = readManifest(this.root, computer);
    if (existing !== undefined) {
      if (existing.adoption === undefined || existing.adoption.version !== 1 || existing.adoption.adoptionId !== claim.adoptionId
        || existing.adoption.hostId !== claim.hostId || existing.adoption.claimGeneration !== claim.claimGeneration
        || existing.adoption.claimFence !== claim.claimFence || existing.profileId !== claim.profileId
        || existing.profileGeneration !== claim.profileGeneration || existing.profileRevisionDigest !== claim.profileRevisionDigest
        || existing.resolvedProfileDigest !== claim.resolvedProfileDigest || existing.resourceId !== `machine:${claim.hostId}` || existing.instanceId !== claim.hostId) {
        throw new ComputersError("conflict", "Adopted-machine manifest claim identity changed", 409);
      }
      return existing;
    }
    const manifest: LocalManifest = { version: 1, tenantId: computer.tenantId, computerId: computer.id, ownerPrincipalId: computer.ownerPrincipalId, provider: this.kind,
      resourceId: `machine:${config.hostId}`, instanceId: config.hostId, bootId: observation.bootId, profileId: config.profileId,
      profileGeneration: claim.profileGeneration, profileRevisionDigest: claim.profileRevisionDigest, resolvedProfileDigest: claim.resolvedProfileDigest,
      adoption: { version: 1, adoptionId: claim.adoptionId, hostId: claim.hostId, claimGeneration: claim.claimGeneration, claimFence: claim.claimFence },
      home: { kind: "adopted_path", reference: home, retained: true }, lifecycle: observation.state === "unknown" ? "stopped" : observation.state,
      assurance: dedicatedAssurance(), attachmentGeneration: 1, updatedAt: new Date().toISOString() };
    try { this.writeManifestOwned(request, manifest, true); } catch (error) { if (!existsSync(manifestPath(this.root, computer))) throw error; return readManifest(this.root, computer) ?? manifest; }
    return manifest;
  }
  private claimPath(): string { return confined(this.root, "adopted-machine-claim.json"); }
  private readClaim(): AdoptionClaimDocument {
    const value = boundedJson<Record<string, unknown>>(this.claimPath());
    const keys = ["version", "adoptionId", "hostId", "tenantId", "computerId", "ownerPrincipalId", "profileId", "profileGeneration",
      "profileRevisionDigest", "resolvedProfileDigest", "claimGeneration", "claimFence", "manifestRequired", "state", "updatedAt"];
    if (Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.version !== 2
      || typeof value.adoptionId !== "string" || typeof value.hostId !== "string" || typeof value.tenantId !== "string"
      || typeof value.computerId !== "string" || typeof value.ownerPrincipalId !== "string"
      || typeof value.profileId !== "string" || !Number.isSafeInteger(value.profileGeneration) || Number(value.profileGeneration) < 1
      || typeof value.profileRevisionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.profileRevisionDigest)
      || typeof value.resolvedProfileDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.resolvedProfileDigest)
      || !Number.isSafeInteger(value.claimGeneration) || Number(value.claimGeneration) < 1
      || typeof value.claimFence !== "string" || !/^fence_[a-f0-9]{32}$/.test(value.claimFence)
      || typeof value.manifestRequired !== "boolean" || !["active", "releasing", "released"].includes(String(value.state)) || typeof value.updatedAt !== "string") {
      throw new ComputersError("storage_error", "Adopted-machine claim is invalid", 500);
    }
    return value as unknown as AdoptionClaimDocument;
  }
  private ensureClaim(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig, profile: AdoptionProfileIdentity): AdoptionClaimDocument {
    const computer = request.computer;
    const path = this.claimPath(); const now = new Date().toISOString();
    const next = (generation: number): AdoptionClaimDocument => ({ version: 2, adoptionId: config.adoptionId, hostId: config.hostId,
      tenantId: computer.tenantId, computerId: computer.id, ownerPrincipalId: computer.ownerPrincipalId, claimGeneration: generation,
      profileId: profile.profileId, profileGeneration: profile.profileGeneration, profileRevisionDigest: profile.profileRevisionDigest,
      resolvedProfileDigest: profile.resolvedProfileDigest, claimFence: `fence_${randomBytes(16).toString("hex")}`, manifestRequired: true, state: "active", updatedAt: now });
    if (!existsSync(path)) { const claim = next(1); request.execution.assertCurrent(); atomicJson(path, claim, true); request.execution.assertCurrent(); return claim; }
    const current = this.readClaim();
    if (current.state !== "released") {
      if (this.reusableClaimMismatch(request, config, profile, current, false) !== undefined) throw new ComputersError("storage_error", "Adopted-machine claim changed after validation", 500);
      return current;
    }
    if (this.reusableClaimMismatch(request, config, profile, current, true) !== undefined) throw new ComputersError("storage_error", "Released adopted-machine claim changed after validation", 500);
    const claim = next(current.claimGeneration + 1); request.execution.assertCurrent(); atomicJson(path, claim); request.execution.assertCurrent(); return claim;
  }
  private currentClaim(manifest: LocalManifest): AdoptionClaimDocument | undefined {
    if (manifest.adoption === undefined || !existsSync(this.claimPath())) return undefined;
    const claim = this.readClaim();
    const expected: AdoptionClaimDocument = { version: 2, adoptionId: manifest.adoption.adoptionId, hostId: manifest.adoption.hostId,
      tenantId: manifest.tenantId, computerId: manifest.computerId, ownerPrincipalId: manifest.ownerPrincipalId, profileId: manifest.profileId,
      profileGeneration: manifest.profileGeneration, profileRevisionDigest: manifest.profileRevisionDigest, resolvedProfileDigest: manifest.resolvedProfileDigest,
      claimGeneration: manifest.adoption.claimGeneration, claimFence: manifest.adoption.claimFence, manifestRequired: claim.manifestRequired,
      state: claim.state, updatedAt: claim.updatedAt };
    return this.sameClaim(claim, expected) ? claim : undefined;
  }
  private sameClaim(claim: AdoptionClaimDocument, expected: AdoptionClaimDocument): boolean {
    return claim.version === expected.version && claim.adoptionId === expected.adoptionId && claim.hostId === expected.hostId
      && claim.tenantId === expected.tenantId && claim.computerId === expected.computerId && claim.ownerPrincipalId === expected.ownerPrincipalId
      && claim.profileId === expected.profileId && claim.profileGeneration === expected.profileGeneration
      && claim.profileRevisionDigest === expected.profileRevisionDigest && claim.resolvedProfileDigest === expected.resolvedProfileDigest
      && claim.claimGeneration === expected.claimGeneration && claim.claimFence === expected.claimFence && claim.manifestRequired === expected.manifestRequired;
  }
  private requestAdoptionMatches(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig): boolean {
    const adoption = request.operation.request.adoption;
    return typeof adoption === "object" && adoption !== null && !Array.isArray(adoption)
      && Object.keys(adoption as Record<string, unknown>).join(",") === "adoptionId"
      && (adoption as Record<string, unknown>).adoptionId === config.adoptionId;
  }
  private validatedConfiguration(config: LocalMachineAdoptionConfig): ValidatedAdoptionConfiguration | ProviderOutcome {
    try { return validateAdoptionConfiguration(config); }
    catch { return fail("invalid_adoption_configuration", "Adopted-machine configuration is invalid"); }
  }
  private requestPreflight(request: ProviderCreateRequest, entryPoint: AdoptionProviderEntryPoint): ProviderOutcome | undefined {
    const config = this.config;
    if (config === undefined) return fail("provider_not_configured", "Adopted-machine provider is not configured");
    const validated = this.validatedConfiguration(config); if ("kind" in validated) return validated;
    const bindingMismatch = this.requestBindingMismatch(request, config, entryPoint); if (bindingMismatch !== undefined) return bindingMismatch;
    if (this.profileIdentity(request, config) === undefined) {
      return fail("profile_mismatch", "Adopted-machine profile binding does not match controller inventory");
    }
    return undefined;
  }
  private requestBindingMismatch(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig,
    entryPoint: AdoptionProviderEntryPoint): ProviderOutcome | undefined {
    try {
      validateId(request.computer.tenantId, "computer.tenantId"); validateId(request.computer.id, "computer.id");
      validateId(request.computer.ownerPrincipalId, "computer.ownerPrincipalId");
      validateId(request.operation.id, "operation.id"); validateId(request.operation.tenantId, "operation.tenantId");
      validateId(request.operation.computerId, "operation.computerId");
      validateId(request.attempt.id, "attempt.id"); validateId(request.attempt.tenantId, "attempt.tenantId");
      validateId(request.attempt.operationId, "attempt.operationId");
    } catch {
      return fail("adoption_mismatch", "Adopted-machine Computer identity is invalid");
    }
    const kind = request.operation.kind;
    // A caller-requested quarantine still requires operation.kind === "quarantine"; only the worker's
    // explicitly-flagged restrictive compensation (compensatingQuarantine) may quarantine a fenced
    // create/start/restore original. Quarantine is always the safe, more-restrictive transition, so
    // accepting this bounded kind set can never escalate capability.
    const restrictiveCompensation = entryPoint === "quarantine"
      && (request as { compensatingQuarantine?: boolean }).compensatingQuarantine === true;
    const supportedKinds = ["create", "start", "stop", "quarantine", "delete"] as const;
    const methodMatches = entryPoint === "reconcile"
      ? (supportedKinds as readonly string[]).includes(kind)
      : restrictiveCompensation
        ? (kind === "quarantine" || kind === "create" || kind === "start" || kind === "restore")
        : kind === entryPoint;
    if (request.computer.provider !== this.kind || request.computer.confinementClass !== "dedicated_machine"
      || !methodMatches
      || request.operation.tenantId !== request.computer.tenantId || request.operation.computerId !== request.computer.id
      || request.attempt.tenantId !== request.operation.tenantId || request.attempt.operationId !== request.operation.id
      || request.operation.request.provider !== undefined && request.operation.request.provider !== this.kind) {
      return fail("adoption_mismatch", "Adopted-machine Computer provider or confinement binding does not match");
    }
    // Policy-generation and fence values may legitimately lag the current Computer once a reclaimed
    // reconcile or its restrictive compensation runs after a policy revision or fence bump. The worker
    // owns fence semantics (it flags the outcome fenced and drives quarantine compensation), so these
    // observation/compensation paths only require the stale values be well-formed and not from the
    // future; identity and execution-owner generation stay strictly bound. Direct caller entry points
    // keep exact equality.
    const lenientFence = entryPoint === "reconcile" || restrictiveCompensation;
    if (!Number.isSafeInteger(request.computer.policyGeneration) || request.computer.policyGeneration < 1
      || !Number.isSafeInteger(request.operation.policyGeneration) || request.operation.policyGeneration < 1
      || (lenientFence ? request.operation.policyGeneration > request.computer.policyGeneration
        : request.operation.policyGeneration !== request.computer.policyGeneration)
      || !Number.isSafeInteger(request.operation.fence) || request.operation.fence < 0
      || !Number.isSafeInteger(request.attempt.fence) || request.attempt.fence < 0
      || (lenientFence ? request.attempt.fence > request.operation.fence
        : request.attempt.fence !== request.operation.fence)
      || !Number.isSafeInteger(request.attempt.executionOwnerGeneration) || request.attempt.executionOwnerGeneration < 1
      || !Number.isSafeInteger(request.execution.ownerGeneration) || request.execution.ownerGeneration < 1
      || request.execution.ownerGeneration !== request.attempt.executionOwnerGeneration) {
      return fail("adoption_mismatch", "Adopted-machine operation execution binding does not match");
    }
    if (request.operation.kind === "create" && !this.requestAdoptionMatches(request, config)) {
      return fail("adoption_mismatch", "Controller adoption inventory does not match the request");
    }
    if (request.computer.tenantId !== config.allowedTenantId || request.computer.ownerPrincipalId !== config.allowedOwnerPrincipalId) {
      return fail("adoption_mismatch", "Controller adoption inventory tenant or owner does not match");
    }
    return undefined;
  }
  private profileIdentity(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig): AdoptionProfileIdentity | undefined {
    const profile = request.operation.request.profile;
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return undefined;
    const bound = profile as Record<string, unknown>; const digest = digestDocument(BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT);
    if (Object.keys(bound).sort().join(",") !== "digest,document,generation,id" || bound.id !== config.profileId
      || bound.id !== request.operation.request.profileId || bound.generation !== 1 || bound.digest !== digest
      || typeof bound.id !== "string" || typeof bound.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(bound.digest)
      || canonicalJson(bound.document) !== canonicalJson(BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT)) return undefined;
    return { profileId: config.profileId, profileGeneration: 1, profileRevisionDigest: digest, resolvedProfileDigest: digest };
  }
  private reusableClaimMismatch(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig, profile: AdoptionProfileIdentity,
    claim: AdoptionClaimDocument, allowNewComputer: boolean): ProviderOutcome | undefined {
    if (claim.adoptionId !== config.adoptionId || claim.hostId !== config.hostId || claim.tenantId !== request.computer.tenantId
      || claim.ownerPrincipalId !== request.computer.ownerPrincipalId) {
      return fail("adoption_mismatch", "Durable adopted-machine identity does not match controller inventory");
    }
    if (claim.profileId !== profile.profileId || claim.profileGeneration !== profile.profileGeneration
      || claim.profileRevisionDigest !== profile.profileRevisionDigest || claim.resolvedProfileDigest !== profile.resolvedProfileDigest) {
      return fail("profile_mismatch", "Durable adopted-machine profile identity does not match controller inventory");
    }
    if (!allowNewComputer && claim.computerId !== request.computer.id) {
      return unknown(request, "This physical host is already claimed by another Computer");
    }
    return undefined;
  }
  private releasedClaimManifestMismatch(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig, profile: AdoptionProfileIdentity,
    claim: AdoptionClaimDocument): ProviderOutcome | undefined {
    const claimedComputer: Computer = { ...request.computer, tenantId: claim.tenantId, id: claim.computerId, ownerPrincipalId: claim.ownerPrincipalId,
      provider: "local_machine", confinementClass: "dedicated_machine" };
    const path = manifestPath(this.root, claimedComputer);
    if (!claim.manifestRequired) {
      return existsSync(path) ? unknown(request, "Rejected adopted-machine claim unexpectedly has a durable manifest") : undefined;
    }
    const manifest = readManifest(this.root, claimedComputer);
    if (manifest === undefined) return unknown(request, "Released adopted-machine claim requires its exact durable manifest before re-adoption");
    const linked = this.currentClaim(manifest);
    if (linked === undefined || manifest.lifecycle !== "deleted" || manifest.adoption?.adoptionId !== config.adoptionId
      || manifest.adoption.hostId !== config.hostId || manifest.profileId !== profile.profileId
      || manifest.profileGeneration !== profile.profileGeneration || manifest.profileRevisionDigest !== profile.profileRevisionDigest
      || manifest.resolvedProfileDigest !== profile.resolvedProfileDigest) {
      return unknown(request, "Released adopted-machine claim and manifest identity do not permit re-adoption", manifest);
    }
    return undefined;
  }
  private establishedIdentityMismatch(request: ProviderCreateRequest, config: LocalMachineAdoptionConfig, profile: AdoptionProfileIdentity,
    manifest: LocalManifest, claim: AdoptionClaimDocument | undefined): ProviderOutcome | undefined {
    if (manifest.adoption === undefined || manifest.adoption.version !== 1
      || manifest.adoption.adoptionId !== config.adoptionId || manifest.adoption.hostId !== config.hostId
      || manifest.tenantId !== request.computer.tenantId || manifest.computerId !== request.computer.id
      || manifest.ownerPrincipalId !== request.computer.ownerPrincipalId || manifest.resourceId !== `machine:${config.hostId}` || manifest.instanceId !== config.hostId) {
      return fail("adoption_mismatch", "Durable adopted-machine identity does not match controller inventory", resource(manifest));
    }
    if (manifest.profileId !== profile.profileId || manifest.profileGeneration !== profile.profileGeneration
      || manifest.profileRevisionDigest !== profile.profileRevisionDigest || manifest.resolvedProfileDigest !== profile.resolvedProfileDigest) {
      return fail("profile_mismatch", "Durable adopted-machine profile identity does not match controller inventory", resource(manifest));
    }
    if (claim === undefined) return unknown(request, "Adopted-machine claim was superseded", manifest);
    const reusable = this.reusableClaimMismatch(request, config, profile, claim, false);
    if (reusable !== undefined) return reusable.kind === "definite_failure" ? { ...reusable, resource: resource(manifest) } : reusable;
    if (manifest.adoption.claimGeneration !== claim.claimGeneration || manifest.adoption.claimFence !== claim.claimFence) {
      return unknown(request, "Adopted-machine claim was superseded", manifest);
    }
    return undefined;
  }
}

export class LimaVmProvider extends LocalProviderBase {
  readonly kind = "local_vm" as const; private readonly config: LocalVmConfig | undefined; private readonly platform: NodeJS.Platform; private readonly arch: string;
  constructor(options: LocalProviderOptions) {
    super(options); this.config = options.vm; this.platform = options.platform ?? process.platform; this.arch = options.arch ?? process.arch;
  }
  async readiness(): Promise<ProviderReadiness> {
    const configured = this.config !== undefined; const supported = this.platform === "darwin" && this.arch === "arm64";
    let runtimeSupported = false; if (configured && supported) try { this.validateConfig(this.config as LocalVmConfig); runtimeSupported = await this.runtimeSupported(); } catch { /* fail closed */ }
    return { provider: this.kind, configured, ready: configured && supported && runtimeSupported, confinementClass: "unverified_vm",
      controls: { nativeVzRequired: true, authoritativeInstanceConfigRequired: true, firstBootProofPending: true, externalEgressEnforced: false,
        strictGuestManagerAvailable: false, durableHomeUsable: false, perComputerLimaHome: true },
      limitations: supported
        ? ["Local VMs remain unverified_vm: stock Lima plus guest firewall helpers do not prove host-enforced egress or resident-independent isolation.",
          "The raw durable-home disk is retained but is not usable until a package-owned strict-guest manager proves filesystem UUID, mount, enrollment, and authorization.",
          "loadDotSSHPubKeys controls user public-key loading only; mandatory controller SSH uses the private per-Computer Lima identity and is never delegated."]
        : ["Local VM creation requires Apple Silicon macOS; no strict or live-Mac assurance was inferred on this host."] };
  }
  async create(request: ProviderCreateRequest): Promise<ProviderOutcome> {
    return this.withResourceGuard(request, this.lockKey(request.computer), () => this.createOwned(request));
  }
  private async createOwned(request: ProviderCreateRequest, prepared?: { configPath: string; inspection: ResolvedLimaInspection }): Promise<ProviderOutcome> {
    const unavailable = this.unavailable(); if (unavailable !== undefined) return unavailable; const config = this.config as LocalVmConfig; const inspector = this.inspectorFor(request.computer);
    if (!await this.exactRuntimeVersionSupported()) return fail("unsupported_lima_version", "Local VM mutations require exact Lima 2.1.1");
    const name = instanceName(request.computer); const disk = diskName(request.computer);
    const profileBinding = this.currentProfileBinding(request, disk);
    const configPath = prepared?.configPath ?? this.prepareConfig(request.computer, disk);
    let inspection: ResolvedLimaInspection;
    if (profileBinding === undefined) {
      try {
        inspection = prepared?.inspection ?? await inspector.inspect(name, configPath);
        const diskRecord = await inspector.inspectDisk(disk, inspection.exists ? name : undefined);
        if (inspection.exists || diskRecord !== undefined) {
          let manifest: LocalManifest | undefined; try { manifest = readManifest(this.root, request.computer); } catch { /* retain unknown ownership */ }
          return unknown(request, "Local VM profile binding has drifted while an external resource may still exist", manifest);
        }
      } catch { return unknown(request, "Local VM profile binding and external resource state are indeterminate"); }
      return fail("profile_mismatch", "Local VM profile digest does not match controller configuration after authoritative absence");
    }
    const resolvedDigest = profileBinding.resolvedDigest;
    inspection = prepared?.inspection ?? await inspector.inspect(name, configPath);
    if (inspection.exists) {
      const existing = readManifest(this.root, request.computer);
      if (existing !== undefined && !this.manifestMatchesCurrentProfile(request, existing)) {
        return unknown(request, "Local VM profile binding has drifted while an external resource still exists", existing);
      }
      if (existing === undefined) {
        let phase: VmCreatePhaseDocument | undefined; try { phase = this.createPhase(request, name, disk, profileBinding); } catch { return unknown(request, "Local VM create ownership marker is indeterminate"); }
        if (phase === undefined) return unknown(request, "Existing deterministic Lima VM lacks a matching controller ownership marker");
      }
      return this.adoptInspectedCreate(request, inspection, name, disk, profileBinding);
    }
    let createPhase: VmCreatePhaseDocument | undefined;
    try { createPhase = this.createPhase(request, name, disk, profileBinding); }
    catch { return unknown(request, "Local VM create-phase ownership is indeterminate"); }
    let diskRecord: ResolvedLimaDisk | undefined; try { diskRecord = await inspector.inspectDisk(disk, inspection.exists ? name : undefined); } catch { return unknown(request, "Lima disk state is indeterminate"); }
    const diskPresent = diskRecord !== undefined;
    if (diskRecord !== undefined && !this.validDisk(diskRecord, disk, request.computer, inspection.exists ? name : undefined)) return unknown(request, "Existing Lima disk does not match the tenant profile");
    if (diskPresent && createPhase === undefined) return unknown(request, "A deterministic Lima disk exists without a durable controller ownership marker");
    if (!diskPresent && createPhase?.phase === "vm_attempted") {
      this.clearCreatePhase(request); return fail("lima_create_failed", "Lima VM and journal-owned disk are authoritatively absent after the recorded create attempt");
    }
    if (!diskPresent) {
      if (createPhase === undefined) {
        createPhase = { version: 1, tenantId: request.computer.tenantId, computerId: request.computer.id, operationId: request.operation.id,
          providerIdempotencyKey: request.attempt.providerIdempotencyKey, instanceId: name, diskName: disk, profileId: config.profile.id,
          profileGeneration: profileBinding.generation, profileRevisionDigest: profileBinding.revisionDigest, resolvedProfileDigest: profileBinding.resolvedDigest,
          diskAbsentBeforeCreate: true, phase: "disk_pending", updatedAt: new Date().toISOString() };
        this.writeCreatePhase(request, createPhase, true);
      }
      const createdDisk = await this.runFor(request, [config.limactlPath, "disk", "create", "--size", `${config.profile.homeDiskGiB}GiB`, disk],
        120_000);
      let observedDisk: ResolvedLimaDisk | undefined;
      try { observedDisk = await inspector.inspectDisk(disk); } catch { return unknown(request, "Lima disk creation and observation are indeterminate"); }
      if (observedDisk === undefined) {
        if (!this.success(createdDisk)) { this.clearCreatePhase(request); return fail("lima_disk_create_failed", "Lima disk creation failed and authoritative observation proves no disk exists"); }
        return unknown(request, "Lima disk creation was not authoritatively confirmed");
      }
      if (!this.validDisk(observedDisk, disk, request.computer)) return unknown(request, "Created Lima disk does not match the tenant profile");
    }
    createPhase = this.createPhase(request, name, disk, profileBinding);
    if (createPhase === undefined) return unknown(request, "Lima disk ownership marker disappeared before VM creation");
    if (createPhase.phase === "vm_attempted") return this.cleanupOwnedCreateDisk(request, disk, profileBinding);
    createPhase = { ...createPhase, phase: "disk_owned", updatedAt: new Date().toISOString() }; this.writeCreatePhase(request, createPhase);
    createPhase = { ...createPhase, phase: "vm_attempted", updatedAt: new Date().toISOString() }; this.writeCreatePhase(request, createPhase);
    const created = await this.runFor(request, [config.limactlPath, "create", "--yes", "--name", name, "--plain", "--mount-none", "--vm-type", "vz", "--arch", "aarch64", configPath], MAX_COMMAND_TIMEOUT_MS);
    if (!this.success(created)) {
      let partial: ResolvedLimaInspection;
      try { partial = await inspector.inspect(name, configPath); } catch { return unknown(request, "Lima create and post-failure inspection are indeterminate", this.synthetic(request.computer, name, disk, profileBinding)); }
      if (partial.exists) {
        try { validateLimaInspection(partial, disk, resolvedDigest); } catch { return this.cleanupUnsafeCreate(request, name, disk, !diskPresent, profileBinding); }
        if (partial.status === "Stopped") return this.adoptInspectedCreate(request, partial, name, disk, profileBinding);
        return unknown(request, "Lima create left a partial VM in an unexpected state", this.synthetic(request.computer, name, disk, profileBinding));
      }
      return this.cleanupOwnedCreateDisk(request, disk, profileBinding);
    }
    inspection = await inspector.inspect(name, configPath);
    try { validateLimaInspection(inspection, disk, resolvedDigest); } catch { return this.cleanupUnsafeCreate(request, name, disk, !diskPresent, profileBinding); }
    if (inspection.status !== "Stopped") return this.cleanupUnsafeCreate(request, name, disk, !diskPresent, profileBinding);
    let retained: ResolvedLimaDisk | undefined; try { retained = await inspector.inspectDisk(disk, name); } catch { return unknown(request, "Lima retained disk inspection is indeterminate"); }
    if (retained === undefined || !this.validDisk(retained, disk, request.computer, name)) return unknown(request, "Lima retained disk is absent or does not match the tenant profile");
    const manifest = this.synthetic(request.computer, name, disk, profileBinding); this.writeManifestOwned(request, manifest);
    this.clearCreatePhase(request);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { backend: "lima_vz" }) };
  }
  async start(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.withResourceGuard(request, this.lockKey(request.computer), () => this.startOwned(request));
  }
  private async startOwned(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const unavailable = this.unavailable(); if (unavailable !== undefined) return unavailable; const config = this.config as LocalVmConfig;
    if (!await this.exactRuntimeVersionSupported()) return fail("unsupported_lima_version", "Local VM mutations require exact Lima 2.1.1");
    const manifest = await this.requireOrRecover(request); if (!("version" in manifest)) return manifest;
    if (!this.manifestMatchesCurrentProfile(request, manifest)) return fail("profile_mismatch", "Local VM profile binding has drifted", resource(manifest));
    const staticFailure = await this.staticProof(manifest); if (staticFailure !== undefined) return staticFailure;
    const started = await this.runFor(request, [config.limactlPath, "start", "--yes", manifest.instanceId], MAX_COMMAND_TIMEOUT_MS);
    if (!this.success(started)) return this.stopAfterFailedProof(request, manifest, "Lima start did not complete successfully");
    const boot = await this.executeFor(request, manifest.instanceId, ["/usr/bin/cat", "/proc/sys/kernel/random/boot_id"], 30_000, 4096);
    if (!this.success(boot) || !/^[a-f0-9-]{16,64}\n?$/.test(boot.stdout)) return this.stopAfterFailedProof(request, manifest, "VM boot identity could not be verified");
    try {
      const inspector = this.inspectorFor(request.computer); const inspected = await inspector.inspect(manifest.instanceId, this.configPath(request.computer));
      validateLimaInspection(inspected, manifest.home.reference, manifest.resolvedProfileDigest);
      const disk = await inspector.inspectDisk(manifest.home.reference, manifest.instanceId);
      if (inspected.status !== "Running" || disk === undefined || !this.validDisk(disk, manifest.home.reference, request.computer, manifest.instanceId)) throw new Error("unsafe running state");
    } catch { return this.stopAfterFailedProof(request, manifest, "VM running profile or retained disk could not be verified"); }
    const bootId = boot.stdout.trim();
    manifest.bootId = bootId; manifest.lifecycle = "running"; manifest.assurance = unverifiedAssurance(); manifest.attachmentGeneration += 1; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { residentBindingVerified: false }) };
  }
  async stop(request: ProviderOperationRequest): Promise<ProviderOutcome> { return this.withResourceGuard(request, this.lockKey(request.computer), () => this.stopLike(request, "stopped")); }
  async quarantine(request: ProviderOperationRequest): Promise<ProviderOutcome> { return this.withResourceGuard(request, this.lockKey(request.computer), () => this.stopLike(request, "quarantined", true)); }
  async delete(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.withResourceGuard(request, this.lockKey(request.computer), () => this.deleteOwned(request));
  }
  private async deleteOwned(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const unavailable = this.unavailable(); if (unavailable !== undefined) return unavailable; const config = this.config as LocalVmConfig;
    if (!await this.exactRuntimeVersionSupported()) return fail("unsupported_lima_version", "Local VM mutations require exact Lima 2.1.1");
    const manifest = readManifest(this.root, request.computer);
    if (manifest === undefined) return unknown(request, "Local VM deletion requires a durable controller ownership manifest");
    if (!this.manifestMatchesCurrentProfile(request, manifest)) return fail("profile_mismatch", "Local VM profile binding has drifted", resource(manifest));
    const inspector = this.inspectorFor(request.computer);
    let inspection: ResolvedLimaInspection; try { inspection = await inspector.inspect(manifest.instanceId, this.configPath(request.computer)); }
    catch { return unknown(request, "Lima delete preflight inspection is indeterminate", manifest); }
    if (inspection.exists) {
      const deleted = await this.runFor(request, [config.limactlPath, "delete", "--force", manifest.instanceId], 5 * 60_000);
      if (!this.success(deleted)) {
        try { if ((await inspector.inspect(manifest.instanceId, this.configPath(request.computer))).exists) return unknown(request, "Lima delete outcome is indeterminate", manifest); }
        catch { return unknown(request, "Lima delete and post-observation are indeterminate", manifest); }
      }
    }
    try { if ((await inspector.inspect(manifest.instanceId, this.configPath(request.computer))).exists) return unknown(request, "Lima VM deletion was not authoritatively confirmed", manifest); }
    catch { return unknown(request, "Lima VM deletion inspection is indeterminate", manifest); }
    let retainedDisk: ResolvedLimaDisk | undefined; try { retainedDisk = await inspector.inspectDisk(manifest.home.reference); }
    catch { return unknown(request, "Lima retained-home inspection is indeterminate", manifest); }
    const retained = retainedDisk !== undefined && this.validDisk(retainedDisk, manifest.home.reference, request.computer);
    if (retainedDisk !== undefined && !retained) return unknown(request, "Lima retained-home properties are indeterminate", manifest);
    manifest.lifecycle = "deleted"; manifest.home.retained = retained; manifest.attachmentGeneration += 1; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { retainHome: retained, instanceAbsent: true, retainedHomeConfirmed: retained }) };
  }
  async reconcile(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.withResourceGuard(request, this.lockKey(request.computer), () => this.reconcileOwned(request), true);
  }
  private async reconcileOwned(request: ProviderOperationRequest): Promise<ProviderOutcome> {
    const unavailable = this.unavailable(); if (unavailable !== undefined) return unavailable; const name = instanceName(request.computer); const disk = diskName(request.computer); const configPath = this.prepareConfig(request.computer, disk);
    if (!await this.exactRuntimeVersionSupported()) return fail("unsupported_lima_version", "Local VM mutations require exact Lima 2.1.1");
    const inspector = this.inspectorFor(request.computer);
    const currentBinding = this.currentProfileBinding(request, disk);
    if (currentBinding === undefined) return request.operation.kind === "create"
      ? unknown(request, "Local VM profile binding has drifted while an external resource may still exist")
      : fail("profile_mismatch", "Local VM profile binding has drifted");
    let inspection: ResolvedLimaInspection; let diskRecord: ResolvedLimaDisk | undefined;
    try { inspection = await inspector.inspect(name, configPath); diskRecord = await inspector.inspectDisk(disk, inspection.exists ? name : undefined); }
    catch { return unknown(request, "Lima resource inspection is indeterminate", readManifest(this.root, request.computer)); }
    const diskPresent = diskRecord !== undefined;
    if (diskRecord !== undefined && !this.validDisk(diskRecord, disk, request.computer, inspection.exists ? name : undefined)) return unknown(request, "Lima durable disk does not match the tenant profile", readManifest(this.root, request.computer));
    const persistedPhase = request.operation.kind === "create" ? readVmCreatePhase(this.root, request.computer) : undefined;
    if (persistedPhase !== undefined) {
      const phaseBinding = { generation: persistedPhase.profileGeneration, revisionDigest: persistedPhase.profileRevisionDigest,
        resolvedDigest: persistedPhase.resolvedProfileDigest };
      let exactPhase: VmCreatePhaseDocument | undefined;
      try { exactPhase = this.createPhase(request, name, disk, phaseBinding); }
      catch { return unknown(request, "Local VM create-phase ownership is indeterminate", readManifest(this.root, request.computer)); }
      if (exactPhase !== undefined && (phaseBinding.generation !== currentBinding.generation
        || phaseBinding.revisionDigest !== currentBinding.revisionDigest || phaseBinding.resolvedDigest !== currentBinding.resolvedDigest)) {
        return inspection.exists
          ? this.cleanupUnsafeCreate(request, name, disk, true, phaseBinding, currentBinding)
          : this.cleanupOwnedCreateDisk(request, disk, phaseBinding, currentBinding);
      }
    }
    if (!inspection.exists) {
      if (request.operation.kind === "create" && readVmCreatePhase(this.root, request.computer) !== undefined) {
        if (diskPresent) return this.cleanupOwnedCreateDisk(request, disk, currentBinding);
        const tombstone = this.synthetic(request.computer, name, disk, currentBinding);
        tombstone.lifecycle = "deleted"; tombstone.home.retained = false; tombstone.attachmentGeneration += 1; tombstone.updatedAt = new Date().toISOString();
        this.writeManifestOwned(request, tombstone); this.clearCreatePhase(request);
        return fail("lima_create_failed", "Lima reconciliation proved that neither VM nor its journal-owned disk exists", resource(tombstone));
      }
      if (request.operation.kind === "delete") {
        const manifest = readManifest(this.root, request.computer);
        if (manifest === undefined) return unknown(request, "Local VM deletion reconciliation requires a durable controller ownership manifest");
        if (!this.manifestMatchesCurrentProfile(request, manifest)) return fail("profile_mismatch", "Local VM profile binding has drifted", resource(manifest));
        manifest.lifecycle = "deleted"; manifest.home.retained = diskPresent; manifest.attachmentGeneration += 1;
        manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
        return { kind: "success", resource: resource(manifest), result: result(manifest, {
          reconciled: true, retainHome: diskPresent, instanceAbsent: true, retainedHomeConfirmed: diskPresent,
        }) };
      }
      if (request.operation.kind === "create" && diskPresent) return unknown(request, "A durable Lima disk exists but VM creation outcome requires restrictive reconciliation");
      return diskPresent ? unknown(request, "A durable Lima disk exists but VM outcome is unresolved") : fail("resource_absent", "Lima confirms both VM and durable disk are absent");
    }
    let manifest: LocalManifest;
    try {
      const existing = readManifest(this.root, request.computer);
      if (existing !== undefined && !this.manifestMatchesCurrentProfile(request, existing)) return request.operation.kind === "create"
        ? unknown(request, "Local VM profile binding has drifted while an external resource may still exist", existing)
        : fail("profile_mismatch", "Local VM profile binding has drifted", resource(existing));
      if (existing === undefined) {
        const phase = this.createPhase(request, name, disk, currentBinding);
        if (phase === undefined) return unknown(request, "Existing deterministic Lima VM lacks a matching controller ownership marker");
      }
      const expectedDigest = currentBinding.resolvedDigest;
      validateLimaInspection(inspection, disk, expectedDigest); manifest = existing ?? this.synthetic(request.computer, name, disk, currentBinding);
    } catch {
      if (request.operation.kind === "create") {
        return this.cleanupUnsafeCreate(request, name, disk, false, currentBinding);
      }
      return unknown(request, "Existing Lima VM failed resolved safe-configuration diagnostics", readManifest(this.root, request.computer));
    }
    if (!diskPresent) return unknown(request, "Lima durable disk is absent", manifest);
    this.writeManifestOwned(request, manifest);
    if (request.operation.kind === "create" && inspection.status === "Stopped") {
      this.clearCreatePhase(request);
      return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true }) };
    }
    if (request.operation.kind === "stop" || request.operation.kind === "quarantine") {
      if (inspection.status === "Running") return this.stopLike(request, request.operation.kind === "quarantine" ? "quarantined" : "stopped", request.operation.kind === "quarantine", "running");
      if (inspection.status === "Stopped") {
        // Report the authoritative observed lifecycle rather than merely the requested operation: a
        // stopped VM the manifest already records as quarantined must not be downgraded to "stopped"
        // by a stop reconcile. Never weaken below the requested intent or the durable prior lifecycle.
        const desired = request.operation.kind === "quarantine" ? "quarantined" : "stopped";
        manifest.lifecycle = desired === "quarantined" || manifest.lifecycle === "quarantined" ? "quarantined" : "stopped";
        this.writeManifestOwned(request, manifest);
        return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true }) };
      }
      return unknown(request, "Lima restrictive reconciliation requires an authoritatively running or stopped instance", manifest);
    }
    if (request.operation.kind === "delete") return this.deleteOwned(request);
    if (request.operation.kind === "start" && inspection.status === "Running") return this.observeRunningReconcile(request, manifest);
    return unknown(request, "Lima resource state differs from the requested lifecycle", manifest);
  }
  private lockKey(computer: Pick<Computer, "tenantId" | "id">): string { return `lima:${computer.tenantId}:${computer.id}`; }
  private unavailable(): ProviderOutcome | undefined {
    if (this.config === undefined) return fail("provider_not_configured", "Local VM provider is not configured");
    if (this.platform !== "darwin" || this.arch !== "arm64") return fail("unsupported_host", "Local VM requires Apple Silicon macOS");
    try { this.validateConfig(this.config); } catch { return fail("invalid_vm_configuration", "Local VM configuration is invalid"); }
    return undefined;
  }
  private validateConfig(config: LocalVmConfig): void {
    validatePath(config.limactlPath, "limactlPath"); const limaHome = secureRoot(config.limaHome); const suffix = relative(this.root, limaHome);
    if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new ComputersError("invalid_request", "LIMA_HOME must be within controller state", 500);
    renderLimaConfig(config.profile, "home_000000000000000000000000");
  }
  private async runtimeSupported(): Promise<boolean> {
    const config = this.config as LocalVmConfig;
    if (!await this.exactRuntimeVersionSupported()) return false;
    const drivers = await this.runner.run({ argv: [config.limactlPath, "create", "--list-drivers"],
      env: { LIMA_HOME: config.limaHome, PATH: LIMA_SYSTEM_PATH }, timeoutMs: 30_000, maxOutputBytes: 16 * 1024 });
    this.assertExecutablePinned();
    if (!this.success(drivers) || !drivers.stdout.split(/\r?\n/).includes("vz")) return false;
    const virtualization = await this.runner.run({ argv: ["/usr/sbin/sysctl", "-n", "kern.hv_support"], env: {}, timeoutMs: 30_000, maxOutputBytes: 4096 });
    return this.success(virtualization) && virtualization.stdout.trim() === "1";
  }
  private async exactRuntimeVersionSupported(): Promise<boolean> {
    const config = this.config as LocalVmConfig;
    this.assertExecutablePinned();
    const version = await this.runner.run({ argv: [config.limactlPath, "--version"],
      env: { LIMA_HOME: config.limaHome, PATH: LIMA_SYSTEM_PATH }, timeoutMs: 30_000, maxOutputBytes: 4096 });
    this.assertExecutablePinned();
    if (!this.success(version)) return false;
    const match = /^limactl version (\d+)\.(\d+)\.(\d+)\s*$/.exec(version.stdout);
    if (match === null) return false;
    const major = Number(match[1]); const minor = Number(match[2]); const patch = Number(match[3]);
    return major === 2 && minor === 1 && patch === 1;
  }
  private limaHomeFor(computer: Pick<Computer, "tenantId" | "id">): string {
    validateId(computer.tenantId, "tenantId"); validateId(computer.id, "computerId");
    return secureRoot(confined(secureRoot((this.config as LocalVmConfig).limaHome), computer.tenantId, computer.id));
  }
  private inspectorFor(computer: Pick<Computer, "tenantId" | "id">): LimaInspector {
    const config = this.config as LocalVmConfig;
    return config.inspector ?? new LimactlInspector(config.limactlPath, this.limaHomeFor(computer), this.runner, vmExecutablePins.get(config));
  }
  private prepareConfig(computer: Computer, disk: string): string {
    validatePerComputerLimaGlobals(this.limaHomeFor(computer));
    const path = this.configPath(computer); secureRoot(dirname(path)); const yaml = renderLimaConfig((this.config as LocalVmConfig).profile, disk);
    if (existsSync(path)) { const stat = statSync(path); if (stat.size > MAX_STATE_BYTES || readFileSync(path, "utf8") !== yaml) throw new ComputersError("storage_error", "Controller Lima request configuration changed", 500); }
    else atomicPrivateFile(path, yaml, true); return path;
  }
  private configPath(computer: Computer): string { return confined(this.root, "computers", computer.tenantId, computer.id, "lima.yaml"); }
  private synthetic(computer: Computer, name: string, disk: string, binding?: { generation: number; revisionDigest: string; resolvedDigest: string }): LocalManifest {
    const profileBinding = binding ?? { generation: 1, revisionDigest: digestDocument(configuredProfileDocument((this.config as LocalVmConfig).profile)),
      resolvedDigest: digestDocument(resolvedProfileDocument((this.config as LocalVmConfig).profile, disk)) };
    return { version: 1, tenantId: computer.tenantId, computerId: computer.id, ownerPrincipalId: computer.ownerPrincipalId, provider: this.kind,
      resourceId: `lima:${name}`, instanceId: name, profileId: (this.config as LocalVmConfig).profile.id, home: { kind: "lima_disk", reference: disk, retained: true },
      profileGeneration: profileBinding.generation, profileRevisionDigest: profileBinding.revisionDigest, resolvedProfileDigest: profileBinding.resolvedDigest,
      lifecycle: "stopped", assurance: unverifiedAssurance(), attachmentGeneration: 1, updatedAt: new Date().toISOString() };
  }
  private currentProfileBinding(request: ProviderCreateRequest, disk: string): { generation: number; revisionDigest: string; resolvedDigest: string } | undefined {
    const config = this.config as LocalVmConfig; const binding = request.operation.request.profile;
    if (typeof binding !== "object" || binding === null || Array.isArray(binding)) return undefined;
    const bound = binding as Record<string, unknown>; const document = configuredProfileDocument(config.profile);
    const revisionDigest = digestDocument(document); const resolvedDigest = digestDocument(resolvedProfileDocument(config.profile, disk));
    if (Object.keys(bound).sort().join(",") !== "digest,document,generation,id" || bound.id !== config.profile.id
      || bound.id !== request.operation.request.profileId || !Number.isSafeInteger(bound.generation) || Number(bound.generation) < 1
      || bound.digest !== revisionDigest || canonicalJson(bound.document) !== canonicalJson(document)) return undefined;
    return { generation: Number(bound.generation), revisionDigest, resolvedDigest };
  }
  private manifestMatchesCurrentProfile(request: ProviderCreateRequest, manifest: LocalManifest): boolean {
    const binding = this.currentProfileBinding(request, manifest.home.reference);
    return binding !== undefined && manifest.profileId === (this.config as LocalVmConfig).profile.id && manifest.profileGeneration === binding.generation
      && manifest.profileRevisionDigest === binding.revisionDigest && manifest.resolvedProfileDigest === binding.resolvedDigest;
  }
  private createPhase(request: ProviderCreateRequest, name: string, disk: string,
    binding: { generation: number; revisionDigest: string; resolvedDigest: string }): VmCreatePhaseDocument | undefined {
    const phase = readVmCreatePhase(this.root, request.computer); if (phase === undefined) return undefined;
    if (phase.operationId !== request.operation.id || phase.providerIdempotencyKey !== request.attempt.providerIdempotencyKey
      || phase.instanceId !== name || phase.diskName !== disk || phase.profileId !== (this.config as LocalVmConfig).profile.id
      || phase.profileGeneration !== binding.generation || phase.profileRevisionDigest !== binding.revisionDigest || phase.resolvedProfileDigest !== binding.resolvedDigest) {
      throw new ComputersError("storage_error", "Local VM create-phase journal identity mismatch", 500);
    }
    return phase;
  }
  private writeCreatePhase(request: ProviderCreateRequest, value: VmCreatePhaseDocument, exclusive = false): void {
    request.execution.assertCurrent(); atomicJson(vmCreatePhasePath(this.root, request.computer), value, exclusive); request.execution.assertCurrent();
  }
  private clearCreatePhase(request: ProviderCreateRequest): void {
    const path = vmCreatePhasePath(this.root, request.computer); if (!existsSync(path)) return;
    const phase = readVmCreatePhase(this.root, request.computer);
    if (phase === undefined || phase.operationId !== request.operation.id || phase.providerIdempotencyKey !== request.attempt.providerIdempotencyKey) {
      throw new ComputersError("storage_error", "Local VM create-phase journal changed before removal", 500);
    }
    request.execution.assertCurrent(); durableUnlink(path); request.execution.assertCurrent();
  }
  private async cleanupOwnedCreateDisk(request: ProviderCreateRequest, disk: string,
    binding: { generation: number; revisionDigest: string; resolvedDigest: string },
    terminalBinding = binding): Promise<ProviderOutcome> {
    const phase = this.createPhase(request, instanceName(request.computer), disk, binding);
    if (phase === undefined) return unknown(request, "Lima durable disk is not journaled as controller-owned");
    const removed = await this.runFor(request, [(this.config as LocalVmConfig).limactlPath, "disk", "delete", "--force", disk], 5 * 60_000);
    try {
      if (await this.inspectorFor(request.computer).inspectDisk(disk) !== undefined) return unknown(request, "Owned Lima disk cleanup was not authoritatively confirmed");
    } catch { return unknown(request, "Owned Lima disk cleanup inspection is indeterminate"); }
    const tombstone = this.synthetic(request.computer, instanceName(request.computer), disk, terminalBinding);
    tombstone.lifecycle = "deleted"; tombstone.home.retained = false; tombstone.attachmentGeneration += 1; tombstone.updatedAt = new Date().toISOString();
    this.writeManifestOwned(request, tombstone);
    this.clearCreatePhase(request);
    return fail("lima_create_failed", this.success(removed)
      ? "Lima VM creation failed and its journal-owned disk was cleaned"
      : "Lima disk cleanup exited nonzero but authoritative observation proves the owned disk is absent");
  }
  private async adoptInspectedCreate(request: ProviderCreateRequest, inspection: ResolvedLimaInspection, name: string, disk: string,
    binding: { generation: number; revisionDigest: string; resolvedDigest: string }): Promise<ProviderOutcome> {
    try { validateLimaInspection(inspection, disk, binding.resolvedDigest); }
    catch { return this.cleanupUnsafeCreate(request, name, disk, false, binding); }
    if (inspection.status !== "Stopped") return unknown(request, "Existing deterministic Lima VM is not stopped");
    let retained: ResolvedLimaDisk | undefined;
    try { retained = await this.inspectorFor(request.computer).inspectDisk(disk, name); } catch { return unknown(request, "Existing Lima disk inspection is indeterminate"); }
    if (retained === undefined || !this.validDisk(retained, disk, request.computer, name)) return unknown(request, "Existing Lima disk is absent or does not match the tenant profile");
    const manifest = readManifest(this.root, request.computer) ?? this.synthetic(request.computer, name, disk, binding); this.writeManifestOwned(request, manifest);
    this.clearCreatePhase(request);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true }) };
  }
  private async cleanupUnsafeCreate(request: ProviderCreateRequest, name: string, disk: string, removeDisk: boolean,
    binding: { generation: number; revisionDigest: string; resolvedDigest: string },
    terminalBinding = binding): Promise<ProviderOutcome> {
    const manifest = this.synthetic(request.computer, name, disk, binding); const config = this.config as LocalVmConfig; const inspector = this.inspectorFor(request.computer);
    let ownedPhase: VmCreatePhaseDocument | undefined;
    try { ownedPhase = this.createPhase(request, name, disk, binding); }
    catch { return unknown(request, "Unsafe Lima cleanup ownership marker is indeterminate", manifest); }
    if (ownedPhase === undefined) return unknown(request, "Unsafe Lima cleanup requires an exact durable ownership marker", manifest);
    const shouldRemoveDisk = true;
    void removeDisk;
    const deleted = await this.runFor(request, [config.limactlPath, "delete", "--force", name], 5 * 60_000);
    if (!this.success(deleted)) return unknown(request, "Unsafe Lima VM cleanup is indeterminate", manifest);
    if (shouldRemoveDisk) {
      const removed = await this.runFor(request, [config.limactlPath, "disk", "delete", "--force", disk], 5 * 60_000);
      if (!this.success(removed)) return unknown(request, "Unsafe Lima disk cleanup is indeterminate", manifest);
    }
    try {
      const inspected = await inspector.inspect(name, this.configPath(request.computer));
      if (inspected.exists || (shouldRemoveDisk && await inspector.inspectDisk(disk) !== undefined)) return unknown(request, "Unsafe Lima resource cleanup was not proven", manifest);
    } catch { return unknown(request, "Unsafe Lima resource cleanup inspection is indeterminate", manifest); }
    const tombstone = this.synthetic(request.computer, name, disk, terminalBinding);
    tombstone.lifecycle = "deleted"; tombstone.home.retained = false; tombstone.attachmentGeneration += 1; tombstone.updatedAt = new Date().toISOString();
    this.writeManifestOwned(request, tombstone);
    if (shouldRemoveDisk) this.clearCreatePhase(request);
    return fail("local_vm_configuration_unsafe", "Created Lima VM failed resolved safe-configuration diagnostics");
  }
  private async requireOrRecover(request: ProviderOperationRequest): Promise<LocalManifest | ProviderOutcome> {
    const existing = readManifest(this.root, request.computer);
    if (existing !== undefined) { validatePerComputerLimaGlobals(this.limaHomeFor(request.computer)); return existing; }
    return unknown(request, "Local VM lifecycle mutation requires a durable controller ownership manifest");
  }
  private async staticProof(manifest: LocalManifest): Promise<ProviderOutcome | undefined> {
    const computer = { tenantId: manifest.tenantId, id: manifest.computerId };
    try {
      const inspector = this.inspectorFor(computer); validateLimaInspection(await inspector.inspect(manifest.instanceId, this.configPath(computer as Computer)), manifest.home.reference, manifest.resolvedProfileDigest);
      const disk = await inspector.inspectDisk(manifest.home.reference, manifest.instanceId); if (disk === undefined || !this.validDisk(disk, manifest.home.reference, computer, manifest.instanceId)) throw new Error("unsafe disk");
      return undefined;
    }
    catch { return fail("local_vm_configuration_unsafe", "Resolved Lima configuration is no longer within the supported safe subset", resource(manifest)); }
  }
  private validDisk(value: ResolvedLimaDisk, name: string, computer: Pick<Computer, "tenantId" | "id">, expectedInstance?: string): boolean {
    return value.name === name && value.format === "raw" && value.sizeBytes === (this.config as LocalVmConfig).profile.homeDiskGiB * GIB
      && value.mountPoint === `/mnt/lima-${name}` && (expectedInstance === undefined
        ? value.instance === "" && value.instanceDir === ""
        : value.instance === expectedInstance && value.instanceDir === resolve(this.limaHomeFor(computer), expectedInstance));
  }
  private async stopLike(request: ProviderOperationRequest, lifecycle: "stopped" | "quarantined", force = false,
    preobserved?: "running" | "stopped" | "absent"): Promise<ProviderOutcome> {
    const unavailable = this.unavailable(); if (unavailable !== undefined) return unavailable; const recovered = await this.requireOrRecover(request); if (!("version" in recovered)) return recovered;
    if (!await this.exactRuntimeVersionSupported()) return fail("unsupported_lima_version", "Local VM mutations require exact Lima 2.1.1");
    if (!this.manifestMatchesCurrentProfile(request, recovered)) return fail("profile_mismatch", "Local VM profile binding has drifted", resource(recovered));
    const before = preobserved === undefined ? await this.restrictiveObservation(request, recovered) : { state: preobserved } as const;
    if (before.state === "unsafe") return unknown(request, "Lima restrictive preflight observation is indeterminate", recovered);
    let stopped: CommandResult | undefined;
    if (before.state === "running") {
      const argv = [(this.config as LocalVmConfig).limactlPath, "stop", ...(force ? ["--force"] : []), recovered.instanceId];
      stopped = await this.runFor(request, argv, 120_000);
    }
    const observed = stopped === undefined ? before : await this.restrictiveObservation(request, recovered);
    if (observed.state !== "stopped" && observed.state !== "absent") return unknown(request, stopped !== undefined && this.success(stopped)
      ? "Lima stop completed but restrictive state was not authoritatively proven"
      : "Lima stop outcome is indeterminate and restrictive state was not authoritatively proven", recovered);
    if (recovered.lifecycle !== lifecycle) recovered.attachmentGeneration += 1;
    recovered.lifecycle = lifecycle; recovered.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, recovered);
    return { kind: "success", resource: resource(recovered), result: result(recovered, { instanceAbsent: observed.state === "absent" }) };
  }
  private async stopAfterFailedProof(request: ProviderOperationRequest, manifest: LocalManifest, message: string): Promise<ProviderOutcome> {
    const before = await this.restrictiveObservation(request, manifest);
    if (before.state === "unsafe") return unknown(request, `${message}; forced-stop preflight is indeterminate`, manifest);
    if (before.state === "stopped" || before.state === "absent") return fail("local_vm_proof_failed", message, resource(manifest));
    const stopped = await this.runFor(request, [(this.config as LocalVmConfig).limactlPath, "stop", "--force", manifest.instanceId], 120_000);
    const observed = await this.restrictiveObservation(request, manifest);
    if (!this.success(stopped) && observed.state !== "stopped" && observed.state !== "absent") return unknown(request, `${message}; forced stop outcome is indeterminate`, manifest);
    return observed.state === "stopped" || observed.state === "absent" ? fail("local_vm_proof_failed", message, resource(manifest)) : unknown(request, `${message}; forced stop was not authoritatively proven`, manifest);
  }
  private async restrictiveObservation(request: ProviderOperationRequest, manifest: LocalManifest): Promise<{ state: "running" | "stopped" | "absent" | "unsafe" }> {
    try {
      const inspector = this.inspectorFor(request.computer); const inspected = await inspector.inspect(manifest.instanceId, this.configPath(request.computer));
      const disk = await inspector.inspectDisk(manifest.home.reference, inspected.exists ? manifest.instanceId : undefined);
      if (disk === undefined || !this.validDisk(disk, manifest.home.reference, request.computer, inspected.exists ? manifest.instanceId : undefined)) return { state: "unsafe" };
      if (!inspected.exists) return { state: "absent" };
      validateLimaInspection(inspected, manifest.home.reference, manifest.resolvedProfileDigest);
      return inspected.status === "Running" ? { state: "running" } : inspected.status === "Stopped" ? { state: "stopped" } : { state: "unsafe" };
    } catch { return { state: "unsafe" }; }
  }
  private async observeRunningReconcile(request: ProviderOperationRequest, manifest: LocalManifest): Promise<ProviderOutcome> {
    const boot = await this.executeFor(request, manifest.instanceId, ["/usr/bin/cat", "/proc/sys/kernel/random/boot_id"], 30_000, 4096);
    if (!this.success(boot) || !/^[a-f0-9-]{16,64}\n?$/.test(boot.stdout)) return unknown(request, "Running VM boot identity is indeterminate", manifest);
    const bootId = boot.stdout.trim();
    manifest.bootId = bootId; manifest.lifecycle = "running"; manifest.assurance = unverifiedAssurance(); manifest.attachmentGeneration += 1; manifest.updatedAt = new Date().toISOString(); this.writeManifestOwned(request, manifest);
    return { kind: "success", resource: resource(manifest), result: result(manifest, { reconciled: true, residentBindingVerified: false }) };
  }
  private success(value: CommandResult): boolean { return value.exitCode === 0 && !value.timedOut && !value.outputExceeded; }
  private async executeFor(request: ProviderOperationRequest, instance: string, argv: string[], timeoutMs: number, outputLimit = MAX_COMMAND_OUTPUT_BYTES): Promise<CommandResult> {
    validateId(instance.replace(/^computers-/, "cmp_"), "instance"); validateArgv(argv);
    return this.runFor(request, [(this.config as LocalVmConfig).limactlPath, "shell", instance, "--", ...argv], timeoutMs, outputLimit, false);
  }
  private async runFor(request: ProviderCreateRequest, argv: string[], timeoutMs: number, maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES, mutating = true): Promise<CommandResult> {
    request.execution.assertCurrent(); this.assertExecutablePinned();
    const command: SupervisedCommandRequest = { argv,
      env: { LIMA_HOME: this.limaHomeFor(request.computer), PATH: LIMA_SYSTEM_PATH }, signal: request.execution.signal, timeoutMs, maxOutputBytes };
    if (mutating) command.supervision = createCommandSupervision(this.root, this.lockKey(request.computer), argv);
    const outcome = mutating ? this.runner.runSupervised === undefined
      ? (() => { throw new ComputersError("provider_not_configured", "Command runner does not support crash-safe supervision", 503); })()
      : await this.runner.runSupervised(command, command.supervision as CommandSupervision)
      : await this.runner.run(command);
    this.assertExecutablePinned(); request.execution.assertCurrent();
    return outcome;
  }
  private assertExecutablePinned(): void {
    const config = this.config; if (config === undefined) return;
    const pin = vmExecutablePins.get(config); if (pin !== undefined) assertPinnedExecutable(pin);
  }
}

export function createLocalProviderPorts(options: LocalProviderOptions): ReturnType<typeof createProviderPorts> {
  const providers = createProviderPorts(); providers.local_machine = new AdoptedMachineProvider(options); providers.local_vm = new LimaVmProvider(options); return providers;
}

export interface LocalControllerConfigDocument {
  version: 1;
  stateRoot: string;
  vm?: {
    limactlPath: string; limaHome: string; profile: LocalVmProfile;
  };
  adoption?: {
    adoptionId: string; hostId: string; profileId: string; allowedTenantId: string; allowedOwnerPrincipalId: string;
    homeRoot: string; homeRelativePath: string; expectedHomeUid: number; controllerPath: string;
  };
}

function exactObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", `Invalid ${label}`, 500);
  const object = value as Record<string, unknown>; if (Object.keys(object).some((key) => !keys.includes(key))) throw new ComputersError("invalid_request", `Invalid ${label}`, 500); return object;
}
function secureControllerFile(path: string, executable: boolean): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new ComputersError("invalid_request", "Controller file path must be absolute", 500);
  const resolved = resolve(path); const parent = dirname(resolved); inspectPathAncestry(parent); const stat = lstatSync(resolved); const uid = process.getuid?.() ?? stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0 || (executable ? (stat.mode & 0o111) === 0 : (stat.mode & 0o077) !== 0)) {
    throw new ComputersError("invalid_request", "Controller file ownership or mode is unsafe", 500);
  }
  return resolved;
}
interface PinnedExecutable { path: string; dev: number; ino: number; size: number; mtimeMs: number; uid: number; mode: number }
const vmExecutablePins = new WeakMap<LocalVmConfig, PinnedExecutable>();
function pinExecutable(path: string): PinnedExecutable {
  const secured = secureControllerFile(path, true); const stat = lstatSync(secured);
  return { path: secured, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, uid: stat.uid, mode: stat.mode };
}
function assertPinnedExecutable(value: PinnedExecutable): void {
  const secured = secureControllerFile(value.path, true); const stat = lstatSync(secured);
  if (secured !== value.path || stat.dev !== value.dev || stat.ino !== value.ino || stat.size !== value.size || stat.mtimeMs !== value.mtimeMs
    || stat.uid !== value.uid || stat.mode !== value.mode) throw new ComputersError("provider_not_configured", "Controller executable identity changed", 503);
}
async function helperJson(runner: CommandRunner, executable: PinnedExecutable, argv: string[], execution?: ProviderExecutionGuard,
  supervision?: CommandSupervision): Promise<unknown> {
  assertPinnedExecutable(executable); execution?.assertCurrent();
  const command: SupervisedCommandRequest = { argv: [executable.path, ...argv], env: {}, timeoutMs: 120_000, maxOutputBytes: 64 * 1024 };
  if (execution !== undefined) command.signal = execution.signal;
  if (supervision !== undefined) command.supervision = supervision;
  const output = supervision === undefined ? await runner.run(command) : runner.runSupervised === undefined
    ? (() => { throw new ComputersError("provider_not_configured", "Command runner does not support crash-safe supervision", 503); })()
    : await runner.runSupervised(command, supervision);
  assertPinnedExecutable(executable); execution?.assertCurrent();
  if (output.exitCode !== 0 || output.timedOut || output.outputExceeded || Buffer.byteLength(output.stdout) > 64 * 1024) throw new ComputersError("provider_not_configured", "Controller helper outcome is indeterminate", 503);
  try { return JSON.parse(output.stdout) as unknown; }
  catch (error) { if (error instanceof ComputersError) throw error; throw new ComputersError("provider_not_configured", "Controller helper output is invalid", 503); }
}

function createLocalProviderPortsFromConfigFileWithOptions(configPath: string, options: { runner?: CommandRunner; platform?: NodeJS.Platform; arch?: string }): ReturnType<typeof createProviderPorts> {
  const path = secureControllerFile(configPath, false); if (statSync(path).size > MAX_STATE_BYTES) throw new ComputersError("invalid_request", "Local controller configuration is too large", 500);
  const raw = boundedJson<unknown>(path); const top = exactObject(raw, ["version", "stateRoot", "vm", "adoption"], "local controller configuration");
  if (top.version !== 1 || typeof top.stateRoot !== "string") throw new ComputersError("invalid_request", "Invalid local controller configuration", 500);
  const runner = options.runner ?? new BunCommandRunner(); const stateRoot = secureRoot(top.stateRoot); const providerOptions: LocalProviderOptions = { stateRoot, runner };
  if (options.platform !== undefined) providerOptions.platform = options.platform; if (options.arch !== undefined) providerOptions.arch = options.arch;
  if (top.vm !== undefined) {
    const vm = exactObject(top.vm, ["limactlPath", "limaHome", "profile"], "local VM configuration");
    if (typeof vm.limactlPath !== "string" || typeof vm.limaHome !== "string") throw new ComputersError("invalid_request", "Invalid local VM configuration", 500);
    const profile = vm.profile as LocalVmProfile;
    renderLimaConfig(profile, "home_000000000000000000000000");
    const executable = pinExecutable(vm.limactlPath); const vmConfig: LocalVmConfig = { limactlPath: executable.path, limaHome: vm.limaHome, profile };
    vmExecutablePins.set(vmConfig, executable); providerOptions.vm = vmConfig;
  }
  if (top.adoption !== undefined) {
    const adoption = exactObject(top.adoption, ["adoptionId", "hostId", "profileId", "allowedTenantId", "allowedOwnerPrincipalId", "homeRoot", "homeRelativePath", "expectedHomeUid", "controllerPath"], "adoption configuration");
    for (const key of ["adoptionId", "hostId", "profileId", "allowedTenantId", "allowedOwnerPrincipalId", "homeRoot", "homeRelativePath", "controllerPath"] as const) if (typeof adoption[key] !== "string") throw new ComputersError("invalid_request", "Invalid adoption configuration", 500);
    if (!Number.isSafeInteger(adoption.expectedHomeUid) || Number(adoption.expectedHomeUid) < 0 || Number(adoption.expectedHomeUid) > MAX_EXPECTED_UID) {
      throw new ComputersError("invalid_request", "Invalid adoption home owner", 500);
    }
    const controllerPath = pinExecutable(String(adoption.controllerPath)); const adoptionId = String(adoption.adoptionId);
    const adoptionResourceKey = ADOPTION_RESOURCE_KEY;
    const claimArgs = (claim: AdoptionClaimContext): string[] => [claim.adoptionId, claim.tenantId, claim.computerId, claim.ownerPrincipalId, String(claim.claimGeneration), claim.claimFence];
    const observe = async (claim: AdoptionClaimContext, execution?: ProviderExecutionGuard): Promise<AdoptedMachineObservation> => {
      const keys = ["hostId", "bootId", "state", "ownership", "controllerExternallyProtected", "residentHeartbeatCurrent"];
      const value = exactObject(await helperJson(runner, controllerPath, ["observe", ...claimArgs(claim)], execution), keys, "adoption observer output");
      if (Object.keys(value).length !== keys.length || typeof value.hostId !== "string" || typeof value.bootId !== "string"
        || !["running", "stopped", "quarantined", "unknown"].includes(String(value.state)) || !["dedicated", "shared", "unknown"].includes(String(value.ownership))
        || typeof value.controllerExternallyProtected !== "boolean" || typeof value.residentHeartbeatCurrent !== "boolean") throw new ComputersError("provider_not_configured", "Adoption observer output is invalid", 503);
      return value as unknown as AdoptedMachineObservation;
    };
    const adoptionConfig: LocalMachineAdoptionConfig = { adoptionId, hostId: String(adoption.hostId), profileId: String(adoption.profileId), allowedTenantId: String(adoption.allowedTenantId),
      allowedOwnerPrincipalId: String(adoption.allowedOwnerPrincipalId), homeRoot: String(adoption.homeRoot), homeRelativePath: String(adoption.homeRelativePath), expectedHomeUid: Number(adoption.expectedHomeUid),
      controller: { observe, transition: async (desired, claim, execution) => {
        const argv = ["transition", ...claimArgs(claim), desired];
        const value = exactObject(await helperJson(runner, controllerPath, argv, execution,
          createCommandSupervision(stateRoot, adoptionResourceKey, [controllerPath.path, ...argv])), ["transitioned"], "adoption transition output");
        if (Object.keys(value).length !== 1 || value.transitioned !== true) throw new ComputersError("provider_not_configured", "Adoption transition output is invalid", 503);
      }, release: async (claim, execution) => {
        const argv = ["release", ...claimArgs(claim)];
        const value = exactObject(await helperJson(runner, controllerPath, argv, execution,
          createCommandSupervision(stateRoot, adoptionResourceKey, [controllerPath.path, ...argv])), ["released"], "adoption release output");
        if (Object.keys(value).length !== 1 || typeof value.released !== "boolean") throw new ComputersError("provider_not_configured", "Adoption release output is invalid", 503);
        return { released: value.released };
      } } };
    try { validateAdoptionConfiguration(adoptionConfig); }
    catch { throw new ComputersError("invalid_request", "Invalid adoption configuration", 500); }
    providerOptions.adoption = adoptionConfig;
  }
  return createLocalProviderPorts(providerOptions);
}

export function createLocalProviderPortsFromConfigFile(configPath: string): ReturnType<typeof createProviderPorts> {
  return createLocalProviderPortsFromConfigFileWithOptions(configPath, {});
}

/** @internal Test-only dependency injection; this symbol is not exposed by package exports. */
export function createLocalProviderPortsFromConfigFileForTesting(configPath: string,
  options: { runner?: CommandRunner; platform?: NodeJS.Platform; arch?: string }): ReturnType<typeof createProviderPorts> {
  return createLocalProviderPortsFromConfigFileWithOptions(configPath, options);
}
