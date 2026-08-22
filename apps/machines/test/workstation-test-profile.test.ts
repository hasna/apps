import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as machines from "../src/test-profile.js";

const GIB = 1024 ** 3;

type MachineAuthority = {
  machineId: string;
  platform: "linux";
  totalMemoryBytes: number;
  logicalCpuCount: number;
};

type Profile = {
  schema: "machines.workstation_test_profile.v1";
  machine: MachineAuthority;
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

type ControllerSnapshot = {
  sliceName: string;
  cgroupV2: boolean;
  controllers: string[];
  userManager: boolean;
  delegated: boolean;
  sliceLoaded: boolean;
  sliceActive: boolean;
  sliceProperties?: Record<string, string | number | boolean>;
};

type ScopeSnapshot = {
  unitName: string;
  sliceName: string;
  loadState: string;
  activeState: string;
  subState: string;
  controlGroup: string;
  invocationId: string;
  observedAtMs: number;
};

type ManagedPaths = {
  profilePath: string;
  slicePath: string;
  rollbackPath: string;
};

type FileChange = { path: string; content: string | null };

interface Store {
  read(path: string): string | null;
  commit(changes: readonly FileChange[]): void;
}

interface Controller {
  inspect(sliceName?: string): ControllerSnapshot;
  inspectScope(unitName: string): ScopeSnapshot | null;
  activate(sliceName: string): ControllerSnapshot;
  reload(): ControllerSnapshot;
  restore(sliceName: string, active: boolean): ControllerSnapshot;
}

type ScopeClaim = {
  scopeId: string;
  unitName: string;
  invocationId: string;
  memoryMaxBytes: number;
  tasks: number;
  processes: number;
  runtimes: number;
  localTestWorkers: number;
  browsers: number;
  machineSlots: number;
};

type PressureScope = ScopeClaim & {
  cgroup: string;
  pids: number[];
  memoryCurrentBytes: number;
};

type ProfileApi = {
  deriveWorkstationTestProfile(authority: MachineAuthority): Profile;
  renderWorkstationTestSlice(profile: Profile): string;
  workstationTestProfilePaths(options: { homeDir: string }): ManagedPaths;
  serializeWorkstationTestProfile(profile: Profile): string;
  verifyWorkstationTestProfile(input: {
    expectedProfile: Profile;
    profileContent: string | null;
    sliceContent: string | null;
    controller: ControllerSnapshot;
  }): { admission: "allowed" | "refused"; reasonCodes: string[] };
  applyWorkstationTestProfile(input: {
    profile: Profile;
    paths: ManagedPaths;
    store: Store;
    controller: Controller;
  }): { status: "applied" | "unchanged" | "refused"; admission: "allowed" | "refused"; reasonCodes: string[] };
  rollbackWorkstationTestProfile(input: {
    paths: ManagedPaths;
    store: Store;
    controller: Controller;
  }): { status: "rolled-back" | "refused"; admission: "allowed" | "refused"; reasonCodes: string[] };
  evaluateWorkstationTestAdmission(input: {
    authority: MachineAuthority;
    homeDir: string;
    store: Store;
    controller: Controller;
    scopes: readonly ScopeClaim[];
  }): {
    admission: "allowed" | "refused";
    reasonCodes: string[];
  };
  evaluateWorkstationTestPressure(profile: Profile, scopes: readonly PressureScope[]): {
    action: "none" | "terminate-scope";
    terminatedScopeId: string | null;
    terminatedCgroup: string | null;
    terminatedPids: number[];
    unaffectedPids: number[];
    nonTestReserveBytes: number;
  };
  enforceWorkstationTestPressure(
    profile: Profile,
    scopes: readonly PressureScope[],
    execute: (command: string, args: readonly string[]) => void,
  ): {
    action: "none" | "terminate-slice";
    triggeringScopeId: string | null;
    terminatedSliceName: string | null;
    unaffectedPids: number[];
    nonTestReserveBytes: number;
  };
  readWorkstationTestProfile(options: {
    authority: MachineAuthority;
    homeDir: string;
    store: Store;
    controller: Controller;
  }): { profile: Profile; paths: ManagedPaths; verification: { admission: "allowed" | "refused"; reasonCodes: string[] } };
};

function profileApi(): ProfileApi {
  const candidate = machines as unknown as Partial<ProfileApi>;
  for (const name of [
    "deriveWorkstationTestProfile",
    "renderWorkstationTestSlice",
    "workstationTestProfilePaths",
    "serializeWorkstationTestProfile",
    "verifyWorkstationTestProfile",
    "applyWorkstationTestProfile",
    "rollbackWorkstationTestProfile",
    "evaluateWorkstationTestAdmission",
    "evaluateWorkstationTestPressure",
    "enforceWorkstationTestPressure",
    "readWorkstationTestProfile",
  ] as const) {
    expect(typeof candidate[name], `@hasna/machines must export ${name}`).toBe("function");
  }
  return candidate as ProfileApi;
}

function authority(overrides: Partial<MachineAuthority> = {}): MachineAuthority {
  return {
    machineId: "station-fixture",
    platform: "linux",
    totalMemoryBytes: 64 * GIB,
    logicalCpuCount: 16,
    ...overrides,
  };
}

function activeController(profile: Profile): ControllerSnapshot {
  return {
    sliceName: profile.aggregate.sliceName,
    cgroupV2: true,
    controllers: ["cpu", "memory", "pids"],
    userManager: true,
    delegated: true,
    sliceLoaded: true,
    sliceActive: true,
    sliceProperties: {
      MemoryHigh: profile.aggregate.memoryHighBytes,
      MemoryMax: profile.aggregate.memoryMaxBytes,
      MemorySwapMax: profile.aggregate.memorySwapMaxBytes,
      TasksMax: profile.aggregate.tasksMax,
      MemoryOOMGroup: true,
      ManagedOOMMemoryPressure: "kill",
    },
  };
}

class MemoryStore implements Store {
  readonly files = new Map<string, string>();
  commits = 0;

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) this.files.set(path, content);
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  commit(changes: readonly FileChange[]): void {
    this.commits += 1;
    for (const change of changes) {
      if (change.content === null) this.files.delete(change.path);
      else this.files.set(change.path, change.content);
    }
  }
}

