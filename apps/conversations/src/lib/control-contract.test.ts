import { describe, expect, test } from "bun:test";
import {
  CONTROL_CONTRACT_VERSION,
  CONTROL_METADATA_KEY,
  MAX_CONTROL_ARRAY_ITEMS,
  MAX_CONTROL_TTL_MS,
  canonicalJson,
  controlMetadataV1,
  createControlEventV1,
  deriveControlEventId,
  validateControlMetadataV1,
  type ControlEventPayloadV1,
  type ControlEventV1,
  type ControlValidationContextV1,
  type TrustedControlEnvelopeV1,
} from "./control-contract";

const ISSUED_AT = "2026-07-23T00:00:00.000Z";
const SERVER_TIME = "2026-07-23T00:00:01.000Z";
const ACTIVATION_TIME = "2026-07-22T00:00:00.000Z";
const CONTROL_ID = "123e4567-e89b-42d3-a456-426614174000";
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
    issued_at: ISSUED_AT,
    expires_at: "2026-07-24T00:00:00.000Z",
    unfreeze_of: null,
    ...overrides,
  };
}

function trustedEnvelope(overrides: Partial<TrustedControlEnvelopeV1> = {}): TrustedControlEnvelopeV1 {
  return {
    authenticated_principal: "agent:security-operator",
    tenant: "tenant:hasna",
    authority_domain: "hasna/control-operators",
    permitted_surface: "announcements",
    policy_version: "1.0.1",
    server_time: SERVER_TIME,
    blocking: true,
    ...overrides,
  };
}

function context(
  trusted: TrustedControlEnvelopeV1 = trustedEnvelope(),
  activation_timestamp = ACTIVATION_TIME,
): ControlValidationContextV1 {
  return { trusted_envelope: trusted, activation_timestamp };
}

function withMutation(event: ControlEventV1, mutation: Record<string, unknown>): Record<string, unknown> {
  return { ...event, ...mutation };
}

function metadata(candidate: unknown): Record<string, unknown> {
  return { [CONTROL_METADATA_KEY]: candidate };
}

function invalidCode(metadata: unknown, ctx = context()): string {
  const result = validateControlMetadataV1(metadata, ctx);
  expect(result.status).toBe("invalid");
  if (result.status !== "invalid") throw new Error("expected invalid control metadata");
  expect(result.diagnostics).toHaveLength(1);
  return result.diagnostics[0]!.code;
}

