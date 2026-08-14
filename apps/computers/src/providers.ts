import type { Computer, HomeLeaseCapability, Operation, ProviderAssuranceEvidence, ProviderAttempt, ProviderKind, ProviderOutcome, ProviderReadiness } from "./contracts";
import { ComputersError } from "./contracts";
import { types as utilTypes } from "node:util";

const PROVIDER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const MAX_PROVIDER_RESULT_BYTES = 1024 * 1024;
const MAX_PROVIDER_SNAPSHOT_DEPTH = 64;
const MAX_PROVIDER_SNAPSHOT_NODES = 100_000;

type JsonSnapshot = null | string | number | boolean | JsonSnapshot[] | { [key: string]: JsonSnapshot };

type SnapshotResult =
  | { ok: true; value: JsonSnapshot }
  | { ok: false };

interface SnapshotState {
  readonly seen: Set<object>;
  nodes: number;
}

export interface ProviderMalformedOutcome {
  kind: "malformed";
  providerOperationId: string;
  message: string;
  resource?: NonNullable<ProviderOutcome["resource"]>;
}

export type ProviderOutcomeInspection =
  | { kind: "valid"; outcome: ProviderOutcome }
  | Omit<ProviderMalformedOutcome, "providerOperationId">;

export interface ProviderMalformedInspection {
  providerOperationId?: string;
  message?: string;
  resource?: NonNullable<ProviderOutcome["resource"]>;
}

function invalidSnapshot(): SnapshotResult {
  return { ok: false };
}

function snapshotJsonData(value: unknown, state: SnapshotState, depth = 0): SnapshotResult {
  state.nodes += 1;
  if (state.nodes > MAX_PROVIDER_SNAPSHOT_NODES || depth > MAX_PROVIDER_SNAPSHOT_DEPTH) return invalidSnapshot();
  if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : invalidSnapshot();
  if (typeof value !== "object") return invalidSnapshot();
  if (utilTypes.isProxy(value)) return invalidSnapshot();
  if (state.seen.has(value)) return invalidSnapshot();
  state.seen.add(value);
  try {
    let prototype: object | null;
    let descriptors: Record<string, PropertyDescriptor>;
    let symbols: symbol[];
    try {
      prototype = Object.getPrototypeOf(value) as object | null;
      descriptors = Object.getOwnPropertyDescriptors(value);
      symbols = Object.getOwnPropertySymbols(descriptors);
    } catch {
      return invalidSnapshot();
    }
    if (symbols.length !== 0) return invalidSnapshot();
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return invalidSnapshot();
      const lengthDescriptor = descriptors["length"];
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) return invalidSnapshot();
      const length = Number(lengthDescriptor.value);
      const output: JsonSnapshot[] = [];
      for (const key of Object.keys(descriptors)) {
        if (key === "length") continue;
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) return invalidSnapshot();
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return invalidSnapshot();
        const item = snapshotJsonData(descriptor.value, state, depth + 1);
        if (!item.ok) return item;
        output.push(item.value);
      }
      return { ok: true, value: output };
    }
    if (prototype !== Object.prototype && prototype !== null) return invalidSnapshot();
    const output: Record<string, JsonSnapshot> = Object.create(null) as Record<string, JsonSnapshot>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) return invalidSnapshot();
      const item = snapshotJsonData(descriptor.value, state, depth + 1);
      if (!item.ok) return item;
      Object.defineProperty(output, key, { value: item.value, enumerable: true, configurable: true, writable: true });
    }
    return { ok: true, value: output };
  } finally {
    state.seen.delete(value);
  }
}

function snapshotJson(value: unknown): SnapshotResult {
  try { return snapshotJsonData(value, { seen: new Set(), nodes: 0 }); }
  catch { return invalidSnapshot(); }
}

