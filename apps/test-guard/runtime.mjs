import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const EXECUTION_PLAN_SCHEMA = "hasna.test_guard.execution_plan.v1";
export const CLASSIFICATION_RECEIPT_SCHEMA = "hasna.test_guard.classification_receipt.v1";
export const ADMISSION_RECEIPT_SCHEMA = "hasna.test_guard.admission_receipt.v1";
export const PARENT_CHILD_RECEIPT_SCHEMA = "hasna.test_guard.parent_child_receipt.v1";
export const TERMINAL_RECEIPT_SCHEMA = "hasna.test_guard.terminal_receipt.v1";
export const AGGREGATE_CONTROLLER_RECEIPT_SCHEMA = "hasna.test_guard.aggregate_controller_receipt.v1";
export const AGGREGATE_TEST_SLICE = "hasna-tests.slice";

const CONTROLLER_RECEIPT_MAX_AGE_MS = 30_000;
const CONTROLLER_PROPERTIES = [
  "Id",
  "Names",
  "LoadState",
  "ActiveState",
  "MemoryAccounting",
  "MemoryMax",
  "MemorySwapMax",
  "TasksMax",
  "ControlGroup",
];

const PLAN_KEYS = new Set([
  "schema",
  "planId",
  "intent",
  "runner",
  "invocation",
  "maySpawn",
  "packages",
  "targetIds",
  "selector",
  "packageWide",
  "workspaceWide",
  "recursive",
  "localCi",
  "lifecycleHooks",
  "dynamicDiscovery",
  "fanout",
  "descendants",
  "limits",
  "parent",
]);
const LIMIT_KEYS = ["memoryHighBytes", "memoryMaxBytes", "swapMaxBytes", "pidsMax", "wallTimeMs"];
const LOCAL_LANES = new Set(["LOCAL_FOCUSED", "LOCAL_DIAGNOSTIC"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validLimit(name, value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  if (name === "swapMaxBytes") return value >= 0;
  return value > 0;
}

function controllerInteger(value) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validControllerControlGroup(value, unit = AGGREGATE_TEST_SLICE) {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.includes("//") &&
    !value.split("/").includes("..") &&
    value.endsWith(`/${unit}`)
  );
}

export function verifyAggregateControllerObservation(observation, options = {}) {
  const expectedUnit = options.expectedUnit ?? AGGREGATE_TEST_SLICE;
  const expectedControlGroup = options.expectedControlGroup;
  const verifiedAtUnixMs = options.verifiedAtUnixMs ?? Date.now();
  const reasons = [];
  const values = new Map(CONTROLLER_PROPERTIES.map((property) => [property, []]));

  if (typeof observation !== "string" || observation.length === 0 || observation.includes("\0")) {
    reasons.push("CONTROLLER_OBSERVATION_MALFORMED");
  } else {
    for (const line of observation.split(/\r?\n/)) {
      if (line === "") continue;
      const separator = line.indexOf("=");
      if (separator <= 0) {
        reasons.push("CONTROLLER_OBSERVATION_MALFORMED");
        continue;
      }
      const property = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (!values.has(property)) {
        reasons.push(`CONTROLLER_UNEXPECTED_PROPERTY:${property}`);
        continue;
      }
      values.get(property).push(value);
    }
  }

  const property = (name) => {
    const candidates = values.get(name) ?? [];
    if (candidates.length !== 1 || candidates[0] === "") {
      reasons.push(`CONTROLLER_AMBIGUOUS_PROPERTY:${name}`);
      return null;
    }
    return candidates[0];
  };
  const id = property("Id");
  const names = property("Names");
  const loadState = property("LoadState");
  const activeState = property("ActiveState");
  const memoryAccounting = property("MemoryAccounting");
  const memoryMaxRaw = property("MemoryMax");
  const memorySwapMaxRaw = property("MemorySwapMax");
  const tasksMaxRaw = property("TasksMax");
  const controlGroup = property("ControlGroup");

  if (
    id !== expectedUnit ||
    names !== expectedUnit ||
    !validControllerControlGroup(controlGroup, expectedUnit) ||
    (expectedControlGroup !== undefined && controlGroup !== expectedControlGroup)
  ) {
    reasons.push("CONTROLLER_IDENTITY_MISMATCH");
  }
  if (loadState !== "loaded") reasons.push("CONTROLLER_NOT_LOADED");
  if (activeState !== "active") reasons.push("CONTROLLER_NOT_ACTIVE");
  if (memoryAccounting !== "yes") reasons.push("CONTROLLER_MEMORY_ACCOUNTING_DISABLED");
  const memoryMaxBytes = controllerInteger(memoryMaxRaw);
  const tasksMax = controllerInteger(tasksMaxRaw);
  if (memoryMaxBytes === null) reasons.push("CONTROLLER_MEMORY_MAX_NOT_FINITE");
  if (tasksMax === null) reasons.push("CONTROLLER_TASKS_MAX_NOT_FINITE");
  if (memorySwapMaxRaw !== "0") reasons.push("CONTROLLER_SWAP_NOT_ZERO");
  if (!Number.isSafeInteger(verifiedAtUnixMs) || verifiedAtUnixMs <= 0) {
    reasons.push("CONTROLLER_VERIFICATION_TIME_INVALID");
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  if (uniqueReasons.length > 0) {
    const error = new TypeError(`Aggregate controller verification failed: ${uniqueReasons.join(",")}`);
    error.reasonCodes = uniqueReasons;
    throw error;
  }

  const body = {
    schema: AGGREGATE_CONTROLLER_RECEIPT_SCHEMA,
    unit: expectedUnit,
    controlGroup,
    loadState,
    activeState,
    memoryAccounting: true,
    memoryMaxBytes,
    memorySwapMaxBytes: 0,
    tasksMax,
    verifiedAtUnixMs,
  };
  return { ...body, receiptId: digest("aggregate-controller", body) };
}

function validAggregateControllerReceipt(receipt, nowUnixMs = Date.now()) {
  if (
    !isPlainObject(receipt) ||
    receipt.schema !== AGGREGATE_CONTROLLER_RECEIPT_SCHEMA ||
    receipt.unit !== AGGREGATE_TEST_SLICE ||
    !validControllerControlGroup(receipt.controlGroup, AGGREGATE_TEST_SLICE) ||
    receipt.loadState !== "loaded" ||
    receipt.activeState !== "active" ||
    receipt.memoryAccounting !== true ||
    !Number.isSafeInteger(receipt.memoryMaxBytes) ||
    receipt.memoryMaxBytes <= 0 ||
    receipt.memorySwapMaxBytes !== 0 ||
    !Number.isSafeInteger(receipt.tasksMax) ||
    receipt.tasksMax <= 0 ||
    !Number.isSafeInteger(receipt.verifiedAtUnixMs) ||
    typeof receipt.receiptId !== "string"
  ) {
    return false;
  }
  const age = nowUnixMs - receipt.verifiedAtUnixMs;
  if (age < 0 || age > CONTROLLER_RECEIPT_MAX_AGE_MS) return false;
  const body = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptId"));
  return receipt.receiptId === digest("aggregate-controller", body);
}

function controllerContextReasons(controller, currentCgroupPath, leafScopeUnit) {
  const reasons = [];
  if (!validAggregateControllerReceipt(controller)) reasons.push("AGGREGATE_CONTROLLER_UNVERIFIED");
  if (typeof leafScopeUnit !== "string" || !/^[A-Za-z0-9_.:-]+\.scope$/.test(leafScopeUnit)) {
    reasons.push("LEAF_SCOPE_ID_INVALID");
  }
  if (typeof currentCgroupPath !== "string" || !currentCgroupPath.startsWith("/") || currentCgroupPath.includes("//")) {
    reasons.push("CURRENT_CGROUP_UNVERIFIED");
  } else if (
    validAggregateControllerReceipt(controller) &&
    typeof leafScopeUnit === "string" &&
    currentCgroupPath !== `${controller.controlGroup}/${leafScopeUnit}`
  ) {
    reasons.push("CGROUP_ANCESTRY_MISMATCH");
  }
  return [...new Set(reasons)].sort();
}

function validatePlan(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["PLAN_NOT_OBJECT"];
  for (const key of Object.keys(value)) {
    if (!PLAN_KEYS.has(key)) issues.push(`UNKNOWN_FIELD:${key}`);
  }
  if (value.schema !== EXECUTION_PLAN_SCHEMA) issues.push("INVALID_SCHEMA");
  if (typeof value.planId !== "string" || value.planId.length === 0) issues.push("INVALID_PLAN_ID");
  if (value.intent !== "execute" && value.intent !== "diagnostic") issues.push("INVALID_INTENT");
  if (typeof value.runner !== "string" || value.runner.length === 0) issues.push("INVALID_RUNNER");
  if (
    !isPlainObject(value.invocation) ||
    value.invocation.executable !== value.runner ||
    !strings(value.invocation.argv) ||
    value.invocation.argv.length === 0
  ) {
    issues.push("INVALID_INVOCATION");
  }
  if (typeof value.maySpawn !== "boolean") issues.push("INVALID_MAY_SPAWN");
  if (!strings(value.packages) || value.packages.length === 0) issues.push("INVALID_PACKAGES");
  if (!strings(value.targetIds)) issues.push("INVALID_TARGET_IDS");
  if (!["explicit", "omitted", "dynamic"].includes(value.selector)) issues.push("INVALID_SELECTOR");
  for (const key of ["packageWide", "workspaceWide", "recursive", "localCi", "dynamicDiscovery"]) {
    if (typeof value[key] !== "boolean") issues.push(`INVALID_${key.toUpperCase()}`);
  }
  if (!strings(value.lifecycleHooks)) issues.push("INVALID_LIFECYCLE_HOOKS");
  if (!Number.isSafeInteger(value.fanout) || value.fanout < 0) issues.push("INVALID_FANOUT");
  if (!Array.isArray(value.descendants)) {
    issues.push("INVALID_DESCENDANTS");
  } else {
    for (const descendant of value.descendants) {
      if (
        !isPlainObject(descendant) ||
        typeof descendant.descendantId !== "string" ||
        typeof descendant.packageId !== "string" ||
        !strings(descendant.targetIds) ||
        typeof descendant.resolved !== "boolean"
      ) {
        issues.push("INVALID_DESCENDANT");
        break;
      }
    }
  }
  if (!isPlainObject(value.limits)) {
    issues.push("MISSING_RESOURCE_LIMITS");
  } else {
    for (const key of LIMIT_KEYS) {
      if (!validLimit(key, value.limits[key])) issues.push(`UNKNOWN_RESOURCE_LIMIT:${key}`);
    }
    if (
      validLimit("memoryHighBytes", value.limits.memoryHighBytes) &&
      validLimit("memoryMaxBytes", value.limits.memoryMaxBytes) &&
      value.limits.memoryHighBytes > value.limits.memoryMaxBytes
    ) {
      issues.push("INVALID_MEMORY_ORDER");
    }
  }
  if (value.parent !== undefined) {
    const parent = value.parent;
    if (
      !isPlainObject(parent) ||
      !strings([parent.admissionReceiptId, parent.allocationId, parent.leaseId, parent.cgroupId])
    ) {
      issues.push("INVALID_PARENT_EVIDENCE");
    }
  }
  return [...new Set(issues)].sort();
}

export function parseResolvedExecutionPlan(value) {
  const issues = validatePlan(value);
  if (issues.length > 0) {
    const error = new TypeError(`Invalid resolved execution plan: ${issues.join(",")}`);
    error.reasonCodes = issues;
    throw error;
  }
  return structuredClone(value);
}

export function classifyResolvedExecutionPlan(value) {
  const validationIssues = validatePlan(value);
  const planDigest = digest("plan", value);
  let lane = "UNCLASSIFIED";
  let reasons = validationIssues;

  if (validationIssues.length === 0) {
    const unresolved = value.descendants.some((descendant) => !descendant.resolved);
    if (value.selector === "dynamic" || value.dynamicDiscovery || unresolved) {
      reasons = [
        ...(value.selector === "dynamic" ? ["DYNAMIC_SELECTOR"] : []),
        ...(value.dynamicDiscovery ? ["DYNAMIC_DISCOVERY"] : []),
        ...(unresolved ? ["UNRESOLVED_DESCENDANT"] : []),
      ].sort();
    } else {
      const cloudReasons = [
        ...(value.runner !== "bun" ? ["NON_BUN_RUNNER"] : []),
        ...(value.packages.length !== 1 ? ["MULTI_PACKAGE"] : []),
        ...(value.selector === "omitted" ? ["OMITTED_SELECTOR"] : []),
        ...(value.packageWide ? ["PACKAGE_WIDE"] : []),
        ...(value.workspaceWide ? ["WORKSPACE_WIDE"] : []),
        ...(value.recursive ? ["RECURSIVE_GRAPH"] : []),
        ...(value.localCi ? ["LOCAL_CI_EMULATION"] : []),
        ...(value.lifecycleHooks.length > 0 ? ["LIFECYCLE_HOOK_EXPANSION"] : []),
        ...(value.fanout > 1 ? ["FANOUT"] : []),
      ].sort();
      if (cloudReasons.length > 0) {
        lane = "CLOUD_FULL";
        reasons = cloudReasons;
      } else if (value.intent === "diagnostic" && value.maySpawn === false) {
        lane = "LOCAL_DIAGNOSTIC";
        reasons = [];
      } else if (
        value.intent === "execute" &&
        value.maySpawn === true &&
        value.selector === "explicit" &&
        value.targetIds.length > 0
      ) {
        lane = "LOCAL_FOCUSED";
        reasons = [];
      } else {
        reasons = ["LOCAL_PLAN_NOT_PROVABLY_FOCUSED"];
      }
    }
  }

  const body = { schema: CLASSIFICATION_RECEIPT_SCHEMA, planDigest, lane, reasons };
  return { ...body, receiptId: digest("classification", body) };
}

function budgetFromLimits(limits) {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, limits?.[key] ?? 0]));
}