class FixtureController implements Controller {
  activateCalls = 0;
  reloadCalls = 0;
  readonly inspectScopeCalls: string[] = [];
  readonly restoreCalls: Array<{ sliceName: string; active: boolean }> = [];

  constructor(
    private readonly before: ControllerSnapshot,
    private readonly after: ControllerSnapshot = before,
    private readonly rolledBack: ControllerSnapshot = before,
    private readonly scopeSnapshots: ReadonlyMap<string, ScopeSnapshot | null> = new Map(),
  ) {}

  inspect(): ControllerSnapshot {
    return this.before;
  }

  inspectScope(unitName: string): ScopeSnapshot | null {
    this.inspectScopeCalls.push(unitName);
    return this.scopeSnapshots.get(unitName) ?? null;
  }

  activate(): ControllerSnapshot {
    this.activateCalls += 1;
    return this.after;
  }

  reload(): ControllerSnapshot {
    this.reloadCalls += 1;
    return this.rolledBack;
  }

  restore(sliceName: string, active: boolean): ControllerSnapshot {
    this.restoreCalls.push({ sliceName, active });
    return this.rolledBack;
  }
}

function claim(profile: Profile, scopeId: string, memoryMaxBytes: number): ScopeClaim {
  return {
    scopeId,
    unitName: `${scopeId}.scope`,
    invocationId: "0123456789abcdef0123456789abcdef",
    memoryMaxBytes,
    tasks: Math.max(1, Math.floor(profile.aggregate.tasksMax / 4)),
    processes: Math.max(1, Math.floor(profile.bounds.processesMax / 4)),
    runtimes: 1,
    localTestWorkers: 1,
    browsers: 0,
    machineSlots: 1,
  };
}