describe("hasna.control/v1 canonical contract", () => {
  test("canonical JSON recursively sorts object keys and normalizes negative zero", () => {
    expect(canonicalJson({ z: [3, { b: true, a: null }], a: -0 })).toBe(
      '{"a":0,"z":[3,{"a":null,"b":true}]}',
    );
  });

  test("canonical JSON rejects non-JSON and non-finite inputs without echoing values", () => {
    for (const value of [undefined, 1n, Number.NaN, Number.POSITIVE_INFINITY, new Date()]) {
      expect(() => canonicalJson(value)).toThrow("invalid canonical JSON value");
    }
    const sparse = new Array(2);
    sparse[1] = "present";
    expect(() => canonicalJson(sparse)).toThrow("invalid canonical JSON value");
  });

  test("derives a stable event id from the canonical payload and verifies it", () => {
    const payload = freezePayload();
    const event = createControlEventV1(payload);

    expect(event.event_id).toBe(deriveControlEventId(payload));
    expect(event.event_id).toMatch(/^sha256:[a-f0-9]{64}$/);

    const result = validateControlMetadataV1(controlMetadataV1(event), context());
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("expected valid event");
    expect(result.event).toEqual(event);
    expect(result.canonical_payload).toBe(canonicalJson(payload));
    expect(result.canonical_event).toBe(canonicalJson(event));
  });

  test("uses only the dedicated metadata key and treats unrelated metadata as absent", () => {
    expect(validateControlMetadataV1(null, context())).toEqual({
      status: "absent",
      diagnostics: [{ code: "no_control_metadata" }],
    });
    expect(validateControlMetadataV1({ control: freezePayload() }, context())).toEqual({
      status: "absent",
      diagnostics: [{ code: "no_control_metadata" }],
    });
    expect(Object.hasOwn(controlMetadataV1(createControlEventV1(freezePayload())), CONTROL_METADATA_KEY)).toBe(true);
  });

  test("rejects unknown keys at every contract-owned boundary", () => {
    const event = createControlEventV1(freezePayload());
    expect(invalidCode(metadata(withMutation(event, { surprise: true })))).toBe("unexpected_keys");
    expect(
      invalidCode(metadata({ ...event, scope: { ...event.scope, surprise: true } })),
    ).toBe("unexpected_keys");
    expect(
      invalidCode(
        controlMetadataV1(event),
        context({ ...trustedEnvelope(), surprise: true } as TrustedControlEnvelopeV1),
      ),
    ).toBe("invalid_trusted_envelope");

    const operations = [...event.affected_operations] as string[] & { extra?: string };
    operations.extra = "not-json-array-data";
    expect(invalidCode(metadata({ ...event, affected_operations: operations }))).toBe(
      "invalid_sorted_unique_array",
    );
  });

  test("fails closed on accessors and hostile objects without invoking or echoing them", () => {
    let accessed = false;
    const accessorMetadata = {} as Record<string, unknown>;
    Object.defineProperty(accessorMetadata, CONTROL_METADATA_KEY, {
      enumerable: true,
      get() {
        accessed = true;
        throw new Error("must not execute");
      },
    });
    expect(validateControlMetadataV1(accessorMetadata, context())).toEqual({
      status: "invalid",
      diagnostics: [{ code: "malformed_control_metadata" }],
    });
    expect(accessed).toBe(false);

    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("hostile trap");
      },
    });
    expect(validateControlMetadataV1(hostile, context())).toEqual({
      status: "invalid",
      diagnostics: [{ code: "malformed_control_metadata" }],
    });
  });

  test("rejects unsupported versions, enums, UUIDs, fingerprints, and token grammars", () => {
    const event = createControlEventV1(freezePayload());
    expect(invalidCode(metadata(withMutation(event, { version: "hasna.control/v2" })))).toBe(
      "unsupported_contract_version",
    );
    expect(invalidCode(metadata(withMutation(event, { state: "blocked" })))).toBe("invalid_lifecycle");
    expect(invalidCode(metadata(withMutation(event, { surface: "general" })))).toBe("invalid_field");
    expect(invalidCode(metadata(withMutation(event, { control_id: "not-a-uuid" })))).toBe(
      "invalid_control_id",
    );
    expect(invalidCode(metadata(withMutation(event, { fingerprint: "same" })))).toBe(
      "invalid_field",
    );
    expect(invalidCode(metadata(withMutation(event, { tenant: "*" })))).toBe("invalid_field");
  });

  test("requires non-empty bounded sorted unique scope, operation, and resource arrays", () => {
    const event = createControlEventV1(freezePayload());
    const cases: unknown[] = [
      { ...event, scope: { kind: "project", ids: [] } },
      { ...event, scope: { kind: "project", ids: ["project:b", "project:a"] } },
      { ...event, scope: { kind: "project", ids: ["project:a", "project:a"] } },
      { ...event, affected_operations: [] },
      { ...event, affected_operations: ["z", "a"] },
      { ...event, affected_resources: Array.from({ length: MAX_CONTROL_ARRAY_ITEMS + 1 }, (_, i) => `r:${i.toString().padStart(2, "0")}`) },
    ];

    for (const candidate of cases) {
      expect(["invalid_scope", "invalid_sorted_unique_array"]).toContain(
        invalidCode({ [CONTROL_METADATA_KEY]: candidate }),
      );
    }
  });

  test("requires canonical timestamps and a positive finite TTL at or below the contract maximum", () => {
    const event = createControlEventV1(freezePayload());
    expect(invalidCode(metadata(withMutation(event, { issued_at: "2026-07-23T00:00:00Z" })))).toBe(
      "invalid_timestamp",
    );
    expect(invalidCode(metadata(withMutation(event, { expires_at: ISSUED_AT })))).toBe("invalid_ttl");

    const tooLong = new Date(Date.parse(ISSUED_AT) + MAX_CONTROL_TTL_MS + 1).toISOString();
    expect(invalidCode(metadata(withMutation(event, { expires_at: tooLong })))).toBe("invalid_ttl");
  });

  test("rejects pre-activation, future, and already-expired ingress observations", () => {
    const event = createControlEventV1(freezePayload());
    expect(invalidCode(controlMetadataV1(event), context(trustedEnvelope(), "2026-07-23T00:00:00.001Z"))).toBe(
      "event_before_activation",
    );
    expect(
      invalidCode(
        controlMetadataV1(event),
        context(trustedEnvelope({ server_time: "2026-07-21T23:59:59.999Z" })),
      ),
    ).toBe("event_before_activation");
    expect(
      invalidCode(
        controlMetadataV1(event),
        context(trustedEnvelope({ server_time: "2026-07-22T23:59:59.999Z" })),
      ),
    ).toBe("event_from_future");
    expect(
      invalidCode(
        controlMetadataV1(event),
        context(trustedEnvelope({ server_time: "2026-07-24T00:00:00.000Z" })),
      ),
    ).toBe("event_expired_at_ingress");
  });

  test("authenticates every metadata claim against the trusted envelope", () => {
    const event = createControlEventV1(freezePayload());
    const mismatches: TrustedControlEnvelopeV1[] = [
      trustedEnvelope({ authenticated_principal: "agent:other" }),
      trustedEnvelope({ tenant: "tenant:other" }),
      trustedEnvelope({ authority_domain: "other/control-operators" }),
      trustedEnvelope({ permitted_surface: "incidents" }),
      trustedEnvelope({ policy_version: "1.0.0" }),
    ];
    for (const trusted of mismatches) {
      expect(invalidCode(controlMetadataV1(event), context(trusted))).toBe("trusted_claim_mismatch");
    }
  });

  test("requires freeze to be blocking and unfreeze to be non-blocking", () => {
    const freeze = createControlEventV1(freezePayload());
    expect(
      invalidCode(controlMetadataV1(freeze), context(trustedEnvelope({ blocking: false }))),
    ).toBe("blocking_state_mismatch");

    const unfreeze = createControlEventV1({
      ...freezePayload(),
      lifecycle_version: 2,
      state: "unfreeze",
      issued_at: "2026-07-23T01:00:00.000Z",
      expires_at: "2026-07-24T01:00:00.000Z",
      unfreeze_of: {
        event_id: freeze.event_id,
        control_id: freeze.control_id,
        fingerprint: freeze.fingerprint,
      },
    });
    expect(
      validateControlMetadataV1(
        controlMetadataV1(unfreeze),
        context(
          trustedEnvelope({
            blocking: false,
            server_time: "2026-07-23T01:00:01.000Z",
          }),
        ),
      ).status,
    ).toBe("valid");
  });

  test("returns a normalized copy so post-validation metadata mutation cannot change the result", () => {
    const event = createControlEventV1(freezePayload());
    const result = validateControlMetadataV1(controlMetadataV1(event), context());
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("expected valid event");

    event.scope.ids[0] = "project:tampered";
    event.affected_operations[0] = "tool.tampered";
    expect(result.event.scope.ids).toEqual(["project:conversations"]);
    expect(result.event.affected_operations).toEqual(["tool.execute", "workflow.dispatch"]);
  });

  test("enforces a two-event lifecycle and exact unfreeze reference shape", () => {
    const freeze = createControlEventV1(freezePayload());
    expect(invalidCode(metadata(withMutation(freeze, { lifecycle_version: 2 })))).toBe(
      "invalid_lifecycle",
    );
    expect(invalidCode(metadata(withMutation(freeze, { unfreeze_of: {} })))).toBe(
      "invalid_unfreeze_reference",
    );

    const unfreezeBase = {
      ...freeze,
      event_id: freeze.event_id,
      lifecycle_version: 2,
      state: "unfreeze",
      unfreeze_of: {
        event_id: freeze.event_id,
        control_id: freeze.control_id,
        fingerprint: freeze.fingerprint,
        extra: true,
      },
    };
    expect(
      invalidCode(
        controlMetadataV1(unfreezeBase as unknown as ControlEventV1),
        context(trustedEnvelope({ blocking: false })),
      ),
    ).toBe("invalid_unfreeze_reference");
  });

  test("rejects event-id tampering after any signed field changes", () => {
    const event = createControlEventV1(freezePayload());
    expect(
      invalidCode(metadata(withMutation(event, { expires_at: "2026-07-24T00:00:00.001Z" }))),
    ).toBe("invalid_event_id");
  });

  test("rejects secret-shaped control values and never echoes the value in diagnostics", () => {
    const event = createControlEventV1(freezePayload());
    const secretLike = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
    const result = validateControlMetadataV1(
      metadata(withMutation(event, { publisher: secretLike })),
      context(),
    );
    expect(result.status).toBe("invalid");
    expect(result.diagnostics).toEqual([{ code: "secret_shaped_value" }]);
    expect(JSON.stringify(result)).not.toContain(secretLike);

    const trustedResult = validateControlMetadataV1(
      controlMetadataV1(event),
      context(trustedEnvelope({ authenticated_principal: secretLike })),
    );
    expect(trustedResult).toEqual({ status: "invalid", diagnostics: [{ code: "secret_shaped_value" }] });
    expect(JSON.stringify(trustedResult)).not.toContain(secretLike);
  });
});