function admissionReceipt(plan, classification, fields) {
  const body = {
    schema: ADMISSION_RECEIPT_SCHEMA,
    planId: typeof plan?.planId === "string" ? plan.planId : "unknown",
    planDigest: classification.planDigest,
    classificationReceiptId: classification.receiptId,
    lane: classification.lane,
    decision: fields.decision,
    reasonCodes: [...new Set(fields.reasonCodes)].sort(),
    allocationId: fields.allocationId ?? null,
    leaseId: fields.leaseId ?? null,
    cgroupId: fields.cgroupId ?? null,
    acquiredLocalAllocation: fields.acquiredLocalAllocation ?? false,
    remainingBudget: fields.remainingBudget ?? budgetFromLimits(null),
    parentAdmissionReceiptId: fields.parentAdmissionReceiptId ?? null,
    parentChildReceiptId: fields.parentChildReceipt?.receiptId ?? null,
    aggregateControllerReceiptId: fields.aggregateController?.receiptId ?? null,
    aggregateUnit: fields.aggregateController?.unit ?? null,
    aggregateControlGroup: fields.aggregateController?.controlGroup ?? null,
    packages: Array.isArray(plan?.packages) ? [...plan.packages] : [],
    targetIds: Array.isArray(plan?.targetIds) ? [...plan.targetIds] : [],
  };
  return { ...body, receiptId: digest("admission", body), parentChildReceipt: fields.parentChildReceipt ?? null };
}

