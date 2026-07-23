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

function hasExactDataKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && "value" in descriptor);
  });
}

function result(
  decision: ControlDecision,
  mode: "off" | "observe_only",
  diagnostics: ControlEvaluationDiagnostic[],
  activeControlIds: string[] = [],
  acceptedEventCount = 0,
  rejectedEventCount = 0,
): ControlEvaluationResultV1 {
  return {
    decision,
    mode,
    enforced: false,
    active_control_ids: [...activeControlIds].sort(),
    accepted_event_count: acceptedEventCount,
    rejected_event_count: rejectedEventCount,
    diagnostics,
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
  if (!hasExactDataKeys(input.config, CONFIG_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
  if (input.config.mode === "off") {
    return result("allow", "off", [{ code: "validator_disabled" }]);
  }
  if (input.config.mode !== "observe_only") {
    return result("indeterminate", "observe_only", [{ code: "unsupported_evaluator_mode" }]);
  }
  if (input.config.validator_version !== CONTROL_VALIDATOR_VERSION) {
    return result("indeterminate", "observe_only", [{ code: "unsupported_validator_version" }]);
  }

  if (!hasExactDataKeys(input.target, TARGET_KEYS)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }

  const activationTime = controlTimestampMsV1(input.config.activation_timestamp);
  const evaluationTime = controlTimestampMsV1(input.config.evaluation_time);
  if (activationTime === null || evaluationTime === null || evaluationTime < activationTime || !isValidTarget(input.target)) {
    return result("indeterminate", "observe_only", [{ code: "invalid_evaluator_input" }]);
  }
  if (input.backend.status === "unavailable") {
    return result("indeterminate", "observe_only", [{ code: "backend_unavailable" }]);
  }
  if (input.backend.observations.length > MAX_CONTROL_OBSERVATIONS) {
    return result("indeterminate", "observe_only", [{ code: "observation_limit_exceeded" }]);
  }

  const diagnostics: ControlEvaluationDiagnostic[] = [];
  const valid: ValidObservation[] = [];
  let rejectedEventCount = 0;

  for (const observation of input.backend.observations) {
    const validation = validateControlMetadataV1(observation.metadata, {
      trusted_envelope: observation.trusted_envelope,
      activation_timestamp: input.config.activation_timestamp,
    });
    if (validation.status === "absent") {
      if (observation.trusted_envelope.blocking === true) diagnostics.push({ code: "ordinary_blocker_ignored" });
      continue;
    }
    if (validation.status === "invalid") {
      rejectedEventCount += 1;
      diagnostics.push({ code: validation.diagnostics[0]?.code ?? "invalid_control_metadata" });
      continue;
    }
    valid.push({
      event: validation.event,
      canonical_event: validation.canonical_event,
      trusted_envelope: observation.trusted_envelope,
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
      releaseIssuedAt >= freezeExpiresAt
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
    if (appliesToTarget(lifecycle.freeze.event, input.target)) applicableControls.push(controlId);
  }

  if (applicableControls.length > 0) {
    for (const controlId of [...applicableControls].sort()) diagnostics.push({ code: "active_control", control_id: controlId });
    return result(
      "hold",
      "observe_only",
      diagnostics,
      applicableControls,
      acceptedEventCount,
      rejectedEventCount,
    );
  }
  if (rejectedEventCount > 0) {
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
