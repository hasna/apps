import {
  CONTROL_VALIDATOR_VERSION,
  canonicalJson,
  controlTimestampMsV1,
  isControlScopeV1,
  isControlTokenV1,
  validateControlMetadataV1,
  type ControlEventV1,
  type ControlScopeV1,
  type TrustedControlEnvelopeV1,
} from "./control-contract.js";
import { types as utilTypes } from "node:util";

export type ControlDecision = "allow" | "hold" | "indeterminate";

export interface ControlObservationV1 {
  content: string | null;
  metadata: unknown;
  trusted_envelope: TrustedControlEnvelopeV1;
}

export type ControlBackendSnapshotV1 =
  | {
      status: "available";
      observations: readonly ControlObservationV1[];
    }
  | {
      status: "unavailable";
    };

export interface ControlEvaluatorConfigV1 {
  mode: string;
  validator_version: string;
  activation_timestamp: string;
  evaluation_time: string;
}

export interface ControlEvaluationTargetV1 {
  tenant: string;
  authority_domain: string;
  scope: ControlScopeV1;
  operation: string;
  resource: string;
}

export interface ControlEvaluationInputV1 {
  config: ControlEvaluatorConfigV1;
  target: ControlEvaluationTargetV1;
  backend: ControlBackendSnapshotV1;
}

export interface ControlEvaluationDiagnostic {
  code: string;
  event_id?: string;
  control_id?: string;
}

export interface ControlEvaluationResultV1 {
  decision: ControlDecision;
  mode: "off" | "observe_only";
  enforced: false;
  active_control_ids: string[];
  accepted_event_count: number;
  rejected_event_count: number;
  diagnostics: ControlEvaluationDiagnostic[];
}

export const MAX_CONTROL_OBSERVATIONS = 4_096;

interface ValidObservation {
  event: ControlEventV1;
  canonical_event: string;
  trusted_envelope: TrustedControlEnvelopeV1;
}

interface LifecycleState {
  freeze: ValidObservation;
  released: boolean;
}

const CONFIG_KEYS = ["mode", "validator_version", "activation_timestamp", "evaluation_time"] as const;
const TARGET_KEYS = ["tenant", "authority_domain", "scope", "operation", "resource"] as const;
const INPUT_KEYS = ["config", "target", "backend"] as const;
const AVAILABLE_BACKEND_KEYS = ["status", "observations"] as const;
const UNAVAILABLE_BACKEND_KEYS = ["status"] as const;
const OBSERVATION_KEYS = ["content", "metadata", "trusted_envelope"] as const;

function readDataRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (utilTypes.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result = Object.create(null) as Record<string, unknown>;
  let keyCount = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return null;
    keyCount += 1;
    if (keyCount > 32) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function hasExactRecordKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function readObservationArray(
  value: unknown,
): { status: "valid"; values: unknown[] } | { status: "too_many" } | { status: "invalid" } {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return { status: "invalid" };
  if (Object.getPrototypeOf(value) !== Array.prototype) return { status: "invalid" };
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return { status: "invalid" };
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_CONTROL_OBSERVATIONS) return { status: "too_many" };

  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return { status: "invalid" };
    values.push(descriptor.value);
  }
  let enumerableCount = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return { status: "invalid" };
    enumerableCount += 1;
    if (enumerableCount > length) return { status: "invalid" };
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      return { status: "invalid" };
    }
  }
  if (enumerableCount !== length) return { status: "invalid" };
  return { status: "valid", values };
}