function refusal(plan, classification, reasonCodes, context = {}) {
  return admissionReceipt(plan, classification, {
    decision: "REFUSE",
    reasonCodes,
    acquiredLocalAllocation: false,
    remainingBudget: context.parentAdmission?.remainingBudget ?? budgetFromLimits(null),
    parentAdmissionReceiptId: context.parentAdmission?.receiptId ?? null,
  });
}

function isSubset(child, parent) {
  const parentSet = new Set(parent);
  return child.every((item) => parentSet.has(item));
}

function validAdmittedParent(parent) {
  if (
    !isPlainObject(parent) ||
    parent.schema !== ADMISSION_RECEIPT_SCHEMA ||
    parent.decision !== "ADMIT" ||
    !LOCAL_LANES.has(parent.lane) ||
    typeof parent.receiptId !== "string"
  ) {
    return false;
  }
  const body = Object.fromEntries(
    Object.entries(parent).filter(([key]) => key !== "receiptId" && key !== "parentChildReceipt"),
  );
  return parent.receiptId === digest("admission", body);
}

export function admitResolvedExecutionPlan(value, context = {}) {
  const classification = classifyResolvedExecutionPlan(value);
  if (!LOCAL_LANES.has(classification.lane)) {
    return refusal(value, classification, [classification.lane === "CLOUD_FULL" ? "REQUIRES_CLOUD_FULL" : "UNCLASSIFIED_PLAN"], context);
  }

  let plan;
  try {
    plan = parseResolvedExecutionPlan(value);
  } catch (error) {
    return refusal(value, classification, error.reasonCodes ?? ["UNCLASSIFIED_PLAN"], context);
  }

  const isChild = plan.parent !== undefined || context.parentAdmission !== undefined;
  if (isChild) {
    const parent = context.parentAdmission;
    if (!plan.parent || !validAdmittedParent(parent)) {
      return refusal(plan, classification, ["MISSING_PARENT_EVIDENCE"], context);
    }
    const controllerReasons = controllerContextReasons(
      context.aggregateController,
      context.currentCgroupPath,
      parent.allocationId,
    );
    if (controllerReasons.length > 0) {
      return refusal(plan, classification, controllerReasons, context);
    }
    if (
      parent.aggregateUnit !== context.aggregateController.unit ||
      parent.aggregateControlGroup !== context.aggregateController.controlGroup ||
      parent.cgroupId !== context.currentCgroupPath
    ) {
      return refusal(plan, classification, ["PARENT_CGROUP_MISMATCH"], context);
    }
    if (
      plan.parent.admissionReceiptId !== parent.receiptId ||
      plan.parent.allocationId !== parent.allocationId ||
      plan.parent.leaseId !== parent.leaseId ||
      plan.parent.cgroupId !== parent.cgroupId
    ) {
      return refusal(plan, classification, ["PARENT_ALLOCATION_MISMATCH"], context);
    }
    if (parent.lane === "LOCAL_DIAGNOSTIC" && classification.lane !== "LOCAL_DIAGNOSTIC") {
      return refusal(plan, classification, ["LANE_WIDENING"], context);
    }
    if (!isSubset(plan.packages, parent.packages ?? []) || !isSubset(plan.targetIds, parent.targetIds ?? [])) {
      return refusal(plan, classification, ["SCOPE_WIDENING"], context);
    }
    for (const key of LIMIT_KEYS) {
      if (plan.limits[key] > parent.remainingBudget[key]) {
        return refusal(plan, classification, ["BUDGET_WIDENING"], context);
      }
    }
    const remainingBudget = Object.fromEntries(
      LIMIT_KEYS.map((key) => [key, parent.remainingBudget[key] - plan.limits[key]]),
    );
    const relationBody = {
      schema: PARENT_CHILD_RECEIPT_SCHEMA,
      relation: "NARROWED_IN_PARENT",
      parentAdmissionReceiptId: parent.receiptId,
      childPlanDigest: classification.planDigest,
      allocationId: parent.allocationId,
      leaseId: parent.leaseId,
      cgroupId: parent.cgroupId,
      budgetBefore: parent.remainingBudget,
      budgetConsumed: budgetFromLimits(plan.limits),
      budgetAfter: remainingBudget,
    };
    const parentChildReceipt = { ...relationBody, receiptId: digest("parent-child", relationBody) };
    const admitted = admissionReceipt(plan, classification, {
      decision: "ADMIT",
      reasonCodes: [],
      allocationId: parent.allocationId,
      leaseId: parent.leaseId,
      cgroupId: parent.cgroupId,
      acquiredLocalAllocation: false,
      remainingBudget,
      parentAdmissionReceiptId: parent.receiptId,
      parentChildReceipt,
      aggregateController: context.aggregateController,
    });
    return admitted;
  }

  if (classification.lane === "LOCAL_DIAGNOSTIC") {
    const admitted = admissionReceipt(plan, classification, {
      decision: "ADMIT",
      reasonCodes: [],
      acquiredLocalAllocation: false,
      remainingBudget: budgetFromLimits(plan.limits),
    });
    return admitted;
  }

  const allocation = context.allocation;
  if (!isPlainObject(allocation)) {
    return refusal(plan, classification, ["AGGREGATE_CONTROLLER_UNVERIFIED"], context);
  }
  if (!strings([allocation.allocationId, allocation.leaseId, allocation.cgroupId])) {
    return refusal(plan, classification, ["SCOPE_SETUP_FAILED"], context);
  }
  const controllerReasons = controllerContextReasons(
    allocation.aggregateController,
    allocation.cgroupId,
    allocation.leafScopeUnit,
  );
  if (controllerReasons.length > 0) return refusal(plan, classification, controllerReasons, context);
  if (allocation.allocationId !== allocation.leafScopeUnit) {
    return refusal(plan, classification, ["SCOPE_SETUP_FAILED"], context);
  }
  const admitted = admissionReceipt(plan, classification, {
    decision: "ADMIT",
    reasonCodes: [],
    allocationId: allocation.allocationId,
    leaseId: allocation.leaseId,
    cgroupId: allocation.cgroupId,
    acquiredLocalAllocation: true,
    remainingBudget: budgetFromLimits(plan.limits),
    aggregateController: allocation.aggregateController,
  });
  return admitted;
}

