#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface EvidenceReference {
  reference: string;
  summary: string;
}

interface MachineEvidence {
  machine: string;
  commitSha: string;
  command: string;
  exitStatus: number;
  timestamp: string;
  artifactReference: string;
  positiveControls: Array<{
    name: string;
    command: string;
    exitStatus: number;
    artifactReference: string;
  }>;
}

interface RoadmapItem {
  key: string;
  title: string;
  todosTaskId?: string;
  status?: "pending" | "in_progress" | "blocked" | "done";
  dependsOn: string[];
  blockers: Array<{ key: string; reason: string }>;
  evidence?: {
    implementation?: EvidenceReference[];
    tests?: EvidenceReference[];
    docs?: EvidenceReference[];
    machine011?: MachineEvidence;
  };
}

interface HardeningLedger {
  $schema: string;
  schemaVersion: number;
  roadmap: string;
  closurePolicy: {
    umbrellaKey: string;
    workstreamKeys: string[];
    requiredEvidence: Array<"implementation" | "tests" | "docs" | "machine011">;
    machineValidation: {
      machine: string;
      minimumPositiveControls: number;
    };
  };
  items: RoadmapItem[];
}

interface CliOptions {
  ledgerPath: string;
  requireComplete: boolean;
}

interface SemanticResult {
  errors: string[];
  crossPlanBlockers: Array<{
    item: string;
    unreadyDependencies: string[];
    declaredBlockers: Array<{ key: string; reason: string }>;
  }>;
  evidenceGaps: Array<{ item: string; missing: string[] }>;
  readyWorkstreams: string[];
  closureReady: boolean;
  umbrellaDone: boolean;
}

const defaultLedgerPath = resolve(import.meta.dir, "..", "ops", "hardening-roadmap.json");
const repositoryRoot = resolve(import.meta.dir, "..");
const canonicalSchemaPath = resolve(repositoryRoot, "ops", "hardening-roadmap.schema.json");
const canonicalSchemaReference = "./hardening-roadmap.schema.json";
const canonicalUmbrellaKey = "SNA-umbrella";
const canonicalWorkstreamKeys = [
  "SNA-00001",
  "SNA-00002",
  "SNA-00003",
  "SNA-00004",
  "SNA-00005",
  "SNA-00006",
  "SNA-00007",
  "SNA-00008",
  "SNA-00009",
  "SNA-00010",
  "SNA-00011",
  "SNA-00012",
  "SNA-00013",
  "SNA-00014",
  "SNA-00015",
  "SNA-00016"
] as const;
const canonicalItemKeys = [canonicalUmbrellaKey, ...canonicalWorkstreamKeys];
const canonicalRequiredEvidence = ["implementation", "tests", "docs", "machine011"] as const;
const canonicalMachine = "machine011";
const canonicalMinimumPositiveControls = 1;
const gitReferencePattern = /^git:([0-9a-f]{40}):([A-Za-z0-9._/-]+)(?:#L[1-9][0-9]*(?:-L[1-9][0-9]*)?)?$/;
const todosAttachmentPattern = /^todos-attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]{8,}):sha256:([0-9a-f]{64}):commit:([0-9a-f]{40})$/;
const placeholderPattern = /^(?:placeholder|tbd|todo|fake|dummy|example|lorem|n\/a|none|replace[ -_]?me)(?:\b|[\s:/_-])/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv: string[]): CliOptions {
  let ledgerPath = defaultLedgerPath;
  let requireComplete = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-complete") {
      requireComplete = true;
      continue;
    }
    if (argument === "--ledger") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--ledger requires a path");
      ledgerPath = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--ledger=")) {
      ledgerPath = resolve(argument.slice("--ledger=".length));
      continue;
    }
    throw new Error("Unknown argument: " + argument);
  }

  return { ledgerPath, requireComplete };
}

function displayPath(path: string): string {
  const local = relative(process.cwd(), path);
  return local && !local.startsWith("..") ? local : path;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function schemaAtReference(root: JsonObject, reference: string): JsonObject {
  if (!reference.startsWith("#/")) throw new Error("Only local JSON Schema references are supported: " + reference);
  let current: unknown = root;
  for (const encodedPart of reference.slice(2).split("/")) {
    const part = encodedPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(current) || !(part in current)) throw new Error("Unresolved JSON Schema reference: " + reference);
    current = current[part];
  }
  if (!isObject(current)) throw new Error("JSON Schema reference is not an object: " + reference);
  return current as JsonObject;
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "object":
      return isObject(value);
    default:
      return typeof value === expected;
  }
}

function parseDateTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((fraction + "000").slice(0, 3));
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return undefined;
  const localMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const localDate = new Date(localMilliseconds);
  if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hour || localDate.getUTCMinutes() !== minute || localDate.getUTCSeconds() !== second) {
    return undefined;
  }
  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (sign === "-" ? -1 : 1);
  return localMilliseconds - offset;
}

function validateFormat(value: string, format: string): boolean {
  if (format === "uuid") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
  if (format === "date-time") {
    return parseDateTime(value) !== undefined;
  }
  throw new Error("Unsupported JSON Schema format: " + format);
}

function validateSchema(
  value: unknown,
  schema: JsonObject,
  root: JsonObject,
  path: string,
  errors: string[]
): void {
  if (typeof schema.$ref === "string") {
    validateSchema(value, schemaAtReference(root, schema.$ref), root, path, errors);
    return;
  }

  if ("const" in schema && !sameJson(value, schema.const)) {
    errors.push(path + " must equal " + JSON.stringify(schema.const));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameJson(value, candidate))) {
    errors.push(path + " must be one of " + JSON.stringify(schema.enum));
  }

  if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    errors.push(path + " must be a " + schema.type);
    return;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(path + " must contain at least " + schema.minLength + " character(s)");
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errors.push(path + " must match " + schema.pattern);
    }
    if (typeof schema.format === "string" && !validateFormat(value, schema.format)) {
      errors.push(path + " must use " + schema.format + " format");
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(path + " must be at least " + schema.minimum);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(path + " must be at most " + schema.maximum);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(path + " must contain at least " + schema.minItems + " item(s)");
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(path + " must contain at most " + schema.maxItems + " item(s)");
    }
    if (schema.uniqueItems === true) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) errors.push(path + " must contain unique items");
    }
    if (isObject(schema.items)) {
      value.forEach((item, index) => validateSchema(item, schema.items as JsonObject, root, path + "[" + index + "]", errors));
    }
  }

  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in value)) errors.push(path + "." + key + " is required");
    }

    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(properties)) {
      if (key in value && isObject(child)) {
        validateSchema(value[key], child as JsonObject, root, path + "." + key, errors);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(path + "." + key + " is not allowed");
      }
    }
  }
}

let reachableRepositoryCommits: Set<string> | undefined;

function repositoryCommitExists(commitSha: string): boolean {
  if (!reachableRepositoryCommits) {
    const result = Bun.spawnSync({
      cmd: ["git", "-C", repositoryRoot, "rev-list", "--all"],
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      stdout: "pipe",
      stderr: "ignore"
    });
    reachableRepositoryCommits = result.exitCode === 0
      ? new Set(new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean))
      : new Set();
  }
  return reachableRepositoryCommits.has(commitSha);
}

function gitObjectExists(specification: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repositoryRoot, "cat-file", "-e", specification],
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    stdout: "ignore",
    stderr: "ignore"
  });
  return result.exitCode === 0;
}

function validateCommit(commitSha: string, label: string, errors: string[]): boolean {
  if (!repositoryCommitExists(commitSha)) {
    errors.push(label + " must resolve to a commit in this repository");
    return false;
  }
  return true;
}

function validateDurableReference(
  reference: string,
  label: string,
  errors: string[],
  expectedCommit?: string
): void {
  const gitMatch = gitReferencePattern.exec(reference);
  if (gitMatch) {
    const [, commitSha, path] = gitMatch;
    const normalizedPath = posix.normalize(path);
    if (path.startsWith("/") || path.startsWith(".git/") || normalizedPath === ".." || normalizedPath.startsWith("../")) {
      errors.push(label + " must use a repository-relative path without traversal");
      return;
    }
    const commitExists = validateCommit(commitSha, label + " commit", errors);
    if (expectedCommit && commitSha !== expectedCommit) errors.push(label + " must bind to machine011 commitSha");
    if (commitExists && !gitObjectExists(commitSha + ":" + path)) {
      errors.push(label + " must resolve to an object at its pinned repository commit");
    }
    return;
  }

  const attachmentMatch = todosAttachmentPattern.exec(reference);
  if (attachmentMatch) {
    const commitSha = attachmentMatch[4];
    validateCommit(commitSha, label + " commit", errors);
    if (expectedCommit && commitSha !== expectedCommit) errors.push(label + " must bind to machine011 commitSha");
    return;
  }

  errors.push(label + " must be a qualified git or checksum-pinned Todos attachment reference");
}

