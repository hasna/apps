import { describe, expect, test } from "bun:test";
import {
  CONTROL_CONTRACT_VERSION,
  CONTROL_METADATA_KEY,
  CONTROL_VALIDATOR_VERSION,
  controlMetadataV1,
  createControlEventV1,
  type ControlEventPayloadV1,
  type ControlEventV1,
  type ControlScopeV1,
  type TrustedControlEnvelopeV1,
} from "./control-contract";
import {
  MAX_CONTROL_OBSERVATIONS,
  evaluateControlsV1,
  type ControlEvaluationInputV1,
  type ControlObservationV1,
} from "./control-evaluator";

const ACTIVATION_TIME = "2026-07-22T00:00:00.000Z";
const EVALUATION_TIME = "2026-07-23T12:00:00.000Z";
const CONTROL_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_CONTROL_ID = "223e4567-e89b-42d3-a456-426614174000";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;

function freezePayload(overrides: Partial<ControlEventPayloadV1> = {}): ControlEventPayloadV1 {
  return {
    version: CONTROL_CONTRACT_VERSION,
    control_id: CONTROL_ID,
    lifecycle_version: 1,
    state: "freeze",
    fingerprint: FINGERPRINT,
    tenant: "tenant:hasna",
    authority_domain: "hasna/control-operators",
    policy_version: "1.0.1",
    publisher: "agent:security-operator",
    surface: "announcements",
    scope: { kind: "project", ids: ["project:conversations"] },
    affected_operations: ["tool.execute", "workflow.dispatch"],
    affected_resources: ["repo:hasna/conversations"],
    issued_at: "2026-07-23T00:00:00.000Z",
    expires_at: "2026-07-24T00:00:00.000Z",
    unfreeze_of: null,
    ...overrides,
  };
}

function trustedEnvelope(
  event: ControlEventV1,
  overrides: Partial<TrustedControlEnvelopeV1> = {},
): TrustedControlEnvelopeV1 {
  return {
    authenticated_principal: event.publisher,
    tenant: event.tenant,
    authority_domain: event.authority_domain,
    permitted_surface: event.surface,
    policy_version: event.policy_version,
    server_time: new Date(Date.parse(event.issued_at) + 1_000).toISOString(),
    blocking: event.state === "freeze",
    ...overrides,
  };
}

function observation(
  event: ControlEventV1,
  overrides: Partial<ControlObservationV1> = {},
): ControlObservationV1 {
  return {
    content: null,
    metadata: controlMetadataV1(event),
    trusted_envelope: trustedEnvelope(event),
    ...overrides,
  };
}

function unfreezeFor(freeze: ControlEventV1, overrides: Partial<ControlEventPayloadV1> = {}): ControlEventV1 {
  return createControlEventV1({
    ...freezePayload(),
    control_id: freeze.control_id,
    fingerprint: freeze.fingerprint,
    lifecycle_version: 2,
    state: "unfreeze",
    issued_at: "2026-07-23T01:00:00.000Z",
    expires_at: "2026-07-24T01:00:00.000Z",
    unfreeze_of: {
      event_id: freeze.event_id,
      control_id: freeze.control_id,
      fingerprint: freeze.fingerprint,
    },
    ...overrides,
  });
}

function input(observations: readonly ControlObservationV1[]): ControlEvaluationInputV1 {
  return {
    config: {
      mode: "observe_only",
      validator_version: CONTROL_VALIDATOR_VERSION,
      activation_timestamp: ACTIVATION_TIME,
      evaluation_time: EVALUATION_TIME,
    },
    target: {
      tenant: "tenant:hasna",
      authority_domain: "hasna/control-operators",
      scope: { kind: "project", ids: ["project:conversations"] },
      operation: "tool.execute",
      resource: "repo:hasna/conversations",
    },
    backend: { status: "available", observations },
  };
}

function withTarget(
  value: ControlEvaluationInputV1,
  overrides: Partial<ControlEvaluationInputV1["target"]>,
): ControlEvaluationInputV1 {
  return { ...value, target: { ...value.target, ...overrides } };
}