function observedScope(
  profile: Profile,
  scope: ScopeClaim,
  overrides: Partial<ScopeSnapshot> = {},
): ScopeSnapshot {
  return {
    unitName: scope.unitName,
    sliceName: profile.aggregate.sliceName,
    loadState: "loaded",
    activeState: "active",
    subState: "running",
    controlGroup: `/user.slice/user-1000.slice/user@1000.service/app.slice/${profile.aggregate.sliceName}/${scope.unitName}`,
    invocationId: scope.invocationId,
    observedAtMs: Date.now(),
    ...overrides,
  };
}

function controllerWithScopes(profile: Profile, scopes: readonly ScopeClaim[]): FixtureController {
  return new FixtureController(
    activeController(profile),
    activeController(profile),
    activeController(profile),
    new Map(scopes.map((scope) => [scope.unitName, observedScope(profile, scope)])),
  );
}

describe("aggregate workstation test profile", () => {
  test("renders numeric aggregate controls, a protected reserve, zero test swap, whole-cgroup kill, and inspectable bounds", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const unit = api.renderWorkstationTestSlice(profile);

    expect(profile.schema).toBe("machines.workstation_test_profile.v1");
    expect(profile.controller).toEqual({
      kind: "systemd-cgroup-v2",
      requiredControllers: ["cpu", "memory", "pids"],
      delegationRequired: true,
    });
    expect(profile.nonTestReserve.memoryBytes).toBeGreaterThan(0);
    expect(profile.aggregate.memoryMaxBytes + profile.nonTestReserve.memoryBytes).toBe(profile.machine.totalMemoryBytes);
    expect(profile.aggregate.memoryHighBytes).toBeLessThan(profile.aggregate.memoryMaxBytes);
    expect(profile.aggregate.memorySwapMaxBytes).toBe(0);
    expect(profile.aggregate.memoryOomGroup).toBe(true);
    expect(profile.aggregate.managedOomMemoryPressure).toBe("kill");
    expect(profile.scope).toMatchObject({
      requiredSlice: profile.aggregate.sliceName,
      memoryOomGroup: true,
      oomPolicy: "kill",
    });
    for (const value of Object.values(profile.bounds)) {
      expect(typeof value).toBe("number");
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(profile.earlyoom).toMatchObject({ role: "host-backstop", primaryTestController: false });
    expect(profile.earlyoom.memoryAvailablePercent).toBeGreaterThan(4);

    expect(unit).toContain(`[Slice]`);
    expect(unit).toContain(`MemoryHigh=${profile.aggregate.memoryHighBytes}`);
    expect(unit).toContain(`MemoryMax=${profile.aggregate.memoryMaxBytes}`);
    expect(unit).toContain("MemorySwapMax=0");
    expect(unit).toContain("MemoryOOMGroup=yes");
    expect(unit).toContain("ManagedOOMMemoryPressure=kill");
    expect(unit).toContain(`TasksMax=${profile.aggregate.tasksMax}`);

    const earlyoom = readFileSync(
      resolve(import.meta.dir, "../templates/station/files/base/etc/systemd/system/earlyoom.service.d/50-hasna-station.conf"),
      "utf8",
    );
    expect(earlyoom).toContain(`-m ${profile.earlyoom.memoryAvailablePercent}`);
    expect(earlyoom).toContain(`-s ${profile.earlyoom.swapFreePercent}`);
    expect(earlyoom).not.toMatch(/--prefer[^\n]*(node|bun)/);
  });

  test("fails closed without every controller, delegation, installed profile, and active aggregate slice", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const paths = api.workstationTestProfilePaths({ homeDir: "/fixture/home" });
    const completeProfile = api.serializeWorkstationTestProfile(profile);
    const completeSlice = api.renderWorkstationTestSlice(profile);

    const completeStore = new MemoryStore({
      [paths.profilePath]: completeProfile,
      [paths.slicePath]: completeSlice,
    });
    expect(api.readWorkstationTestProfile({
      authority: authority(),
      homeDir: "/fixture/home",
      store: completeStore,
      controller: new FixtureController(activeController(profile)),
    }).verification).toEqual({ admission: "allowed", reasonCodes: [] });

    const refusedSnapshots: Array<[string, Partial<ControllerSnapshot>]> = [
      ["controller", { controllers: ["cpu", "pids"] }],
      ["delegation", { delegated: false }],
      ["slice", { sliceLoaded: false, sliceActive: false }],
    ];
    for (const [reason, override] of refusedSnapshots) {
      const snapshot = { ...activeController(profile), ...override };
      const verified = api.verifyWorkstationTestProfile({
        expectedProfile: profile,
        profileContent: completeProfile,
        sliceContent: completeSlice,
        controller: snapshot,
      });
      expect(verified.admission, reason).toBe("refused");
    }
    expect(api.verifyWorkstationTestProfile({
      expectedProfile: profile,
      profileContent: null,
      sliceContent: completeSlice,
      controller: activeController(profile),
    }).admission).toBe("refused");

    const store = new MemoryStore();
    const controller = new FixtureController({ ...activeController(profile), delegated: false });
    const applied = api.applyWorkstationTestProfile({ profile, paths, store, controller });
    expect(applied).toMatchObject({ status: "refused", admission: "refused" });
    expect(store.commits).toBe(0);
    expect(store.files.size).toBe(0);
    expect(controller.activateCalls).toBe(0);
  });

  test("repeated apply is idempotent and keeps the original rollback preimage", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const paths = api.workstationTestProfilePaths({ homeDir: "/fixture/home" });
    const inactive = { ...activeController(profile), sliceLoaded: false, sliceActive: false };
    const active = activeController(profile);
    const store = new MemoryStore();
    const firstController = new FixtureController(inactive, active);

    const first = api.applyWorkstationTestProfile({ profile, paths, store, controller: firstController });
    expect(first).toMatchObject({ status: "applied", admission: "allowed" });
    const rollbackRecord = store.read(paths.rollbackPath);
    expect(rollbackRecord).not.toBeNull();
    const commitsAfterFirst = store.commits;

    const secondController = new FixtureController(active, active);
    const second = api.applyWorkstationTestProfile({ profile, paths, store, controller: secondController });
    expect(second).toMatchObject({ status: "unchanged", admission: "allowed" });
    expect(store.commits).toBe(commitsAfterFirst);
    expect(store.read(paths.rollbackPath)).toBe(rollbackRecord);
    expect(secondController.activateCalls).toBe(0);
  });

  test("two or more focused scopes cannot exceed aggregate profile limits", () => {
    const api = profileApi();
    const machineAuthority = authority();
    const profile = api.deriveWorkstationTestProfile(machineAuthority);
    const homeDir = "/fixture/home";
    const paths = api.workstationTestProfilePaths({ homeDir });
    const store = new MemoryStore({
      [paths.profilePath]: api.serializeWorkstationTestProfile(profile),
      [paths.slicePath]: api.renderWorkstationTestSlice(profile),
    });
    const within = Math.floor(profile.aggregate.memoryMaxBytes * 0.4);
    const over = Math.floor(profile.aggregate.memoryMaxBytes * 0.6);
    const withinScopes = [claim(profile, "focused-a", within), claim(profile, "focused-b", within)];
    const overScopes = [claim(profile, "focused-a", over), claim(profile, "focused-b", over)];

    expect(api.evaluateWorkstationTestAdmission({
      authority: machineAuthority,
      homeDir,
      store,
      controller: controllerWithScopes(profile, withinScopes),
      scopes: withinScopes,
    })).toMatchObject({ admission: "allowed", reasonCodes: [] });

    const refused = api.evaluateWorkstationTestAdmission({
      authority: machineAuthority,
      homeDir,
      store,
      controller: controllerWithScopes(profile, overScopes),
      scopes: overScopes,
    });
    expect(refused.admission).toBe("refused");
    expect(refused.reasonCodes).toContain("aggregate_memory_limit_exceeded");
  });

  test("admission refuses absent controller evidence and never trusts caller-supplied profile claims", () => {
    const api = profileApi();
    const machineAuthority = authority();
    const profile = api.deriveWorkstationTestProfile(machineAuthority);
    const homeDir = "/fixture/home";
    const inactive = { ...activeController(profile), sliceLoaded: false, sliceActive: false };

    const refused = api.evaluateWorkstationTestAdmission({
      authority: machineAuthority,
      homeDir,
      store: new MemoryStore(),
      controller: new FixtureController(inactive),
      scopes: [claim(profile, "focused-a", Math.floor(profile.aggregate.memoryMaxBytes * 0.2))],
    });
    expect(refused.admission).toBe("refused");
    expect(refused.reasonCodes).toContain("managed_profile_missing_or_mismatched");
    expect(refused.reasonCodes).toContain("aggregate_slice_inactive");

    const legacyCaller = api.evaluateWorkstationTestAdmission as unknown as (
      suppliedProfile: Profile,
      suppliedScopes: readonly ScopeClaim[],
    ) => { admission: "allowed" | "refused"; reasonCodes: string[] };
    expect(legacyCaller(profile, [claim(profile, "caller-only", 1)])).toEqual({
      admission: "refused",
      reasonCodes: ["current_controller_evidence_required"],
    });
  });

  test("admission accepts a currently observed nested leaf and rejects the reviewer's fabricated caller claim before execution", () => {
    const api = profileApi();
    const machineAuthority = authority();
    const profile = api.deriveWorkstationTestProfile(machineAuthority);
    const homeDir = "/fixture/home";
    const paths = api.workstationTestProfilePaths({ homeDir });
    const store = new MemoryStore({
      [paths.profilePath]: api.serializeWorkstationTestProfile(profile),
      [paths.slicePath]: api.renderWorkstationTestSlice(profile),
    });
    const nested = claim(profile, "nested-leaf", 1024);
    const observedController = controllerWithScopes(profile, [nested]);

    expect(api.evaluateWorkstationTestAdmission({
      authority: machineAuthority,
      homeDir,
      store,
      controller: observedController,
      scopes: [nested],
    })).toEqual({ admission: "allowed", reasonCodes: [] });
    expect(observedController.inspectScopeCalls).toEqual(["nested-leaf.scope"]);

    const fabricatedController = new FixtureController(activeController(profile));
    const fabricated = {
      ...claim(profile, "fabricated", 1024),
      sliceName: profile.aggregate.sliceName,
      observed: observedScope(profile, claim(profile, "fabricated", 1024)),
    } as unknown as ScopeClaim;
    const refused = api.evaluateWorkstationTestAdmission({
      authority: machineAuthority,
      homeDir,
      store,
      controller: fabricatedController,
      scopes: [fabricated],
    });

    expect(refused.admission).toBe("refused");
    expect(refused.reasonCodes).toContain("scope_observation_missing");
    expect(fabricatedController.inspectScopeCalls).toEqual(["fabricated.scope"]);
    expect(fabricatedController.activateCalls).toBe(0);
    expect(fabricatedController.reloadCalls).toBe(0);
    expect(fabricatedController.restoreCalls).toEqual([]);
  });

  test("admission refuses missing, inactive, stale, replaced, wrong-parent, and ambiguous observed leaf scopes", () => {
    const api = profileApi();
    const machineAuthority = authority();
    const profile = api.deriveWorkstationTestProfile(machineAuthority);
    const homeDir = "/fixture/home";
    const paths = api.workstationTestProfilePaths({ homeDir });
    const store = new MemoryStore({
      [paths.profilePath]: api.serializeWorkstationTestProfile(profile),
      [paths.slicePath]: api.renderWorkstationTestSlice(profile),
    });
    const scope = claim(profile, "focused-negative", 1024);
    const cases: Array<[string, ScopeSnapshot | null, string]> = [
      ["missing", null, "scope_observation_missing"],
      ["inactive", observedScope(profile, scope, { activeState: "inactive", subState: "dead" }), "scope_unit_inactive"],
      ["stale", observedScope(profile, scope, { observedAtMs: Date.now() - 60_000 }), "scope_observation_stale"],
      ["replaced", observedScope(profile, scope, { invocationId: "fedcba9876543210fedcba9876543210" }), "scope_invocation_mismatched"],
      ["wrong-parent", observedScope(profile, scope, {
        sliceName: "app.slice",
        controlGroup: `/user.slice/user-1000.slice/user@1000.service/app.slice/${scope.unitName}`,
      }), "scope_outside_aggregate_slice"],
      ["ambiguous", observedScope(profile, scope, {
        controlGroup: `/user.slice/${profile.aggregate.sliceName}/${profile.aggregate.sliceName}/${scope.unitName}`,
      }), "scope_cgroup_ambiguous"],
    ];

    for (const [name, snapshot, reason] of cases) {
      const controller = new FixtureController(
        activeController(profile),
        activeController(profile),
        activeController(profile),
        new Map([[scope.unitName, snapshot]]),
      );
      const result = api.evaluateWorkstationTestAdmission({
        authority: machineAuthority,
        homeDir,
        store,
        controller,
        scopes: [scope],
      });
      expect(result.admission, name).toBe("refused");
      expect(result.reasonCodes, name).toContain(reason);
      expect(controller.activateCalls, name).toBe(0);
      expect(controller.reloadCalls, name).toBe(0);
      expect(controller.restoreCalls, name).toEqual([]);
    }
  });

  test("an over-limit test scope is terminated as one cgroup while unrelated processes and the non-test reserve remain", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const safeClaim = claim(profile, "safe", Math.floor(profile.aggregate.memoryMaxBytes * 0.2));
    const badClaim = claim(profile, "offender", Math.floor(profile.aggregate.memoryMaxBytes * 0.25));
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const result = api.enforceWorkstationTestPressure(profile, [
      { ...safeClaim, cgroup: "/user.slice/hasna-tests.slice/safe.scope", pids: [101, 102], memoryCurrentBytes: safeClaim.memoryMaxBytes },
      { ...badClaim, cgroup: "/user.slice/hasna-tests.slice/offender.scope", pids: [201, 202, 203], memoryCurrentBytes: badClaim.memoryMaxBytes + 1 },
    ], (command, args) => calls.push({ command, args }));

    expect(result).toEqual({
      action: "terminate-slice",
      triggeringScopeId: "offender",
      terminatedSliceName: "hasna-tests.slice",
      unaffectedPids: [],
      nonTestReserveBytes: profile.nonTestReserve.memoryBytes,
    });
    expect(calls).toEqual([{
      command: "systemctl",
      args: ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", "hasna-tests.slice"],
    }]);
  });

  test("whole-cgroup enforcement refuses a substituted slice target without executing it", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const substituted = {
      ...profile,
      aggregate: { ...profile.aggregate, sliceName: "important.service" },
      scope: { ...profile.scope, requiredSlice: "important.service" },
    };
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const overLimit = claim(substituted, "offender", 1024);

    expect(() => api.enforceWorkstationTestPressure(substituted, [{
      ...overLimit,
      cgroup: "/user.slice/important.service/offender.scope",
      pids: [201],
      memoryCurrentBytes: 1025,
    }], (command, args) => {
      calls.push({ command, args });
    })).toThrow("aggregate_slice_name_invalid");
    expect(calls).toEqual([]);
  });

  test("rollback restores the exact prior managed state and leaves admission refused when that state is not safe", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const paths = api.workstationTestProfilePaths({ homeDir: "/fixture/home" });
    const priorProfile = "{\"legacy\":true}\n";
    const priorSlice = "[Slice]\nMemoryMax=infinity\n";
    const store = new MemoryStore({
      [paths.profilePath]: priorProfile,
      [paths.slicePath]: priorSlice,
    });
    const inactive = { ...activeController(profile), sliceLoaded: false, sliceActive: false };
    const active = activeController(profile);

    expect(api.applyWorkstationTestProfile({
      profile,
      paths,
      store,
      controller: new FixtureController(inactive, active),
    })).toMatchObject({ status: "applied", admission: "allowed" });

    const rollbackController = new FixtureController(active, active, inactive);
    const rolledBack = api.rollbackWorkstationTestProfile({
      paths,
      store,
      controller: rollbackController,
    });
    expect(rolledBack).toMatchObject({ status: "rolled-back", admission: "refused" });
    expect(store.read(paths.profilePath)).toBe(priorProfile);
    expect(store.read(paths.slicePath)).toBe(priorSlice);
    expect(store.read(paths.rollbackPath)).toBeNull();
    expect(rollbackController.restoreCalls).toEqual([{ sliceName: profile.aggregate.sliceName, active: false }]);
    expect(rolledBack.reasonCodes.length).toBeGreaterThan(0);
  });

  test("rollback refuses unexpected managed-file drift and preserves both drift and rollback evidence", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const paths = api.workstationTestProfilePaths({ homeDir: "/fixture/home" });
    const inactive = { ...activeController(profile), sliceLoaded: false, sliceActive: false };
    const active = activeController(profile);
    const store = new MemoryStore();
    expect(api.applyWorkstationTestProfile({
      profile,
      paths,
      store,
      controller: new FixtureController(inactive, active),
    }).status).toBe("applied");
    const rollbackRecord = store.read(paths.rollbackPath);
    store.files.set(paths.slicePath, "[Slice]\nMemoryMax=unexpected-drift\n");
    const rollbackController = new FixtureController(active, active, inactive);

    const refused = api.rollbackWorkstationTestProfile({ paths, store, controller: rollbackController });
    expect(refused).toEqual({
      status: "refused",
      admission: "refused",
      reasonCodes: ["applied_postimage_drift_detected"],
    });
    expect(store.read(paths.slicePath)).toBe("[Slice]\nMemoryMax=unexpected-drift\n");
    expect(store.read(paths.profilePath)).toBe(api.serializeWorkstationTestProfile(profile));
    expect(store.read(paths.rollbackPath)).toBe(rollbackRecord);
    expect(rollbackController.restoreCalls).toEqual([]);
  });

  test("post-apply verification failure restores prior bytes and prior active runtime state", () => {
    const api = profileApi();
    const profile = api.deriveWorkstationTestProfile(authority());
    const paths = api.workstationTestProfilePaths({ homeDir: "/fixture/home" });
    const priorProfile = "{\"legacy\":true}\n";
    const priorSlice = "[Slice]\nMemoryMax=infinity\n";
    const priorActive = activeController(profile);
    const mismatched = {
      ...priorActive,
      sliceProperties: { ...priorActive.sliceProperties, MemoryMax: profile.aggregate.memoryMaxBytes - 1 },
    };
    const store = new MemoryStore({
      [paths.profilePath]: priorProfile,
      [paths.slicePath]: priorSlice,
    });
    const controller = new FixtureController(priorActive, mismatched, priorActive);

    const refused = api.applyWorkstationTestProfile({ profile, paths, store, controller });
    expect(refused.status).toBe("refused");
    expect(refused.reasonCodes).toContain("post_apply_verification_failed");
    expect(store.read(paths.profilePath)).toBe(priorProfile);
    expect(store.read(paths.slicePath)).toBe(priorSlice);
    expect(store.read(paths.rollbackPath)).toBeNull();
    expect(controller.restoreCalls).toEqual([{ sliceName: profile.aggregate.sliceName, active: true }]);
  });
});
