import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputersError, type AuthorizationContext, type Computer, type Operation, type ProviderAttempt, type ProviderOutcome, type ProviderReadiness } from "../src/contracts";
import { cleanupLocalCanary } from "../src/local-canary";
import {
  AdoptedMachineProvider, BunCommandRunner, LimaVmProvider, LimactlInspector, type CommandRequest, type CommandResult, type CommandRunner,
  type AdoptionClaimContext, type LimaInspector, type LocalVmConfig, type ResolvedLimaDisk, type ResolvedLimaInspection,
  createCommandSupervision, createLocalProviderPortsFromConfigFile, createLocalProviderPortsFromConfigFileForTesting, renderLimaConfig, validateLimaInspection,
} from "../src/local";
import { createProviderPorts, validateProviderAssurance } from "../src/providers";
import type { ProviderCreateRequest, ProviderOperationRequest, ProviderPort } from "../src/providers";
import { ComputersService } from "../src/service";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { SQLiteStorage, sha256 } from "../src/storage";
import { OperationWorker } from "../src/worker";
import * as localModule from "../src/local";

const roots: string[] = [];
const limaTestInstance = `computers-${"a".repeat(24)}`;
const admin: AuthorizationContext = { tenantId: "tenant_local", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root(): string { const value = mkdtempSync(join(tmpdir(), "computers-local-")); roots.push(value); return value; }
function computer(provider: "local_machine" | "local_vm" = "local_vm", id = "cmp_local_one"): Computer {
  const now = new Date().toISOString(); return { id, tenantId: "tenant_local", slug: id.replaceAll("_", "-"), provider,
    confinementClass: provider === "local_machine" ? "dedicated_machine" : "unverified_vm", status: "provisioning", ownerPrincipalId: `principal_${id}`,
    policyGeneration: 1, dataExfiltrationProtection: false, createdAt: now, updatedAt: now };
}
function operation(value: Computer, kind: Operation["kind"] = "create"): Operation {
  const now = new Date().toISOString(); const desired = { create: "stopped", start: "running", stop: "stopped", quarantine: "quarantined", delete: "deleted" } as const;
  const document = value.provider === "local_machine"
    ? { provider: "local_machine", cpus: 4, memoryGiB: 8, rootDiskGiB: 32, homeDiskGiB: 32 }
    : { provider: "local_vm", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` };
  const profileId = value.provider === "local_machine" ? "profile_adopted" : "profile_strict";
  return { id: `opn_${kind}_local`, tenantId: value.tenantId, computerId: value.id, kind, status: "running", policyGeneration: 1,
    idempotencyKey: `local-${kind}-0001`, request: { provider: value.provider, profileId,
      profile: { id: profileId, generation: 1, digest: sha256(document), document }, adoption: { adoptionId: "adoption_one" } },
    priorComputerStatus: kind === "create" ? "provisioning" : "stopped", desiredComputerStatus: desired[kind as keyof typeof desired], fence: 0, createdAt: now, updatedAt: now };
}
function attempt(op: Operation): ProviderAttempt { return { id: `pat_${op.kind}_local`, tenantId: op.tenantId, operationId: op.id, attemptNumber: 1, providerIdempotencyKey: `provider:${op.id}`, status: "running", fence: 0, executionOwnerGeneration: 1, startedAt: op.createdAt }; }
function execution(): { ownerGeneration: number; signal: AbortSignal; assertCurrent(): void } {
  return { ownerGeneration: 1, signal: new AbortController().signal, assertCurrent() { /* current test owner */ } };
}
function resolved(overrides: Partial<ResolvedLimaInspection> = {}): ResolvedLimaInspection {
  const diskName = overrides.additionalDisks?.[0]?.name ?? "home_expected";
  const profile = { minimumLimaVersion: "2.1.1", vmType: "vz", os: "Linux", arch: "aarch64", plain: true,
    user: { name: "computers", comment: "Computers resident", home: "/home/computers", shell: "/bin/bash", uid: 1000 },
    cpus: 2, memoryBytes: 4 * 1024 ** 3, rootDiskBytes: 16 * 1024 ** 3,
    image: { location: "https://images.example.invalid/linux.qcow2", arch: "aarch64", digest: `sha256:${"a".repeat(64)}` },
    firmware: { legacyBIOS: false, images: [] }, audio: { device: "none" }, video: { display: "none", vnc: { display: "none" } },
    upgradePackages: false, nestedVirtualization: false, timezone: "", guestInstallPrefix: "/usr/local",
    mounts: [], portForwards: [], copyToHost: [], provision: [], probes: [], networks: [], dns: [], caCerts: { removeDefaults: false, files: [], certs: [] },
    env: {}, param: {}, propagateProxyEnv: false,
    hostResolver: { enabled: false, ipv6: false, hosts: {} }, containerd: { system: false, user: false }, rosetta: { enabled: false, binfmt: false },
    ssh: { localPort: 0, loadDotSSHPubKeys: false, forwardAgent: false, forwardX11: false, forwardX11Trusted: false, overVsock: false },
    additionalDisks: [{ name: diskName, format: false }] };
  return { exists: true, status: "Stopped", vmType: "vz", arch: "aarch64", plain: true, cpus: 2, memoryBytes: 4 * 1024 ** 3,
    rootDiskBytes: 16 * 1024 ** 3, imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}`,
    profileDigest: sha256(profile), mountCount: 0, portForwardCount: 0, provisionCount: 0, probeCount: 0, networkCount: 0, envEntryCount: 0,
    additionalDisks: [{ name: diskName, format: false }], hostResolverEnabled: false, hostResolverIpv6: false, hostResolverHostsCount: 0,
    containerdSystem: false, containerdUser: false, rosettaEnabled: false, rosettaBinFmt: false, sshLocalPort: 0, forwardAgent: false,
    loadDotSshPubKeys: false, forwardX11: false, forwardX11Trusted: false, sshOverVsock: false, guestAgentEnabled: false,
    propagateProxyEnv: false, ...overrides };
}
class FakeRunner implements CommandRunner {
  readonly calls: string[][] = []; readonly requests: CommandRequest[] = []; results: CommandResult[] = [];
  onRun?: (request: CommandRequest) => void;
  async run(request: CommandRequest): Promise<CommandResult> {
    if (request.argv.at(-1) === "--version" && !this.results[0]?.stdout.startsWith("limactl version ")) return commandResult("limactl version 2.1.1\n");
    this.onRun?.(request);
    this.calls.push(request.argv); this.requests.push(request); return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false, outputExceeded: false };
  }
  async runSupervised(request: CommandRequest, supervision: import("../src/local").CommandSupervision): Promise<CommandResult> {
    supervision.prepare(); supervision.publish(99_999_999, 99_999_999); const result = await this.run(request); supervision.clear(); return result;
  }
}
class FakeInspector implements LimaInspector {
  inspection = resolved(); inspections: ResolvedLimaInspection[] = []; disk = false; disks: boolean[] = []; diskOverride?: Partial<ResolvedLimaDisk>; limaHome = "/controller";
  onInspect?: (value: ResolvedLimaInspection) => void;
  async inspect(): Promise<ResolvedLimaInspection> { const value = this.inspections.shift() ?? this.inspection; this.onInspect?.(value); return { ...value, additionalDisks: value.additionalDisks.map((item) => ({ ...item })) }; }
  async inspectDisk(name: string, expectedInstanceName?: string): Promise<ResolvedLimaDisk | undefined> {
    const present = this.disks.shift() ?? this.disk;
    return present ? { name, sizeBytes: 32 * 1024 ** 3, format: "raw", dir: join(this.limaHome, "_disks", name), instance: expectedInstanceName ?? "",
      instanceDir: expectedInstanceName === undefined ? "" : join(this.limaHome, expectedInstanceName), mountPoint: `/mnt/lima-${name}`, ...this.diskOverride } : undefined;
  }
}
const canaryAdmin: AuthorizationContext = { tenantId: "tenant_local_canary", principalId: "principal_local_canary_admin", scopes: ["computers:admin"], authMethod: "loopback_dev" };
const canaryAssurance = { confinementClass: "unverified_vm", providerSpecificControlsPassed: false, externalEgressEnforced: false,
  residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false } as const;