function isWithinJsonByteLimit(value: JsonSnapshot, limit: number): boolean {
  const encoder = new TextEncoder();
  let bytes = 0;
  const add = (text: string): boolean => {
    if (text.length > limit - bytes) return false;
    bytes += encoder.encode(text).byteLength;
    return bytes <= limit;
  };
  const visit = (item: JsonSnapshot): boolean => {
    if (item === null) return add("null");
    if (typeof item === "string") return add(JSON.stringify(item));
    if (typeof item === "number") return add(Object.is(item, -0) ? "0" : String(item));
    if (typeof item === "boolean") return add(item ? "true" : "false");
    if (Array.isArray(item)) {
      if (!add("[")) return false;
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const lengthDescriptor = (descriptors as Record<string, PropertyDescriptor>)["length"];
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return false;
      const length = Number(lengthDescriptor.value);
      for (let index = 0; index < length; index += 1) {
        if (index !== 0 && !add(",")) return false;
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !visit(descriptor.value as JsonSnapshot)) return false;
      }
      return add("]");
    }
    if (!add("{")) return false;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    let index = 0;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return false;
      if (index !== 0 && !add(",")) return false;
      if (!add(JSON.stringify(key)) || !add(":") || !visit(descriptor.value as JsonSnapshot)) return false;
      index += 1;
    }
    return add("}");
  };
  return visit(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
}

function defineOwnData(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function resource(value: unknown): NonNullable<ProviderOutcome["resource"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
  const item = value as Record<string, unknown>; exact(item, ["resourceId", "instanceId", "bootId"]);
  for (const key of ["resourceId", "instanceId", "bootId"] as const) {
    if ((key === "resourceId" || item[key] !== undefined) && (typeof item[key] !== "string" || !PROVIDER_REFERENCE.test(item[key]))) {
      throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    }
  }
  const result = Object.create(null) as NonNullable<ProviderOutcome["resource"]>;
  defineOwnData(result, "resourceId", String(item.resourceId));
  if (item.instanceId !== undefined) defineOwnData(result, "instanceId", String(item.instanceId));
  if (item.bootId !== undefined) defineOwnData(result, "bootId", String(item.bootId));
  return result;
}

const ASSURANCE_KEYS = ["confinementClass", "providerSpecificControlsPassed", "externalEgressEnforced", "residentIndependentIsolation", "hostMounts", "hostSockets", "portForwards", "containerd", "networkPolicyId"] as const;

function validateProviderAssuranceSnapshot(value: unknown): ProviderAssuranceEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", "Provider returned invalid assurance evidence", 500);
  const item = value as Record<string, unknown>;
  exact(item, ASSURANCE_KEYS);
  if (!["dedicated_machine", "unverified_vm", "strict_vm"].includes(String(item.confinementClass))) throw new ComputersError("invalid_request", "Provider returned invalid assurance evidence", 500);
  for (const key of ["providerSpecificControlsPassed", "externalEgressEnforced", "residentIndependentIsolation", "hostMounts", "hostSockets", "portForwards", "containerd"] as const) {
    if (typeof item[key] !== "boolean") throw new ComputersError("invalid_request", "Provider returned invalid assurance evidence", 500);
  }
  if (item.networkPolicyId !== undefined && (typeof item.networkPolicyId !== "string" || !/^[a-z][a-z0-9._:-]{2,127}$/.test(item.networkPolicyId))) {
    throw new ComputersError("invalid_request", "Provider returned invalid assurance evidence", 500);
  }
  if (item.confinementClass === "strict_vm" && (item.providerSpecificControlsPassed !== true || item.externalEgressEnforced !== true
    || item.residentIndependentIsolation !== true || item.hostMounts !== false || item.hostSockets !== false
    || item.portForwards !== false || item.containerd !== false || item.networkPolicyId === undefined)) {
    throw new ComputersError("invalid_request", "Provider strict assurance evidence is inconsistent", 500);
  }
  if (item.confinementClass === "dedicated_machine" && (item.providerSpecificControlsPassed !== true || item.residentIndependentIsolation !== false)) {
    throw new ComputersError("invalid_request", "Provider dedicated-machine assurance evidence is inconsistent", 500);
  }
  const evidence = Object.create(null) as ProviderAssuranceEvidence;
  for (const key of ASSURANCE_KEYS) {
    if (item[key] !== undefined) defineOwnData(evidence, key, item[key]);
  }
  return evidence;
}

