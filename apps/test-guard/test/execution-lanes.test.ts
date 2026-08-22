import { describe, expect, test } from "bun:test";
import {
  admitResolvedExecutionPlan,
  classifyResolvedExecutionPlan,
  createTerminalReceipt,
  executeAdmittedPlan,
  resolveWrapperInvocation,
  verifyAggregateControllerObservation,
  type AdmissionReceipt,
  type AdmissionContext,
  type ResolvedExecutionPlan,
} from "../runtime.mjs";

const limits = {
  memoryHighBytes: 512 * 1024 * 1024,
  memoryMaxBytes: 1024 * 1024 * 1024,
  swapMaxBytes: 0,
  pidsMax: 64,
  wallTimeMs: 30_000,
};

const activeAggregateObservation = [
  "Id=hasna-tests.slice",
  "Names=hasna-tests.slice",
  "LoadState=loaded",
  "ActiveState=active",
  "MemoryAccounting=yes",
  "MemoryMax=34359738368",
  "MemorySwapMax=0",
  "TasksMax=8192",
  "ControlGroup=/hasna-tests.slice",
  "",
].join("\n");

const aggregateController = verifyAggregateControllerObservation(activeAggregateObservation);

function focusedPlan(overrides: Partial<ResolvedExecutionPlan> = {}): ResolvedExecutionPlan {
  return {
    schema: "hasna.test_guard.execution_plan.v1",
    planId: "plan-focused-one",
    intent: "execute",
    runner: "bun",
    invocation: { executable: "bun", argv: ["test", "test/execution-lanes.test.ts"] },
    maySpawn: true,
    packages: ["@hasna/test-guard"],
    targetIds: ["test/execution-lanes.test.ts"],
    selector: "explicit",
    packageWide: false,
    workspaceWide: false,
    recursive: false,
    localCi: false,
    lifecycleHooks: [],
    dynamicDiscovery: false,
    fanout: 1,
    descendants: [],
    limits,
    ...overrides,
  };
}

const rootContext: AdmissionContext = {
  allocation: {
    allocationId: "test-guard-plan-focused-one.scope",
    leaseId: "test-guard-plan-focused-one.scope",
    cgroupId: "/hasna-tests.slice/test-guard-plan-focused-one.scope",
    leafScopeUnit: "test-guard-plan-focused-one.scope",
    aggregateController,
  },
};

function childContext(parentAdmission: AdmissionReceipt): AdmissionContext {
  return {
    parentAdmission,
    aggregateController: verifyAggregateControllerObservation(activeAggregateObservation),
    currentCgroupPath: "/hasna-tests.slice/test-guard-plan-focused-one.scope",
  };
}