export async function executeAdmittedPlan(value, context, spawn) {
  const admission = admitResolvedExecutionPlan(value, context);
  if (admission.decision !== "ADMIT") return { admission, spawned: false, result: null };
  if (typeof spawn !== "function") throw new TypeError("spawn must be a function");
  return { admission, spawned: true, result: await spawn(admission) };
}

function writeReceipt(path, receipt) {
  const temporary = `${path}.${process.pid}.new`;
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function readReceipt(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readCurrentCgroupPath() {
  const testPath =
    process.env.HASNA_TEST_GUARD_TEST_LOCK_BACKEND === "mkdir"
      ? process.env.HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP
      : undefined;
  const source = testPath || "/proc/self/cgroup";
  const matches = readFileSync(source, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("0::"))
    .map((line) => line.slice(3));
  if (matches.length !== 1 || !matches[0]) throw new TypeError("current cgroup is ambiguous");
  return matches[0];
}

export function createTerminalReceipt(admission, observation) {
  const ambiguous =
    !isPlainObject(observation) ||
    !Number.isInteger(observation.directExitCode) ||
    typeof observation.activeState !== "string" ||
    typeof observation.subState !== "string" ||
    typeof observation.controlGroup !== "string" ||
    observation.controlGroup !== admission.cgroupId ||
    typeof observation.cgroupPopulated !== "boolean";
  const terminalState =
    !ambiguous &&
    ((observation.activeState === "inactive" && observation.subState === "dead") ||
      (observation.activeState === "failed" && ["failed", "dead"].includes(observation.subState)));
  const terminalEmpty = terminalState && observation.cgroupPopulated === false;
  const outcome = ambiguous ? "AMBIGUOUS" : terminalEmpty ? "TERMINAL_EMPTY" : "DESCENDANTS_REMAIN";
  const body = {
    schema: TERMINAL_RECEIPT_SCHEMA,
    admissionReceiptId: admission.receiptId,
    allocationId: admission.allocationId ?? null,
    leaseId: admission.leaseId ?? null,
    cgroupId: admission.cgroupId ?? null,
    directExitCode: observation?.directExitCode ?? null,
    activeState: observation?.activeState ?? null,
    subState: observation?.subState ?? null,
    controlGroup: observation?.controlGroup ?? null,
    cgroupPopulated: observation?.cgroupPopulated ?? null,
    outcome,
    releaseAllocation: terminalEmpty,
    reasonCode: ambiguous ? "TERMINAL_STATE_AMBIGUOUS" : terminalEmpty ? null : "CGROUP_NOT_EMPTY",
  };
  return { ...body, receiptId: digest("terminal", body) };
}

export function resolveWrapperInvocation(argv, options = {}) {
  const packageId = options.packageId ?? "unknown-package";
  const limits = options.limits;
  const base = {
    schema: EXECUTION_PLAN_SCHEMA,
    planId: digest("invocation", { packageId, argv }),
    intent: "execute",
    runner: "bun",
    invocation: { executable: "bun", argv: Array.isArray(argv) ? [...argv] : [] },
    maySpawn: true,
    packages: [packageId],
    targetIds: [],
    selector: "omitted",
    packageWide: false,
    workspaceWide: false,
    recursive: false,
    localCi: options.localCi === true,
    lifecycleHooks: [],
    dynamicDiscovery: false,
    fanout: 1,
    descendants: [],
    limits,
  };
  if (!Array.isArray(argv) || argv.length === 0) return { kind: "PASS_THROUGH" };
  if (options.resolvedPlan !== undefined) {
    const plan = options.resolvedPlan;
    if (
      isPlainObject(plan) &&
      isPlainObject(plan.invocation) &&
      JSON.stringify(plan.invocation.argv) === JSON.stringify(argv)
    ) {
      return { kind: "PLAN", plan };
    }
    return { kind: "REFUSE", plan: { ...base, descendants: [{ descendantId: "plan-mismatch", packageId, targetIds: [], resolved: false }] } };
  }
  if (argv[0] !== "test") {
    if (argv.some((arg) => arg === "test" || arg === "check") || argv[0] === "run") {
      return { kind: "REFUSE", plan: { ...base, selector: "dynamic", dynamicDiscovery: true } };
    }
    return { kind: "PASS_THROUGH" };
  }
  const targetIds = argv.slice(1).filter((arg) => !arg.startsWith("-") && arg !== "--");
  const hasDynamicTarget = targetIds.some((target) => /[*?{}[\]]/.test(target));
  const plan = {
    ...base,
    targetIds,
    selector: hasDynamicTarget ? "dynamic" : targetIds.length > 0 ? "explicit" : "omitted",
    packageWide: targetIds.length === 0,
    dynamicDiscovery: hasDynamicTarget,
    descendants: [{ descendantId: "closure-not-supplied", packageId, targetIds, resolved: false }],
  };
  return { kind: "REFUSE", plan };
}

async function main() {
  const operation = process.argv[2];
  if (operation === "verify-controller") {
    const [unit, observationFile, receiptFile] = process.argv.slice(3);
    if (unit !== AGGREGATE_TEST_SLICE || !observationFile || !receiptFile) process.exit(78);
    try {
      const receipt = verifyAggregateControllerObservation(readFileSync(observationFile, "utf8"), {
        expectedUnit: AGGREGATE_TEST_SLICE,
      });
      writeReceipt(receiptFile, receipt);
      process.stdout.write(`${receipt.controlGroup}\n`);
      process.exit(0);
    } catch (error) {
      const reasons = Array.isArray(error?.reasonCodes) ? error.reasonCodes.join(",") : "UNVERIFIABLE";
      process.stderr.write(`hasna-test-guard: aggregate controller refused reasons=${reasons}\n`);
      process.exit(78);
    }
  }
  if (operation !== "intercept" && operation !== "launch" && operation !== "child-admit") return;
  const packageId = process.env.HASNA_TEST_GUARD_PACKAGE_ID || "unknown-package";
  const limits = {
    memoryHighBytes: Number(process.env.BUN_TEST_MEMORY_HIGH_BYTES || 12 * 1024 ** 3),
    memoryMaxBytes: Number(process.env.BUN_TEST_MEMORY_MAX_BYTES || 16 * 1024 ** 3),
    swapMaxBytes: Number(process.env.BUN_TEST_MEMORY_SWAP_MAX_BYTES || 0),
    pidsMax: Number(process.env.BUN_TEST_TASKS_MAX || 4096),
    wallTimeMs: Number(process.env.BUN_TEST_WALL_TIME_MS || 1_800_000),
  };
  let resolvedPlan;
  const resolvedPlanFile = process.env.HASNA_TEST_GUARD_RESOLVED_PLAN_FILE;
  if (resolvedPlanFile) {
    try {
      resolvedPlan = JSON.parse(readFileSync(resolvedPlanFile, "utf8"));
    } catch {
      process.stderr.write("hasna-test-guard: refusing local execution lane=UNCLASSIFIED reasons=RESOLVED_PLAN_UNREADABLE\n");
      process.exit(78);
    }
  }
  if (operation === "child-admit") {
    const [controllerReceiptFile, admissionReceiptFile] = process.argv.slice(3);
    if (!resolvedPlan || !controllerReceiptFile || !admissionReceiptFile) process.exit(78);
    try {
      const aggregateController = readReceipt(controllerReceiptFile);
      const parentAdmission = readReceipt(process.env.HASNA_TEST_GUARD_PARENT_ADMISSION_RECEIPT_FILE || "");
      const currentCgroupPath = readCurrentCgroupPath();
      const admission = admitResolvedExecutionPlan(resolvedPlan, {
        parentAdmission,
        aggregateController,
        currentCgroupPath,
      });
      if (admission.decision !== "ADMIT" || admission.acquiredLocalAllocation) process.exit(78);
      writeReceipt(admissionReceiptFile, admission);
      process.exit(0);
    } catch {
      process.exit(78);
    }
  }
  if (operation === "launch") {
    const [allocationId, controllerReceiptFile, receiptFile, separator, ...command] = process.argv.slice(3);
    if (!resolvedPlan || !allocationId || !controllerReceiptFile || !receiptFile || separator !== "--" || command.length === 0) {
      process.exit(78);
    }
    let aggregateController;
    let currentCgroupPath;
    try {
      aggregateController = readReceipt(controllerReceiptFile);
      currentCgroupPath = readCurrentCgroupPath();
    } catch {
      process.exit(78);
    }
    const admission = admitResolvedExecutionPlan(resolvedPlan, {
      allocation: {
        allocationId,
        leaseId: allocationId,
        cgroupId: currentCgroupPath,
        leafScopeUnit: allocationId,
        aggregateController,
      },
    });
    if (admission.decision !== "ADMIT" || admission.lane !== "LOCAL_FOCUSED") process.exit(78);
    writeReceipt(receiptFile, admission);
    const childEnv = { ...process.env };
    delete childEnv.HASNA_TEST_GUARD_RESOLVED_PLAN_FILE;
    childEnv.HASNA_TEST_GUARD_HELD = "1";
    childEnv.HASNA_TEST_GUARD_ALLOCATION_ID = allocationId;
    childEnv.HASNA_TEST_GUARD_LEASE_ID = allocationId;
    childEnv.HASNA_TEST_GUARD_CGROUP_ID = admission.cgroupId;
    childEnv.HASNA_TEST_GUARD_PARENT_ADMISSION_RECEIPT_FILE = receiptFile;
    childEnv.HASNA_TEST_GUARD_PARENT_LANE = admission.lane;
    childEnv.HASNA_TEST_GUARD_REMAINING_MEMORY_HIGH_BYTES = String(admission.remainingBudget.memoryHighBytes);
    childEnv.HASNA_TEST_GUARD_REMAINING_MEMORY_MAX_BYTES = String(admission.remainingBudget.memoryMaxBytes);
    childEnv.HASNA_TEST_GUARD_REMAINING_SWAP_MAX_BYTES = String(admission.remainingBudget.swapMaxBytes);
    childEnv.HASNA_TEST_GUARD_REMAINING_PIDS = String(admission.remainingBudget.pidsMax);
    childEnv.HASNA_TEST_GUARD_REMAINING_WALL_TIME_MS = String(admission.remainingBudget.wallTimeMs);
    const child = Bun.spawn({ cmd: command, env: childEnv, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exit(await child.exited);
  }

  const resolved = resolveWrapperInvocation(process.argv.slice(3), {
    packageId,
    limits,
    localCi: process.env.CI === "1" || process.env.CI === "true",
    resolvedPlan,
  });
  if (resolved.kind === "PASS_THROUGH") process.exit(0);
  const classification = classifyResolvedExecutionPlan(resolved.plan);
  if (resolved.kind === "PLAN" && classification.lane === "LOCAL_FOCUSED") {
    process.exit(10);
  }
  process.stderr.write(
    `hasna-test-guard: refusing local execution lane=${classification.lane} reasons=${classification.reasons.join(",")} receipt=${classification.receiptId}\n`,
  );
  process.exit(78);
}

if (import.meta.main) await main();