function result(
  decision: ControlDecision,
  mode: "off" | "observe_only",
  diagnostics: ControlEvaluationDiagnostic[],
  activeControlIds: string[] = [],
  acceptedEventCount = 0,
  rejectedEventCount = 0,
): ControlEvaluationResultV1 {
  const sortedDiagnostics = [...diagnostics].sort((left, right) => {
    const leftKey = `${left.code}\u0000${left.event_id ?? ""}\u0000${left.control_id ?? ""}`;
    const rightKey = `${right.code}\u0000${right.event_id ?? ""}\u0000${right.control_id ?? ""}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    decision,
    mode,
    enforced: false,
    active_control_ids: [...activeControlIds].sort(),
    accepted_event_count: acceptedEventCount,
    rejected_event_count: rejectedEventCount,
    diagnostics: sortedDiagnostics,
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scopesEqual(left: ControlScopeV1, right: ControlScopeV1): boolean {
  return left.kind === right.kind && arraysEqual(left.ids, right.ids);
}

function scopesOverlap(left: ControlScopeV1, right: ControlScopeV1): boolean {
  if (left.kind !== right.kind) return false;
  const rightIds = new Set(right.ids);
  return left.ids.some((id) => rightIds.has(id));
}

function releaseMatches(freeze: ControlEventV1, release: ControlEventV1): boolean {
  const reference = release.unfreeze_of;
  if (!reference) return false;
  return (
    reference.event_id === freeze.event_id &&
    reference.control_id === freeze.control_id &&
    reference.fingerprint === freeze.fingerprint &&
    release.control_id === freeze.control_id &&
    release.fingerprint === freeze.fingerprint &&
    release.tenant === freeze.tenant &&
    release.authority_domain === freeze.authority_domain &&
    release.policy_version === freeze.policy_version &&
    release.publisher === freeze.publisher &&
    release.surface === freeze.surface &&
    scopesEqual(release.scope, freeze.scope) &&
    arraysEqual(release.affected_operations, freeze.affected_operations) &&
    arraysEqual(release.affected_resources, freeze.affected_resources)
  );
}

function isValidTarget(target: ControlEvaluationTargetV1): boolean {
  return (
    isControlTokenV1(target.tenant) &&
    isControlTokenV1(target.authority_domain) &&
    isControlScopeV1(target.scope) &&
    isControlTokenV1(target.operation) &&
    isControlTokenV1(target.resource)
  );
}

function appliesToTarget(event: ControlEventV1, target: ControlEvaluationTargetV1): boolean {
  return (
    event.tenant === target.tenant &&
    event.authority_domain === target.authority_domain &&
    scopesOverlap(event.scope, target.scope) &&
    event.affected_operations.includes(target.operation) &&
    event.affected_resources.includes(target.resource)
  );
}

function lifecycleKey(event: Pick<ControlEventV1, "tenant" | "authority_domain" | "control_id">): string {
  return `${event.tenant}\u0000${event.authority_domain}\u0000${event.control_id}`;
}

function compareObservations(left: ValidObservation, right: ValidObservation): number {
  const trustedDelta = controlTimestampMsV1(left.trusted_envelope.server_time)! - controlTimestampMsV1(right.trusted_envelope.server_time)!;
  if (trustedDelta !== 0) return trustedDelta;
  const issuedDelta = controlTimestampMsV1(left.event.issued_at)! - controlTimestampMsV1(right.event.issued_at)!;
  if (issuedDelta !== 0) return issuedDelta;
  if (left.event.lifecycle_version !== right.event.lifecycle_version) {
    return left.event.lifecycle_version - right.event.lifecycle_version;
  }
  return left.event.event_id < right.event.event_id ? -1 : left.event.event_id > right.event.event_id ? 1 : 0;
}

function evaluateControlsV1Unsafe(input: ControlEvaluationInputV1): ControlEvaluationResultV1 {
  const stableInput = readDataRecord(input);
  if (!stableInput || !hasExactRecordKeys(stableInput, INPUT_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
  const config = readDataRecord(stableInput.config);
  if (!config || !hasExactRecordKeys(config, CONFIG_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
  if (config.mode === "off") {
    return result("allow", "off", [{ code: "validator_disabled" }]);
  }
  if (config.mode !== "observe_only") {
    return result("indeterminate", "observe_only", [{ code: "unsupported_evaluator_mode" }]);
  }
  if (config.validator_version !== CONTROL_VALIDATOR_VERSION) {
    return result("indeterminate", "observe_only", [{ code: "unsupported_validator_version" }]);
  }

  const targetRecord = readDataRecord(stableInput.target);
  if (!targetRecord || !hasExactRecordKeys(targetRecord, TARGET_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }

  const activationTime = controlTimestampMsV1(config.activation_timestamp);
  const evaluationTime = controlTimestampMsV1(config.evaluation_time);
  let stableScope: unknown;
  try {
    stableScope = JSON.parse(canonicalJson(targetRecord.scope));
  } catch {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
  const target: ControlEvaluationTargetV1 = {
    tenant: targetRecord.tenant as string,
    authority_domain: targetRecord.authority_domain as string,
    scope: stableScope as ControlScopeV1,
    operation: targetRecord.operation as string,
    resource: targetRecord.resource as string,
  };
  if (activationTime === null || evaluationTime === null || evaluationTime < activationTime || !isValidTarget(target)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }

  const backend = readDataRecord(stableInput.backend);
  if (!backend) {
    return result("indeterminate", "observe_only", [{ code: "invalid_backend_snapshot" }]);
  }
  if (backend.status === "unavailable" && hasExactRecordKeys(backend, UNAVAILABLE_BACKEND_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "backend_unavailable" }]);
  }
  if (backend.status !== "available" || !hasExactRecordKeys(backend, AVAILABLE_BACKEND_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_backend_snapshot" }]);
  }
  const observationArray = readObservationArray(backend.observations);
  if (observationArray.status === "too_many") {
    return result("indeterminate", "observe_only", [{ code: "observation_limit_exceeded" }]);
  }
  if (observationArray.status === "invalid") {
    return result("indeterminate", "observe_only", [{ code: "invalid_backend_snapshot" }]);
  }

  const diagnostics: ControlEvaluationDiagnostic[] = [];
  const valid: ValidObservation[] = [];
  let rejectedEventCount = 0;
  let uncertainObservationCount = 0;
  let excludedFutureObservationCount = 0;

  for (const rawObservation of observationArray.values) {
    const observation = readDataRecord(rawObservation);
    if (
      !observation ||
      !hasExactRecordKeys(observation, OBSERVATION_KEYS) ||
      (observation.content !== null && typeof observation.content !== "string")
    ) {
      rejectedEventCount += 1;
      uncertainObservationCount += 1;
      diagnostics.push({ code: "invalid_observation" });
      continue;
    }
    const validation = validateControlMetadataV1(observation.metadata, {
      trusted_envelope: observation.trusted_envelope as TrustedControlEnvelopeV1,
      activation_timestamp: config.activation_timestamp as string,
    });
    if (validation.status === "absent") {
      const trusted = readDataRecord(observation.trusted_envelope);
      if (trusted?.blocking === true) diagnostics.push({ code: "ordinary_blocker_ignored" });
      continue;
    }
    if (validation.status === "invalid") {
      rejectedEventCount += 1;
      uncertainObservationCount += 1;
      diagnostics.push({ code: validation.diagnostics[0]?.code ?? "invalid_control_metadata" });
      continue;
    }
    const eventIssuedAt = controlTimestampMsV1(validation.event.issued_at)!;
    const ingressAt = controlTimestampMsV1(validation.trusted_envelope.server_time)!;
    if (eventIssuedAt > evaluationTime || ingressAt > evaluationTime) {
      rejectedEventCount += 1;
      excludedFutureObservationCount += 1;
      diagnostics.push({
        code: "observation_from_future",
        event_id: validation.event.event_id,
        control_id: validation.event.control_id,
      });
      continue;
    }
    valid.push({
      event: validation.event,
      canonical_event: validation.canonical_event,
      trusted_envelope: validation.trusted_envelope,
    });
  }

  valid.sort(compareObservations);
  const seenEvents = new Map<string, string>();
  const lifecycles = new Map<string, LifecycleState>();
  const lifecycleKeysByControlId = new Map<string, Set<string>>();
  let acceptedEventCount = 0;

  for (const observation of valid) {
    const { event } = observation;
    const seenCanonical = seenEvents.get(event.event_id);
    if (seenCanonical !== undefined) {
      if (seenCanonical === observation.canonical_event) {
        diagnostics.push({ code: "exact_replay_ignored", event_id: event.event_id, control_id: event.control_id });
      } else {
        rejectedEventCount += 1;
        diagnostics.push({ code: "conflicting_duplicate", event_id: event.event_id, control_id: event.control_id });
      }
      continue;
    }
    seenEvents.set(event.event_id, observation.canonical_event);

    const key = lifecycleKey(event);
    const lifecycle = lifecycles.get(key);
    if (event.state === "freeze") {
      if (lifecycle) {
        rejectedEventCount += 1;
        diagnostics.push({ code: "conflicting_duplicate", event_id: event.event_id, control_id: event.control_id });
        continue;
      }
      lifecycles.set(key, { freeze: observation, released: false });
      const indexedKeys = lifecycleKeysByControlId.get(event.control_id) ?? new Set<string>();
      indexedKeys.add(key);
      lifecycleKeysByControlId.set(event.control_id, indexedKeys);
      acceptedEventCount += 1;
      continue;
    }

    if (!lifecycle) {
      rejectedEventCount += 1;
      diagnostics.push({
        code: lifecycleKeysByControlId.has(event.control_id)
          ? "unfreeze_context_mismatch"
          : "orphan_or_reordered_unfreeze",
        event_id: event.event_id,
        control_id: event.control_id,
      });
      continue;
    }
    if (lifecycle.released) {
      rejectedEventCount += 1;
      diagnostics.push({ code: "stale_or_reordered_unfreeze", event_id: event.event_id, control_id: event.control_id });
      continue;
    }
    if (!releaseMatches(lifecycle.freeze.event, event)) {
      rejectedEventCount += 1;
      diagnostics.push({ code: "unfreeze_context_mismatch", event_id: event.event_id, control_id: event.control_id });
      continue;
    }

    const freezeIssuedAt = controlTimestampMsV1(lifecycle.freeze.event.issued_at)!;
    const freezeIngressAt = controlTimestampMsV1(lifecycle.freeze.trusted_envelope.server_time)!;
    const freezeExpiresAt = controlTimestampMsV1(lifecycle.freeze.event.expires_at)!;
    const releaseIssuedAt = controlTimestampMsV1(event.issued_at)!;
    const releaseIngressAt = controlTimestampMsV1(observation.trusted_envelope.server_time)!;
    if (
      releaseIssuedAt <= freezeIssuedAt ||
      releaseIngressAt <= freezeIngressAt ||
      releaseIssuedAt >= freezeExpiresAt ||
      releaseIngressAt >= freezeExpiresAt
    ) {
      rejectedEventCount += 1;
      diagnostics.push({ code: "stale_or_reordered_unfreeze", event_id: event.event_id, control_id: event.control_id });
      continue;
    }

    lifecycle.released = true;
    acceptedEventCount += 1;
    diagnostics.push({ code: "control_released", event_id: event.event_id, control_id: event.control_id });
  }

  const applicableControls: string[] = [];
  for (const lifecycle of lifecycles.values()) {
    const controlId = lifecycle.freeze.event.control_id;
    if (lifecycle.released) continue;
    if (controlTimestampMsV1(lifecycle.freeze.event.expires_at)! <= evaluationTime) {
      diagnostics.push({
        code: "freeze_expired",
        event_id: lifecycle.freeze.event.event_id,
        control_id: controlId,
      });
      continue;
    }
    if (appliesToTarget(lifecycle.freeze.event, target)) applicableControls.push(controlId);
  }

  for (const controlId of [...applicableControls].sort()) {
    diagnostics.push({ code: "active_control", control_id: controlId });
  }
  if (uncertainObservationCount > 0) {
    return result(
      "indeterminate",
      "observe_only",
      diagnostics,
      applicableControls,
      acceptedEventCount,
      rejectedEventCount,
    );
  }
  if (applicableControls.length > 0) {
    return result(
      "hold",
      "observe_only",
      diagnostics,
      applicableControls,
      acceptedEventCount,
      rejectedEventCount,
    );
  }
  if (rejectedEventCount > excludedFutureObservationCount) {
    return result(
      "indeterminate",
      "observe_only",
      diagnostics,
      [],
      acceptedEventCount,
      rejectedEventCount,
    );
  }
  return result("allow", "observe_only", diagnostics, [], acceptedEventCount, rejectedEventCount);
}

export function evaluateControlsV1(input: ControlEvaluationInputV1): ControlEvaluationResultV1 {
  try {
    return evaluateControlsV1Unsafe(input);
  } catch {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
}