function validateQualifiedText(value: string, label: string, minimumLength: number, errors: string[]): void {
  const trimmed = value.trim();
  if (trimmed.length < minimumLength) errors.push(label + " is not sufficiently descriptive");
  if (placeholderPattern.test(trimmed)) errors.push(label + " must not be placeholder evidence");
}

function cycleErrors(items: RoadmapItem[]): string[] {
  const graph = new Map(items.map((item) => [
    item.key,
    [...item.dependsOn, ...item.blockers.map((blocker) => blocker.key)]
  ]));
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles = new Set<string>();

  const visit = (key: string): void => {
    if (state.get(key) === "visited") return;
    if (state.get(key) === "visiting") {
      const start = stack.indexOf(key);
      cycles.add([...stack.slice(start), key].join(" -> "));
      return;
    }
    state.set(key, "visiting");
    stack.push(key);
    for (const dependency of graph.get(key) ?? []) {
      if (graph.has(dependency)) visit(dependency);
    }
    stack.pop();
    state.set(key, "visited");
  };

  for (const item of items) visit(item.key);
  return [...cycles].map((cycle) => "dependency/blocker cycle: " + cycle);
}

function validateSemantics(ledger: HardeningLedger): SemanticResult {
  const errors: string[] = [];
  const itemsByKey = new Map<string, RoadmapItem>();
  const todosIds = new Set<string>();
  const semanticallyInvalidEvidence = new Set<string>();

  if (ledger.$schema !== canonicalSchemaReference) errors.push("ledger $schema must reference the shipped canonical schema");
  if (ledger.closurePolicy.umbrellaKey !== canonicalUmbrellaKey) errors.push("closure policy must use the canonical umbrella key");
  if (!sameJson(ledger.closurePolicy.workstreamKeys, canonicalWorkstreamKeys)) {
    errors.push("closure policy must contain the canonical workstream keys in order");
  }
  if (!sameJson(ledger.closurePolicy.requiredEvidence, canonicalRequiredEvidence)) {
    errors.push("closure policy must contain the canonical required evidence in order");
  }
  if (ledger.closurePolicy.machineValidation.machine !== canonicalMachine
    || ledger.closurePolicy.machineValidation.minimumPositiveControls !== canonicalMinimumPositiveControls) {
    errors.push("closure policy must use the canonical machine011 validation policy");
  }

  for (const item of ledger.items) {
    if (itemsByKey.has(item.key)) errors.push("duplicate roadmap key: " + item.key);
    itemsByKey.set(item.key, item);
    if (item.todosTaskId) {
      if (todosIds.has(item.todosTaskId)) errors.push("duplicate Todos task id: " + item.todosTaskId);
      todosIds.add(item.todosTaskId);
    }
    const evidenceErrorCount = errors.length;
    for (const category of ["implementation", "tests", "docs"] as const) {
      const references = item.evidence?.[category] ?? [];
      const values = references.map((evidence) => evidence.reference);
      if (new Set(values).size !== values.length) errors.push(item.key + " has duplicate " + category + " evidence references");
      references.forEach((evidence, index) => {
        const label = item.key + " " + category + " evidence[" + index + "]";
        validateDurableReference(evidence.reference, label + " reference", errors);
        validateQualifiedText(evidence.summary, label + " summary", 12, errors);
      });
    }
    const machine = item.evidence?.machine011;
    if (machine) {
      validateCommit(machine.commitSha, item.key + " machine011 commitSha", errors);
      const timestamp = parseDateTime(machine.timestamp);
      if (timestamp !== undefined && timestamp > Date.now()) errors.push(item.key + " machine011 timestamp must not be in the future");
      validateQualifiedText(machine.command, item.key + " machine011 command", 3, errors);
      validateDurableReference(machine.artifactReference, item.key + " machine011 artifactReference", errors, machine.commitSha);
      const controlNames = machine.positiveControls.map((control) => control.name);
      const controlCommands = machine.positiveControls.map((control) => control.command);
      const controlArtifacts = machine.positiveControls.map((control) => control.artifactReference);
      if (new Set(controlNames).size !== controlNames.length) errors.push(item.key + " has duplicate machine011 positive-control names");
      if (new Set(controlCommands).size !== controlCommands.length) errors.push(item.key + " has duplicate machine011 positive-control commands");
      if (new Set(controlArtifacts).size !== controlArtifacts.length) errors.push(item.key + " has duplicate machine011 positive-control artifacts");
      if (controlArtifacts.includes(machine.artifactReference)) {
        errors.push(item.key + " machine011 result and positive controls must use distinct artifacts");
      }
      machine.positiveControls.forEach((control, index) => {
        const label = item.key + " machine011 positiveControls[" + index + "]";
        validateQualifiedText(control.name, label + ".name", 3, errors);
        validateQualifiedText(control.command, label + ".command", 3, errors);
        validateDurableReference(control.artifactReference, label + ".artifactReference", errors, machine.commitSha);
      });
    }
    if (errors.length > evidenceErrorCount) semanticallyInvalidEvidence.add(item.key);
    if (item.dependsOn.includes(item.key)) errors.push(item.key + " cannot depend on itself");
    const blockerKeys = item.blockers.map((blocker) => blocker.key);
    if (new Set(blockerKeys).size !== blockerKeys.length) errors.push(item.key + " has duplicate blocker references");
    if (blockerKeys.includes(item.key)) errors.push(item.key + " cannot block on itself");
  }

  const actualKeys = ledger.items.map((item) => item.key);
  if (!sameJson(actualKeys, canonicalItemKeys)) {
    errors.push("ledger items must exactly match the canonical umbrella and workstream keys in order");
  }
  if (ledger.items.length !== canonicalItemKeys.length || new Set(actualKeys).size !== canonicalItemKeys.length) {
    errors.push("ledger must contain exactly " + canonicalItemKeys.length + " unique tracked items");
  }

  for (const item of ledger.items) {
    for (const reference of [...item.dependsOn, ...item.blockers.map((blocker) => blocker.key)]) {
      if (!itemsByKey.has(reference)) errors.push(item.key + " references unknown dependency/blocker " + reference);
    }
  }

  const umbrella = itemsByKey.get(canonicalUmbrellaKey);
  if (!umbrella) {
    errors.push("umbrella item is missing: " + canonicalUmbrellaKey);
  } else if (!sameJson(umbrella.dependsOn, canonicalWorkstreamKeys)) {
    errors.push("umbrella must depend on every canonical workstream in order and no others");
  }

  errors.push(...cycleErrors(ledger.items));

  const evidenceGaps = canonicalWorkstreamKeys.map((key) => {
    const item = itemsByKey.get(key);
    const missing: string[] = [];
    if (!item || item.status !== "done") missing.push("status:done");
    if (!item?.evidence?.implementation?.length) missing.push("evidence:implementation");
    if (!item?.evidence?.tests?.length) missing.push("evidence:tests");
    if (!item?.evidence?.docs?.length) missing.push("evidence:docs");
    const machine = item?.evidence?.machine011;
    if (!machine) {
      missing.push("evidence:machine011");
    } else {
      if (machine.machine !== canonicalMachine) missing.push("machine011:machine");
      if (machine.positiveControls.length < canonicalMinimumPositiveControls) {
        missing.push("machine011:positiveControls");
      }
      const names = machine.positiveControls.map((control) => control.name);
      if (new Set(names).size !== names.length) missing.push("machine011:uniquePositiveControlNames");
    }
    return { item: key, missing };
  });

  const ownEvidenceReady = new Map<string, boolean>(evidenceGaps.map((gap) => [
    gap.item,
    gap.missing.length === 0 && !semanticallyInvalidEvidence.has(gap.item)
  ]));
  const readinessMemo = new Map<string, boolean>();
  const evaluating = new Set<string>();
  const isReady = (key: string): boolean => {
    const memoized = readinessMemo.get(key);
    if (memoized !== undefined) return memoized;
    if (evaluating.has(key)) return false;
    const item = itemsByKey.get(key);
    if (!item) return false;
    evaluating.add(key);
    const ready = ownEvidenceReady.get(key) === true
      && item.dependsOn.every((dependency) => isReady(dependency))
      && item.blockers.length === 0;
    evaluating.delete(key);
    readinessMemo.set(key, ready);
    return ready;
  };

  const readyWorkstreams = canonicalWorkstreamKeys.filter((key) => isReady(key));
  const crossPlanBlockers = ledger.items
    .map((item) => ({
      item: item.key,
      unreadyDependencies: item.dependsOn.filter((dependency) => !isReady(dependency)),
      declaredBlockers: item.blockers
    }))
    .filter((entry) => entry.unreadyDependencies.length > 0 || entry.declaredBlockers.length > 0);

  for (const item of ledger.items) {
    if (item.status !== "done") continue;
    if (item.key === canonicalUmbrellaKey) {
      const unready = canonicalWorkstreamKeys.filter((key) => !isReady(key));
      if (unready.length > 0) errors.push("umbrella cannot be done while workstreams are unready: " + unready.join(", "));
      if (item.blockers.length > 0) errors.push("umbrella cannot be done while declared blockers remain");
      continue;
    }
    const ownGap = evidenceGaps.find((gap) => gap.item === item.key);
    const missingEvidence = ownGap?.missing.filter((gap) => gap !== "status:done") ?? [];
    if (missingEvidence.length > 0) {
      errors.push(item.key + " claims done without required evidence: " + missingEvidence.join(", "));
    }
    const blockers = crossPlanBlockers.find((entry) => entry.item === item.key);
    if (blockers) errors.push(item.key + " claims done while cross-plan blockers remain");
  }

  const umbrellaDone = umbrella?.status === "done";
  const closureReady = errors.length === 0
    && umbrellaDone
    && umbrella?.blockers.length === 0
    && readyWorkstreams.length === canonicalWorkstreamKeys.length;

  return {
    errors,
    crossPlanBlockers,
    evidenceGaps: evidenceGaps.filter((gap) => gap.missing.length > 0),
    readyWorkstreams,
    closureReady,
    umbrellaDone
  };
}

