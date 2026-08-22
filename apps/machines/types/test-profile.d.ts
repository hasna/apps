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
    nonTestReserve: {
        memoryBytes: number;
    };
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
    sliceName: string;
    cgroupV2: boolean;
    controllers: string[];
    userManager: boolean;
    delegated: boolean;
    sliceLoaded: boolean;
    sliceActive: boolean;
    sliceProperties?: Record<string, string | number | boolean>;
};
export type WorkstationTestScopeSnapshot = {
    unitName: string;
    sliceName: string;
    loadState: string;
    activeState: string;
    subState: string;
    controlGroup: string;
    invocationId: string;
    observedAtMs: number;
};
export type WorkstationTestProfilePaths = {
    profilePath: string;
    slicePath: string;
    rollbackPath: string;
};
export type WorkstationTestFileChange = {
    path: string;
    content: string | null;
};
export interface WorkstationTestProfileStore {
    read(path: string): string | null;
    commit(changes: readonly WorkstationTestFileChange[]): void;
}
export interface WorkstationTestProfileController {
    inspect(sliceName?: string): WorkstationTestControllerSnapshot;
    inspectScope(unitName: string): WorkstationTestScopeSnapshot | null;
    activate(sliceName: string): WorkstationTestControllerSnapshot;
    reload(): WorkstationTestControllerSnapshot;
    restore(sliceName: string, active: boolean): WorkstationTestControllerSnapshot;
}
export type WorkstationTestScopeClaim = {
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
export type WorkstationTestPressureScope = WorkstationTestScopeClaim & {
    cgroup: string;
    pids: number[];
    memoryCurrentBytes: number;
};
export type WorkstationTestVerification = {
    admission: "allowed" | "refused";
    reasonCodes: string[];
};
export declare function readMachineTestAuthority(): MachineTestAuthority;
export declare function deriveWorkstationTestProfile(authority: MachineTestAuthority): WorkstationTestProfile;
export declare function renderWorkstationTestSlice(profile: WorkstationTestProfile): string;
export declare function serializeWorkstationTestProfile(profile: WorkstationTestProfile): string;
export declare function workstationTestProfilePaths(options: {
    homeDir: string;
}): WorkstationTestProfilePaths;
export declare function verifyWorkstationTestProfile(input: {
    expectedProfile: WorkstationTestProfile;
    profileContent: string | null;
    sliceContent: string | null;
    controller: WorkstationTestControllerSnapshot;
}): WorkstationTestVerification;
export declare function applyWorkstationTestProfile(input: {
    profile: WorkstationTestProfile;
    paths: WorkstationTestProfilePaths;
    store: WorkstationTestProfileStore;
    controller: WorkstationTestProfileController;
}): {
    status: "applied" | "unchanged" | "refused";
    admission: "allowed" | "refused";
    reasonCodes: string[];
};
export declare function rollbackWorkstationTestProfile(input: {
    paths: WorkstationTestProfilePaths;
    store: WorkstationTestProfileStore;
    controller: WorkstationTestProfileController;
}): {
    status: "rolled-back" | "refused";
    admission: "allowed" | "refused";
    reasonCodes: string[];
};
/**
 * Read-only leaf admission. The leaf-lifecycle owner must create and clean up
 * the empty scope, and must not start its workload until this returns allowed.
 */
export declare function evaluateWorkstationTestAdmission(input: {
    authority: MachineTestAuthority;
    homeDir: string;
    store: WorkstationTestProfileStore;
    controller: WorkstationTestProfileController;
    scopes: readonly WorkstationTestScopeClaim[];
}): WorkstationTestVerification;
export declare function evaluateWorkstationTestPressure(profile: WorkstationTestProfile, scopes: readonly WorkstationTestPressureScope[]): {
    action: "none" | "terminate-scope";
    terminatedScopeId: string | null;
    terminatedCgroup: string | null;
    terminatedPids: number[];
    unaffectedPids: number[];
    nonTestReserveBytes: number;
};
export declare function enforceWorkstationTestPressure(profile: WorkstationTestProfile, scopes: readonly WorkstationTestPressureScope[], execute?: (command: string, args: readonly string[]) => void): {
    action: "none" | "terminate-slice";
    triggeringScopeId: string | null;
    terminatedSliceName: string | null;
    unaffectedPids: number[];
    nonTestReserveBytes: number;
};
export declare function createNodeWorkstationTestProfileStore(): WorkstationTestProfileStore;
export declare function createSystemdUserTestProfileController(): WorkstationTestProfileController;
export declare function readWorkstationTestProfile(options?: {
    authority?: MachineTestAuthority;
    homeDir?: string;
    store?: WorkstationTestProfileStore;
    controller?: WorkstationTestProfileController;
}): {
    profile: WorkstationTestProfile;
    paths: WorkstationTestProfilePaths;
    verification: WorkstationTestVerification;
};