describe("resolved execution lane classification", () => {
  test("known finite single-target plan admits LOCAL_FOCUSED", () => {
    const classification = classifyResolvedExecutionPlan(focusedPlan());
    expect(classification.lane).toBe("LOCAL_FOCUSED");
    expect(classification.reasons).toEqual([]);

    const admission = admitResolvedExecutionPlan(focusedPlan(), rootContext);
    expect(admission.decision).toBe("ADMIT");
    expect(admission.lane).toBe("LOCAL_FOCUSED");
    expect(admission.acquiredLocalAllocation).toBe(true);
    expect(admission.allocationId).toBe("test-guard-plan-focused-one.scope");
  });

  const cloudFullCases: Array<[string, Partial<ResolvedExecutionPlan>]> = [
    ["package-wide", { packageWide: true, targetIds: [], selector: "omitted" }],
    ["workspace-wide", { workspaceWide: true, packages: ["@hasna/test-guard", "@hasna/testers"] }],
    ["recursive graph", { recursive: true }],
    ["check or lifecycle-hook expansion", { lifecycleHooks: ["pretest", "check"] }],
    ["local CI emulation", { localCi: true }],
    ["army or fanout", { fanout: 4 }],
  ];

  for (const [name, override] of cloudFullCases) {
    test(`${name} resolves CLOUD_FULL and refuses local admission`, () => {
      const plan = focusedPlan({ planId: `plan-${name}`, ...override });
      expect(classifyResolvedExecutionPlan(plan).lane).toBe("CLOUD_FULL");
      expect(admitResolvedExecutionPlan(plan, rootContext).decision).toBe("REFUSE");
    });
  }

  test("all broad and unresolved plans refuse before a sentinel child starts", async () => {
    const refused = [
      ...cloudFullCases.map(([name, override]) => focusedPlan({ planId: `sentinel-${name}`, ...override })),
      focusedPlan({
        planId: "sentinel-non-bun",
        runner: "node",
        invocation: { executable: "node", argv: ["test/non-bun.test.js"] },
      }),
      focusedPlan({ planId: "sentinel-dynamic", selector: "dynamic", dynamicDiscovery: true }),
      focusedPlan({
        planId: "sentinel-unresolved",
        descendants: [{ descendantId: "unknown", packageId: "@hasna/test-guard", targetIds: [], resolved: false }],
      }),
      focusedPlan({ planId: "sentinel-unknown-bounds", limits: { ...limits, pidsMax: null } }),
    ];
    let sentinelStarts = 0;
    for (const plan of refused) {
      const execution = await executeAdmittedPlan(plan, rootContext, () => {
        sentinelStarts += 1;
      });
      expect(execution.spawned).toBe(false);
    }
    expect(sentinelStarts).toBe(0);
  });

  test("pre-subcommand test spelling refuses instead of inferring safety", () => {
    const resolved = resolveWrapperInvocation(["--cwd", "apps/test-guard", "test", "test/execution-lanes.test.ts"], {
      packageId: "@hasna/test-guard",
      limits,
    });
    expect(resolved.kind).toBe("REFUSE");
    if (resolved.kind !== "PASS_THROUGH") {
      expect(admitResolvedExecutionPlan(resolved.plan, rootContext).decision).toBe("REFUSE");
    }
  });

  test("wrapper admits only matching resolved closure evidence", () => {
    const argv = ["test", "test/execution-lanes.test.ts"];
    const withoutPlan = resolveWrapperInvocation(argv, { packageId: "@hasna/test-guard", limits });
    expect(withoutPlan.kind).toBe("REFUSE");
    if (withoutPlan.kind !== "PASS_THROUGH") {
      expect(classifyResolvedExecutionPlan(withoutPlan.plan).lane).toBe("UNCLASSIFIED");
    }

    const plan = focusedPlan();
    const matching = resolveWrapperInvocation(argv, {
      packageId: "@hasna/test-guard",
      limits,
      resolvedPlan: plan,
    });
    expect(matching.kind).toBe("PLAN");
    if (matching.kind === "PLAN") expect(classifyResolvedExecutionPlan(matching.plan).lane).toBe("LOCAL_FOCUSED");

    const mismatched = resolveWrapperInvocation(["test", "test/other.test.ts"], {
      packageId: "@hasna/test-guard",
      limits,
      resolvedPlan: plan,
    });
    expect(mismatched.kind).toBe("REFUSE");
  });

  test("known non-Bun runner resolves CLOUD_FULL and refuses local admission", () => {
    const plan = focusedPlan({
      planId: "plan-non-bun",
      runner: "node",
      invocation: { executable: "node", argv: ["test/non-bun.test.js"] },
    });
    expect(classifyResolvedExecutionPlan(plan).lane).toBe("CLOUD_FULL");
    expect(admitResolvedExecutionPlan(plan, rootContext).decision).toBe("REFUSE");
  });

  const unclassifiedCases: Array<[string, Partial<ResolvedExecutionPlan>]> = [
    ["dynamic discovery", { dynamicDiscovery: true, selector: "dynamic" }],
    ["unknown closure", { descendants: [{ descendantId: "unknown", packageId: "@hasna/test-guard", targetIds: [], resolved: false }] }],
    ["missing numeric bounds", { limits: { ...limits, pidsMax: null } }],
  ];

  for (const [name, override] of unclassifiedCases) {
    test(`${name} resolves UNCLASSIFIED and refuses local admission`, () => {
      const plan = focusedPlan({ planId: `plan-${name}`, ...override });
      expect(classifyResolvedExecutionPlan(plan).lane).toBe("UNCLASSIFIED");
      expect(admitResolvedExecutionPlan(plan, rootContext).decision).toBe("REFUSE");
    });
  }

  test("LOCAL_DIAGNOSTIC is explicit, resolved, and cannot spawn", () => {
    const plan = focusedPlan({ intent: "diagnostic", maySpawn: false });
    expect(classifyResolvedExecutionPlan(plan).lane).toBe("LOCAL_DIAGNOSTIC");
  });
});