function loadCanonicalSchema(): { path: string; value: JsonObject } {
  const schemaValue = parseJson(canonicalSchemaPath);
  if (!isObject(schemaValue)) throw new Error("JSON Schema root must be an object");
  return { path: canonicalSchemaPath, value: schemaValue as JsonObject };
}

function printFailure(error: unknown, requireComplete: boolean): void {
  process.stdout.write(JSON.stringify({
    valid: false,
    mode: requireComplete ? "require-complete" : "consistency",
    closureReady: false,
    errors: [error instanceof Error ? error.message : String(error)]
  }, null, 2) + "\n");
  process.exitCode = 1;
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printFailure(error, process.argv.includes("--require-complete"));
    return;
  }

  try {
    const ledgerValue = parseJson(options.ledgerPath);
    const schema = loadCanonicalSchema();
    const schemaErrors: string[] = [];
    validateSchema(ledgerValue, schema.value, schema.value, "$", schemaErrors);
    const semantics = schemaErrors.length === 0
      ? validateSemantics(ledgerValue as HardeningLedger)
      : undefined;
    const errors = [...schemaErrors, ...(semantics?.errors ?? [])];
    const valid = errors.length === 0;
    const closureReady = semantics?.closureReady ?? false;

    process.stdout.write(JSON.stringify({
      valid,
      mode: options.requireComplete ? "require-complete" : "consistency",
      ledger: displayPath(options.ledgerPath),
      schema: displayPath(schema.path),
      summary: {
        expectedItemCount: canonicalItemKeys.length,
        actualItemCount: isObject(ledgerValue) && Array.isArray(ledgerValue.items) ? ledgerValue.items.length : null,
        readyWorkstreams: semantics?.readyWorkstreams.length ?? 0,
        totalWorkstreams: canonicalWorkstreamKeys.length,
        umbrellaDone: semantics?.umbrellaDone ?? false,
        closureReady
      },
      errors,
      crossPlanBlockers: semantics?.crossPlanBlockers ?? [],
      evidenceGaps: semantics?.evidenceGaps ?? []
    }, null, 2) + "\n");

    if (!valid || (options.requireComplete && !closureReady)) process.exitCode = 1;
  } catch (error) {
    printFailure(error, options.requireComplete);
  }
}

main();