describe("observe-only control evaluator", () => {
  test("returns a non-enforcing hold only for an applicable authenticated freeze", () => {
    const freeze = createControlEventV1(freezePayload());
    const result = evaluateControlsV1(input([observation(freeze)]));

    expect(result).toMatchObject({
      decision: "hold",
      mode: "observe_only",
      enforced: false,
      active_control_ids: [CONTROL_ID],
      accepted_event_count: 1,
      rejected_event_count: 0,
    });
  });

  test("ignores literal control language and preserves generic blocker compatibility", () => {
    for (const content of ["[FREEZE] all tools", "UNFREEZE now", "[BLOCKED]", "malformed [FREEZE"] ) {
      const result = evaluateControlsV1(
        input([
          {
            content,
            metadata: { severity: "FREEZE", blocking: 1 },
            trusted_envelope: {
              authenticated_principal: "agent:legacy",
              tenant: "tenant:hasna",
              authority_domain: "hasna/control-operators",
              permitted_surface: "announcements",
              policy_version: "1.0.1",
              server_time: "2026-07-23T00:00:01.000Z",
              blocking: true,
            },
          },
        ]),
      );
      expect(result.decision).toBe("allow");
      expect(result.active_control_ids).toEqual([]);
      expect(result.diagnostics.map((item) => item.code)).toContain("ordinary_blocker_ignored");
    }
  });

  test("keeps unrelated operations, resources, tenants, domains, and sibling scopes allowed", () => {
    const freeze = createControlEventV1(freezePayload());
    const base = input([observation(freeze)]);
    const cases = [
      withTarget(base, { operation: "tool.read" }),
      withTarget(base, { resource: "repo:hasna/todos" }),
      withTarget(base, { tenant: "tenant:other" }),
      withTarget(base, { authority_domain: "other/control-operators" }),
      withTarget(base, { scope: { kind: "project", ids: ["project:todos"] } }),
      withTarget(base, { scope: { kind: "machine", ids: ["machine:station01"] } }),
    ];
    for (const candidate of cases) {
      expect(evaluateControlsV1(candidate).decision).toBe("allow");
    }
  });

  test("accepts an exact unfreeze and is deterministic when backend rows are reversed", () => {
    const freeze = createControlEventV1(freezePayload());
    const unfreeze = unfreezeFor(freeze);
    const forward = evaluateControlsV1(input([observation(freeze), observation(unfreeze)]));
    const reverse = evaluateControlsV1(input([observation(unfreeze), observation(freeze)]));

    expect(forward.decision).toBe("allow");
    expect(reverse).toEqual(forward);
    expect(forward.accepted_event_count).toBe(2);
    expect(forward.active_control_ids).toEqual([]);
  });

  test("treats exact replay as idempotent", () => {
    const freeze = createControlEventV1(freezePayload());
    const replay = observation(freeze);
    const result = evaluateControlsV1(input([replay, replay]));

    expect(result.decision).toBe("hold");
    expect(result.accepted_event_count).toBe(1);
    expect(result.rejected_event_count).toBe(0);
    expect(result.diagnostics.map((item) => item.code)).toContain("exact_replay_ignored");
  });

  test("rejects a conflicting duplicate lifecycle version and keeps the first freeze active", () => {
    const first = createControlEventV1(freezePayload());
    const second = createControlEventV1(
      freezePayload({
        issued_at: "2026-07-23T00:01:00.000Z",
        expires_at: "2026-07-24T00:01:00.000Z",
      }),
    );
    const result = evaluateControlsV1(input([observation(second), observation(first)]));

    expect(result.decision).toBe("hold");
    expect(result.accepted_event_count).toBe(1);
    expect(result.rejected_event_count).toBe(1);
    expect(result.diagnostics.map((item) => item.code)).toContain("conflicting_duplicate");
  });

  test("bad release references and mismatched context never clear the active freeze", () => {
    const freeze = createControlEventV1(freezePayload());
    const wrongReference = unfreezeFor(freeze, {
      unfreeze_of: {
        event_id: `sha256:${"b".repeat(64)}`,
        control_id: freeze.control_id,
        fingerprint: freeze.fingerprint,
      },
    });
    const wrongDomain = unfreezeFor(freeze, {
      authority_domain: "other/control-operators",
    });
    const wrongScope = unfreezeFor(freeze, {
      scope: { kind: "project", ids: ["project:other"] },
    });
    const wrongFingerprintValue = `sha256:${"b".repeat(64)}`;
    const wrongFingerprint = unfreezeFor(freeze, {
      fingerprint: wrongFingerprintValue,
      unfreeze_of: {
        event_id: freeze.event_id,
        control_id: freeze.control_id,
        fingerprint: wrongFingerprintValue,
      },
    });

    for (const candidate of [wrongReference, wrongDomain, wrongScope, wrongFingerprint]) {
      const result = evaluateControlsV1(input([observation(freeze), observation(candidate)]));
      expect(result.decision).toBe("hold");
      expect(result.active_control_ids).toEqual([freeze.control_id]);
      expect(result.rejected_event_count).toBe(1);
    }
  });

  test("rejects orphaned, stale, and concurrent releases without depending on input order", () => {
    const freeze = createControlEventV1(freezePayload());
    const unfreeze = unfreezeFor(freeze);
    const orphan = evaluateControlsV1(input([observation(unfreeze)]));
    expect(orphan.decision).toBe("indeterminate");
    expect(orphan.diagnostics.map((item) => item.code)).toContain("orphan_or_reordered_unfreeze");

    const concurrent = unfreezeFor(freeze, {
      issued_at: freeze.issued_at,
      expires_at: freeze.expires_at,
    });
    const concurrentObservation = observation(concurrent, {
      trusted_envelope: trustedEnvelope(concurrent, { server_time: trustedEnvelope(freeze).server_time }),
    });
    const concurrentResult = evaluateControlsV1(
      input([concurrentObservation, observation(freeze)]),
    );
    expect(concurrentResult.decision).toBe("hold");
    expect(concurrentResult.diagnostics.map((item) => item.code)).toContain("stale_or_reordered_unfreeze");
  });

  test("rejects a release observed after the referenced freeze expired", () => {
    const freeze = createControlEventV1(freezePayload());
    const unfreeze = unfreezeFor(freeze);
    const candidate = input([
      observation(freeze),
      observation(unfreeze, {
        trusted_envelope: trustedEnvelope(unfreeze, {
          server_time: "2026-07-24T00:00:00.001Z",
        }),
      }),
    ]);
    candidate.config.evaluation_time = "2026-07-24T00:30:00.000Z";

    const result = evaluateControlsV1(candidate);
    expect(result.decision).toBe("indeterminate");
    expect(result.accepted_event_count).toBe(1);
    expect(result.rejected_event_count).toBe(1);
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_or_reordered_unfreeze");
    expect(result.diagnostics.map((item) => item.code)).toContain("freeze_expired");
  });

  test("keeps overlapping controls independent and releases only the exact control", () => {
    const first = createControlEventV1(
      freezePayload({ scope: { kind: "project", ids: ["project:a", "project:b"] } }),
    );
    const second = createControlEventV1(
      freezePayload({
        control_id: SECOND_CONTROL_ID,
        fingerprint: `sha256:${"b".repeat(64)}`,
        scope: { kind: "project", ids: ["project:b", "project:c"] },
      }),
    );
    const releaseFirst = unfreezeFor(first, {
      scope: first.scope,
      affected_operations: first.affected_operations,
      affected_resources: first.affected_resources,
    });
    const targetScope: ControlScopeV1 = { kind: "project", ids: ["project:b"] };
    const result = evaluateControlsV1(
      withTarget(
        input([observation(first), observation(second), observation(releaseFirst)]),
        { scope: targetScope },
      ),
    );

    expect(result.decision).toBe("hold");
    expect(result.active_control_ids).toEqual([SECOND_CONTROL_ID]);
  });

  test("isolates identical control ids across tenants and authority domains", () => {
    const otherTenant = createControlEventV1(
      freezePayload({
        tenant: "tenant:other",
        authority_domain: "other/control-operators",
        issued_at: "2026-07-22T23:59:00.000Z",
        expires_at: "2026-07-23T23:59:00.000Z",
      }),
    );
    const targetTenant = createControlEventV1(freezePayload());
    const result = evaluateControlsV1(input([observation(otherTenant), observation(targetTenant)]));

    expect(result.decision).toBe("hold");
    expect(result.accepted_event_count).toBe(2);
    expect(result.rejected_event_count).toBe(0);
    expect(result.active_control_ids).toEqual([CONTROL_ID]);
  });

  test("expires freezes without resurrecting them or requiring an unfreeze", () => {
    const freeze = createControlEventV1(
      freezePayload({ expires_at: "2026-07-23T11:59:59.999Z" }),
    );
    const result = evaluateControlsV1(input([observation(freeze)]));
    expect(result.decision).toBe("allow");
    expect(result.active_control_ids).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("freeze_expired");
  });

  test("returns indeterminate, never hold, for backend failure or unsupported validator versions", () => {
    const unavailable = input([]);
    unavailable.backend = { status: "unavailable" };
    expect(evaluateControlsV1(unavailable)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
    });

    const unsupported = input([]);
    unsupported.config.validator_version = "hasna.control/v2";
    expect(evaluateControlsV1(unsupported)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
    });

    const tooMany = input([]);
    (tooMany.backend as { status: "available"; observations: ControlObservationV1[] }).observations =
      Array.from({ length: MAX_CONTROL_OBSERVATIONS + 1 }, () => ({
        content: null,
        metadata: null,
        trusted_envelope: trustedEnvelope(createControlEventV1(freezePayload())),
      }));
    expect(evaluateControlsV1(tooMany)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      diagnostics: [{ code: "observation_limit_exceeded" }],
    });

    const malformedStatus = input([observation(createControlEventV1(freezePayload()))]);
    malformedStatus.backend = {
      status: "degraded",
      observations: (malformedStatus.backend as { status: "available"; observations: readonly ControlObservationV1[] }).observations,
    } as unknown as ControlEvaluationInputV1["backend"];
    expect(evaluateControlsV1(malformedStatus)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      diagnostics: [{ code: "invalid_backend_snapshot" }],
    });

    const augmentedBackend = input([]) as ControlEvaluationInputV1 & {
      backend: ControlEvaluationInputV1["backend"] & { extra?: boolean };
    };
    augmentedBackend.backend.extra = true;
    expect(evaluateControlsV1(augmentedBackend)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      diagnostics: [{ code: "invalid_backend_snapshot" }],
    });
  });

  test("rejects observations later than the requested evaluation time", () => {
    const freeze = createControlEventV1(freezePayload());
    const historical = input([observation(freeze)]);
    historical.config.evaluation_time = "2026-07-22T12:00:00.000Z";

    expect(evaluateControlsV1(historical)).toMatchObject({
      decision: "allow",
      enforced: false,
      active_control_ids: [],
      accepted_event_count: 0,
      rejected_event_count: 1,
      diagnostics: [{ code: "observation_from_future", event_id: freeze.event_id, control_id: freeze.control_id }],
    });

    const futureUnfreeze = unfreezeFor(freeze, {
      issued_at: "2026-07-23T13:00:00.000Z",
      expires_at: "2026-07-24T13:00:00.000Z",
    });
    const historicalActive = input([
      observation(freeze),
      observation(futureUnfreeze, {
        trusted_envelope: trustedEnvelope(futureUnfreeze, {
          server_time: "2026-07-23T13:00:01.000Z",
        }),
      }),
    ]);
    const activeResult = evaluateControlsV1(historicalActive);
    expect(activeResult).toMatchObject({
      decision: "hold",
      enforced: false,
      active_control_ids: [freeze.control_id],
      accepted_event_count: 1,
      rejected_event_count: 1,
    });
    expect(activeResult.diagnostics).toContainEqual({
      code: "observation_from_future",
      event_id: futureUnfreeze.event_id,
      control_id: freeze.control_id,
    });
  });

  test("supports rollback by switching observe-only evaluation off", () => {
    const freeze = createControlEventV1(freezePayload());
    const disabled = input([observation(freeze)]);
    disabled.config.mode = "off";
    expect(evaluateControlsV1(disabled)).toEqual({
      decision: "allow",
      mode: "off",
      enforced: false,
      active_control_ids: [],
      accepted_event_count: 0,
      rejected_event_count: 0,
      diagnostics: [{ code: "validator_disabled" }],
    });
  });

  test("reports malformed and unsupported metadata as indeterminate without inventing a hold", () => {
    const malformed = input([
      {
        content: "irrelevant",
        metadata: { [CONTROL_METADATA_KEY]: { version: CONTROL_CONTRACT_VERSION } },
        trusted_envelope: trustedEnvelope(createControlEventV1(freezePayload())),
      },
    ]);
    expect(evaluateControlsV1(malformed)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      rejected_event_count: 1,
    });

    const unsupported = structuredClone(malformed);
    (unsupported.backend as { status: "available"; observations: ControlObservationV1[] }).observations[0]!.metadata = {
      [CONTROL_METADATA_KEY]: { version: "hasna.control/v2" },
    };
    expect(evaluateControlsV1(unsupported)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      rejected_event_count: 1,
    });

    const freeze = createControlEventV1(freezePayload());
    const mixed = input([
      observation(freeze),
      ...(malformed.backend as { status: "available"; observations: readonly ControlObservationV1[] }).observations,
    ]);
    expect(evaluateControlsV1(mixed)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [freeze.control_id],
      accepted_event_count: 1,
      rejected_event_count: 1,
    });
    const mixedReverse = input([
      ...(malformed.backend as { status: "available"; observations: readonly ControlObservationV1[] }).observations,
      observation(freeze),
    ]);
    expect(evaluateControlsV1(mixedReverse)).toEqual(evaluateControlsV1(mixed));

    const ambiguousTarget = input([]) as ControlEvaluationInputV1 & {
      target: ControlEvaluationInputV1["target"] & { global?: boolean };
    };
    ambiguousTarget.target.global = true;
    expect(evaluateControlsV1(ambiguousTarget)).toMatchObject({
      decision: "indeterminate",
      enforced: false,
      active_control_ids: [],
      diagnostics: [{ code: "invalid_evaluator_input" }],
    });
  });
});