class CanaryCleanupProvider implements ProviderPort {
  readonly kind = "local_vm" as const; quarantineOutcome: ProviderOutcome | Error; deleteCalls = 0; reconcileCalls = 0;
  constructor(quarantineOutcome: ProviderOutcome | Error) { this.quarantineOutcome = quarantineOutcome; }
  async readiness(): Promise<ProviderReadiness> { return { provider: this.kind, configured: true, ready: true, confinementClass: "unverified_vm", controls: {}, limitations: [] }; }
  async create(): Promise<ProviderOutcome> { return this.success("stopped"); }
  async start(): Promise<ProviderOutcome> { return this.success("running"); }
  async stop(): Promise<ProviderOutcome> { return this.success("stopped"); }
  async quarantine(): Promise<ProviderOutcome> { if (this.quarantineOutcome instanceof Error) throw this.quarantineOutcome; return this.quarantineOutcome; }
  async delete(): Promise<ProviderOutcome> { this.deleteCalls += 1; return this.success("deleted", { instanceAbsent: true, retainedHomeConfirmed: true }); }
  async restore(): Promise<ProviderOutcome> { return this.success("running"); }
  async reconcile(): Promise<ProviderOutcome> { this.reconcileCalls += 1; return { kind: "unknown", providerOperationId: "canary-reconcile", message: "still indeterminate" }; }
  success(lifecycle: "stopped" | "running" | "quarantined" | "deleted", extra: Record<string, unknown> = {}): ProviderOutcome {
    return { kind: "success", resource: { resourceId: "resource:canary", instanceId: "instance:canary" }, result: {
      lifecycle, assurance: canaryAssurance, residentBindingVerified: false, volumes: { root: "root:canary", home: "home:canary" },
      retainHome: true, homeUsable: false, ...extra,
    } };
  }
}
async function preparedCanary(provider: CanaryCleanupProvider): Promise<{ storage: SQLiteStorage; service: ComputersService; worker: OperationWorker; computer: Computer }> {
  const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider as never, local_vm: provider, aws_ec2: provider as never };
  const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  service.createProfile(canaryAdmin, { id: "profile_canary", name: "Canary Lima", document: { provider: "local_vm", cpus: 2, memoryGiB: 4,
    rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/canary.qcow2", imageDigest: `sha256:${"c".repeat(64)}` } });
  const computer = service.createComputer(canaryAdmin, { id: "cmp_canary_cleanup", slug: "canary-cleanup", provider: "local_vm",
    ownerPrincipalId: "principal_canary_cleanup", profileId: "profile_canary", idempotencyKey: "canary-create-cleanup" });
  const worker = new OperationWorker(storage, ports); await worker.runTenant(canaryAdmin.tenantId);
  if (storage.getComputer(canaryAdmin.tenantId, computer.id)?.status !== "stopped") throw new Error("canary fixture did not reach stopped");
  return { storage, service, worker, computer };
}
function vmConfig(state: string, inspector: LimaInspector, runner: CommandRunner): { config: LocalVmConfig; provider: LimaVmProvider } {
  const limaHome = join(state, "lima"); mkdirSync(limaHome, { recursive: true, mode: 0o700 });
  if (inspector instanceof FakeInspector) inspector.limaHome = join(limaHome, "tenant_local", "cmp_local_one");
  const config: LocalVmConfig = { limactlPath: "/usr/bin/limactl", limaHome, inspector,
    profile: { id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` } };
  return { config, provider: new LimaVmProvider({ stateRoot: state, platform: "darwin", arch: "arm64", runner, vm: config }) };
}

function commandResult(stdout = "", stderr = "", exitCode = 0): CommandResult {
  return { exitCode, stdout, stderr, timedOut: false, outputExceeded: false };
}

function writeInstanceConfig(limaHome: string, name: string, yaml: string): string {
  const instanceDirectory = join(limaHome, name); mkdirSync(instanceDirectory, { recursive: true, mode: 0o700 });
  const path = join(instanceDirectory, "lima.yaml"); writeFileSync(path, yaml, { mode: 0o600 }); return path;
}

function limaListRecord(limaHome: string, overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name: limaTestInstance, hostname: limaTestInstance, status: "Stopped", dir: join(limaHome, limaTestInstance),
    vmType: "vz", arch: "aarch64", cpus: 2, memory: 4 * 1024 ** 3, disk: 16 * 1024 ** 3, protected: false, limaVersion: "2.1.1", ...overrides })}\n`;
}

describe("local provider assurance and recovery", () => {
  test("keeps dedicated-machine lower assurance and enforces strict VM consistency", () => {
    expect(validateProviderAssurance({ confinementClass: "dedicated_machine", providerSpecificControlsPassed: true, externalEgressEnforced: false, residentIndependentIsolation: false, hostMounts: true, hostSockets: true, portForwards: true, containerd: true }).residentIndependentIsolation).toBe(false);
    expect(() => validateProviderAssurance({ confinementClass: "dedicated_machine", providerSpecificControlsPassed: true, externalEgressEnforced: false, residentIndependentIsolation: true, hostMounts: false, hostSockets: false, portForwards: false, containerd: false })).toThrow("inconsistent");
    expect(() => validateProviderAssurance({ confinementClass: "strict_vm", providerSpecificControlsPassed: true, externalEgressEnforced: true, residentIndependentIsolation: true, hostMounts: false, hostSockets: true, portForwards: false, containerd: false, networkPolicyId: "policy.strict.v1" })).toThrow("inconsistent");
  });

  test("plain mode alone cannot pass static proof and generated config disables host conveniences", () => {
    for (const unsafe of [{ portForwardCount: 1 }, { provisionCount: 1 }, { probeCount: 1 }, { mountCount: 1 }, { envEntryCount: 1 },
      { forwardAgent: true }, { forwardX11: true }, { forwardX11Trusted: true }, { sshOverVsock: true }, { rosettaEnabled: true },
      { rosettaBinFmt: true }, { guestAgentEnabled: true }, { hostResolverEnabled: true }, { hostResolverIpv6: true }, { hostResolverHostsCount: 1 }, { networkCount: 1 }]) {
      expect(() => validateLimaInspection(resolved(unsafe), "home_expected")).toThrow("safe local-VM diagnostics");
    }
    const yaml = renderLimaConfig({ id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` }, "home_expected");
    expect(yaml).toContain("plain: true"); expect(yaml).toContain("mounts: []"); expect(yaml).toContain("portForwards: []");
    expect(yaml).toContain("hostResolver:\n  enabled: false"); expect(yaml).not.toContain("host.lima.internal"); expect(yaml).not.toContain(".sock");
    expect(yaml).toContain("format: false"); expect(yaml).not.toContain("fsType:");
  });

  test("binds the complete authoritative profile digest, not only plain mode", async () => {
    const profile = { id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` };
    const safeYaml = renderLimaConfig(profile, "home_expected"); const safeHome = root(); writeInstanceConfig(safeHome, limaTestInstance, safeYaml);
    const safeRunner = new FakeRunner(); safeRunner.results.push(commandResult(limaListRecord(safeHome)));
    const expected = await new LimactlInspector("/usr/bin/limactl", safeHome, safeRunner).inspect(limaTestInstance);
    validateLimaInspection(expected, "home_expected", expected.profileDigest);

    const mutations: Array<{ yaml: string; list?: Record<string, unknown> }> = [
      { yaml: safeYaml.replace("cpus: 2", "cpus: 3"), list: { cpus: 3 } },
      { yaml: safeYaml.replace('memory: "4GiB"', 'memory: "5GiB"'), list: { memory: 5 * 1024 ** 3 } },
      { yaml: safeYaml.replace('disk: "16GiB"', 'disk: "17GiB"'), list: { disk: 17 * 1024 ** 3 } },
      { yaml: safeYaml.replace("linux.qcow2", "other.qcow2") },
      { yaml: safeYaml.replace(`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`) },
      { yaml: safeYaml.replace("probes: []", "probes:\n  - script: false") },
      { yaml: safeYaml.replace("env: {}", "env:\n  UNSAFE: value") },
      { yaml: safeYaml.replace("  hosts: {}", "  hosts:\n    unsafe.internal: 127.0.0.1") },
      { yaml: safeYaml.replace("  forwardX11: false", "  forwardX11: true") },
      { yaml: safeYaml.replace("    format: false", "    format: true") },
    ];
    for (const mutation of mutations) {
      const limaHome = root(); writeInstanceConfig(limaHome, limaTestInstance, mutation.yaml); const runner = new FakeRunner();
      runner.results.push(commandResult(limaListRecord(limaHome, mutation.list)));
      const inspected = await new LimactlInspector("/usr/bin/limactl", limaHome, runner).inspect(limaTestInstance);
      expect(() => validateLimaInspection(inspected, "home_expected", expected.profileDigest)).toThrow("safe local-VM diagnostics");
    }
  });

  test("nonzero authoritative list is indeterminate rather than absence", async () => {
    const runner = new FakeRunner(); runner.results.push({ exitCode: 1, stdout: "", stderr: "denied", timedOut: false, outputExceeded: false });
    await expect(new LimactlInspector("/usr/bin/limactl", root(), runner).inspect("computers-test", "/tmp/config.yaml")).rejects.toThrow("indeterminate");
  });

  test("uses the controller-owned instance config instead of a safe request YAML", async () => {
    const limaHome = root(); const requestPath = join(root(), "request.yaml");
    const safe = renderLimaConfig({ id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` }, "home_expected");
    writeFileSync(requestPath, safe, { mode: 0o600 });
    writeInstanceConfig(limaHome, limaTestInstance, safe.replace("mounts: []", "mounts:\n  - location: /Users/unsafe"));
    const runner = new FakeRunner();
    runner.results.push(
      commandResult(`${JSON.stringify({ name: limaTestInstance, hostname: limaTestInstance, status: "Stopped", dir: join(limaHome, limaTestInstance),
        vmType: "vz", arch: "aarch64", cpus: 2, memory: 4 * 1024 ** 3, disk: 16 * 1024 ** 3, protected: false, limaVersion: "2.1.1" })}\n`),
    );
    const inspected = await new LimactlInspector("/usr/bin/limactl", limaHome, runner).inspect(limaTestInstance, requestPath);
    expect(inspected.mountCount).toBe(1);
    expect(() => validateLimaInspection(inspected, "home_expected")).toThrow("safe local-VM diagnostics");
    expect(runner.calls.some((argv) => argv.includes("yq"))).toBe(false);
  });

  test("rejects unsupported or unknown authoritative Lima fields and per-Computer global overrides", async () => {
    const profile = { id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` };
    const safe = renderLimaConfig(profile, "home_expected");
    for (const yaml of [
      safe.replace("copyToHost: []", "copyToHost:\n  - guest: /tmp/a\n    host: /tmp/b"),
      `${safe}unknownTopLevel: true\n`,
      safe.replace("  overVsock: false", "  overVsock: false\n  unknownSshKey: true"),
      `${safe}vmOpts:\n  vz:\n    rosetta:\n      enabled: true\n`,
      `${safe}base: []\n`, `${safe}cpuType:\n  aarch64: host\n`, `${safe}mountTypesUnsupported: [9p]\n`,
      `${safe}mountType: 9p\n`, `${safe}mountInotify: true\n`, `${safe}message: unsafe\n`,
      safe.replace("containerd:\n  system: false\n  user: false", "containerd:\n  system: false\n  user: false\n  archives: []"),
      safe.replace("    format: false", "    format: false\n    fsType: ext4"),
      safe.replace("    format: false", "    format: false\n    fsArgs: [-F]"),
      safe.replace(`    digest: "sha256:${"a".repeat(64)}"`, `    digest: "sha256:${"a".repeat(64)}"\n    kernel: /tmp/kernel`),
      safe.replace(`    digest: "sha256:${"a".repeat(64)}"`, `    digest: "sha256:${"a".repeat(64)}"\n    initrd: /tmp/initrd`),
      safe.replace(`    digest: "sha256:${"a".repeat(64)}"`, `    digest: "sha256:${"a".repeat(64)}"\n    vmType: vz`),
    ]) {
      const limaHome = root(); writeInstanceConfig(limaHome, limaTestInstance, yaml); const runner = new FakeRunner(); runner.results.push(commandResult(limaListRecord(limaHome)));
      await expect(new LimactlInspector("/usr/bin/limactl", limaHome, runner).inspect(limaTestInstance)).rejects.toThrow(/Invalid Lima|Unsupported Lima resolved defaults/);
    }
    const forwardHome = root(); writeInstanceConfig(forwardHome, limaTestInstance,
      safe.replace("portForwards: []", "portForwards:\n  - guestPort: 22\n    hostPort: 2200\n    static: true"));
    const forwardRunner = new FakeRunner(); forwardRunner.results.push(commandResult(limaListRecord(forwardHome)));
    const forwarded = await new LimactlInspector("/usr/bin/limactl", forwardHome, forwardRunner).inspect(limaTestInstance);
    expect(() => validateLimaInspection(forwarded, "home_expected")).toThrow("safe local-VM diagnostics");
    for (const globalName of ["default.yaml", "override.yaml", "base.yaml"]) {
      const limaHome = root(); writeInstanceConfig(limaHome, limaTestInstance, safe); const configDir = join(limaHome, "_config"); mkdirSync(configDir, { mode: 0o700 });
      writeFileSync(join(configDir, globalName), "portForwards:\n  - guestPort: 22\n    hostPort: 2200\n    static: true\n", { mode: 0o600 });
      await expect(new LimactlInspector("/usr/bin/limactl", limaHome, new FakeRunner()).inspect(limaTestInstance)).rejects.toThrow(globalName);
    }
  });

  test("rejects unsafe authoritative Lima file identity preconditions", async () => {
    const safe = renderLimaConfig({ id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` }, "home_expected");
    const inspect = async (limaHome: string): Promise<ResolvedLimaInspection> => {
      const runner = new FakeRunner(); runner.results.push(commandResult(limaListRecord(limaHome)));
      return new LimactlInspector("/usr/bin/limactl", limaHome, runner).inspect(limaTestInstance);
    };

    const linkedHome = root(); writeInstanceConfig(linkedHome, limaTestInstance, safe);
    const linkedConfig = join(linkedHome, limaTestInstance, "lima.yaml"); linkSync(linkedConfig, `${linkedConfig}.alias`);
    await expect(inspect(linkedHome)).rejects.toThrow("Authoritative Lima instance configuration is unsafe");

    const replacedHome = root(); writeInstanceConfig(replacedHome, limaTestInstance, safe);
    const replacedConfig = join(replacedHome, limaTestInstance, "lima.yaml"); const originalConfig = `${replacedConfig}.original`;
    renameSync(replacedConfig, originalConfig); symlinkSync(originalConfig, replacedConfig);
    await expect(inspect(replacedHome)).rejects.toThrow("Local provider paths may not contain symlinks");

    const directoryHome = root(); writeInstanceConfig(directoryHome, limaTestInstance, safe);
    const directoryConfig = join(directoryHome, limaTestInstance, "lima.yaml"); rmSync(directoryConfig); mkdirSync(directoryConfig, { mode: 0o700 });
    await expect(inspect(directoryHome)).rejects.toThrow("Authoritative Lima instance configuration is unsafe");
  });

  test("rejects authoritative Lima instance version mismatch", async () => {
    const limaHome = root(); writeInstanceConfig(limaHome, limaTestInstance, renderLimaConfig({ id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` }, "home_expected"));
    const runner = new FakeRunner(); runner.results.push(commandResult(limaListRecord(limaHome, { limaVersion: "2.2.0" })));
    await expect(new LimactlInspector("/usr/bin/limactl", limaHome, runner).inspect(limaTestInstance)).rejects.toThrow("Unsupported Lima instance version");
  });

  test("rejects a runtime version mismatch before any mutating Lima command", async () => {
    const state = root(); const limaHome = join(state, "lima"); mkdirSync(limaHome, { recursive: true, mode: 0o700 });
    const runner = new FakeRunner(); runner.results.push(commandResult("limactl version 2.2.0\n"));
    const provider = new LimaVmProvider({ stateRoot: state, platform: "darwin", arch: "arm64", runner, vm: {
      limactlPath: "/usr/bin/limactl", limaHome,
      profile: { id: "profile_strict", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
        imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` },
    } });
    const machine = computer(); const op = operation(machine);
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "unsupported_lima_version" });
    expect(runner.calls).toEqual([["/usr/bin/limactl", "--version"]]);
  });

  test("proves absence from a successful bounded all-instance list and rejects every nonzero", async () => {
    const absentRunner = new FakeRunner();
    absentRunner.results.push(commandResult(""));
    expect((await new LimactlInspector("/usr/bin/limactl", root(), absentRunner).inspect(limaTestInstance, "/unused/request.yaml")).exists).toBe(false);

    const malformedRunner = new FakeRunner();
    malformedRunner.results.push(commandResult("", "permission denied\n", 1));
    await expect(new LimactlInspector("/usr/bin/limactl", root(), malformedRunner).inspect(limaTestInstance, "/unused/request.yaml")).rejects.toThrow("indeterminate");

    const duplicateRunner = new FakeRunner();
    duplicateRunner.results.push(commandResult(`{"name":"${limaTestInstance}"}\n{"name":"${limaTestInstance}"}\n`));
    await expect(new LimactlInspector("/usr/bin/limactl", root(), duplicateRunner).inspect(limaTestInstance, "/unused/request.yaml")).rejects.toThrow("duplicated");
  });

  test("parses Lima disk list JSONL for zero and multiple disks and rejects malformed records", async () => {
    const limaHome = root(); const diskDir = join(limaHome, "_disks", "home_expected"); mkdirSync(diskDir, { recursive: true, mode: 0o700 });
    const disk = (name: string, size: number, dir: string) => JSON.stringify({ name, size, format: "raw", dir, instance: "", instanceDir: "", mountPoint: `/mnt/lima-${name}` });
    const runner = new FakeRunner(); runner.results.push(
      commandResult(""),
      commandResult(`${disk("home_other", 1, join(limaHome, "_disks", "home_other"))}\n${disk("home_expected", 32 * 1024 ** 3, diskDir)}\n`),
      commandResult(`${disk("home_expected", 32 * 1024 ** 3, diskDir)}\nnot-json\n`),
    );
    const inspector = new LimactlInspector("/usr/bin/limactl", limaHome, runner);
    expect(await inspector.inspectDisk("home_expected")).toBeUndefined();
    expect(await inspector.inspectDisk("home_expected")).toMatchObject({ name: "home_expected", sizeBytes: 32 * 1024 ** 3, format: "raw", dir: diskDir });
    await expect(inspector.inspectDisk("home_expected")).rejects.toThrow("invalid");
    expect(runner.calls.every((argv) => argv.slice(0, 4).join(" ") === "/usr/bin/limactl disk list --json")).toBe(true);
    expect(runner.requests.every((request) => request.env?.LIMA_HOME === limaHome
      && request.env?.PATH === "/usr/bin:/bin:/usr/sbin:/sbin")).toBe(true);
  });

  test("creates Lima disks with an explicit GiB size and only succeeds from authoritative Stopped state", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const inspector = new FakeInspector(); inspector.disks = [false, false, true, true];
    inspector.inspections = [resolved({ exists: false }), resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult());
    const { provider } = vmConfig(state, inspector, runner);
    const tampered = operation(machine); tampered.request.profile = { ...(tampered.request.profile as Record<string, unknown>), digest: `sha256:${"f".repeat(64)}` };
    expect(await provider.create({ computer: machine, operation: tampered, attempt: attempt(tampered), execution: execution() })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    expect((await provider.create({ computer: machine, operation: operation(machine), attempt: attempt(operation(machine)), execution: execution() })).kind).toBe("success");
    expect(runner.calls[0]).toEqual(["/usr/bin/limactl", "disk", "create", "--size", "32GiB", expectedDisk]);
    expect(runner.requests[0]?.env).toEqual({
      LIMA_HOME: join(state, "lima", machine.tenantId, machine.id),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    });
    expect(runner.requests[1]?.env).toEqual({
      LIMA_HOME: join(state, "lima", machine.tenantId, machine.id),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    });

    const runningInspector = new FakeInspector(); runningInspector.disk = true;
    runningInspector.inspections = [resolved({ exists: false }), resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runningRunner = new FakeRunner(); runningRunner.results.push(commandResult());
    const runningProvider = vmConfig(root(), runningInspector, runningRunner).provider;
    expect((await runningProvider.create({ computer: machine, operation: operation(machine), attempt: attempt(operation(machine)) })).kind).not.toBe("success");
  });

  test("gives every Lima lifecycle and reconciliation command the bounded system PATH", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const inspector = new FakeInspector(); inspector.disks = [false, true, true];
    inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult());
    const provider = vmConfig(state, inspector, runner).provider; const createOp = operation(machine);
    expect((await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");

    inspector.disk = true; inspector.inspection = resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] });
    runner.results.push(commandResult(), commandResult("01234567-89ab-cdef-0123-456789abcdef\n"));
    const startOp = operation(machine, "start");
    expect((await provider.start({ computer: machine, operation: startOp, attempt: attempt(startOp), execution: execution(), homeLease: {} as never })).kind).toBe("success");

    runner.results.push(commandResult("01234567-89ab-cdef-0123-456789abcdef\n"));
    expect((await provider.reconcile({ computer: machine, operation: startOp, attempt: attempt(startOp), execution: execution() })).kind).toBe("success");

    runner.results.push(commandResult()); inspector.inspections = [
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
      resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
    ]; inspector.disks = [true, true];
    const stopOp = operation(machine, "stop");
    expect((await provider.stop({ computer: machine, operation: stopOp, attempt: attempt(stopOp), execution: execution() })).kind).toBe("success");

    runner.results.push(commandResult()); inspector.inspections = [
      resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }), resolved({ exists: false }),
    ];
    const deleteOp = operation(machine, "delete");
    expect((await provider.delete({ computer: machine, operation: deleteOp, attempt: attempt(deleteOp), execution: execution() })).kind).toBe("success");

    const expectedEnvironment = { LIMA_HOME: join(state, "lima", machine.tenantId, machine.id), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
    expect(runner.requests.length).toBeGreaterThanOrEqual(7);
    for (const request of runner.requests) {
      expect(request.env).toEqual(expectedEnvironment);
      expect(request.env?.PATH).not.toContain("/opt/homebrew");
      expect(request.env?.PATH).not.toContain("/opt/local");
      expect(request.env?.PATH).not.toContain("/usr/local");
      expect(request.env?.PATH).not.toContain("/nix");
    }
    const actions = runner.calls.map((argv) => argv[1]);
    expect(actions).toContain("disk"); expect(actions).toContain("create"); expect(actions).toContain("start");
    expect(actions.filter((action) => action === "shell")).toHaveLength(2);
    expect(actions).toContain("stop"); expect(actions).toContain("delete");
  });

  test("durably publishes, replaces, and removes recovery journals while failing closed on exclusive collision", () => {
    const state = root(); const resourceKey = "lima:tenant_local:cmp_durable"; const argv = ["/usr/bin/limactl", "start", "computers-durable"];
    const first = createCommandSupervision(state, resourceKey, argv); first.prepare();
    const journalDirectory = join(state, "command-journals"); const files = readdirSync(journalDirectory);
    expect(files).toHaveLength(1); expect(files[0]?.endsWith(".json")).toBe(true);
    const journal = join(journalDirectory, files[0] as string); const prepared = readFileSync(journal, "utf8");
    expect(lstatSync(journal).nlink).toBe(1); expect(lstatSync(journal).mode & 0o077).toBe(0);

    const collision = createCommandSupervision(state, resourceKey, ["/usr/bin/limactl", "stop", "computers-durable"]);
    expect(() => collision.prepare()).toThrow();
    expect(readFileSync(journal, "utf8")).toBe(prepared);
    expect(readdirSync(journalDirectory).filter((name) => name.includes(".tmp-"))).toHaveLength(0);

    first.publish(99_999_999, 99_999_999);
    expect(JSON.parse(readFileSync(journal, "utf8"))).toMatchObject({ phase: "published", pid: 99_999_999, pgid: 99_999_999 });
    expect(lstatSync(journal).nlink).toBe(1);
    first.clear();
    expect(existsSync(journal)).toBe(false);
    expect(readdirSync(journalDirectory).filter((name) => name.includes(".tmp-"))).toHaveLength(0);

    const source = readFileSync(join(process.cwd(), "src", "local.ts"), "utf8");
    const syncedWrite = source.slice(source.indexOf("function writeSyncedPrivateFile"), source.indexOf("function durableUnlink"));
    expect(syncedWrite.indexOf('synchronizeRecoveryDescriptor(fd, "file")')).toBeLessThan(syncedWrite.indexOf("return { dev:"));
    const publication = source.slice(source.indexOf("function atomicPrivateFile"), source.indexOf("function atomicJson"));
    expect(publication.indexOf("writeSyncedPrivateFile")).toBeLessThan(publication.indexOf("linkSync(temporary, path)"));
    expect(publication.indexOf("writeSyncedPrivateFile")).toBeLessThan(publication.indexOf("renameSync(temporary, path)"));
    expect(publication.indexOf("linkSync(temporary, path)")).toBeLessThan(publication.indexOf("syncDirectory(parent)"));
    const removal = source.slice(source.indexOf("function durableUnlink"), source.indexOf("function atomicPrivateFile"));
    expect(removal.indexOf("unlinkSync(path)")).toBeLessThan(removal.indexOf("syncDirectory(dirname(path))"));
  });

  test("selects Darwin full sync for recovery files and fails closed when it is unavailable or rejected", () => {
    type SyncForTesting = (fd: number, target: "file" | "directory", platform: NodeJS.Platform, operations: {
      fsync(fd: number): void; fullFsync?: (fd: number) => number;
    }) => void;
    const synchronize = (localModule as unknown as { synchronizeRecoveryDescriptorForTesting?: SyncForTesting })
      .synchronizeRecoveryDescriptorForTesting;
    expect(typeof synchronize).toBe("function");
    if (synchronize === undefined) return;

    const calls: string[] = [];
    const operations = {
      fsync(fd: number) { calls.push(`fsync:${fd}`); },
      fullFsync(fd: number) { calls.push(`full:${fd}`); return 0; },
    };
    synchronize(11, "file", "darwin", operations);
    synchronize(12, "directory", "darwin", operations);
    synchronize(13, "file", "linux", operations);
    expect(calls).toEqual(["full:11", "fsync:12", "fsync:13"]);
    expect(() => synchronize(14, "file", "darwin", { fsync() { throw new Error("ordinary sync must not be selected"); } }))
      .toThrow("F_FULLFSYNC is unavailable");
    expect(() => synchronize(15, "file", "darwin", { fsync() { /* not selected */ }, fullFsync: () => -1 }))
      .toThrow("F_FULLFSYNC failed");
    expect(() => synchronize(16, "directory", "darwin", { fsync() { throw new Error("directory sync rejected"); }, fullFsync: () => 0 }))
      .toThrow("directory sync rejected");
  });

  test("does not adopt an unmarked deterministic Lima VM", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const inspector = new FakeInspector(); inspector.disk = true;
    inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] });
    const runner = new FakeRunner(); const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Existing deterministic Lima VM lacks a matching controller ownership marker" });
    const stop = operation(machine, "stop");
    expect(await provider.stop({ computer: machine, operation: stop, attempt: attempt(stop), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local VM lifecycle mutation requires a durable controller ownership manifest" });
    const deletion = operation(machine, "delete");
    expect(await provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local VM deletion requires a durable controller ownership manifest" });
    expect(runner.calls).toHaveLength(0);
  });

  test("clears the create-phase marker after a definite disk-create rejection", async () => {
    const state = root(); const machine = computer(); const inspector = new FakeInspector();
    inspector.inspection = resolved({ exists: false }); inspector.disks = [false, false];
    const runner = new FakeRunner(); runner.results.push(commandResult("", "disk create rejected", 1));
    const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "lima_disk_create_failed" });
    expect(existsSync(join(state, "computers", machine.tenantId, machine.id, "create-phase.json"))).toBe(false);
  });

  test("reconcile cleans a journal-owned disk after a crash at the disk-created before VM boundary", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const op = operation(machine);
    const crashingInspector = new FakeInspector(); crashingInspector.inspection = resolved({ exists: false }); crashingInspector.disks = [false, true];
    const crashingRunner: CommandRunner = { calls: 0, async run(this: { calls: number }, request: CommandRequest) {
      if (request.argv.at(-1) === "--version") return commandResult("limactl version 2.1.1\n");
      this.calls += 1; if (this.calls === 2) throw new Error("simulated parent crash before VM completion"); return commandResult();
    }, async runSupervised(this: { calls: number; run(request: CommandRequest): Promise<CommandResult> }, request, supervision) {
      supervision.prepare(); supervision.publish(99_999_999, 99_999_999); const result = await this.run(request); supervision.clear(); return result;
    } } as CommandRunner;
    const first = vmConfig(state, crashingInspector, crashingRunner).provider;
    await expect(first.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).rejects.toThrow("simulated parent crash");
    expect(existsSync(join(state, "computers", machine.tenantId, machine.id, "create-phase.json"))).toBe(true);

    const recoveringInspector = new FakeInspector(); recoveringInspector.inspections = [resolved({ exists: false }), resolved({ exists: false })];
    recoveringInspector.disks = [true, false]; const recoveringRunner = new FakeRunner(); const recovered = vmConfig(state, recoveringInspector, recoveringRunner).provider;
    expect(await recovered.reconcile({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "lima_create_failed" });
    expect(recoveringRunner.calls).toContainEqual(["/usr/bin/limactl", "disk", "delete", "--force", expectedDisk]);
    expect(existsSync(join(state, "computers", machine.tenantId, machine.id, "create-phase.json"))).toBe(false);
    const tombstone = JSON.parse(readFileSync(join(state, "computers", machine.tenantId, machine.id, "manifest.json"), "utf8")) as { lifecycle: string; home: { retained: boolean } };
    expect(tombstone).toMatchObject({ lifecycle: "deleted", home: { retained: false } });
    recoveringInspector.inspection = resolved({ exists: false }); recoveringInspector.disk = false; const deletion = operation(machine, "delete");
    expect((await recovered.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("success");
  });

  test("rejects retained disks with the wrong format or exact size", async () => {
    const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    for (const diskOverride of [{ format: "qcow2" }, { sizeBytes: 31 * 1024 ** 3 }, { mountPoint: "/mnt/wrong" },
      { instance: "computers-wrong-nonempty" }, { instanceDir: "/controller/wrong-nonempty" }]) {
      const inspector = new FakeInspector(); inspector.disk = true; inspector.diskOverride = diskOverride;
      inspector.inspection = resolved({ additionalDisks: [{ name: expectedDisk, format: false }] });
      const provider = vmConfig(root(), inspector, new FakeRunner()).provider; const op = operation(machine);
      expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).toMatchObject({ kind: "unknown" });
    }
  });

  test("re-inspects stopped or absent state after stop and failed-start cleanup", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const inspector = new FakeInspector(); inspector.disks = [false, true, true];
    inspector.inspections = [resolved({ exists: false }), resolved({ additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const createOp = operation(machine);
    expect((await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");
    inspector.inspection = resolved({ additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.disk = true;

    runner.results.push(commandResult()); inspector.inspections = [
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
    ]; inspector.disks = [true, true];
    const stopOp = operation(machine, "stop");
    expect(await provider.stop({ computer: machine, operation: stopOp, attempt: attempt(stopOp), execution: execution() })).toMatchObject({ kind: "unknown" });

    runner.results.push(commandResult("", "start failed", 1), commandResult());
    inspector.inspections = [resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] })];
    inspector.disks = [true, true, true];
    const startOp = operation(machine, "start");
    expect(await provider.start({ computer: machine, operation: startOp, attempt: attempt(startOp), execution: execution(), homeLease: {} as never })).toMatchObject({ kind: "unknown" });

    runner.results.push(commandResult()); inspector.inspections = [
      resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
      resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
    ]; inspector.disks = [true, true];
    const quarantineOp = operation(machine, "quarantine");
    expect(await provider.quarantine({ computer: machine, operation: quarantineOp, attempt: attempt(quarantineOp), execution: execution() })).toMatchObject({ kind: "success" });
  });

  test("nonzero mutating exits are classified only by authoritative final observation", async () => {
    const createState = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const createInspector = new FakeInspector(); createInspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    createInspector.disks = [false, true, true]; const createRunner = new FakeRunner(); createRunner.results.push(commandResult("", "disk warning", 1), commandResult());
    const createProvider = vmConfig(createState, createInspector, createRunner).provider; const createOp = operation(machine);
    expect((await createProvider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");

    const stopOp = operation(machine, "stop"); createRunner.results.push(commandResult("", "stop warning", 1));
    createInspector.inspections = [resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })]; createInspector.disk = true;
    expect((await createProvider.stop({ computer: machine, operation: stopOp, attempt: attempt(stopOp), execution: execution() })).kind).toBe("success");

    const deleteOp = operation(machine, "delete"); createRunner.results.push(commandResult("", "delete warning", 1));
    createInspector.inspections = [resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }), resolved({ exists: false }), resolved({ exists: false })];
    expect((await createProvider.delete({ computer: machine, operation: deleteOp, attempt: attempt(deleteOp), execution: execution() })).kind).toBe("success");
  });

  test("reclaimed Lima stop quarantine and delete observe first, converge, and do not duplicate restrictive mutation", async () => {
    for (const kind of ["stop", "quarantine", "delete"] as const) {
      const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
      const inspector = new FakeInspector(); inspector.disks = [false, true, true]; inspector.inspections = [
        resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
      ];
      const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider;
      const create = operation(machine); expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");
      runner.calls.length = 0; runner.requests.length = 0; runner.results.length = 0;

      const events: string[] = []; inspector.onInspect = (value) => { events.push(`observe:${value.exists ? value.status : "absent"}`); };
      runner.onRun = (request) => { events.push(`mutate:${request.argv[1] ?? "unknown"}`); };
      inspector.disk = true;
      if (kind === "delete") {
        inspector.inspection = resolved({ exists: false });
        inspector.inspections = [
          resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
          resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
          resolved({ exists: false }),
        ];
        inspector.disks = [true, true];
      } else {
        inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] });
        inspector.inspections = [
          resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
          resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
        ];
        inspector.disks = [true, true];
        runner.results.push(commandResult());
      }

      const reclaimed = operation(machine, kind);
      expect(await provider.reconcile({ computer: machine, operation: reclaimed, attempt: attempt(reclaimed), execution: execution() }))
        .toMatchObject({ kind: "success" });
      const mutation = kind === "delete" ? "delete" : "stop";
      expect(events[0]).toStartWith("observe:");
      expect(events.indexOf(`mutate:${mutation}`)).toBeGreaterThan(0);
      expect(runner.calls.filter((argv) => argv[1] === mutation)).toHaveLength(1);

      inspector.inspections = []; inspector.disks = []; events.length = 0;
      expect(await provider.reconcile({ computer: machine, operation: reclaimed, attempt: attempt(reclaimed), execution: execution() }))
        .toMatchObject({ kind: "success" });
      expect(events[0]).toStartWith("observe:");
      expect(runner.calls.filter((argv) => argv[1] === mutation)).toHaveLength(1);
      expect(runner.calls.some((argv) => ["create", "start"].includes(argv[1] ?? ""))).toBe(false);
    }
  });

  test("worker crash before Lima stop quarantine or delete invocation is reclaimed through restrictive reconciliation", async () => {
    for (const kind of ["stop", "quarantine", "delete"] as const) {
      const state = root(); const machineId = "cmp_local_one"; const machineShape = computer("local_vm", machineId);
      const expectedDisk = `home_${createHashFor(machineShape, "home")}`; const inspector = new FakeInspector();
      inspector.disks = [false, true, true]; inspector.inspections = [
        resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
      ];
      const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider;
      const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider as never, local_vm: provider, aws_ec2: provider as never };
      const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
      service.createProfile(admin, { id: "profile_strict", name: "Reclaimed Lima", document: { provider: "local_vm", cpus: 2, memoryGiB: 4,
        rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` } });
      const machine = service.createComputer(admin, { id: machineId, slug: `reclaimed-lima-${kind}`, provider: "local_vm",
        ownerPrincipalId: machineShape.ownerPrincipalId, profileId: "profile_strict", idempotencyKey: `reclaimed-lima-${kind}-create` });
      const worker = new OperationWorker(storage, ports);
      try {
        await worker.runTenant(admin.tenantId); expect(storage.getComputer(admin.tenantId, machine.id)?.status).toBe("stopped");
        if (kind === "stop") storage.updateComputerStatus(admin.tenantId, machine.id, "running");
        const lifecycle = service.requestLifecycle(admin, machine.id, kind, `reclaimed-lima-${kind}-lifecycle`);
        const abandoned = storage.claimProviderAttempt(lifecycle); expect(abandoned.mode).toBe("perform");
        storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
          .run("1970-01-01T00:00:00.000Z", admin.tenantId, abandoned.attempt.id);

        runner.calls.length = 0; runner.requests.length = 0; runner.results.length = 0; inspector.disk = true;
        if (kind === "delete") {
          inspector.inspection = resolved({ exists: false }); inspector.inspections = [
            resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
            resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }), resolved({ exists: false }),
          ]; inspector.disks = [true, true];
        } else {
          inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.inspections = [
            resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] }),
            resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }),
          ]; inspector.disks = [true, true]; runner.results.push(commandResult());
        }

        await worker.runTenant(admin.tenantId);
        expect(storage.getOperation(admin.tenantId, lifecycle.id)?.status).toBe("succeeded");
        expect(storage.getComputer(admin.tenantId, machine.id)?.status).toBe(
          kind === "stop" ? "stopped" : kind === "quarantine" ? "quarantined" : "deleted",
        );
        const mutation = kind === "delete" ? "delete" : "stop";
        expect(runner.calls.filter((argv) => argv[1] === mutation)).toHaveLength(1);
        expect(runner.calls.some((argv) => ["create", "start"].includes(argv[1] ?? ""))).toBe(false);
        await worker.runTenant(admin.tenantId);
        expect(runner.calls.filter((argv) => argv[1] === mutation)).toHaveLength(1);
      } finally { storage.close(); }
    }
  });

  test("serializes a reclaimed owner behind the persistent local resource lock and stops the stale mutation", async () => {
    const state = root(); const machine = computer(); const inspector = new FakeInspector();
    inspector.inspection = resolved({ exists: false, status: "Unknown" }); inspector.disk = false;
    let enteredResolve!: () => void; const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let finishResolve!: (result: CommandResult) => void; const finish = new Promise<CommandResult>((resolve) => { finishResolve = resolve; });
    const runner: CommandRunner & { calls: string[][] } = {
      calls: [],
      async run(request) {
        if (request.argv.at(-1) === "--version") return commandResult("limactl version 2.1.1\n");
        this.calls.push(request.argv); enteredResolve(); return finish;
      },
      async runSupervised(request, supervision) {
        supervision.prepare(); supervision.publish(99_999_999, 99_999_999); const result = await this.run(request); supervision.clear(); return result;
      },
    };
    const { provider } = vmConfig(state, inspector, runner); const op = operation(machine); let oldCurrent = true;
    const oldExecution = { ownerGeneration: 1, signal: new AbortController().signal, assertCurrent() {
      if (!oldCurrent) throw new ComputersError("conflict", "stale owner", 409);
    } };
    const oldMutation = provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: oldExecution });
    await entered;
    const reclaimed = await provider.reconcile({ computer: machine, operation: op,
      attempt: { ...attempt(op), executionOwnerGeneration: 2 }, execution: execution() });
    expect(reclaimed).toMatchObject({ kind: "unknown", message: "Local resource mutation is already supervised by another owner" });
    expect(runner.calls).toHaveLength(1);
    oldCurrent = false;
    finishResolve(commandResult());
    expect(await oldMutation).toMatchObject({ kind: "unknown", message: "Local provider execution ownership was lost during mutation" });
    expect(runner.calls).toHaveLength(1);
  });

  test("fails closed for partial and live orphan journals, then reclaims a dead process group only through reconcile", async () => {
    const state = root(); const machine = computer(); const inspector = new FakeInspector(); inspector.inspection = resolved({ exists: false }); inspector.disk = false;
    const runner = new FakeRunner(); const { provider } = vmConfig(state, inspector, runner); const op = operation(machine);
    const resourceKey = `lima:${machine.tenantId}:${machine.id}`;
    const digest = new Bun.CryptoHasher("sha256").update(resourceKey).digest("hex"); const journalDir = join(state, "command-journals"); mkdirSync(journalDir, { mode: 0o700 });
    const journal = join(journalDir, `${digest}.json`); const now = new Date().toISOString();
    const base = { version: 1, commandId: `cmd_${"a".repeat(32)}`, resourceKey, argvDigest: `sha256:${"b".repeat(64)}`, createdAt: now, updatedAt: now };
    writeFileSync(journal, `${JSON.stringify({ ...base, phase: "prepared" })}\n`, { mode: 0o600 });
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local command supervision was only partially published; manual recovery is required" });
    expect(runner.calls).toHaveLength(0); rmSync(journal);

    const child = Bun.spawn(["/usr/bin/sleep", "5"], { detached: true, stdout: "ignore", stderr: "ignore" });
    writeFileSync(journal, `${JSON.stringify({ ...base, phase: "published", pid: child.pid, pgid: child.pid })}\n`, { mode: 0o600 });
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "A detached local mutator is still running; provider state is unknown" });
    expect(runner.calls).toHaveLength(0);
    process.kill(-child.pid, "SIGKILL"); await child.exited;
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "A stale local mutator was fenced; reconciliation is required before another mutation" });
    expect(existsSync(journal)).toBe(false);
    expect((await provider.reconcile({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("definite_failure");
    expect(runner.calls).toHaveLength(0);
  });

  test("fences a detached mutator published by a parent that is then killed", async () => {
    const state = root(); const machine = computer(); const resourceKey = `lima:${machine.tenantId}:${machine.id}`;
    const digest = new Bun.CryptoHasher("sha256").update(resourceKey).digest("hex"); const journalDir = join(state, "command-journals"); mkdirSync(journalDir, { mode: 0o700 });
    const journal = join(journalDir, `${digest}.json`); const localModule = join(process.cwd(), "src", "local.ts");
    const script = `
      import { BunCommandRunner, createCommandSupervision } from ${JSON.stringify(localModule)};
      const resourceKey = ${JSON.stringify(resourceKey)};
      const supervision = createCommandSupervision(${JSON.stringify(state)}, resourceKey, ["/usr/bin/sleep", "30"]);
      await new BunCommandRunner().runSupervised({ argv: ["/usr/bin/sleep", "30"], timeoutMs: 60000, maxOutputBytes: 1024 }, supervision);
    `;
    const parent = Bun.spawn([process.execPath, "-e", script], { stdout: "ignore", stderr: "ignore" }); let pgid = 0;
    try {
      for (let index = 0; index < 200; index += 1) {
        if (existsSync(journal)) {
          try { const value = JSON.parse(readFileSync(journal, "utf8")) as { phase?: string; pgid?: number }; if (value.phase === "published" && typeof value.pgid === "number") { pgid = value.pgid; break; } } catch { /* atomic publication in progress */ }
        }
        await Bun.sleep(5);
      }
      expect(pgid).toBeGreaterThan(0); process.kill(parent.pid, "SIGKILL"); await parent.exited;
      expect(() => process.kill(-pgid, 0)).not.toThrow();
      const inspector = new FakeInspector(); inspector.inspection = resolved({ exists: false }); const runner = new FakeRunner();
      const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
      expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
        .toMatchObject({ kind: "unknown", message: "A detached local mutator is still running; provider state is unknown" });
      expect(runner.calls).toHaveLength(0);
      process.kill(-pgid, "SIGKILL");
      for (let index = 0; index < 200; index += 1) {
        try { process.kill(-pgid, 0); await Bun.sleep(5); } catch { break; }
      }
      expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
        .toMatchObject({ kind: "unknown", message: "A stale local mutator was fenced; reconciliation is required before another mutation" });
      expect(existsSync(journal)).toBe(false);
    } finally {
      try { process.kill(parent.pid, "SIGKILL"); } catch { /* exited */ }
      if (pgid > 0) try { process.kill(-pgid, "SIGKILL"); } catch { /* exited */ }
      await parent.exited;
    }
  });

  test("aborts its package supervision journal when Bun.spawn fails before publication", async () => {
    const state = root(); const machine = computer(); const inspector = new FakeInspector();
    inspector.inspection = resolved({ exists: false }); inspector.disk = false;
    const actual = new BunCommandRunner();
    const runner: CommandRunner = {
      async run(request) {
        if (request.argv.at(-1) === "--version") return commandResult("limactl version 2.1.1\n");
        return commandResult();
      },
      async runSupervised(request, supervision) {
        return actual.runSupervised({ ...request, argv: ["/definitely/missing/computers-command"] }, supervision);
      },
    };
    const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    await expect(provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).rejects.toThrow();
    const resourceKey = `lima:${machine.tenantId}:${machine.id}`;
    const digest = new Bun.CryptoHasher("sha256").update(resourceKey).digest("hex");
    expect(existsSync(join(state, "command-journals", `${digest}.json`))).toBe(false);
  });

  test("reports unsupported Linux truthfully without invoking Lima", async () => {
    const state = root(); const fake = new FakeInspector(); const runner = new FakeRunner(); const { config } = vmConfig(state, fake, runner);
    const provider = new LimaVmProvider({ stateRoot: state, platform: "linux", arch: "x64", runner, vm: config });
    const readiness = await provider.readiness(); expect(readiness.ready).toBe(false); expect(readiness.confinementClass).toBe("unverified_vm"); expect(runner.calls).toHaveLength(0);
  });

  test("readiness requires supported Lima, the VZ driver, and host virtualization support without claiming strict assurance", async () => {
    const state = root(); const inspector = new FakeInspector(); const runner = new FakeRunner();
    runner.results.push(commandResult("limactl version 2.1.1\n"), commandResult("qemu\nvz\n"), commandResult("1\n"));
    const readiness = await vmConfig(state, inspector, runner).provider.readiness();
    expect(readiness).toMatchObject({ configured: true, ready: true, confinementClass: "unverified_vm", controls: { firstBootProofPending: true } });
    expect(runner.calls).toEqual([
      ["/usr/bin/limactl", "--version"],
      ["/usr/bin/limactl", "create", "--list-drivers"],
      ["/usr/sbin/sysctl", "-n", "kern.hv_support"],
    ]);
    expect(runner.requests[0]?.env).toEqual({ LIMA_HOME: join(state, "lima"), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
    expect(runner.requests[1]?.env).toEqual({ LIMA_HOME: join(state, "lima"), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
    expect(runner.requests[2]?.env).toEqual({});

    const oldRunner = new FakeRunner(); oldRunner.results.push(commandResult("limactl version 2.1.0\n"));
    expect((await vmConfig(root(), inspector, oldRunner).provider.readiness()).ready).toBe(false);
    const futureRunner = new FakeRunner(); futureRunner.results.push(commandResult("limactl version 2.2.0\n"));
    expect((await vmConfig(root(), inspector, futureRunner).provider.readiness()).ready).toBe(false);
    const noVzRunner = new FakeRunner(); noVzRunner.results.push(commandResult("limactl version 2.1.1\n"), commandResult("qemu\n"));
    expect((await vmConfig(root(), inspector, noVzRunner).provider.readiness()).ready).toBe(false);
    const noHvRunner = new FakeRunner(); noHvRunner.results.push(commandResult("limactl version 2.1.1\n"), commandResult("vz\n"), commandResult("0\n"));
    expect((await vmConfig(root(), inspector, noHvRunner).provider.readiness()).ready).toBe(false);
  });

  test("prevalidates adoption configuration before readiness, observation, helper execution, or claim publication", async () => {
    const invalidConfigurations: Array<{ name: string; mutate(config: Record<string, unknown>): void }> = [
      { name: "host identity", mutate: (config) => { config.hostId = "HOST-invalid"; } },
      { name: "adoption identity", mutate: (config) => { config.adoptionId = "adoption-invalid"; } },
      { name: "tenant binding", mutate: (config) => { config.allowedTenantId = "tenant-invalid"; } },
      { name: "owner binding", mutate: (config) => { config.allowedOwnerPrincipalId = "principal-invalid"; } },
      { name: "profile binding", mutate: (config) => { config.profileId = "profile-invalid"; } },
      { name: "noncanonical home root", mutate: (config) => { config.homeRoot = `${String(config.homeRoot)}/.`; } },
      { name: "unsafe home root", mutate: (config) => {
        const link = `${String(config.homeRoot)}-link`; symlinkSync(String(config.homeRoot), link); config.homeRoot = link;
      } },
      { name: "escaped home path", mutate: (config) => { config.homeRelativePath = "../escape"; } },
      { name: "uid bounds", mutate: (config) => { config.expectedHomeUid = Number.MAX_SAFE_INTEGER; } },
      { name: "home ownership", mutate: (config) => { config.expectedHomeUid = process.getuid() + 1; } },
      { name: "controller observation", mutate: (config) => { config.controller = {}; } },
      { name: "controller transition", mutate: (config) => { (config.controller as Record<string, unknown>).transition = true; } },
      { name: "controller release", mutate: (config) => { (config.controller as Record<string, unknown>).release = true; } },
    ];
    for (const item of invalidConfigurations) {
      const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
      const machine = computer("local_machine", `cmp_prevalidate_${item.name.replaceAll(" ", "_")}`); const op = operation(machine);
      op.request.adoption = { adoptionId: "adoption_prevalidate" }; op.desiredComputerStatus = "running";
      let observations = 0; let releases = 0;
      const config: Record<string, unknown> = {
        adoptionId: "adoption_prevalidate", hostId: "host_prevalidate", profileId: "profile_adopted",
        allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
        homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(),
        controller: {
          observe: async () => {
            observations += 1;
            return { hostId: "host_prevalidate", bootId: "boot_prevalidate", state: "running" as const, ownership: "dedicated" as const,
              controllerExternallyProtected: true, residentHeartbeatCurrent: false };
          },
          release: async () => { releases += 1; return { released: true }; },
        },
      };
      item.mutate(config);
      const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: config as never });
      expect(await provider.readiness(), item.name).toMatchObject({ configured: true, ready: false });
      expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }), item.name)
        .toMatchObject({ kind: "definite_failure", code: "invalid_adoption_configuration" });
      expect(observations, item.name).toBe(0); expect(releases, item.name).toBe(0);
      expect(existsSync(join(state, "adopted-machine-claim.json")), item.name).toBe(false);
    }

    const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
    const helper = join(state, "adoption-helper"); writeFileSync(helper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const configPath = join(state, "local.json"); writeFileSync(configPath, `${JSON.stringify({ version: 1, stateRoot: join(state, "provider"), adoption: {
      adoptionId: "adoption_helper", hostId: "HOST-invalid", profileId: "profile_adopted", allowedTenantId: "tenant_local",
      allowedOwnerPrincipalId: "principal_cmp_local_one", homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controllerPath: helper,
    } })}\n`, { mode: 0o600 });
    const runner = new FakeRunner();
    expect(() => createLocalProviderPortsFromConfigFileForTesting(configPath, { runner })).toThrow("Invalid adoption configuration");
    expect(runner.calls).toHaveLength(0);
    expect(existsSync(join(state, "provider", "adopted-machine-claim.json"))).toBe(false);
  });

  test("invalid adoption config cannot create a lock or reclaim a dead supervision journal", async () => {
    const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_invalid_pre_guard_state"); const op = operation(machine);
    op.request.adoption = { adoptionId: "adoption_invalid_pre_guard_state" }; op.desiredComputerStatus = "running";
    const base = { adoptionId: "adoption_invalid_pre_guard_state", hostId: "host_invalid_pre_guard_state", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
      homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid() };
    const seeded = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller: {
      observe: async () => ({ hostId: base.hostId, bootId: "boot_invalid_pre_guard_seed", state: "running", ownership: "dedicated",
        controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
    } } });
    expect((await seeded.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    const claimPath = join(state, "adopted-machine-claim.json");
    const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
    const claimBefore = readFileSync(claimPath, "utf8"); const manifestBefore = readFileSync(manifestPath, "utf8");
    const lockTree = join(state, "locks"); rmSync(lockTree, { recursive: true, force: true });
    const resourceKey = "adoption:state-root"; const digest = new Bun.CryptoHasher("sha256").update(resourceKey).digest("hex");
    const journalTree = join(state, "command-journals"); mkdirSync(journalTree, { mode: 0o700 });
    const journalPath = join(journalTree, `${digest}.json`); const now = new Date().toISOString();
    const journalBefore = `${JSON.stringify({ version: 1, commandId: `cmd_${"d".repeat(32)}`, resourceKey,
      argvDigest: `sha256:${"e".repeat(64)}`, phase: "published", pid: 99_999_999, pgid: 99_999_999, createdAt: now, updatedAt: now })}\n`;
    writeFileSync(journalPath, journalBefore, { mode: 0o600 });

    let observations = 0; let transitions = 0; let releases = 0; const runner = new FakeRunner();
    const invalid = new AdoptedMachineProvider({ stateRoot: state, runner, adoption: { ...base, expectedHomeUid: process.getuid() + 1, controller: {
      observe: async () => {
        observations += 1;
        return { hostId: base.hostId, bootId: "boot_invalid_pre_guard", state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false };
      },
      transition: async () => { transitions += 1; },
      release: async () => { releases += 1; return { released: true }; },
    } } });
    expect(await invalid.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "invalid_adoption_configuration" });
    expect(existsSync(lockTree)).toBe(false);
    expect(readdirSync(journalTree)).toEqual([`${digest}.json`]); expect(readFileSync(journalPath, "utf8")).toBe(journalBefore);
    expect(observations).toBe(0); expect(transitions).toBe(0); expect(releases).toBe(0); expect(runner.calls).toHaveLength(0);
    expect(readFileSync(claimPath, "utf8")).toBe(claimBefore); expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
  });

  test("preflights invalid adoption config before every guarded provider entry point", async () => {
    const invocations: Array<{ name: string; kind: Operation["kind"]; invoke(provider: AdoptedMachineProvider, request: ProviderOperationRequest): Promise<ProviderOutcome> }> = [
      { name: "create", kind: "create", invoke: (provider, request) => provider.create(request) },
      { name: "start", kind: "start", invoke: (provider, request) => provider.start({ ...request, homeLease: {} as never }) },
      { name: "stop", kind: "stop", invoke: (provider, request) => provider.stop(request) },
      { name: "quarantine", kind: "quarantine", invoke: (provider, request) => provider.quarantine(request) },
      { name: "delete", kind: "delete", invoke: (provider, request) => provider.delete(request) },
      { name: "reconcile", kind: "create", invoke: (provider, request) => provider.reconcile(request) },
    ];
    for (const item of invocations) {
      const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
      const machine = computer("local_machine", `cmp_invalid_config_${item.name}`); const op = operation(machine, item.kind);
      op.request.adoption = { adoptionId: `adoption_invalid_config_${item.name}` };
      const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
        adoptionId: `adoption_invalid_config_${item.name}`, hostId: `host_invalid_config_${item.name}`, profileId: "profile_adopted",
        allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
        homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid() + 1,
        controller: { observe: async () => { throw new Error("invalid configuration reached observer"); } },
      } });
      const request = { computer: machine, operation: op, attempt: attempt(op), execution: execution() };
      expect(await item.invoke(provider, request), item.name)
        .toMatchObject({ kind: "definite_failure", code: "invalid_adoption_configuration" });
      expect(existsSync(join(state, "locks")), item.name).toBe(false);
      expect(existsSync(join(state, "command-journals")), item.name).toBe(false);
      expect(existsSync(join(state, "adopted-machine-claim.json")), item.name).toBe(false);
      expect(existsSync(join(state, "computers")), item.name).toBe(false);
    }
  });

  test("binds provider methods and complete request ownership before touching adopted state", async () => {
    type Invocation = { name: string; operationKind: Operation["kind"]; invoke(provider: AdoptedMachineProvider, request: ProviderOperationRequest): Promise<ProviderOutcome> };
    const methodMismatches: Invocation[] = [
      { name: "create", operationKind: "start", invoke: (provider, request) => provider.create(request) },
      { name: "start", operationKind: "stop", invoke: (provider, request) => provider.start({ ...request, homeLease: {} as never }) },
      { name: "stop", operationKind: "start", invoke: (provider, request) => provider.stop(request) },
      { name: "quarantine", operationKind: "stop", invoke: (provider, request) => provider.quarantine(request) },
      { name: "delete", operationKind: "quarantine", invoke: (provider, request) => provider.delete(request) },
      { name: "reconcile unsupported", operationKind: "exec", invoke: (provider, request) => provider.reconcile(request) },
    ];
    const bindingMutations: Array<{ name: string; mutate(request: ProviderCreateRequest): void }> = [
      { name: "operation id", mutate: (request) => { request.operation.id = "OP-invalid"; } },
      { name: "attempt id", mutate: (request) => { request.attempt.id = "PAT-invalid"; } },
      { name: "attempt tenant", mutate: (request) => { request.attempt.tenantId = "tenant_other"; } },
      { name: "attempt operation", mutate: (request) => { request.attempt.operationId = "opn_other"; } },
      { name: "attempt fence", mutate: (request) => { request.attempt.fence += 1; } },
      { name: "operation policy generation", mutate: (request) => { request.operation.policyGeneration += 1; } },
      { name: "operation fence", mutate: (request) => { request.operation.fence = -1; request.attempt.fence = -1; } },
      { name: "attempt execution generation", mutate: (request) => { request.attempt.executionOwnerGeneration = 0; request.execution.ownerGeneration = 0; } },
      { name: "execution generation", mutate: (request) => { request.execution.ownerGeneration += 1; } },
      { name: "explicit provider", mutate: (request) => { request.operation.request.provider = "local_vm"; } },
    ];
    const runCase = async (name: string, operationKind: Operation["kind"],
      invoke: Invocation["invoke"], mutate?: (request: ProviderCreateRequest) => void): Promise<void> => {
      const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
      const suffix = name.replaceAll(" ", "_"); const machine = computer("local_machine", `cmp_binding_${suffix}`); const op = operation(machine, operationKind);
      op.request.adoption = { adoptionId: `adoption_binding_${suffix}` }; let observations = 0; let transitions = 0; let releases = 0;
      const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
        adoptionId: `adoption_binding_${suffix}`, hostId: `host_binding_${suffix}`, profileId: "profile_adopted",
        allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
        homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
          observe: async () => { observations += 1; return { hostId: `host_binding_${suffix}`, bootId: `boot_binding_${suffix}`,
            state: "running", ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
          transition: async () => { transitions += 1; }, release: async () => { releases += 1; return { released: true }; },
        },
      } });
      const request: ProviderOperationRequest = { computer: machine, operation: op, attempt: attempt(op), execution: execution() };
      mutate?.(request);
      expect(await invoke(provider, request), name).toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
      expect(observations, name).toBe(0); expect(transitions, name).toBe(0); expect(releases, name).toBe(0);
      expect(existsSync(join(state, "locks")), name).toBe(false); expect(existsSync(join(state, "adopted-machine-claim.json")), name).toBe(false);
      expect(existsSync(join(state, "computers")), name).toBe(false);
    };
    for (const item of methodMismatches) await runCase(`method ${item.name}`, item.operationKind, item.invoke);
    for (const item of bindingMutations) await runCase(item.name, "create", (provider, request) => provider.create(request), item.mutate);

    const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_binding_omitted_provider"); const op = operation(machine); delete op.request.provider;
    op.request.adoption = { adoptionId: "adoption_binding_omitted_provider" };
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_binding_omitted_provider", hostId: "host_binding_omitted_provider", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
      homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => ({ hostId: "host_binding_omitted_provider", bootId: "boot_binding_omitted_provider", state: "running",
          ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
      },
    } });
    expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
  });

  test("prevalidates adopted Computer confinement and complete request bindings before claim publication", async () => {
    const cases: Array<{ name: string; mutate(machine: Computer, op: Operation): void }> = [
      { name: "provider", mutate: (machine, op) => { machine.provider = "local_vm"; op.request.provider = "local_vm"; } },
      { name: "confinement", mutate: (machine) => { machine.confinementClass = "unverified_vm"; } },
      { name: "computer identity", mutate: (machine) => { machine.id = "CMP-invalid"; } },
      { name: "operation tenant", mutate: (_machine, op) => { op.tenantId = "tenant_other"; } },
      { name: "operation computer", mutate: (_machine, op) => { op.computerId = "cmp_other"; } },
      { name: "profile generation", mutate: (_machine, op) => { (op.request.profile as { generation: number }).generation = 2; } },
      { name: "profile digest", mutate: (_machine, op) => { (op.request.profile as { digest: string }).digest = `sha256:${"f".repeat(64)}`; } },
    ];
    for (const item of cases) {
      const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
      const machine = computer("local_machine", `cmp_binding_${item.name.replaceAll(" ", "_")}`); const op = operation(machine);
      op.request.adoption = { adoptionId: "adoption_binding" }; op.desiredComputerStatus = "running"; item.mutate(machine, op);
      let observations = 0;
      const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
        adoptionId: "adoption_binding", hostId: "host_binding", profileId: "profile_adopted",
        allowedTenantId: "tenant_local", allowedOwnerPrincipalId: `principal_cmp_binding_${item.name.replaceAll(" ", "_")}`,
        homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
          observe: async () => {
            observations += 1;
            return { hostId: "host_binding", bootId: "boot_binding", state: "running", ownership: "dedicated",
              controllerExternallyProtected: true, residentHeartbeatCurrent: false };
          },
        },
      } });
      expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }), item.name)
        .toMatchObject({ kind: "definite_failure" });
      expect(observations, item.name).toBe(0);
      expect(existsSync(join(state, "adopted-machine-claim.json")), item.name).toBe(false);
    }
  });

  test("invalid adoption restart leaves the exact durable claim and manifest unchanged without release", async () => {
    const state = root(); const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adoption_prevalidation_restart"); const op = operation(machine);
    op.request.adoption = { adoptionId: "adoption_prevalidation_restart" }; op.desiredComputerStatus = "running";
    const base = { adoptionId: "adoption_prevalidation_restart", hostId: "host_prevalidation_restart", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
      homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid() };
    const valid = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller: {
      observe: async () => ({ hostId: base.hostId, bootId: "boot_prevalidation_restart", state: "running", ownership: "dedicated",
        controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
    } } });
    expect(await valid.readiness()).toMatchObject({ configured: true, ready: true });
    expect((await valid.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    const claimPath = join(state, "adopted-machine-claim.json"); const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
    const claimBefore = readFileSync(claimPath, "utf8"); const manifestBefore = readFileSync(manifestPath, "utf8");

    let observations = 0; let releases = 0;
    const invalid = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, expectedHomeUid: process.getuid() + 1, controller: {
      observe: async () => {
        observations += 1;
        return { hostId: base.hostId, bootId: "boot_invalid_restart", state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false };
      },
      release: async () => { releases += 1; return { released: true }; },
    } } });
    expect(await invalid.readiness()).toMatchObject({ configured: true, ready: false });
    expect(await invalid.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "invalid_adoption_configuration" });
    const deletion = operation(machine, "delete");
    expect(await invalid.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "invalid_adoption_configuration" });
    expect(observations).toBe(0); expect(releases).toBe(0);
    expect(readFileSync(claimPath, "utf8")).toBe(claimBefore); expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
  });

  test("adoption is admin-only, observer-derived, running, and shared-OS resident dependent", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); const home = join(homeRoot, "home"); mkdirSync(home, { recursive: true, mode: 0o700 });
    let observed = { hostId: "host_one", bootId: "boot_one", state: "running" as const, ownership: "dedicated" as const, controllerExternallyProtected: true, residentHeartbeatCurrent: true };
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: { adoptionId: "adoption_one", hostId: "host_one", profileId: "profile_adopted",
      allowedTenantId: "tenant_local", allowedOwnerPrincipalId: "principal_owner", homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: { observe: async () => observed } } });
    const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider, local_vm: provider as never, aws_ec2: provider as never }; const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      expect(() => service.adoptComputer({ ...admin, scopes: ["computers:read"] }, { slug: "adopted", ownerPrincipalId: "principal_owner", adoptionId: "adoption_one", idempotencyKey: "adopt-machine-001" })).toThrow("Authorization denied");
      const adopted = service.adoptComputer(admin, { slug: "adopted", ownerPrincipalId: "principal_owner", adoptionId: "adoption_one", idempotencyKey: "adopt-machine-001" });
      await new OperationWorker(storage, ports).runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, adopted.id)?.status).toBe("running");
      expect(storage.getProviderAssurance(admin.tenantId, adopted.id)).toMatchObject({ confinementClass: "dedicated_machine", residentIndependentIsolation: false });
      expect(storage.getResidentBinding(admin.tenantId, adopted.id)?.bootId).toBe("boot_one");
      observed = { ...observed, ownership: "shared" as const };
      expect((await provider.reconcile({ computer: adopted, operation: operation(adopted), attempt: attempt(operation(adopted)), execution: execution() })))
        .toMatchObject({ kind: "unknown", message: "Authoritative adoption rejection left the established claim held for reconciliation" });
      const second = { ...computer("local_machine", "cmp_claim_blocked"), ownerPrincipalId: adopted.ownerPrincipalId };
      const secondOperation = operation(second);
      expect((await provider.create({ computer: second, operation: secondOperation, attempt: attempt(secondOperation), execution: execution() })).kind).toBe("unknown");
    } finally { storage.close(); }
  });

  test("rejects adopted host and profile drift before observing or returning a stale manifest", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adopt_drift"); const original = operation(machine);
    original.request.adoption = { adoptionId: "adoption_drift" }; original.desiredComputerStatus = "running";
    const first = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_drift", hostId: "host_a", profileId: "profile_adopted", allowedTenantId: machine.tenantId,
      allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => ({ hostId: "host_a", bootId: "boot_a", state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
      },
    } });
    expect(await first.create({ computer: machine, operation: original, attempt: attempt(original), execution: execution() }))
      .toMatchObject({ kind: "success", resource: { resourceId: "machine:host_a", instanceId: "host_a", bootId: "boot_a" } });
    const claimPath = join(state, "adopted-machine-claim.json");
    const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
    const claimBefore = readFileSync(claimPath, "utf8"); const manifestBefore = readFileSync(manifestPath, "utf8");

    let driftedObservations = 0; const drifted = structuredClone(original);
    drifted.request.profileId = "profile_default"; (drifted.request.profile as { id: string }).id = "profile_default";
    const reopened = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_drift", hostId: "host_b", profileId: "profile_default", allowedTenantId: machine.tenantId,
      allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => { driftedObservations += 1; return { hostId: "host_b", bootId: "boot_b", state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
      },
    } });
    expect(await reopened.create({ computer: machine, operation: drifted, attempt: attempt(drifted), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
    expect(driftedObservations).toBe(0);
    expect(readFileSync(claimPath, "utf8")).toBe(claimBefore); expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
  });

  test("serializes old and drifted adopted configurations on one state-root physical lock", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adopt_serialized"); const op = operation(machine);
    op.request.adoption = { adoptionId: "adoption_serialized" }; op.desiredComputerStatus = "running";
    let block = false; let enteredResolve!: () => void; const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let releaseResolve!: () => void; const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const oldProvider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_serialized", hostId: "host_old", profileId: "profile_adopted", allowedTenantId: machine.tenantId,
      allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => {
          if (block) { enteredResolve(); await release; }
          return { hostId: "host_old", bootId: "boot_old", state: "running", ownership: "dedicated",
            controllerExternallyProtected: true, residentHeartbeatCurrent: false };
        },
      },
    } });
    expect((await oldProvider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    block = true; const inFlight = oldProvider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }); await entered;

    let newObservations = 0; const drifted = structuredClone(op);
    drifted.request.profileId = "profile_default"; (drifted.request.profile as { id: string }).id = "profile_default";
    const newProvider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_serialized", hostId: "host_new", profileId: "profile_default", allowedTenantId: machine.tenantId,
      allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => { newObservations += 1; return { hostId: "host_new", bootId: "boot_new", state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
      },
    } });
    expect(await newProvider.create({ computer: machine, operation: drifted, attempt: attempt(drifted), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local resource mutation is already supervised by another owner" });
    expect(newObservations).toBe(0); releaseResolve(); expect((await inFlight).kind).toBe("success");
  });

  test("binds adopted claim and manifest identity across profile adoption tenant owner and Computer drift", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adopt_identity"); const original = operation(machine);
    original.request.adoption = { adoptionId: "adoption_identity" }; original.desiredComputerStatus = "running";
    const base = { adoptionId: "adoption_identity", hostId: "host_identity", profileId: "profile_adopted", allowedTenantId: machine.tenantId,
      allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid() };
    const first = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller: {
      observe: async () => ({ hostId: base.hostId, bootId: "boot_identity", state: "running", ownership: "dedicated",
        controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
    } } });
    expect((await first.create({ computer: machine, operation: original, attempt: attempt(original), execution: execution() })).kind).toBe("success");
    const claimPath = join(state, "adopted-machine-claim.json"); const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
    const claimBefore = readFileSync(claimPath, "utf8"); const manifestBefore = readFileSync(manifestPath, "utf8");

    const cases: Array<{ name: string; config: typeof base; machine: Computer; op: Operation; expected: Partial<ProviderOutcome>; throws?: boolean }> = [];
    const profileId = structuredClone(original); profileId.request.profileId = "profile_default"; (profileId.request.profile as { id: string }).id = "profile_default";
    cases.push({ name: "profile id", config: { ...base, profileId: "profile_default" }, machine, op: profileId,
      expected: { kind: "definite_failure", code: "profile_mismatch" } });
    const profileDigest = structuredClone(original); (profileDigest.request.profile as { digest: string }).digest = `sha256:${"f".repeat(64)}`;
    cases.push({ name: "profile digest", config: base, machine, op: profileDigest, expected: { kind: "definite_failure", code: "profile_mismatch" } });
    const adoption = structuredClone(original); adoption.request.adoption = { adoptionId: "adoption_other" };
    cases.push({ name: "adoption", config: { ...base, adoptionId: "adoption_other" }, machine, op: adoption,
      expected: { kind: "definite_failure", code: "adoption_mismatch" } });
    const otherTenant = { ...machine, tenantId: "tenant_other" }; const tenantOp = operation(otherTenant); tenantOp.request.adoption = { adoptionId: base.adoptionId };
    cases.push({ name: "tenant", config: { ...base, allowedTenantId: otherTenant.tenantId }, machine: otherTenant, op: tenantOp,
      expected: { kind: "definite_failure", code: "adoption_mismatch" } });
    const otherComputer = { ...machine, id: "cmp_adopt_identity_other", slug: "adopt-identity-other" }; const computerOp = operation(otherComputer);
    computerOp.request.adoption = { adoptionId: base.adoptionId };
    cases.push({ name: "Computer", config: base, machine: otherComputer, op: computerOp,
      expected: { kind: "unknown", message: "This physical host is already claimed by another Computer" } });
    const otherOwner = { ...machine, ownerPrincipalId: "principal_identity_other" }; const ownerOp = operation(otherOwner);
    ownerOp.request.adoption = { adoptionId: base.adoptionId };
    cases.push({ name: "owner", config: { ...base, allowedOwnerPrincipalId: otherOwner.ownerPrincipalId }, machine: otherOwner, op: ownerOp,
      expected: {}, throws: true });

    for (const item of cases) {
      let observations = 0; const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...item.config, controller: {
        observe: async () => { observations += 1; return { hostId: item.config.hostId, bootId: `boot_${item.name}`, state: "running", ownership: "dedicated",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
      } } });
      const call = provider.create({ computer: item.machine, operation: item.op, attempt: attempt(item.op), execution: execution() });
      if (item.throws) await expect(call).rejects.toMatchObject({ code: "storage_error" });
      else expect(await call).toMatchObject(item.expected);
      expect(observations).toBe(0); expect(readFileSync(claimPath, "utf8")).toBe(claimBefore); expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
    }
  });

  test("fails closed on legacy or corrupt adopted claim and manifest identity fields", async () => {
    for (const corruption of ["legacy-claim", "extra-claim-field", "missing-manifest-host"] as const) {
      const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
      const machine = computer("local_machine", `cmp_${corruption.replaceAll("-", "_")}`); const op = operation(machine);
      op.request.adoption = { adoptionId: `adoption_${corruption.replaceAll("-", "_")}` }; op.desiredComputerStatus = "running";
      let observations = 0; const config = { adoptionId: (op.request.adoption as { adoptionId: string }).adoptionId, hostId: `host_${corruption.replaceAll("-", "_")}`,
        profileId: "profile_adopted", allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
        homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
          observe: async () => { observations += 1; return { hostId: `host_${corruption.replaceAll("-", "_")}`, bootId: "boot_corrupt", state: "running" as const,
            ownership: "dedicated" as const, controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
        } };
      const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: config });
      expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
      const claimPath = join(state, "adopted-machine-claim.json"); const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
      if (corruption === "missing-manifest-host") {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { adoption: Record<string, unknown> }; delete manifest.adoption.hostId;
        writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      } else {
        const claim = JSON.parse(readFileSync(claimPath, "utf8")) as Record<string, unknown>;
        if (corruption === "legacy-claim") {
          claim.version = 1; delete claim.profileId; delete claim.profileGeneration; delete claim.profileRevisionDigest; delete claim.resolvedProfileDigest; delete claim.manifestRequired;
        } else claim.untrusted = true;
        writeFileSync(claimPath, `${JSON.stringify(claim)}\n`);
      }
      observations = 0;
      await expect(provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
        .rejects.toMatchObject({ code: "storage_error" });
      expect(observations).toBe(0);
    }
  });

  test("reopens an exact adopted configuration and re-adopts only an exactly matching released physical claim", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const firstMachine = computer("local_machine", "cmp_adopt_reopen_first"); const firstOp = operation(firstMachine);
    firstOp.request.adoption = { adoptionId: "adoption_reopen" }; firstOp.desiredComputerStatus = "running";
    let observedState: "running" | "stopped" = "running"; let releases = 0;
    const base = { adoptionId: "adoption_reopen", hostId: "host_reopen", profileId: "profile_adopted", allowedTenantId: firstMachine.tenantId,
      allowedOwnerPrincipalId: firstMachine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid() };
    const controller = { observe: async () => ({ hostId: base.hostId, bootId: `boot_${observedState}`, state: observedState, ownership: "dedicated" as const,
      controllerExternallyProtected: true, residentHeartbeatCurrent: false }), release: async () => { releases += 1; return { released: true }; } };
    const first = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller } });
    expect((await first.create({ computer: firstMachine, operation: firstOp, attempt: attempt(firstOp), execution: execution() })).kind).toBe("success");
    const reopened = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller } });
    expect((await reopened.create({ computer: firstMachine, operation: firstOp, attempt: attempt(firstOp), execution: execution() })).kind).toBe("success");
    observedState = "stopped"; const deletion = operation(firstMachine, "delete");
    expect((await reopened.delete({ computer: firstMachine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("success");
    expect(releases).toBe(1);

    const secondMachine = { ...firstMachine, id: "cmp_adopt_reopen_second", slug: "adopt-reopen-second" }; const secondOp = operation(secondMachine);
    secondOp.request.adoption = { adoptionId: base.adoptionId }; secondOp.desiredComputerStatus = "running"; observedState = "running";
    const releasedManifestPath = join(state, "computers", firstMachine.tenantId, firstMachine.id, "manifest.json");
    const releasedManifest = readFileSync(releasedManifestPath, "utf8"); rmSync(releasedManifestPath);
    expect(await reopened.create({ computer: secondMachine, operation: secondOp, attempt: attempt(secondOp), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Released adopted-machine claim requires its exact durable manifest before re-adoption" });
    writeFileSync(releasedManifestPath, releasedManifest, { mode: 0o600 });
    let driftedObservations = 0; const drifted = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, hostId: "host_reopen_drift", controller: {
      observe: async () => { driftedObservations += 1; return { hostId: "host_reopen_drift", bootId: "boot_drift", state: "running", ownership: "dedicated",
        controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
    } } });
    expect(await drifted.create({ computer: secondMachine, operation: secondOp, attempt: attempt(secondOp), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
    expect(driftedObservations).toBe(0);
    const exact = new AdoptedMachineProvider({ stateRoot: state, adoption: { ...base, controller } });
    expect((await exact.create({ computer: secondMachine, operation: secondOp, attempt: attempt(secondOp), execution: execution() })).kind).toBe("success");
    expect(JSON.parse(readFileSync(join(state, "adopted-machine-claim.json"), "utf8"))).toMatchObject({ version: 2, state: "active",
      adoptionId: base.adoptionId, hostId: base.hostId, tenantId: secondMachine.tenantId, computerId: secondMachine.id,
      ownerPrincipalId: secondMachine.ownerPrincipalId, profileId: "profile_adopted", profileGeneration: 1, manifestRequired: true, claimGeneration: 2 });
  });

  test("rebinds the validated built-in adoption profile through service worker lifecycle and releases the claim", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    let observedState: "running" | "stopped" | "quarantined" = "running";
    const transitions: string[] = []; let releases = 0;
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_lifecycle", hostId: "host_lifecycle", profileId: "profile_adopted",
      allowedTenantId: admin.tenantId, allowedOwnerPrincipalId: "principal_lifecycle", homeRoot, homeRelativePath: "home",
      expectedHomeUid: process.getuid(), controller: {
        observe: async () => ({ hostId: "host_lifecycle", bootId: `boot_${observedState}`, state: observedState,
          ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
        transition: async (desired) => { transitions.push(desired); observedState = desired; },
        release: async () => { releases += 1; return { released: true }; },
      },
    } });
    const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider, local_vm: provider as never, aws_ec2: provider as never };
    const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const worker = new OperationWorker(storage, ports);
    try {
      const adopted = service.adoptComputer(admin, { id: "cmp_adopt_lifecycle", slug: "adopt-lifecycle", ownerPrincipalId: "principal_lifecycle",
        adoptionId: "adoption_lifecycle", idempotencyKey: "adopt-lifecycle-create" });
      await worker.runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, adopted.id)?.status).toBe("running");

      for (const [kind, expected] of [["stop", "stopped"], ["start", "running"], ["quarantine", "quarantined"]] as const) {
        if (kind === "start") storage.acquireHomeLease(admin.tenantId, adopted.id, adopted.ownerPrincipalId, "adoption-lifecycle-test", 60, 0);
        const lifecycle = service.requestLifecycle(admin, adopted.id, kind, `adopt-lifecycle-${kind}`);
        await worker.runTenant(admin.tenantId);
        const completed = storage.getOperation(admin.tenantId, lifecycle.id);
        if (completed === undefined) throw new Error(`Missing adopted ${kind} operation`);
        expect(completed.status).toBe("succeeded"); expect(Object.hasOwn(completed, "errorCode")).toBe(false);
        expect(storage.getComputer(admin.tenantId, adopted.id)?.status).toBe(expected);
      }

      const deletion = service.requestLifecycle(admin, adopted.id, "delete", "adopt-lifecycle-delete");
      await worker.runTenant(admin.tenantId);
      const completedDeletion = storage.getOperation(admin.tenantId, deletion.id);
      if (completedDeletion === undefined) throw new Error("Missing adopted delete operation");
      expect(completedDeletion.status).toBe("succeeded"); expect(Object.hasOwn(completedDeletion, "errorCode")).toBe(false);
      expect(storage.getComputer(admin.tenantId, adopted.id)?.status).toBe("deleted");
      expect(storage.getProviderBinding(admin.tenantId, adopted.id)?.state).toBe("released");
      expect(JSON.parse(readFileSync(join(state, "adopted-machine-claim.json"), "utf8"))).toMatchObject({ state: "released", computerId: adopted.id });
      expect(transitions).toEqual(["stopped", "running", "quarantined"]); expect(releases).toBe(1);
    } finally { storage.close(); }
  });

  test("reclaimed adopted quarantine observes before transition and does not weaken or duplicate a restrictive state", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adopt_reclaimed_quarantine"); let observedState: "running" | "stopped" | "quarantined" = "running";
    const events: string[] = []; const transitions: string[] = [];
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_reclaimed_quarantine", hostId: "host_reclaimed_quarantine", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(),
      controller: {
        observe: async () => { events.push(`observe:${observedState}`); return { hostId: "host_reclaimed_quarantine", bootId: `boot_${observedState}`,
          state: observedState, ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
        transition: async (desired) => { events.push(`transition:${desired}`); transitions.push(desired); observedState = desired; },
      },
    } });
    const create = operation(machine); create.request.adoption = { adoptionId: "adoption_reclaimed_quarantine" }; create.desiredComputerStatus = "running";
    expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");
    events.length = 0;

    const quarantine = operation(machine, "quarantine");
    expect(await provider.reconcile({ computer: machine, operation: quarantine, attempt: attempt(quarantine), execution: execution() }))
      .toMatchObject({ kind: "success" });
    expect(events).toEqual(["observe:running", "transition:quarantined", "observe:quarantined"]);
    expect(transitions).toEqual(["quarantined"]);
    events.length = 0;
    expect(await provider.reconcile({ computer: machine, operation: quarantine, attempt: attempt(quarantine), execution: execution() }))
      .toMatchObject({ kind: "success" });
    expect(events).toEqual(["observe:quarantined"]); expect(transitions).toEqual(["quarantined"]);

    const stop = operation(machine, "stop"); events.length = 0;
    expect(await provider.reconcile({ computer: machine, operation: stop, attempt: attempt(stop), execution: execution() }))
      .toMatchObject({ kind: "success", result: { lifecycle: "quarantined" } });
    expect(events).toEqual(["observe:quarantined"]); expect(transitions).toEqual(["quarantined"]);
  });

  test("service worker reclaimed adopted stop preserves an authoritative quarantined lifecycle without transition", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    let observedState: "running" | "quarantined" = "running"; const transitions: string[] = []; const observations: string[] = [];
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_reclaimed_stop", hostId: "host_reclaimed_stop", profileId: "profile_adopted",
      allowedTenantId: admin.tenantId, allowedOwnerPrincipalId: "principal_reclaimed_stop", homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(),
      controller: {
        observe: async () => { observations.push(observedState); return { hostId: "host_reclaimed_stop", bootId: `boot_${observedState}`,
          state: observedState, ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
        transition: async (desired) => { transitions.push(desired); observedState = desired as "quarantined"; },
      },
    } });
    const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider, local_vm: provider as never, aws_ec2: provider as never };
    const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const worker = new OperationWorker(storage, ports);
    try {
      const machine = service.adoptComputer(admin, { id: "cmp_worker_reclaimed_stop", slug: "worker-reclaimed-stop",
        ownerPrincipalId: "principal_reclaimed_stop", adoptionId: "adoption_reclaimed_stop", idempotencyKey: "worker-reclaimed-stop-create" });
      await worker.runTenant(admin.tenantId); expect(storage.getComputer(admin.tenantId, machine.id)?.status).toBe("running");
      observations.length = 0;
      const stop = service.requestLifecycle(admin, machine.id, "stop", "worker-reclaimed-stop-lifecycle");
      const abandoned = storage.claimProviderAttempt(stop); expect(abandoned.mode).toBe("perform");
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, abandoned.attempt.id);
      observedState = "quarantined";

      await worker.runTenant(admin.tenantId);
      expect(observations).toEqual(["quarantined"]); expect(transitions).toEqual([]);
      expect(storage.getOperation(admin.tenantId, stop.id)).toMatchObject({ status: "succeeded", result: { lifecycle: "quarantined" } });
      expect(storage.getComputer(admin.tenantId, machine.id)?.status).toBe("quarantined");
      await worker.runTenant(admin.tenantId);
      expect(observations).toEqual(["quarantined"]); expect(transitions).toEqual([]);
    } finally { storage.close(); }
  });

  test("reclaimed adopted delete observes the exact active claim before one idempotent release", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine", "cmp_adopt_reclaimed_delete"); let observedState: "running" | "stopped" = "running";
    const events: string[] = []; const releases: AdoptionClaimContext[] = [];
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_reclaimed_delete", hostId: "host_reclaimed_delete", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(),
      controller: {
        observe: async (claim) => { events.push(`observe:${claim.claimGeneration}:${observedState}`); return { hostId: "host_reclaimed_delete", bootId: `boot_${observedState}`,
          state: observedState, ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
        release: async (claim) => { events.push(`release:${claim.claimGeneration}`); releases.push({ ...claim }); return { released: true }; },
      },
    } });
    const create = operation(machine); create.request.adoption = { adoptionId: "adoption_reclaimed_delete" }; create.desiredComputerStatus = "running";
    expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");
    observedState = "stopped"; events.length = 0;

    const deletion = operation(machine, "delete");
    expect(await provider.reconcile({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() }))
      .toMatchObject({ kind: "success" });
    expect(events).toEqual(["observe:1:stopped", "release:1"]);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ adoptionId: "adoption_reclaimed_delete", tenantId: machine.tenantId, computerId: machine.id,
      ownerPrincipalId: machine.ownerPrincipalId, claimGeneration: 1 });
    expect(releases[0]?.claimFence).toMatch(/^fence_[a-f0-9]{32}$/);
    events.length = 0;
    expect(await provider.reconcile({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() }))
      .toMatchObject({ kind: "success" });
    expect(events).toEqual([]); expect(releases).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(state, "adopted-machine-claim.json"), "utf8")).state).toBe("released");
  });

  test("worker crash before adopted quarantine and delete invocation reclaims only the fenced restrictive actions", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    let observedState: "running" | "quarantined" = "running"; const transitions: string[] = []; const releases: AdoptionClaimContext[] = [];
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
      adoptionId: "adoption_worker_reclaimed", hostId: "host_worker_reclaimed", profileId: "profile_adopted", allowedTenantId: admin.tenantId,
      allowedOwnerPrincipalId: "principal_worker_reclaimed", homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => ({ hostId: "host_worker_reclaimed", bootId: `boot_${observedState}`, state: observedState,
          ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
        transition: async (desired) => { transitions.push(desired); observedState = desired as "quarantined"; },
        release: async (claim) => { releases.push({ ...claim }); return { released: true }; },
      },
    } });
    const storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider, local_vm: provider as never, aws_ec2: provider as never };
    const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const worker = new OperationWorker(storage, ports);
    try {
      const machine = service.adoptComputer(admin, { id: "cmp_worker_reclaimed", slug: "worker-reclaimed", ownerPrincipalId: "principal_worker_reclaimed",
        adoptionId: "adoption_worker_reclaimed", idempotencyKey: "worker-reclaimed-create" });
      await worker.runTenant(admin.tenantId); expect(storage.getComputer(admin.tenantId, machine.id)?.status).toBe("running");

      const quarantine = service.requestLifecycle(admin, machine.id, "quarantine", "worker-reclaimed-quarantine");
      const abandonedQuarantine = storage.claimProviderAttempt(quarantine); expect(abandonedQuarantine.mode).toBe("perform");
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, abandonedQuarantine.attempt.id);
      await worker.runTenant(admin.tenantId);
      expect(storage.getOperation(admin.tenantId, quarantine.id)?.status).toBe("succeeded"); expect(transitions).toEqual(["quarantined"]);

      const deletion = service.requestLifecycle(admin, machine.id, "delete", "worker-reclaimed-delete");
      const abandonedDelete = storage.claimProviderAttempt(deletion); expect(abandonedDelete.mode).toBe("perform");
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, abandonedDelete.attempt.id);
      await worker.runTenant(admin.tenantId);
      expect(storage.getOperation(admin.tenantId, deletion.id)?.status).toBe("succeeded"); expect(releases).toHaveLength(1);
      expect(releases[0]).toMatchObject({ adoptionId: "adoption_worker_reclaimed", computerId: machine.id, claimGeneration: 1 });
      await worker.runTenant(admin.tenantId); expect(transitions).toEqual(["quarantined"]); expect(releases).toHaveLength(1);
    } finally { storage.close(); }
  });

  test("unknown adopted state remains unknown and metadata cannot fake lifecycle", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const machine = computer("local_machine"); const op = operation(machine); const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: { adoptionId: "adoption_one", hostId: "host_one", profileId: "profile_adopted",
      allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: { observe: async () => ({ hostId: "host_one", bootId: "boot_one", state: "unknown", ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }) } } });
    const tampered = structuredClone(op); (tampered.request.profile as { document: { cpus: number }; digest: string }).document.cpus = 99;
    (tampered.request.profile as { document: object; digest: string }).digest = sha256((tampered.request.profile as { document: object }).document);
    expect(await provider.create({ computer: machine, operation: tampered, attempt: attempt(tampered), execution: execution() })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("unknown");
    expect((await provider.start({ computer: machine, operation: { ...op, kind: "start" }, attempt: attempt(op), execution: execution(), homeLease: {} as never })).kind).toBe("unknown");
  });

  test("CAS-releases a definitely rejected adoption claim so it cannot leak", async () => {
    const state = root(); const homeRoot = join(state, "inventory"); mkdirSync(join(homeRoot, "home"), { recursive: true, mode: 0o700 });
    const first = computer("local_machine", "cmp_rejected_one"); let dedicated = false;
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: { adoptionId: "adoption_one", hostId: "host_one", profileId: "profile_adopted",
      allowedTenantId: first.tenantId, allowedOwnerPrincipalId: first.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: {
        observe: async () => ({ hostId: "host_one", bootId: "boot_one", state: "running", ownership: dedicated ? "dedicated" : "shared",
          controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
      } } });
    const firstOp = operation(first); expect(await provider.create({ computer: first, operation: firstOp, attempt: attempt(firstOp), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "adoption_unproven" });
    dedicated = true; const second = { ...computer("local_machine", "cmp_rejected_two"), ownerPrincipalId: first.ownerPrincipalId }; const secondOp = operation(second);
    expect((await provider.create({ computer: second, operation: secondOp, attempt: attempt(secondOp), execution: execution() })).kind).toBe("success");
  });

  test("adoption inventory binds tenant and owner and release is crash-recoverable before re-adoption", async () => {
    const state = root(); const homeRoot = root(); mkdirSync(join(homeRoot, "home"), { mode: 0o700 });
    const first = computer("local_machine", "cmp_adopt_first"); first.ownerPrincipalId = "principal_adopt_owner";
    let releases = 0; const releaseClaims: Array<{ claimGeneration: number; claimFence: string; computerId: string }> = [];
    let observedState: "running" | "stopped" = "running";
    const controller = {
      observe: async () => ({ hostId: "host_reusable", bootId: "boot_reusable", state: observedState, ownership: "dedicated" as const,
        controllerExternallyProtected: true, residentHeartbeatCurrent: false }),
      release: async (claim: { claimGeneration: number; claimFence: string; computerId: string }): Promise<{ released: boolean }> => {
        releaseClaims.push(claim); releases += 1; if (releases === 1) throw new Error("crash after external release"); return { released: true };
      },
    };
    const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: { adoptionId: "adoption_reusable", hostId: "host_reusable", profileId: "profile_adopted",
      allowedTenantId: first.tenantId, allowedOwnerPrincipalId: first.ownerPrincipalId, homeRoot, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller } });
    const crossTenant = { ...first, id: "cmp_cross_tenant", tenantId: "tenant_other" };
    const crossOperation = operation(crossTenant); crossOperation.request.adoption = { adoptionId: "adoption_reusable" };
    expect(await provider.create({ computer: crossTenant, operation: crossOperation, attempt: attempt(crossOperation), execution: execution() })).toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
    const create = operation(first); create.request.adoption = { adoptionId: "adoption_reusable" }; create.desiredComputerStatus = "running";
    expect((await provider.create({ computer: first, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");
    observedState = "stopped";
    const deleting = operation(first, "delete");
    expect((await provider.delete({ computer: first, operation: deleting, attempt: attempt(deleting), execution: execution() })).kind).toBe("unknown");
    expect((await provider.reconcile({ computer: first, operation: deleting, attempt: attempt(deleting), execution: execution() }))).toMatchObject({ kind: "success" });
    expect(releases).toBe(2);
    observedState = "running";
    const second = { ...first, id: "cmp_adopt_second", slug: "adopt-second" };
    const secondCreate = operation(second); secondCreate.request.adoption = { adoptionId: "adoption_reusable" }; secondCreate.desiredComputerStatus = "running";
    expect((await provider.create({ computer: second, operation: secondCreate, attempt: attempt(secondCreate), execution: execution() })).kind).toBe("success");
    expect(releaseClaims.map((claim) => claim.claimGeneration)).toEqual([1, 1]);
    expect(releaseClaims[0]?.claimFence).toBe(releaseClaims[1]?.claimFence ?? "");
    expect(await provider.delete({ computer: first, operation: deleting, attempt: attempt(deleting), execution: execution() })).toMatchObject({ kind: "unknown", message: "Adopted-machine claim was superseded" });
    expect(releases).toBe(2);
  });

  test("controller helper JSON is closed and exactly typed for observe transition and release", async () => {
    const state = root(); const inventory = join(state, "inventory"); const home = join(inventory, "home"); mkdirSync(home, { recursive: true, mode: 0o700 });
    const controller = join(state, "controller-helper"); writeFileSync(controller, "#!/bin/sh\nexit 0\n", { mode: 0o700 }); chmodSync(controller, 0o700);
    const config = join(state, "local.json"); writeFileSync(config, `${JSON.stringify({ version: 1, stateRoot: join(state, "state"), adoption: {
      adoptionId: "adoption_exact", hostId: "host_exact", profileId: "profile_adopted", allowedTenantId: "tenant_local",
      allowedOwnerPrincipalId: "principal_cmp_local_one", homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controllerPath: controller,
    } })}\n`, { mode: 0o600 });
    const runner = new FakeRunner(); const provider = createLocalProviderPortsFromConfigFileForTesting(config, { runner }).local_machine;
    const machine = computer("local_machine"); const create = operation(machine); create.request.adoption = { adoptionId: "adoption_exact" };
    const observation = { hostId: "host_exact", bootId: "boot_exact", state: "running", ownership: "dedicated",
      controllerExternallyProtected: true, residentHeartbeatCurrent: false };
    runner.results.push(commandResult(`${JSON.stringify({ ...observation, extra: true })}\n`));
    await expect(provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).rejects.toThrow("Invalid adoption observer output");
    runner.results.push(commandResult(`${JSON.stringify(observation)}\n`));
    expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");
    expect(runner.calls[1]?.slice(0, 6)).toEqual([controller, "observe", "adoption_exact", machine.tenantId, machine.id, machine.ownerPrincipalId]);
    expect(runner.calls[1]?.[6]).toBe("1"); expect(runner.calls[1]?.[7]).toMatch(/^fence_[a-f0-9]{32}$/);
    const stop = operation(machine, "stop");
    runner.results.push(commandResult(`${JSON.stringify(observation)}\n`), commandResult("", "transition rejected", 1));
    expect((await provider.stop({ computer: machine, operation: stop, attempt: attempt(stop), execution: execution() })).kind).toBe("unknown");
    runner.results.push(commandResult(`${JSON.stringify(observation)}\n`), commandResult('{"transitioned":true,"extra":true}\n'));
    expect((await provider.stop({ computer: machine, operation: stop, attempt: attempt(stop), execution: execution() })).kind).toBe("unknown");
    runner.results.push(commandResult(`${JSON.stringify(observation)}\n`), commandResult('{"transitioned":true}\n'), commandResult(`${JSON.stringify({ ...observation, state: "stopped" })}\n`));
    expect((await provider.stop({ computer: machine, operation: stop, attempt: attempt(stop), execution: execution() })).kind).toBe("success");
    const deletion = operation(machine, "delete"); runner.results.push(commandResult(`${JSON.stringify({ ...observation, state: "stopped" })}\n`), commandResult("", "release rejected", 1));
    expect((await provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("unknown");
    runner.results.push(commandResult(`${JSON.stringify({ ...observation, state: "stopped" })}\n`), commandResult('{"released":true,"extra":true}\n'));
    expect((await provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("unknown");
  });

  test("canary cleanup reaches audited deletion and retained-home confirmation", async () => {
    const provider = new CanaryCleanupProvider({ kind: "success", resource: { resourceId: "resource:canary", instanceId: "instance:canary" }, result: {
      lifecycle: "quarantined", assurance: canaryAssurance, residentBindingVerified: false,
      volumes: { root: "root:canary", home: "home:canary" }, retainHome: true, homeUsable: false,
    } });
    const { storage, service, worker, computer } = await preparedCanary(provider);
    try {
      expect(await cleanupLocalCanary(storage, service, worker, computer, "success")).toEqual({ deleted: true, retainedHome: "home:canary" });
      expect(storage.getComputer(canaryAdmin.tenantId, computer.id)?.status).toBe("deleted");
      expect(storage.getProviderBinding(canaryAdmin.tenantId, computer.id)?.state).toBe("released");
      expect(storage.listComputerVolumes(canaryAdmin.tenantId, computer.id).find((volume) => volume.kind === "home")).toMatchObject({ state: "detached", providerRef: "home:canary" });
      expect(provider.deleteCalls).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND computer_id = ? AND action IN ('computer.quarantine.requested','computer.delete.requested')")
        .get(canaryAdmin.tenantId, computer.id) as { count: number }).count).toBe(2);
    } finally { storage.close(); }
  });

  test("worker reconciles local create with the current configured profile revision", async () => {
    const storage = new SQLiteStorage(":memory:"); const seen: Operation[] = [];
    const provider = {
      kind: "local_vm" as const,
      async readiness(): Promise<ProviderReadiness> { return { provider: "local_vm", configured: true, ready: true, confinementClass: "unverified_vm", controls: {}, limitations: [] }; },
      async create(request: { operation: Operation }): Promise<ProviderOutcome> { seen.push(request.operation); return { kind: "unknown", providerOperationId: "profile-current", message: "reconcile" }; },
      async reconcile(request: { operation: Operation }): Promise<ProviderOutcome> { seen.push(request.operation); return { kind: "unknown", providerOperationId: "profile-current", message: "reconcile" }; },
      async start(): Promise<ProviderOutcome> { throw new Error("unused"); }, async stop(): Promise<ProviderOutcome> { throw new Error("unused"); },
      async quarantine(): Promise<ProviderOutcome> { throw new Error("unused"); }, async delete(): Promise<ProviderOutcome> { throw new Error("unused"); },
      async restore(): Promise<ProviderOutcome> { throw new Error("unused"); },
    } as ProviderPort;
    const ports = { local_machine: provider as never, local_vm: provider, aws_ec2: provider as never };
    const service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const firstDocument = { provider: "local_vm", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/current.qcow2", imageDigest: `sha256:${"d".repeat(64)}` };
    service.createProfile(admin, { id: "profile_current", name: "Current", document: firstDocument });
    service.createComputer(admin, { id: "cmp_profile_current", slug: "profile-current", provider: "local_vm",
      ownerPrincipalId: "principal_profile_current", profileId: "profile_current", idempotencyKey: "profile-current-create" });
    const worker = new OperationWorker(storage, ports); await worker.runTenant(admin.tenantId);
    const secondDocument = { ...firstDocument, cpus: 3 }; const now = new Date().toISOString();
    storage.database.query("INSERT INTO profile_revisions (id, profile_id, tenant_id, generation, digest, document_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("prv_profile_current_2", "profile_current", admin.tenantId, 2, sha256(secondDocument), JSON.stringify(secondDocument), now);
    await worker.runTenant(admin.tenantId);
    expect(seen.map((item) => (item.request.profile as { generation: number }).generation)).toEqual([1, 2]);
    expect((seen[1]?.request.profile as { digest: string }).digest).toBe(sha256(secondDocument));
    storage.close();
  });

  test("canary cleanup fails closed for explicit unknown, definite failure, and provider crash", async () => {
    const cases: Array<{ name: string; outcome: ProviderOutcome | Error; status: Operation["status"] }> = [
      { name: "unknown", outcome: { kind: "unknown", providerOperationId: "canary-quarantine", message: "indeterminate" }, status: "unknown" },
      { name: "failure", outcome: { kind: "definite_failure", code: "quarantine_failed", message: "not quarantined" }, status: "failed" },
      { name: "crash", outcome: new Error("provider crashed"), status: "unknown" },
    ];
    for (const item of cases) {
      const provider = new CanaryCleanupProvider(item.outcome); const { storage, service, worker, computer } = await preparedCanary(provider);
      try {
        expect(await cleanupLocalCanary(storage, service, worker, computer, item.name)).toEqual({ deleted: false });
        const cleanup = storage.listOperations(canaryAdmin.tenantId, computer.id).find((operation) => operation.idempotencyKey === `canary-cleanup-quarantine-${item.name}`);
        expect(cleanup?.status).toBe(item.status); expect(provider.deleteCalls).toBe(0);
        expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND computer_id = ? AND action = 'computer.quarantine.requested'")
          .get(canaryAdmin.tenantId, computer.id) as { count: number }).count).toBe(1);
        if (item.name === "unknown") {
          expect(await cleanupLocalCanary(storage, service, worker, computer, `${item.name}-retry`)).toEqual({ deleted: false });
          expect(provider.reconcileCalls).toBe(3);
          expect(storage.listOperations(canaryAdmin.tenantId, computer.id).filter((operation) => ["pending", "accepted", "running", "unknown"].includes(operation.status))).toHaveLength(1);
        }
      } finally { storage.close(); }
    }
  });

  test("canary cleanup reconciles an active unknown create start stop or delete before opening another lifecycle", async () => {
    for (const phase of ["create", "start", "stop", "delete"] as const) {
      const provider = new CanaryCleanupProvider({ kind: "success", resource: { resourceId: "resource:canary" }, result: {} });
      let storage: SQLiteStorage; let service: ComputersService; let worker: OperationWorker; let machine: Computer;
      if (phase === "create") {
        provider.create = async () => ({ kind: "unknown", providerOperationId: "canary-create-unknown", message: "indeterminate" });
        storage = new SQLiteStorage(":memory:"); const ports = { local_machine: provider as never, local_vm: provider, aws_ec2: provider as never };
        service = new ComputersService(storage, { providers: ports, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
        service.createProfile(canaryAdmin, { id: "profile_canary", name: "Canary Lima", document: { provider: "local_vm", cpus: 2, memoryGiB: 4,
          rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/canary.qcow2", imageDigest: `sha256:${"c".repeat(64)}` } });
        machine = service.createComputer(canaryAdmin, { id: "cmp_canary_unknown_create", slug: "canary-unknown-create", provider: "local_vm",
          ownerPrincipalId: "principal_canary_unknown_create", profileId: "profile_canary", idempotencyKey: "canary-create-unknown" });
        worker = new OperationWorker(storage, ports); await worker.runTenant(canaryAdmin.tenantId);
      } else {
        ({ storage, service, worker, computer: machine } = await preparedCanary(provider));
        if (phase === "start") {
          storage.acquireHomeLease(canaryAdmin.tenantId, machine.id, machine.ownerPrincipalId, "canary-controller", 60, 0);
          provider.start = async () => ({ kind: "unknown", providerOperationId: "canary-start-unknown", message: "indeterminate" });
        } else if (phase === "stop") {
          storage.updateComputerStatus(canaryAdmin.tenantId, machine.id, "running");
          provider.stop = async () => ({ kind: "unknown", providerOperationId: "canary-stop-unknown", message: "indeterminate" });
        } else provider.delete = async () => ({ kind: "unknown", providerOperationId: "canary-delete-unknown", message: "indeterminate" });
        service.requestLifecycle(canaryAdmin, machine.id, phase, `canary-${phase}-unknown`); await worker.runTenant(canaryAdmin.tenantId);
      }
      try {
        expect(await cleanupLocalCanary(storage, service, worker, machine, `active-${phase}`)).toEqual({ deleted: false });
        expect(provider.reconcileCalls).toBe(3);
        expect(storage.listOperations(canaryAdmin.tenantId, machine.id).filter((item) => ["pending", "accepted", "running", "unknown"].includes(item.status))).toHaveLength(1);
      } finally { storage.close(); }
    }
  });

  test("recovers deterministic VM but keeps running state, resident binding, and durable home explicitly unverified", async () => {
    const state = root(); const inspector = new FakeInspector(); const runner = new FakeRunner(); const machine = computer();
    const expectedDisk = `home_${createHashFor(machine, "home")}`; inspector.disks = [false, true, true];
    inspector.inspections = [resolved({ exists: false }), resolved({ additionalDisks: [{ name: expectedDisk, format: false }] })];
    runner.results.push(commandResult(), commandResult());
    const { provider } = vmConfig(state, inspector, runner); const createOp = operation(machine); const created = await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() });
    expect(created.kind).toBe("success"); if (created.kind === "success") expect((created.result.assurance as { confinementClass: string }).confinementClass).toBe("unverified_vm");
    inspector.disk = true;
    const startOp = operation(machine, "start"); runner.results.push({ exitCode: 0, stdout: "", stderr: "", timedOut: false, outputExceeded: false }, { exitCode: 0, stdout: "01234567-89ab-cdef-0123-456789abcdef\n", stderr: "", timedOut: false, outputExceeded: false });
    inspector.inspection = resolved({ status: "Running", additionalDisks: [{ name: expectedDisk, format: false }] });
    const started = await provider.start({ computer: machine, operation: startOp, attempt: attempt(startOp), execution: execution(), homeLease: {} as never });
    expect(started.kind).toBe("success"); if (started.kind === "success") expect(started.result).toMatchObject({
      residentBindingVerified: false, homeUsable: false, strictGuestPending: true,
      assurance: { confinementClass: "unverified_vm", externalEgressEnforced: false, residentIndependentIsolation: false },
    });
  });

  test("later lifecycle and reconcile reject profile id generation revision and resolved-digest drift before mutation", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true, true]; inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const createOp = operation(machine);
    expect((await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");
    const generation = operation(machine, "start"); (generation.request.profile as { generation: number }).generation = 2;
    expect(await provider.start({ computer: machine, operation: generation, attempt: attempt(generation), execution: execution(), homeLease: {} as never })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    const id = operation(machine, "start"); (id.request.profile as { id: string }).id = "profile_other"; id.request.profileId = "profile_other";
    expect(await provider.start({ computer: machine, operation: id, attempt: attempt(id), execution: execution(), homeLease: {} as never })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    const revision = operation(machine, "start"); const revisionBinding = revision.request.profile as { document: Record<string, unknown>; digest: string };
    revisionBinding.document = { ...revisionBinding.document, cpus: 3 }; revisionBinding.digest = sha256(revisionBinding.document);
    expect(await provider.start({ computer: machine, operation: revision, attempt: attempt(revision), execution: execution(), homeLease: {} as never })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json"); const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.resolvedProfileDigest = `sha256:${"f".repeat(64)}`; writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.disk = true;
    expect(await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local VM profile binding has drifted while an external resource still exists" });
    const invalidBinding = structuredClone(createOp); (invalidBinding.request.profile as { digest: string }).digest = `sha256:${"0".repeat(64)}`;
    expect(await provider.create({ computer: machine, operation: invalidBinding, attempt: attempt(invalidBinding), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local VM profile binding has drifted while an external resource may still exist" });
    expect(await provider.reconcile({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Local VM profile binding has drifted while an external resource may still exist" });
    inspector.inspection = resolved({ exists: false }); inspector.disk = false; const deletion = operation(machine, "delete");
    expect(await provider.reconcile({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).toMatchObject({ kind: "definite_failure", code: "profile_mismatch" });
    expect(runner.calls).toHaveLength(2);
  });

  test("rejects malformed local VM manifests before trusting resource or home identity", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true, true]; inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const createOp = operation(machine);
    expect((await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");
    const manifestPath = join(state, "computers", machine.tenantId, machine.id, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>; manifest.unexpected = "untrusted";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    const deletion = operation(machine, "delete");
    await expect(provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() }))
      .rejects.toThrow("manifest identity mismatch");
    expect(runner.calls).toHaveLength(2);
  });

  test("create reconciliation durably manifests ownership and clears the phase marker", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true, true]; inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    const directory = join(state, "computers", machine.tenantId, machine.id); const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>; rmSync(manifestPath);
    writeFileSync(join(directory, "create-phase.json"), `${JSON.stringify({ version: 1, tenantId: machine.tenantId, computerId: machine.id,
      operationId: op.id, providerIdempotencyKey: attempt(op).providerIdempotencyKey, instanceId: manifest.instanceId, diskName: (manifest.home as { reference: string }).reference,
      profileId: manifest.profileId, profileGeneration: manifest.profileGeneration, profileRevisionDigest: manifest.profileRevisionDigest,
      resolvedProfileDigest: manifest.resolvedProfileDigest, diskAbsentBeforeCreate: true, phase: "vm_attempted", updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.disk = true;
    expect((await provider.reconcile({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    expect(existsSync(manifestPath)).toBe(true); expect(existsSync(join(directory, "create-phase.json"))).toBe(false);
  });

  test("profile drift cleans an exactly journal-owned create phase instead of continuing stale creation", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true, true]; inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("success");
    const directory = join(state, "computers", machine.tenantId, machine.id); const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>; rmSync(manifestPath);
    writeFileSync(join(directory, "create-phase.json"), `${JSON.stringify({ version: 1, tenantId: machine.tenantId, computerId: machine.id,
      operationId: op.id, providerIdempotencyKey: attempt(op).providerIdempotencyKey, instanceId: manifest.instanceId, diskName: (manifest.home as { reference: string }).reference,
      profileId: manifest.profileId, profileGeneration: manifest.profileGeneration, profileRevisionDigest: manifest.profileRevisionDigest,
      resolvedProfileDigest: manifest.resolvedProfileDigest, diskAbsentBeforeCreate: true, phase: "vm_attempted", updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    inspector.inspection = resolved({ exists: false }); inspector.disks = [true, false]; const current = structuredClone(op);
    (current.request.profile as { generation: number }).generation = 2;
    expect(await provider.reconcile({ computer: machine, operation: current, attempt: attempt(current), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "lima_create_failed" });
    const tombstone = JSON.parse(readFileSync(manifestPath, "utf8")) as { lifecycle: string; profileGeneration: number; home: { retained: boolean } };
    expect(tombstone).toMatchObject({ lifecycle: "deleted", profileGeneration: 2, home: { retained: false } });
    expect(existsSync(join(directory, "create-phase.json"))).toBe(false);
    inspector.inspection = resolved({ exists: false }); inspector.disk = false; const deletion = operation(machine, "delete");
    (deletion.request.profile as { generation: number }).generation = 2;
    expect((await provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("success");
  });

  test("a ghost VM with profile drift keeps delegated quota reserved until exact cleanup or absence is proven", async () => {
    const state = root(); const storage = new SQLiteStorage(":memory:");
    const adminContext: AuthorizationContext = { tenantId: "tenant_ghost_quota", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    const basePorts = createProviderPorts();
    const service = new ComputersService(storage, { providers: basePorts, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const parent = service.createComputer(adminContext, {
        slug: "ghost-parent", provider: "local_machine", ownerPrincipalId: "principal_ghost_parent", idempotencyKey: "ghost-parent-create",
      });
      const parentCreate = storage.listOperations(adminContext.tenantId, parent.id)[0];
      if (parentCreate === undefined) throw new Error("Missing parent create operation");
      storage.completeProviderOperation(parentCreate, storage.beginProviderAttempt(parentCreate), {
        kind: "success", resource: { resourceId: "resource_ghost_parent" }, result: { lifecycle: "stopped" },
      });
      const profileDocument = { provider: "local_vm" as const, cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
        imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` };
      const profile = service.createProfile(adminContext, { id: "profile_ghost", name: "Ghost VM", document: profileDocument });
      const grant = service.createComputerGrant(adminContext, {
        principalId: parent.ownerPrincipalId, ownerPrincipalId: parent.ownerPrincipalId, parentComputerId: parent.id,
        allowedProviders: ["local_vm"], allowedChildOwnerPrincipalIds: ["principal_ghost_child", "principal_ghost_second"],
        allowedRegions: ["local"], allowedProfileIds: [profile.id], maxStorageGiB: 32, maxUptimeSeconds: 600,
        maxBudgetMicros: 1000, limit: 1,
      });
      const delegated: AuthorizationContext = { tenantId: adminContext.tenantId, principalId: parent.ownerPrincipalId,
        scopes: ["computers:create"], boundComputerId: parent.id, policyGeneration: parent.policyGeneration, authMethod: "bearer" };
      const fields = { provider: "local_vm" as const, parentComputerId: parent.id, grantId: grant.id, region: "local",
        profileId: profile.id, storageGiB: 32, uptimeSeconds: 600, budgetMicros: 1000 };
      const child = service.createComputer(delegated, {
        ...fields, slug: "ghost-child", ownerPrincipalId: "principal_ghost_child", idempotencyKey: "ghost-child-create",
      });
      const create = storage.listOperations(adminContext.tenantId, child.id)[0];
      if (create === undefined) throw new Error("Missing ghost create operation");
      const attemptRecord = storage.beginProviderAttempt(create);
      const expectedDisk = `home_${createHashFor(child, "home")}`;
      const inspector = new FakeInspector(); inspector.disks = [false, true, true];
      inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
      const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult());
      const limaHome = join(state, "lima"); mkdirSync(limaHome, { recursive: true, mode: 0o700 });
      inspector.limaHome = join(limaHome, child.tenantId, child.id);
      const localProvider = new LimaVmProvider({ stateRoot: state, platform: "darwin", arch: "arm64", runner, vm: {
        limactlPath: "/usr/bin/limactl", limaHome, inspector, profile: {
          id: profile.id, cpus: profileDocument.cpus, memoryGiB: profileDocument.memoryGiB,
          rootDiskGiB: profileDocument.rootDiskGiB, homeDiskGiB: profileDocument.homeDiskGiB,
          imageLocation: profileDocument.imageLocation, imageDigest: profileDocument.imageDigest,
        },
      } });
      const external = await localProvider.create({ computer: child, operation: create, attempt: attemptRecord, execution: execution() });
      if (external.kind !== "success") throw new Error(`Ghost fixture did not create the external VM: ${JSON.stringify(external)}`);
      expect(external.kind).toBe("success");
      storage.recordProviderUnknown(attemptRecord, {
        kind: "unknown", providerOperationId: attemptRecord.providerIdempotencyKey, resource: external.resource,
        message: "Controller crashed after external create",
      });
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", attemptRecord.tenantId, attemptRecord.id);
      storage.database.query(`INSERT INTO profile_revisions
        (id, profile_id, tenant_id, generation, digest, document_json, created_at) VALUES (?, ?, ?, 2, ?, ?, ?)`)
        .run("prv_ghost_generation_two", profile.id, profile.tenantId, profile.digest, JSON.stringify(profile.document), new Date().toISOString());
      inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.disk = true;
      basePorts.local_vm = localProvider;
      expect(await new OperationWorker(storage, basePorts).runTenant(adminContext.tenantId)).toBe(1);
      expect(storage.getOperation(adminContext.tenantId, create.id)).toMatchObject({ status: "unknown" });
      expect(storage.getProviderBinding(adminContext.tenantId, child.id)).toMatchObject({ state: "unknown", resource: { resourceId: external.resource.resourceId } });
      expect(() => service.createComputer(delegated, {
        ...fields, slug: "ghost-second", ownerPrincipalId: "principal_ghost_second", idempotencyKey: "ghost-second-create",
      })).toThrow("quota");
    } finally { storage.close(); }
  });

  test("unsafe cleanup performs no mutation when its exact create marker disappears", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true]; inspector.inspections = [resolved({ exists: false }), resolved({ portForwardCount: 1, additionalDisks: [{ name: expectedDisk, format: false }] })];
    const phasePath = join(state, "computers", machine.tenantId, machine.id, "create-phase.json");
    inspector.onInspect = (value) => { if (value.portForwardCount === 1 && existsSync(phasePath)) rmSync(phasePath); };
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult()); const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "unknown", message: "Unsafe Lima cleanup requires an exact durable ownership marker" });
    expect(runner.calls).toHaveLength(2);
  });

  test("proven unsafe-create cleanup persists a tombstone that later delete can close", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`; const inspector = new FakeInspector();
    inspector.disks = [false, true, false]; inspector.inspections = [resolved({ exists: false }),
      resolved({ portForwardCount: 1, additionalDisks: [{ name: expectedDisk, format: false }] }), resolved({ exists: false })];
    const runner = new FakeRunner(); runner.results.push(commandResult(), commandResult(), commandResult(), commandResult());
    const provider = vmConfig(state, inspector, runner).provider; const op = operation(machine);
    expect(await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "local_vm_configuration_unsafe" });
    const tombstone = JSON.parse(readFileSync(join(state, "computers", machine.tenantId, machine.id, "manifest.json"), "utf8")) as { lifecycle: string; home: { retained: boolean } };
    expect(tombstone).toMatchObject({ lifecycle: "deleted", home: { retained: false } });
    inspector.inspection = resolved({ exists: false }); inspector.disk = false; const deletion = operation(machine, "delete");
    expect((await provider.delete({ computer: machine, operation: deletion, attempt: attempt(deletion), execution: execution() })).kind).toBe("success");
  });

  test("unsafe created VM returns unknown when bounded cleanup is not proven", async () => {
    const state = root(); const inspector = new FakeInspector(); inspector.inspection = resolved({ exists: false }); inspector.disk = false;
    const runner = new FakeRunner(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    runner.results.push({ exitCode: 0, stdout: "", stderr: "", timedOut: false, outputExceeded: false }, { exitCode: 0, stdout: "", stderr: "", timedOut: false, outputExceeded: false }, { exitCode: 1, stdout: "", stderr: "", timedOut: true, outputExceeded: false });
    const { provider } = vmConfig(state, inspector, runner); inspector.inspections = [resolved({ exists: false }), resolved({ portForwardCount: 1, additionalDisks: [{ name: expectedDisk, format: false }] })];
    const op = operation(machine); expect((await provider.create({ computer: machine, operation: op, attempt: attempt(op), execution: execution() })).kind).toBe("unknown");
  });

  test("bounded runner enforces output and timeout without a shell", async () => {
    const runner = new BunCommandRunner();
    const output = await runner.run({ argv: ["/usr/bin/printf", "0123456789"], timeoutMs: 1000, maxOutputBytes: 4 }); expect(output.outputExceeded).toBe(true); expect(output.stdout).toBe("0123");
    const timeout = await runner.run({ argv: ["/usr/bin/sleep", "1"], timeoutMs: 10, maxOutputBytes: 1024 }); expect(timeout.timedOut).toBe(true);
    await expect(runner.run({ argv: ["sh", "-c", "id"], timeoutMs: 1000, maxOutputBytes: 1024 })).rejects.toThrow("absolute");
  });

  test("bounded runner shares one aggregate stdout and stderr budget", async () => {
    const output = await new BunCommandRunner().run({ argv: ["/bin/sh", "-c", "printf 12345; printf 67890 >&2"], timeoutMs: 1000, maxOutputBytes: 6 });
    expect(output.outputExceeded).toBe(true);
    expect(Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr)).toBeLessThanOrEqual(6);
  });

  test("rejects symlinked controller roots and upgrades an existing 0001 database", () => {
    const parent = root(); const target = join(parent, "target"); mkdirSync(target, { mode: 0o700 }); const link = join(parent, "link"); symlinkSync(target, link);
    expect(() => new LimaVmProvider({ stateRoot: link, platform: "linux" })).toThrow("symlinks");
    const databasePath = join(parent, "upgrade.db"); const db = new Database(databasePath); db.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    const document = { provider: "local_machine", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32 };
    db.query("INSERT INTO profiles (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)").run("profile_shared", "tenant_before", "Before", new Date().toISOString());
    db.query("INSERT INTO profile_revisions (id, profile_id, tenant_id, generation, digest, document_json, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)")
      .run("prv_before", "profile_shared", "tenant_before", sha256(document), JSON.stringify(document), new Date().toISOString()); db.close();
    const upgraded = new SQLiteStorage(databasePath); try {
      expect(upgraded.database.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 3 });
      expect(upgraded.database.query("SELECT name FROM sqlite_master WHERE name = 'provider_assurance'").get()).toEqual({ name: "provider_assurance" });
      const otherAdmin = { ...admin, tenantId: "tenant_after" };
      const service = new ComputersService(upgraded, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
      expect(service.createProfile(otherAdmin, { id: "profile_shared", name: "After", document }).tenantId).toBe("tenant_after");
    } finally { upgraded.close(); }
  });

  test("rejects writable controller ancestors and detects helper inode replacement around execution", async () => {
    const state = root(); const writable = join(state, "group-writable"); mkdirSync(writable, { mode: 0o770 }); chmodSync(writable, 0o770);
    const unsafeConfig = join(writable, "local.json"); writeFileSync(unsafeConfig, '{"version":1,"stateRoot":"/tmp/unused"}\n', { mode: 0o600 });
    expect(() => createLocalProviderPortsFromConfigFile(unsafeConfig)).toThrow("unsafe writable ancestor");

    const safe = root(); const inventory = join(safe, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
    const helper = join(safe, "helper"); writeFileSync(helper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const config = join(safe, "local.json"); writeFileSync(config, `${JSON.stringify({ version: 1, stateRoot: join(safe, "provider"), adoption: {
      adoptionId: "adoption_replace", hostId: "host_replace", profileId: "profile_adopted", allowedTenantId: "tenant_local",
      allowedOwnerPrincipalId: "principal_cmp_local_one", homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controllerPath: helper,
    } })}\n`, { mode: 0o600 });
    const replacingRunner: CommandRunner = { async run() {
      const old = `${helper}.old`; renameSync(helper, old); writeFileSync(helper, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      return commandResult(`${JSON.stringify({ hostId: "host_replace", bootId: "boot_replace", state: "running", ownership: "dedicated",
        controllerExternallyProtected: true, residentHeartbeatCurrent: false })}\n`);
    } };
    const provider = createLocalProviderPortsFromConfigFileForTesting(config, { runner: replacingRunner }).local_machine;
    const machine = computer("local_machine"); const create = operation(machine); create.request.adoption = { adoptionId: "adoption_replace" };
    await expect(provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).rejects.toThrow("identity changed");
  });

  test("profile creation is bounded and caller-ID replay is deterministic", () => {
    const storage = new SQLiteStorage(":memory:"); const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const input = { id: "profile_vm_one", name: "Strict VM", document: { provider: "local_vm" as const, cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/linux.qcow2", imageDigest: `sha256:${"a".repeat(64)}` } };
    try {
      const first = service.createProfile(admin, input); const replay = service.createProfile(admin, input); expect(replay).toEqual(first);
      const otherAdmin = { ...admin, tenantId: "tenant_local_other" };
      const other = service.createProfile(otherAdmin, input); expect(other.id).toBe(first.id); expect(other.tenantId).toBe(otherAdmin.tenantId);
      const created = service.createComputer(admin, { slug: "profile-bound", provider: "local_vm", ownerPrincipalId: "principal_profile", profileId: first.id, idempotencyKey: "profile-bound-create" });
      const binding = storage.listOperations(admin.tenantId, created.id)[0]?.request.profile as Record<string, unknown>;
      expect(binding).toEqual({ id: first.id, generation: first.generation, digest: first.digest, document: first.document });
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND action = 'profile.created'").get(admin.tenantId) as { count: number }).count).toBe(1);
      expect(() => service.createProfile(admin, { ...input, name: "Changed" })).toThrow("already exists");
      expect(() => service.createProfile(admin, { ...input, id: "profile_bad", document: { ...input.document, unexpected: {} } } as never)).toThrow("Invalid unexpected");
      const machineProfile = service.createProfile(admin, { id: "profile_machine", name: "Machine", document: { provider: "local_machine", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32 } });
      expect(() => service.createComputer(admin, { slug: "profile-mismatch", provider: "local_vm", ownerPrincipalId: "principal_profile", profileId: machineProfile.id, idempotencyKey: "profile-mismatch-create" })).toThrow("provider does not match");
    } finally { storage.close(); }
  });
});

function createHashFor(value: Computer, suffix: string): string {
  return new Bun.CryptoHasher("sha256").update(`${value.tenantId}\0${value.id}\0${suffix}`).digest("hex").slice(0, 24);
}

interface AdoptedController {
  observes: number; transitions: number; value: "running" | "stopped" | "quarantined" | "unknown";
  observe(): Promise<{ hostId: string; bootId: string; state: string; ownership: string; controllerExternallyProtected: boolean; residentHeartbeatCurrent: boolean }>;
  transition(desired: "running" | "stopped" | "quarantined"): Promise<void>;
  release(): Promise<{ released: boolean }>;
}

function adoptedProvider(state: string, machine: Computer): { provider: AdoptedMachineProvider; controller: AdoptedController } {
  const inventory = join(state, "inventory"); mkdirSync(join(inventory, "home"), { recursive: true, mode: 0o700 });
  const controller: AdoptedController = {
    observes: 0, transitions: 0, value: "running",
    async observe() { this.observes += 1; return { hostId: "host_rc", bootId: "boot_rc", state: this.value, ownership: "dedicated", controllerExternallyProtected: true, residentHeartbeatCurrent: false }; },
    async transition(desired) { this.transitions += 1; this.value = desired; },
    async release() { return { released: true }; },
  };
  const provider = new AdoptedMachineProvider({ stateRoot: state, adoption: {
    adoptionId: "adoption_one", hostId: "host_rc", profileId: "profile_adopted",
    allowedTenantId: machine.tenantId, allowedOwnerPrincipalId: machine.ownerPrincipalId,
    homeRoot: inventory, homeRelativePath: "home", expectedHomeUid: process.getuid(), controller: controller as never,
  } as never });
  return { provider, controller };
}

describe("release-candidate adopted reconciliation and compensation", () => {
  test("finding 1: a reclaimed reconcile observes after a policy/fence bump instead of failing preflight", async () => {
    const machine = computer("local_machine", "cmp_rc_reconcile"); const { provider, controller } = adoptedProvider(root(), machine);
    const create = operation(machine);
    expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");

    // Policy revision after the adopted attempt started: the Computer's generation advanced while the
    // reclaimed operation still carries the prior generation, and the reclaimed attempt fence lags.
    const bumped: Computer = { ...machine, policyGeneration: 3 };
    const startOp: Operation = { ...operation(machine, "start"), policyGeneration: 1, fence: 2 };
    const staleAttempt: ProviderAttempt = { ...attempt(startOp), fence: 1 };
    const before = controller.observes;
    const reconciled = await provider.reconcile({ computer: bumped, operation: startOp, attempt: staleAttempt, execution: execution() });
    expect(reconciled).toMatchObject({ kind: "success", result: { reconciled: true, lifecycle: "running" } });
    expect(controller.observes).toBeGreaterThan(before);

    // The direct (caller) start entry point keeps exact policy/fence equality and never observes.
    const observedBeforeDirect = controller.observes;
    expect(await provider.start({ computer: bumped, operation: startOp, attempt: staleAttempt, execution: execution(), homeLease: {} as never }))
      .toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
    expect(controller.observes).toBe(observedBeforeDirect);
  });

  test("finding 2: an authorized restrictive compensation quarantine is accepted for a fenced start original", async () => {
    const machine = computer("local_machine", "cmp_rc_compensate"); const { provider, controller } = adoptedProvider(root(), machine);
    const create = operation(machine);
    expect((await provider.create({ computer: machine, operation: create, attempt: attempt(create), execution: execution() })).kind).toBe("success");

    // Current-generation start original: isolates the method mismatch (start != quarantine).
    const startMatched: Operation = operation(machine, "start");
    // Without the explicit worker flag, a quarantine method carrying a non-quarantine original is refused.
    expect(await provider.quarantine({ computer: machine, operation: startMatched, attempt: attempt(startMatched), execution: execution() }))
      .toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
    expect(controller.transitions).toBe(0);

    // Fenced start original (policy revision + lagging attempt fence after the attempt started).
    const startOp: Operation = { ...operation(machine, "start"), policyGeneration: 1, fence: 2 };
    const staleAttempt: ProviderAttempt = { ...attempt(startOp), fence: 1 };
    const bumped: Computer = { ...machine, policyGeneration: 3 };

    // With the flag the adopted host is driven to the restrictive quarantined state.
    const compensated = await provider.quarantine({ computer: bumped, operation: startOp, attempt: staleAttempt, execution: execution(), compensatingQuarantine: true } as never);
    expect(compensated).toMatchObject({ kind: "success", result: { lifecycle: "quarantined" } });
    expect(controller.transitions).toBe(1); expect(controller.value).toBe("quarantined");

    // A restrictive-compensation flag never widens an arbitrary mismatch: it stays bound to quarantine
    // and to permissive originals, and a caller-issued quarantine still needs a quarantine operation.
    const deleteOp: Operation = { ...operation(machine, "delete"), policyGeneration: 1 };
    expect(await provider.start({ computer: machine, operation: deleteOp, attempt: attempt(deleteOp), execution: execution(), homeLease: {} as never, compensatingQuarantine: true } as never))
      .toMatchObject({ kind: "definite_failure", code: "adoption_mismatch" });
  });
});

describe("release-candidate Lima restrictive reconciliation", () => {
  test("residual: a stop reconcile reports the authoritative quarantined lifecycle without downgrading", async () => {
    const state = root(); const machine = computer(); const expectedDisk = `home_${createHashFor(machine, "home")}`;
    const inspector = new FakeInspector(); const runner = new FakeRunner();
    inspector.disks = [false, true, true];
    inspector.inspections = [resolved({ exists: false }), resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] })];
    runner.results.push(commandResult(), commandResult());
    const provider = vmConfig(state, inspector, runner).provider; const createOp = operation(machine);
    expect((await provider.create({ computer: machine, operation: createOp, attempt: attempt(createOp), execution: execution() })).kind).toBe("success");

    // Quarantine the already-stopped VM so the durable manifest records the stronger restrictive state.
    inspector.inspection = resolved({ status: "Stopped", additionalDisks: [{ name: expectedDisk, format: false }] }); inspector.disk = true;
    const quarantineOp = operation(machine, "quarantine");
    expect(await provider.quarantine({ computer: machine, operation: quarantineOp, attempt: attempt(quarantineOp), execution: execution() }))
      .toMatchObject({ kind: "success", result: { lifecycle: "quarantined" } });

    // A reclaimed stop reconcile observing the same stopped VM must not weaken quarantined to stopped.
    const stopOp = operation(machine, "stop");
    expect(await provider.reconcile({ computer: machine, operation: stopOp, attempt: attempt(stopOp), execution: execution() }))
      .toMatchObject({ kind: "success", result: { reconciled: true, lifecycle: "quarantined" } });
  });
});
