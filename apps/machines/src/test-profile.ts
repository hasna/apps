import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, hostname, platform, totalmem } from "node:os";
import { dirname, join } from "node:path";

const GIB = 1024 ** 3;
const REQUIRED_CONTROLLERS = ["cpu", "memory", "pids"] as const;

export type MachineTestAuthority = {
  machineId: string;
  platform: "linux";
  totalMemoryBytes: number;
  logicalCpuCount: number;
};

export type WorkstationTestProfile = {
  schema: "machines.workstation_test_profile.v1";
  machine: MachineTestAuthority;
  controller: {
    kind: "systemd-cgroup-v2";
    requiredControllers: string[];
    delegationRequired: true;
  };
  aggregate: {
    sliceName: string;
    memoryHighBytes: number;
    memoryMaxBytes: number;
    memorySwapMaxBytes: number;
    tasksMax: number;
    memoryOomGroup: true;
    managedOomMemoryPressure: "kill";
  };
  nonTestReserve: { memoryBytes: number };
  scope: {
    requiredSlice: string;
    memoryOomGroup: true;
    oomPolicy: "kill";
  };
  bounds: {
    processesMax: number;
    runtimesMax: number;
    localTestWorkersMax: number;
    browsersMax: number;
    machineSlotsMax: number;
  };
  earlyoom: {
    role: "host-backstop";
    primaryTestController: false;
    memoryAvailablePercent: number;
    swapFreePercent: number;
  };
};

export type WorkstationTestControllerSnapshot = {
  cgroupV2: boolean;
  controllers: string[];
  userManager: boolean;
  delegated: boolean;
  sliceLoaded: boolean;
  sliceActive: boolean;
  sliceProperties?: Record<string, string | number | boolean>;
};

export type WorkstationTestProfilePaths = {
  profilePath: string;
  slicePath: string;
  rollbackPath: string;
};

export type WorkstationTestFileChange = { path: string; content: string | null };

export interface WorkstationTestProfileStore {
  read(path: string): string | null;
  commit(changes: readonly WorkstationTestFileChange[]): void;
}

export interface WorkstationTestProfileController {
  inspect(): WorkstationTestControllerSnapshot;
  activate(sliceName: string): WorkstationTestControllerSnapshot;
  reload(): WorkstationTestControllerSnapshot;
}

export type WorkstationTestScopeClaim = {
  scopeId: string;
  sliceName: string;
  memoryMaxBytes: number;
  tasks: number;
  processes: number;
  runtimes: number;
  localTestWorkers: number;
  browsers: number;
  machineSlots: number;
};

export type WorkstationTestPressureScope = WorkstationTestScopeClaim & {
  cgroup: string;
  pids: number[];
  memoryCurrentBytes: number;
};

export type WorkstationTestVerification = {
  admission: "allowed" | "refused";
  reasonCodes: string[];
};