export function validateProviderAssurance(value: unknown): ProviderAssuranceEvidence {
  const snapshot = snapshotJson(value);
  if (!snapshot.ok) throw new ComputersError("invalid_request", "Provider returned invalid assurance evidence", 500);
  return validateProviderAssuranceSnapshot(snapshot.value);
}

function validateProviderOutcomeSnapshot(value: unknown): ProviderOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
  const item = value as Record<string, unknown>;
  if (item.kind === "success") {
    exact(item, ["kind", "resource", "result"]);
    if (typeof item.result !== "object" || item.result === null || Array.isArray(item.result)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    if (!isWithinJsonByteLimit(item.result as JsonSnapshot, MAX_PROVIDER_RESULT_BYTES)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    const result = item.result as Record<string, unknown>;
    if (Object.hasOwn(result, "assurance")) result.assurance = validateProviderAssuranceSnapshot(result.assurance);
    return { kind: "success", resource: resource(item.resource), result };
  }
  if (item.kind === "definite_failure") {
    exact(item, ["kind", "code", "message", "resource"]);
    if (typeof item.code !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(item.code)
      || typeof item.message !== "string" || item.message.length < 1 || item.message.length > 512) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    const outcome: Extract<ProviderOutcome, { kind: "definite_failure" }> = { kind: "definite_failure", code: item.code, message: item.message };
    if (item.resource !== undefined) outcome.resource = resource(item.resource);
    return outcome;
  }
  if (item.kind === "unknown") {
    exact(item, ["kind", "providerOperationId", "message", "resource"]);
    if (typeof item.providerOperationId !== "string" || !PROVIDER_REFERENCE.test(item.providerOperationId)
      || typeof item.message !== "string" || item.message.length < 1 || item.message.length > 512) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    const outcome: Extract<ProviderOutcome, { kind: "unknown" }> = { kind: "unknown", providerOperationId: item.providerOperationId, message: item.message };
    if (item.resource !== undefined) outcome.resource = resource(item.resource);
    return outcome;
  }
  throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
}

function snapshotProviderEnvelope(value: unknown): { snapshot?: Record<string, unknown>; resource?: NonNullable<ProviderOutcome["resource"]> } {
  if (typeof value !== "object" || value === null) return {};
  if (utilTypes.isProxy(value)) return {};
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    if (Array.isArray(value)) return {};
    prototype = Object.getPrototypeOf(value) as object | null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return {}; }
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length !== 0) return {};
  const state: SnapshotState = { seen: new Set([value]), nodes: 1 };
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let complete = true;
  let recoveredResource: NonNullable<ProviderOutcome["resource"]> | undefined;
  try {
    const entries = Object.entries(descriptors);
    const resourceIndex = entries.findIndex(([key]) => key === "resource");
    if (resourceIndex > 0) entries.unshift(entries.splice(resourceIndex, 1)[0]!);
    for (const [key, descriptor] of entries) {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        complete = false;
        continue;
      }
      const item = snapshotJsonData(descriptor.value, state, 1);
      if (!item.ok) {
        complete = false;
        continue;
      }
      Object.defineProperty(output, key, { value: item.value, enumerable: true, configurable: true, writable: true });
      if (key === "resource") {
        try { recoveredResource = resource(item.value); }
        catch { recoveredResource = undefined; }
      }
    }
  } catch { complete = false; }
  return {
    ...(complete ? { snapshot: output } : {}),
    ...(recoveredResource === undefined ? {} : { resource: recoveredResource }),
  };
}

export function inspectProviderOutcome(value: unknown): ProviderOutcomeInspection {
  const envelope = snapshotProviderEnvelope(value);
  if (envelope.snapshot === undefined) return {
    kind: "malformed", message: "Provider returned a malformed outcome",
    ...(envelope.resource === undefined ? {} : { resource: envelope.resource }),
  };
  try { return { kind: "valid", outcome: validateProviderOutcomeSnapshot(envelope.snapshot) }; }
  catch {
    return {
      kind: "malformed", message: "Provider returned a malformed outcome",
      ...(envelope.resource === undefined ? {} : { resource: envelope.resource }),
    };
  }
}