describe("parent and child admission", () => {
  test("narrowing child inherits allocation and consumes remaining budget", () => {
    const parent = admitResolvedExecutionPlan(focusedPlan(), rootContext);
    expect(parent.decision).toBe("ADMIT");

    const childPlan = focusedPlan({
      planId: "plan-child",
      targetIds: ["test/execution-lanes.test.ts"],
      limits: { ...limits, memoryHighBytes: 128 * 1024 * 1024, memoryMaxBytes: 256 * 1024 * 1024, pidsMax: 8, wallTimeMs: 5_000 },
      parent: {
        admissionReceiptId: parent.receiptId,
        allocationId: parent.allocationId!,
        leaseId: parent.leaseId!,
        cgroupId: parent.cgroupId!,
      },
    });
    const child = admitResolvedExecutionPlan(childPlan, childContext(parent));

    expect(child.decision).toBe("ADMIT");
    expect(child.acquiredLocalAllocation).toBe(false);
    expect(child.allocationId).toBe(parent.allocationId);
    expect(child.leaseId).toBe(parent.leaseId);
    expect(child.remainingBudget.memoryMaxBytes).toBe(limits.memoryMaxBytes - 256 * 1024 * 1024);
    expect(child.parentChildReceipt?.relation).toBe("NARROWED_IN_PARENT");
  });

  test("widening or parentless child refuses before allocation", () => {
    const parent = admitResolvedExecutionPlan(focusedPlan(), rootContext);
    const parentRef = {
      admissionReceiptId: parent.receiptId,
      allocationId: parent.allocationId!,
      leaseId: parent.leaseId!,
      cgroupId: parent.cgroupId!,
    };

    const widening = admitResolvedExecutionPlan(
      focusedPlan({
        planId: "plan-widening-child",
        targetIds: ["test/execution-lanes.test.ts", "test/descendant-lifetime.sh"],
        parent: parentRef,
      }),
      childContext(parent),
    );
    expect(widening.decision).toBe("REFUSE");
    expect(widening.acquiredLocalAllocation).toBe(false);

    const parentless = admitResolvedExecutionPlan(
      focusedPlan({ planId: "plan-parentless-child", parent: parentRef }),
      {},
    );
    expect(parentless.decision).toBe("REFUSE");
    expect(parentless.acquiredLocalAllocation).toBe(false);
  });

  test("missing or mismatched parent evidence refuses", () => {
    const parent = admitResolvedExecutionPlan(focusedPlan(), rootContext);
    const mismatched = admitResolvedExecutionPlan(
      focusedPlan({
        planId: "plan-mismatched-child",
        parent: {
          admissionReceiptId: parent.receiptId,
          allocationId: "allocation-other",
          leaseId: parent.leaseId!,
          cgroupId: parent.cgroupId!,
        },
      }),
      childContext(parent),
    );
    expect(mismatched.decision).toBe("REFUSE");

    const tamperedParent = { ...parent, targetIds: ["test/other.test.ts"] };
    const tampered = admitResolvedExecutionPlan(
      focusedPlan({
        planId: "plan-tampered-parent",
        parent: {
          admissionReceiptId: parent.receiptId,
          allocationId: parent.allocationId!,
          leaseId: parent.leaseId!,
          cgroupId: parent.cgroupId!,
        },
      }),
      childContext(tamperedParent),
    );
    expect(tampered.decision).toBe("REFUSE");
  });
});