type RollbackRecord = {
  schema: "machines.workstation_test_profile_rollback.v1";
  profileContent: string | null;
  sliceContent: string | null;
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function readMachineTestAuthority(): MachineTestAuthority {
  const detectedPlatform = platform();
  if (detectedPlatform !== "linux") throw new Error(`workstation test profiles require Linux, found ${detectedPlatform}`);
  return {
    machineId: process.env["HASNA_MACHINE_ID"]?.trim() || hostname(),
    platform: "linux",
    totalMemoryBytes: positiveInteger(totalmem(), "totalMemoryBytes"),
    logicalCpuCount: positiveInteger(availableParallelism(), "logicalCpuCount"),
  };
}

export function deriveWorkstationTestProfile(authority: MachineTestAuthority): WorkstationTestProfile {
  if (authority.platform !== "linux") throw new Error("workstation test profiles require Linux authority");
  positiveInteger(authority.totalMemoryBytes, "totalMemoryBytes");
  positiveInteger(authority.logicalCpuCount, "logicalCpuCount");
  if (!authority.machineId.trim()) throw new Error("machineId is required");
  if (authority.totalMemoryBytes < 4 * GIB) throw new Error("at least 4 GiB is required for a protected workstation test profile");

  const reserveBytes = Math.max(2 * GIB, Math.floor(authority.totalMemoryBytes * 0.2));
  const memoryMaxBytes = authority.totalMemoryBytes - reserveBytes;
  const memoryHighBytes = Math.floor(memoryMaxBytes * 0.9);
  const machineSlotsMax = Math.max(1, Math.floor(authority.logicalCpuCount / 4));
  const aggregate = {
    sliceName: "hasna-tests.slice",
    memoryHighBytes,
    memoryMaxBytes,
    memorySwapMaxBytes: 0,
    tasksMax: Math.max(64, authority.logicalCpuCount * 32),
    memoryOomGroup: true as const,
    managedOomMemoryPressure: "kill" as const,
  };

  return {
    schema: "machines.workstation_test_profile.v1",
    machine: { ...authority },
    controller: {
      kind: "systemd-cgroup-v2",
      requiredControllers: [...REQUIRED_CONTROLLERS],
      delegationRequired: true,
    },
    aggregate,
    nonTestReserve: { memoryBytes: reserveBytes },
    scope: {
      requiredSlice: aggregate.sliceName,
      memoryOomGroup: true,
      oomPolicy: "kill",
    },
    bounds: {
      processesMax: Math.max(32, authority.logicalCpuCount * 16),
      runtimesMax: Math.max(2, Math.floor(authority.logicalCpuCount / 2)),
      localTestWorkersMax: Math.max(1, Math.floor(authority.logicalCpuCount / 2)),
      browsersMax: Math.max(1, Math.floor(authority.logicalCpuCount / 4)),
      machineSlotsMax,
    },
    earlyoom: {
      role: "host-backstop",
      primaryTestController: false,
      memoryAvailablePercent: 8,
      swapFreePercent: 20,
    },
  };
}

export function renderWorkstationTestSlice(profile: WorkstationTestProfile): string {
  return [
    "# Managed by @hasna/machines. Use the package apply/rollback surface.",
    "[Unit]",
    "Description=Aggregate boundary for admitted local test scopes",
    "",
    "[Slice]",
    `MemoryHigh=${profile.aggregate.memoryHighBytes}`,
    `MemoryMax=${profile.aggregate.memoryMaxBytes}`,
    `MemorySwapMax=${profile.aggregate.memorySwapMaxBytes}`,
    `TasksMax=${profile.aggregate.tasksMax}`,
    "MemoryOOMGroup=yes",
    `ManagedOOMMemoryPressure=${profile.aggregate.managedOomMemoryPressure}`,
    "",
  ].join("\n");
}

export function serializeWorkstationTestProfile(profile: WorkstationTestProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export function workstationTestProfilePaths(options: { homeDir: string }): WorkstationTestProfilePaths {
  const managedDir = join(options.homeDir, ".hasna", "machines", "profiles");
  return {
    profilePath: join(managedDir, "workstation-test-profile.json"),
    slicePath: join(options.homeDir, ".config", "systemd", "user", "hasna-tests.slice"),
    rollbackPath: join(managedDir, "workstation-test-profile.rollback.json"),
  };
}

function propertyEquals(actual: string | number | boolean | undefined, expected: string | number | boolean): boolean {
  if (typeof expected === "boolean") return actual === expected || actual === (expected ? "yes" : "no");
  if (typeof expected === "number") return Number(actual) === expected;
  return actual === expected;
}

function profileReasons(profile: WorkstationTestProfile): string[] {
  const reasons: string[] = [];
  if (profile.schema !== "machines.workstation_test_profile.v1") reasons.push("profile_schema_invalid");
  const positiveValues: Array<[string, number]> = [
    ["machine_total_memory", profile.machine.totalMemoryBytes],
    ["machine_logical_cpu", profile.machine.logicalCpuCount],
    ["aggregate_memory_high", profile.aggregate.memoryHighBytes],
    ["aggregate_memory_max", profile.aggregate.memoryMaxBytes],
    ["aggregate_tasks_max", profile.aggregate.tasksMax],
    ["non_test_reserve", profile.nonTestReserve.memoryBytes],
    ...Object.entries(profile.bounds).map(([name, value]) => [`bound_${name}`, value] as [string, number]),
  ];
  for (const [name, value] of positiveValues) {
    if (!Number.isSafeInteger(value) || value <= 0) reasons.push(`${name}_invalid`);
  }
  if (profile.aggregate.memorySwapMaxBytes !== 0) reasons.push("test_swap_not_zero");
  if (profile.aggregate.memoryHighBytes >= profile.aggregate.memoryMaxBytes) reasons.push("aggregate_memory_high_not_below_max");
  if (profile.aggregate.memoryMaxBytes + profile.nonTestReserve.memoryBytes !== profile.machine.totalMemoryBytes) {
    reasons.push("non_test_reserve_not_preserved");
  }
  if (!profile.aggregate.memoryOomGroup || profile.aggregate.managedOomMemoryPressure !== "kill") reasons.push("aggregate_whole_cgroup_kill_missing");
  if (profile.scope.requiredSlice !== profile.aggregate.sliceName || !profile.scope.memoryOomGroup || profile.scope.oomPolicy !== "kill") {
    reasons.push("scope_whole_cgroup_contract_invalid");
  }
  if (!REQUIRED_CONTROLLERS.every((controller) => profile.controller.requiredControllers.includes(controller))) {
    reasons.push("required_controller_profile_incomplete");
  }
  if (!profile.controller.delegationRequired) reasons.push("delegation_requirement_missing");
  return reasons;
}

function controllerReasons(snapshot: WorkstationTestControllerSnapshot, requireActiveSlice: boolean): string[] {
  const reasons: string[] = [];
  if (!snapshot.cgroupV2) reasons.push("cgroup_v2_unavailable");
  for (const controller of REQUIRED_CONTROLLERS) {
    if (!snapshot.controllers.includes(controller)) reasons.push(`controller_${controller}_unavailable`);
  }
  if (!snapshot.userManager) reasons.push("systemd_user_manager_unavailable");
  if (!snapshot.delegated) reasons.push("controller_delegation_unavailable");
  if (requireActiveSlice && (!snapshot.sliceLoaded || !snapshot.sliceActive)) reasons.push("aggregate_slice_inactive");
  return reasons;
}

export function verifyWorkstationTestProfile(input: {
  expectedProfile: WorkstationTestProfile;
  profileContent: string | null;
  sliceContent: string | null;
  controller: WorkstationTestControllerSnapshot;
}): WorkstationTestVerification {
  const reasons = [...profileReasons(input.expectedProfile), ...controllerReasons(input.controller, true)];
  if (input.profileContent !== serializeWorkstationTestProfile(input.expectedProfile)) reasons.push("managed_profile_missing_or_mismatched");
  if (input.sliceContent !== renderWorkstationTestSlice(input.expectedProfile)) reasons.push("aggregate_slice_missing_or_mismatched");

  const properties = input.controller.sliceProperties ?? {};
  const requiredProperties: Record<string, string | number | boolean> = {
    MemoryHigh: input.expectedProfile.aggregate.memoryHighBytes,
    MemoryMax: input.expectedProfile.aggregate.memoryMaxBytes,
    MemorySwapMax: 0,
    TasksMax: input.expectedProfile.aggregate.tasksMax,
    MemoryOOMGroup: true,
    ManagedOOMMemoryPressure: "kill",
  };
  for (const [name, expected] of Object.entries(requiredProperties)) {
    if (!propertyEquals(properties[name], expected)) reasons.push(`slice_property_${name.toLowerCase()}_mismatched`);
  }
  return { admission: reasons.length === 0 ? "allowed" : "refused", reasonCodes: reasons };
}

function rollbackContent(record: RollbackRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function parseRollback(content: string | null): RollbackRecord | null {
  if (content === null) return null;
  try {
    const value = JSON.parse(content) as Partial<RollbackRecord>;
    if (value.schema !== "machines.workstation_test_profile_rollback.v1") return null;
    if (!(typeof value.profileContent === "string" || value.profileContent === null)) return null;
    if (!(typeof value.sliceContent === "string" || value.sliceContent === null)) return null;
    return value as RollbackRecord;
  } catch {
    return null;
  }
}

export function applyWorkstationTestProfile(input: {
  profile: WorkstationTestProfile;
  paths: WorkstationTestProfilePaths;
  store: WorkstationTestProfileStore;
  controller: WorkstationTestProfileController;
}): { status: "applied" | "unchanged" | "refused"; admission: "allowed" | "refused"; reasonCodes: string[] } {
  const preflight = [...profileReasons(input.profile), ...controllerReasons(input.controller.inspect(), false)];
  if (preflight.length > 0) return { status: "refused", admission: "refused", reasonCodes: preflight };

  const profileContent = serializeWorkstationTestProfile(input.profile);
  const sliceContent = renderWorkstationTestSlice(input.profile);
  const currentProfile = input.store.read(input.paths.profilePath);
  const currentSlice = input.store.read(input.paths.slicePath);
  const currentRollback = input.store.read(input.paths.rollbackPath);

  const currentVerification = verifyWorkstationTestProfile({
    expectedProfile: input.profile,
    profileContent: currentProfile,
    sliceContent: currentSlice,
    controller: input.controller.inspect(),
  });
  if (currentVerification.admission === "allowed") {
    return { status: "unchanged", admission: "allowed", reasonCodes: [] };
  }
  if (currentRollback !== null) {
    return { status: "refused", admission: "refused", reasonCodes: ["rollback_already_pending"] };
  }

  const record: RollbackRecord = {
    schema: "machines.workstation_test_profile_rollback.v1",
    profileContent: currentProfile,
    sliceContent: currentSlice,
  };
  try {
    input.store.commit([
      { path: input.paths.rollbackPath, content: rollbackContent(record) },
      { path: input.paths.profilePath, content: profileContent },
      { path: input.paths.slicePath, content: sliceContent },
    ]);
    const activated = input.controller.activate(input.profile.aggregate.sliceName);
    const verified = verifyWorkstationTestProfile({
      expectedProfile: input.profile,
      profileContent: input.store.read(input.paths.profilePath),
      sliceContent: input.store.read(input.paths.slicePath),
      controller: activated,
    });
    if (verified.admission === "allowed") return { status: "applied", admission: "allowed", reasonCodes: [] };
    input.store.commit([
      { path: input.paths.profilePath, content: record.profileContent },
      { path: input.paths.slicePath, content: record.sliceContent },
      { path: input.paths.rollbackPath, content: null },
    ]);
    input.controller.reload();
    return { status: "refused", admission: "refused", reasonCodes: ["post_apply_verification_failed", ...verified.reasonCodes] };
  } catch (error) {
    input.store.commit([
      { path: input.paths.profilePath, content: record.profileContent },
      { path: input.paths.slicePath, content: record.sliceContent },
      { path: input.paths.rollbackPath, content: null },
    ]);
    input.controller.reload();
    return { status: "refused", admission: "refused", reasonCodes: ["apply_failed", error instanceof Error ? error.name : "unknown_error"] };
  }
}

export function rollbackWorkstationTestProfile(input: {
  paths: WorkstationTestProfilePaths;
  store: WorkstationTestProfileStore;
  controller: WorkstationTestProfileController;
}): { status: "rolled-back" | "refused"; admission: "allowed" | "refused"; reasonCodes: string[] } {
  const record = parseRollback(input.store.read(input.paths.rollbackPath));
  if (!record) return { status: "refused", admission: "refused", reasonCodes: ["rollback_record_missing_or_invalid"] };
  input.store.commit([
    { path: input.paths.profilePath, content: record.profileContent },
    { path: input.paths.slicePath, content: record.sliceContent },
    { path: input.paths.rollbackPath, content: null },
  ]);
  input.controller.reload();
  return { status: "rolled-back", admission: "refused", reasonCodes: ["safe_profile_unavailable_after_rollback"] };
}

export function evaluateWorkstationTestAdmission(
  profile: WorkstationTestProfile,
  scopes: readonly WorkstationTestScopeClaim[],
): WorkstationTestVerification {
  const reasons = new Set<string>();
  for (const reason of profileReasons(profile)) reasons.add(reason);
  const totals = {
    memoryMaxBytes: 0,
    tasks: 0,
    processes: 0,
    runtimes: 0,
    localTestWorkers: 0,
    browsers: 0,
    machineSlots: 0,
  };
  const seenScopeIds = new Set<string>();
  for (const scope of scopes) {
    if (!scope.scopeId.trim() || seenScopeIds.has(scope.scopeId)) reasons.add("scope_identity_invalid");
    seenScopeIds.add(scope.scopeId);
    if (scope.sliceName !== profile.aggregate.sliceName) reasons.add("scope_outside_aggregate_slice");
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      const value = scope[key];
      if (!Number.isSafeInteger(value) || value < 0 || (key === "memoryMaxBytes" && value === 0)) reasons.add("scope_bounds_invalid");
      else totals[key] += value;
    }
  }
  if (totals.memoryMaxBytes > profile.aggregate.memoryMaxBytes) reasons.add("aggregate_memory_limit_exceeded");
  if (totals.tasks > profile.aggregate.tasksMax) reasons.add("aggregate_tasks_limit_exceeded");
  if (totals.processes > profile.bounds.processesMax) reasons.add("aggregate_process_limit_exceeded");
  if (totals.runtimes > profile.bounds.runtimesMax) reasons.add("aggregate_runtime_limit_exceeded");
  if (totals.localTestWorkers > profile.bounds.localTestWorkersMax) reasons.add("aggregate_local_test_worker_limit_exceeded");
  if (totals.browsers > profile.bounds.browsersMax) reasons.add("aggregate_browser_limit_exceeded");
  if (totals.machineSlots > profile.bounds.machineSlotsMax) reasons.add("aggregate_machine_slot_limit_exceeded");
  const reasonCodes = [...reasons];
  return { admission: reasonCodes.length === 0 ? "allowed" : "refused", reasonCodes };
}

export function evaluateWorkstationTestPressure(
  profile: WorkstationTestProfile,
  scopes: readonly WorkstationTestPressureScope[],
): {
  action: "none" | "terminate-scope";
  terminatedScopeId: string | null;
  terminatedCgroup: string | null;
  terminatedPids: number[];
  unaffectedPids: number[];
  nonTestReserveBytes: number;
} {
  const offender = scopes.find((scope) => scope.memoryCurrentBytes > scope.memoryMaxBytes) ?? null;
  return {
    action: offender ? "terminate-scope" : "none",
    terminatedScopeId: offender?.scopeId ?? null,
    terminatedCgroup: offender?.cgroup ?? null,
    terminatedPids: offender ? [...offender.pids] : [],
    unaffectedPids: scopes.filter((scope) => scope !== offender).flatMap((scope) => scope.pids),
    nonTestReserveBytes: profile.nonTestReserve.memoryBytes,
  };
}

export function createNodeWorkstationTestProfileStore(): WorkstationTestProfileStore {
  return {
    read(path): string | null {
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    },
    commit(changes): void {
      const temporary: Array<{ target: string; temporary: string }> = [];
      try {
        for (const [index, change] of changes.entries()) {
          if (change.content === null) continue;
          mkdirSync(dirname(change.path), { recursive: true, mode: 0o700 });
          const temp = `${change.path}.tmp-${process.pid}-${index}`;
          writeFileSync(temp, change.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
          temporary.push({ target: change.path, temporary: temp });
        }
        for (const item of temporary) renameSync(item.temporary, item.target);
        for (const change of changes) if (change.content === null) rmSync(change.path, { force: true });
      } finally {
        for (const item of temporary) rmSync(item.temporary, { force: true });
      }
    },
  };
}

function systemctlShow(unit: string, properties: string[]): Record<string, string> {
  const output = execFileSync("systemctl", ["--user", "show", unit, ...properties.flatMap((name) => ["-p", name])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return Object.fromEntries(output.trim().split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function delegatedUserControllers(): string[] {
  if (!existsSync("/proc/self/cgroup")) return [];
  const unified = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  if (!unified) return [];
  const parts = unified.split("/").filter(Boolean);
  const userManagerIndex = parts.findIndex((part) => /^user@\d+\.service$/.test(part));
  if (userManagerIndex < 0) return [];
  const subtreePath = join("/sys/fs/cgroup", ...parts.slice(0, userManagerIndex + 1), "cgroup.subtree_control");
  if (!existsSync(subtreePath)) return [];
  return readFileSync(subtreePath, "utf8").trim().split(/\s+/).filter(Boolean);
}

export function createSystemdUserTestProfileController(): WorkstationTestProfileController {
  const inspect = (): WorkstationTestControllerSnapshot => {
    const cgroupV2 = existsSync("/sys/fs/cgroup/cgroup.controllers");
    const controllers = cgroupV2 ? readFileSync("/sys/fs/cgroup/cgroup.controllers", "utf8").trim().split(/\s+/).filter(Boolean) : [];
    const delegatedControllers = delegatedUserControllers();
    try {
      const values = systemctlShow("hasna-tests.slice", [
        "LoadState", "ActiveState", "MemoryHigh", "MemoryMax", "MemorySwapMax", "TasksMax", "MemoryOOMGroup", "ManagedOOMMemoryPressure",
      ]);
      return {
        cgroupV2,
        controllers,
        userManager: true,
        delegated: REQUIRED_CONTROLLERS.every((controller) => delegatedControllers.includes(controller)),
        sliceLoaded: values["LoadState"] === "loaded",
        sliceActive: values["ActiveState"] === "active",
        sliceProperties: {
          MemoryHigh: values["MemoryHigh"] ?? "",
          MemoryMax: values["MemoryMax"] ?? "",
          MemorySwapMax: values["MemorySwapMax"] ?? "",
          TasksMax: values["TasksMax"] ?? "",
          MemoryOOMGroup: values["MemoryOOMGroup"] ?? "",
          ManagedOOMMemoryPressure: values["ManagedOOMMemoryPressure"] ?? "",
        },
      };
    } catch {
      return { cgroupV2, controllers, userManager: false, delegated: false, sliceLoaded: false, sliceActive: false };
    }
  };
  return {
    inspect,
    activate(sliceName): WorkstationTestControllerSnapshot {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      execFileSync("systemctl", ["--user", "start", sliceName], { stdio: "ignore" });
      return inspect();
    },
    reload(): WorkstationTestControllerSnapshot {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      return inspect();
    },
  };
}

export function readWorkstationTestProfile(options: {
  authority?: MachineTestAuthority;
  homeDir?: string;
  store?: WorkstationTestProfileStore;
  controller?: WorkstationTestProfileController;
} = {}): { profile: WorkstationTestProfile; paths: WorkstationTestProfilePaths; verification: WorkstationTestVerification } {
  const profile = deriveWorkstationTestProfile(options.authority ?? readMachineTestAuthority());
  const paths = workstationTestProfilePaths({ homeDir: options.homeDir ?? process.env["HOME"] ?? "" });
  const store = options.store ?? createNodeWorkstationTestProfileStore();
  const controller = options.controller ?? createSystemdUserTestProfileController();
  return {
    profile,
    paths,
    verification: verifyWorkstationTestProfile({
      expectedProfile: profile,
      profileContent: store.read(paths.profilePath),
      sliceContent: store.read(paths.slicePath),
      controller: controller.inspect(),
    }),
  };
}