export function inspectProviderMalformedOutcome(value: unknown): ProviderMalformedInspection {
  const envelope = snapshotProviderEnvelope(value);
  const inspected: ProviderMalformedInspection = envelope.resource === undefined ? {} : { resource: envelope.resource };
  const snapshot = envelope.snapshot;
  if (snapshot === undefined || snapshot.kind !== "malformed"
    || Object.keys(snapshot).some((key) => !["kind", "providerOperationId", "message", "resource"].includes(key))) return inspected;
  if (typeof snapshot.providerOperationId === "string" && PROVIDER_REFERENCE.test(snapshot.providerOperationId)) {
    inspected.providerOperationId = snapshot.providerOperationId;
  }
  if (typeof snapshot.message === "string" && snapshot.message.length >= 1 && snapshot.message.length <= 512) {
    inspected.message = snapshot.message;
  }
  return inspected;
}

export function inspectProviderResource(value: unknown): NonNullable<ProviderOutcome["resource"]> | undefined {
  const snapshot = snapshotJson(value);
  if (!snapshot.ok) return undefined;
  try { return resource(snapshot.value); }
  catch { return undefined; }
}

export function validateProviderOutcome(value: unknown): ProviderOutcome {
  const inspection = inspectProviderOutcome(value);
  if (inspection.kind === "malformed") throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
  return inspection.outcome;
}

export interface ProviderCreateRequest {
  computer: Computer;
  operation: Operation;
  attempt: ProviderAttempt;
  execution: ProviderExecutionGuard;
}

export interface ProviderExecutionGuard {
  ownerGeneration: number;
  signal: AbortSignal;
  assertCurrent(): void;
}

export interface ProviderOperationRequest extends ProviderCreateRequest {
  homeLease?: HomeLeaseCapability;
  // Set by the worker ONLY when dispatching provider.quarantine() as the restrictive compensation
  // for a fenced/assurance-lost original operation whose kind is not "quarantine". It authorizes the
  // adopted provider to accept the (bounded) kind mismatch for the always-safe quarantine transition,
  // without loosening any other entry point. It is never set for a caller-requested quarantine.
  compensatingQuarantine?: boolean;
}

export interface ProviderPort {
  readonly kind: ProviderKind;
  readiness(): Promise<ProviderReadiness>;
  create(request: ProviderCreateRequest): Promise<ProviderOutcome>;
  start(request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome>;
  stop(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  quarantine(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  delete(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  restore(request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome>;
  reconcile(request: ProviderOperationRequest): Promise<ProviderOutcome>;
}

export class UnconfiguredProvider implements ProviderPort {
  readonly kind: ProviderKind;

  constructor(kind: ProviderKind) {
    this.kind = kind;
  }

  async readiness(): Promise<ProviderReadiness> {
    const vm = this.kind !== "local_machine";
    return {
      provider: this.kind,
      configured: false,
      ready: false,
      confinementClass: vm ? "unverified_vm" : "dedicated_machine",
      controls: vm
        ? { providerSpecificControlsPassed: false, externalEgressEnforced: false, residentIndependentIsolation: false }
        : { entireHostDedicated: false, controllerExternallyProtected: false },
      limitations: [
        "Provider adapter is not configured in this core slice.",
        this.kind === "aws_ec2"
          ? "strict_vm remains a future provider capability after provider-specific isolation and egress controls pass."
          : this.kind === "local_vm"
            ? "Stock Lima local_vm remains unverified_vm until a package-owned strict_guest provider replaces it."
          : "local_machine is lower-assurance dedicated_machine confinement and never strict VM isolation.",
      ],
    };
  }

  async create(_request: ProviderCreateRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async start(_request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async stop(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async quarantine(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async delete(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async restore(_request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome> { return this.unavailable(); }
  async reconcile(_request: ProviderOperationRequest): Promise<ProviderOutcome> { return this.unavailable(); }

  private unavailable(): ProviderOutcome {
    return { kind: "definite_failure", code: "provider_not_configured", message: `Provider ${this.kind} is not configured` };
  }
}

export function createProviderPorts(): Record<ProviderKind, ProviderPort> {
  return {
    local_machine: new UnconfiguredProvider("local_machine"),
    local_vm: new UnconfiguredProvider("local_vm"),
    aws_ec2: new UnconfiguredProvider("aws_ec2"),
  };
}