describe("scope and terminal receipts", () => {
  test("caller-forged scope verification cannot replace controller evidence", () => {
    const admission = admitResolvedExecutionPlan(focusedPlan(), {
      allocation: {
        allocationId: "test-guard-plan-focused-one.scope",
        leaseId: "test-guard-plan-focused-one.scope",
        cgroupId: "/hasna-tests.slice/test-guard-plan-focused-one.scope",
        leafScopeUnit: "test-guard-plan-focused-one.scope",
        scopeControlsVerified: true,
      } as never,
    });
    expect(admission.decision).toBe("REFUSE");
    expect(admission.reasonCodes).toContain("AGGREGATE_CONTROLLER_UNVERIFIED");
  });

  test("wrong cgroup ancestry refuses root admission", () => {
    const admission = admitResolvedExecutionPlan(focusedPlan(), {
      allocation: {
        ...rootContext.allocation!,
        cgroupId: "/other.slice/test-guard-plan-focused-one.scope",
      },
    });
    expect(admission.decision).toBe("REFUSE");
    expect(admission.reasonCodes).toContain("CGROUP_ANCESTRY_MISMATCH");
  });

  test("terminal ambiguity holds the allocation; terminal empty releases it", () => {
    const admission = admitResolvedExecutionPlan(focusedPlan(), rootContext);
    const ambiguous = createTerminalReceipt(admission, {
      directExitCode: 0,
      activeState: null,
      subState: null,
      controlGroup: null,
      cgroupPopulated: null,
    });
    expect(ambiguous.outcome).toBe("AMBIGUOUS");
    expect(ambiguous.releaseAllocation).toBe(false);

    const terminal = createTerminalReceipt(admission, {
      directExitCode: 0,
      activeState: "inactive",
      subState: "dead",
      controlGroup: "/hasna-tests.slice/test-guard-plan-focused-one.scope",
      cgroupPopulated: false,
    });
    expect(terminal.outcome).toBe("TERMINAL_EMPTY");
    expect(terminal.releaseAllocation).toBe(true);

    const mismatchedScope = createTerminalReceipt(admission, {
      directExitCode: 0,
      activeState: "inactive",
      subState: "dead",
      controlGroup: "other.scope",
      cgroupPopulated: false,
    });
    expect(mismatchedScope.outcome).toBe("AMBIGUOUS");
    expect(mismatchedScope.releaseAllocation).toBe(false);
  });
});

describe("aggregate workstation controller observation", () => {
  test("one loaded active finite zero-swap controller verifies", () => {
    expect(aggregateController.unit).toBe("hasna-tests.slice");
    expect(aggregateController.controlGroup).toBe("/hasna-tests.slice");
    expect(aggregateController.memoryMaxBytes).toBe(34_359_738_368);
    expect(aggregateController.memorySwapMaxBytes).toBe(0);
    expect(aggregateController.tasksMax).toBe(8192);

    const userManagerPrefixed = verifyAggregateControllerObservation(
      activeAggregateObservation.replace(
        "ControlGroup=/hasna-tests.slice",
        "ControlGroup=/user.slice/user-1000.slice/user@1000.service/hasna-tests.slice",
      ),
    );
    expect(userManagerPrefixed.controlGroup).toBe(
      "/user.slice/user-1000.slice/user@1000.service/hasna-tests.slice",
    );
  });

  const refusedControllers: Array<[string, string, string]> = [
    ["absent", "", "CONTROLLER_OBSERVATION_MALFORMED"],
    ["inactive", activeAggregateObservation.replace("ActiveState=active", "ActiveState=inactive"), "CONTROLLER_NOT_ACTIVE"],
    ["unlimited memory", activeAggregateObservation.replace("MemoryMax=34359738368", "MemoryMax=infinity"), "CONTROLLER_MEMORY_MAX_NOT_FINITE"],
    ["non-zero swap", activeAggregateObservation.replace("MemorySwapMax=0", "MemorySwapMax=1073741824"), "CONTROLLER_SWAP_NOT_ZERO"],
    ["mismatched identity", activeAggregateObservation.replaceAll("hasna-tests.slice", "other.slice"), "CONTROLLER_IDENTITY_MISMATCH"],
    ["duplicate active state", `${activeAggregateObservation}ActiveState=active\n`, "CONTROLLER_AMBIGUOUS_PROPERTY:ActiveState"],
  ];

  for (const [name, observation, reason] of refusedControllers) {
    test(`${name} controller evidence refuses`, () => {
      try {
        verifyAggregateControllerObservation(observation);
        throw new Error("expected controller verification to refuse");
      } catch (error) {
        expect(error).toHaveProperty("reasonCodes");
        expect((error as { reasonCodes: string[] }).reasonCodes).toContain(reason);
      }
    });
  }
});
