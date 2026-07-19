import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  IncidentValidationError,
  applyIncidentTransition,
  buildIncidentProjectionEvent,
  createInitialIncident,
  incidentEventId,
  incidentTransitionId,
  isCanonicalIncidentTimestamp,
  normalizeIncidentCreateInput,
  normalizeIncidentTransitionInput,
  stableIncidentFingerprint,
  supersedeIncident,
  type IncidentState,
} from "./contracts.js";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const REPLACED_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-18T20:00:00.000Z";

function current(overrides: Partial<IncidentState> = {}): IncidentState {
  return {
    id: INCIDENT_ID,
    title: "Todos coordination outage",
    severity: "high",
    status: "investigating",
    owner: "platform-todos",
    affected_scopes: ["todos", "station01"],
    blocked_scopes: ["channel:incidents"],
    containment: "Remote writes held",
    next_action: "Verify the authority path",
    deadline: "2026-07-19T00:00:00.000Z",
    closure_evidence: [],
    supersedes_id: null,
    superseded_by_id: null,
    resolved_at: null,
    version: 3,
    created_at: "2026-07-18T19:00:00.000Z",
    updated_at: "2026-07-18T19:30:00.000Z",
    ...overrides,
  };
}

describe("incident input contracts", () => {
  it("distinguishes canonical UTC millisecond wire timestamps from accepted RFC3339 inputs", () => {
    expect(isCanonicalIncidentTimestamp("2026-07-18T20:00:00.000Z")).toBe(true);
    for (const value of [
      "1",
      "2026-02-30T00:00:00.000Z",
      "2026-07-18T20:00:00Z",
      "2026-07-18T20:00:00.0000Z",
      "2026-07-18T23:00:00.000+03:00",
    ]) expect(isCanonicalIncidentTimestamp(value)).toBe(false);
  });

  it("normalizes a bounded create request without accepting actor provenance", () => {
    const input = normalizeIncidentCreateInput({
      id: INCIDENT_ID,
      idempotency_key: "incident-create-0001",
      title: "  Todos coordination outage  ",
      severity: "critical",
      owner: "  platform-todos ",
      affected_scopes: [" todos ", "station01", "todos"],
      blocked_scopes: [" channel:incidents "],
      containment: " Hold remote writes ",
      next_action: " Verify the authority path ",
      deadline: "2026-07-19T00:00:00.000Z",
      supersedes_id: REPLACED_ID,
      supersedes_expected_version: 7,
    });

    expect(input).toEqual({
      id: INCIDENT_ID,
      idempotency_key: "incident-create-0001",
      title: "Todos coordination outage",
      severity: "critical",
      status: "open",
      owner: "platform-todos",
      affected_scopes: ["todos", "station01"],
      blocked_scopes: ["channel:incidents"],
      containment: "Hold remote writes",
      next_action: "Verify the authority path",
      deadline: "2026-07-19T00:00:00.000Z",
      closure_evidence: [],
      supersedes_id: REPLACED_ID,
      supersedes_expected_version: 7,
    });
    expect(() => normalizeIncidentCreateInput({ ...input, actor_id: "spoofed" })).toThrow(IncidentValidationError);
  });

  it("freezes routable blocker recipients to agent, channel, and project scope kinds", () => {
    const base = {
      id: INCIDENT_ID,
      idempotency_key: "incident-scope-contract-0001",
      title: "Todos outage",
      severity: "high",
      owner: "platform-todos",
      affected_scopes: ["descriptive values remain free-form"],
      next_action: "Investigate",
    };
    expect(normalizeIncidentCreateInput({
      ...base,
      blocked_scopes: [
        "agent:projector-01",
        "channel:incidents",
        "project:wks_8vJJzXTiFo6sxwRkpPqoI",
      ],
    }).blocked_scopes).toEqual([
      "agent:projector-01",
      "channel:incidents",
      "project:wks_8vJJzXTiFo6sxwRkpPqoI",
    ]);

    for (const blockedScope of [
      "agent-coordination",
      "agent:",
      "channel:Incidents",
      "channel:incidents team",
      "project:bad value",
      "team:engineering",
      "global:all",
    ]) {
      expect(() => normalizeIncidentCreateInput({ ...base, blocked_scopes: [blockedScope] }))
        .toThrow(/agent:<agent-id>.*channel:<normalized-channel-name>.*project:<project-id>/);
    }
  });

  it("rejects malformed, terminal, unowned, unbounded, or incomplete create requests", () => {
    const base = {
      id: INCIDENT_ID,
      idempotency_key: "incident-create-0001",
      title: "Todos outage",
      severity: "high",
      owner: "platform-todos",
      affected_scopes: ["todos"],
      blocked_scopes: [],
      next_action: "Investigate",
    };
    for (const patch of [
      { id: "not-a-uuid" },
      { status: "resolved" },
      { severity: "p0" },
      { owner: "" },
      { affected_scopes: [] },
      { affected_scopes: Array.from({ length: 65 }, (_, index) => `scope-${index}`) },
      { next_action: "" },
      { deadline: "tomorrow" },
      { supersedes_id: REPLACED_ID },
      { supersedes_expected_version: 1 },
    ]) {
      expect(() => normalizeIncidentCreateInput({ ...base, ...patch })).toThrow(IncidentValidationError);
    }
  });

  it("requires an idempotency key, expected version, reason, and non-empty strict patch", () => {
    const input = normalizeIncidentTransitionInput({
      expected_version: 3,
      idempotency_key: "incident-transition-0001",
      reason: " Containment verified ",
      status: "contained",
      containment: " Read-only mode active ",
      blocked_scopes: [" channel:incidents ", "channel:incidents"],
    });
    expect(input).toEqual({
      expected_version: 3,
      idempotency_key: "incident-transition-0001",
      reason: "Containment verified",
      patch: {
        status: "contained",
        containment: "Read-only mode active",
        blocked_scopes: ["channel:incidents"],
      },
    });
    for (const value of [
      {},
      { expected_version: 0, idempotency_key: "incident-transition-0001", reason: "x", status: "contained" },
      { expected_version: 3, idempotency_key: "short", reason: "x", status: "contained" },
      { expected_version: 3, idempotency_key: "incident-transition-0001", reason: "", status: "contained" },
      { expected_version: 3, idempotency_key: "incident-transition-0001", reason: "x", status: "superseded" },
      { expected_version: 3, idempotency_key: "incident-transition-0001", reason: "x", actor_id: "spoofed", status: "contained" },
    ]) {
      expect(() => normalizeIncidentTransitionInput(value)).toThrow(IncidentValidationError);
    }
  });
});

describe("incident transition invariants", () => {
  it("creates version one with authenticated provenance and stable authority identity", () => {
    const input = normalizeIncidentCreateInput({
      id: INCIDENT_ID,
      idempotency_key: "incident-create-0001",
      title: "Todos coordination outage",
      severity: "high",
      owner: "platform-todos",
      affected_scopes: ["todos"],
      blocked_scopes: ["channel:incidents"],
      next_action: "Investigate",
    });
    const result = createInitialIncident(input, "engineering-authority", "authenticated-agent", NOW, "key-a");
    expect(result.incident).toMatchObject({ id: INCIDENT_ID, version: 1, status: "open", resolved_at: null });
    expect(result.transition).toMatchObject({
      action: "created",
      actor_id: "authenticated-agent",
      effective_actor_id: "authenticated-agent",
      actor_key_id: "key-a",
      actor_act_as: false,
      before: null,
      incident_version: 1,
    });
    expect(result.transition.id).toStartWith("itr_");
  });

  it("keeps authenticated and effective actor provenance distinct for explicit act-as", () => {
    const input = normalizeIncidentCreateInput({
      id: INCIDENT_ID,
      idempotency_key: "incident-create-act-as-0001",
      title: "Todos coordination outage",
      severity: "high",
      owner: "platform-todos",
      affected_scopes: ["todos"],
      blocked_scopes: ["channel:incidents"],
      next_action: "Investigate",
    });
    const result = createInitialIncident(
      input,
      "engineering-authority",
      "authenticated-admin",
      NOW,
      "key-admin",
      "effective-operator",
      true,
    );
    expect(result.transition).toMatchObject({
      actor_id: "authenticated-admin",
      effective_actor_id: "effective-operator",
      actor_key_id: "key-admin",
      actor_act_as: true,
    });
  });

  it("uses the authenticated actor and increments exactly one version", () => {
    const input = normalizeIncidentTransitionInput({
      expected_version: 3,
      idempotency_key: "incident-transition-0001",
      reason: "Containment verified",
      status: "contained",
      containment: "Read-only mode active",
      next_action: "Monitor for one hour",
    });
    const result = applyIncidentTransition(current(), input, "authenticated-agent", NOW);
    expect(result.incident.version).toBe(4);
    expect(result.incident.status).toBe("contained");
    expect(result.transition.actor_id).toBe("authenticated-agent");
    expect(result.transition.before?.version).toBe(3);
    expect(result.transition.after).toEqual(result.incident);
  });

  it("requires closure evidence and no blocked scopes before resolution", () => {
    const base = {
      expected_version: 3,
      idempotency_key: "incident-transition-0002",
      reason: "Close incident",
      status: "resolved",
    };
    expect(() => applyIncidentTransition(current(), normalizeIncidentTransitionInput(base), "actor", NOW)).toThrow(IncidentValidationError);
    expect(() => applyIncidentTransition(current(), normalizeIncidentTransitionInput({
      ...base,
      closure_evidence: ["verification:green"],
    }), "actor", NOW)).toThrow(IncidentValidationError);

    const result = applyIncidentTransition(current(), normalizeIncidentTransitionInput({
      ...base,
      blocked_scopes: [],
      closure_evidence: ["verification:green"],
      next_action: null,
    }), "actor", NOW);
    expect(result.incident.status).toBe("resolved");
    expect(result.incident.resolved_at).toBe(NOW);
    expect(result.incident.next_action).toBeNull();
  });

  it("rejects stale versions and any mutation after a terminal state", () => {
    const input = normalizeIncidentTransitionInput({
      expected_version: 2,
      idempotency_key: "incident-transition-0003",
      reason: "stale",
      owner: "next-owner",
    });
    expect(() => applyIncidentTransition(current(), input, "actor", NOW)).toThrow(IncidentValidationError);
    const terminal = current({ status: "resolved", resolved_at: NOW, blocked_scopes: [], closure_evidence: ["done"] });
    expect(() => applyIncidentTransition(terminal, { ...input, expected_version: 3 }, "actor", NOW)).toThrow(IncidentValidationError);
  });

  it("supersedes only the expected active version and records the replacement", () => {
    const result = supersedeIncident(
      current(),
      REPLACED_ID,
      3,
      "engineering-authority",
      "authenticated-agent",
      NOW,
      "supersede-transition-0001",
      "key-b",
    );
    expect(result.incident).toMatchObject({
      status: "superseded",
      superseded_by_id: REPLACED_ID,
      blocked_scopes: ["channel:incidents"],
      resolved_at: NOW,
      version: 4,
    });
    expect(buildIncidentProjectionEvent("engineering-authority", result.transition).incident).toMatchObject({
      id: INCIDENT_ID,
      status: "superseded",
      superseded_by_id: REPLACED_ID,
      blocked_scopes: ["channel:incidents"],
    });
    expect(result.transition).toMatchObject({ action: "superseded", actor_id: "authenticated-agent", actor_key_id: "key-b" });
    expect(() => supersedeIncident(current(), INCIDENT_ID, 3, "engineering-authority", "actor", NOW, "supersede-transition-0002")).toThrow(IncidentValidationError);
    expect(() => supersedeIncident(current(), REPLACED_ID, 2, "engineering-authority", "actor", NOW, "supersede-transition-0003")).toThrow(IncidentValidationError);
  });
});

describe("incident projection identity", () => {
  it("generates the byte-identical Conversations v1 cross-service fixture through the real producer path", () => {
    const fixtureBytes = readFileSync(
      new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
      "utf8",
    );
    const fixture = JSON.parse(fixtureBytes);
    const input = normalizeIncidentCreateInput({
      id: INCIDENT_ID,
      idempotency_key: "canonical-cross-service-fixture-v1",
      title: "Canonical cross-service incident fixture",
      severity: "high",
      status: "investigating",
      owner: "projector-01",
      affected_scopes: ["service:conversations"],
      blocked_scopes: [
        "agent:projector-01",
        "channel:incidents",
        "project:wks_8vJJzXTiFo6sxwRkpPqoI",
      ],
      next_action: "Project and acknowledge the canonical incident state",
    });
    const created = createInitialIncident(
      input,
      "todos.hasna.xyz:v1",
      "fixture-producer",
      "2026-07-18T20:01:00.000Z",
      "fixture-key-v1",
    );
    const produced = buildIncidentProjectionEvent("todos.hasna.xyz:v1", created.transition);

    expect(produced).toEqual(fixture);
    expect(`${JSON.stringify(produced, null, 2)}\n`).toBe(fixtureBytes);
    expect(createHash("sha256").update(fixtureBytes).digest("hex"))
      .toBe("63cb9fafe606006003d033fbd2060d35ca10b6a520afa6a960a8e639c2be48ef");
    expect(stableIncidentFingerprint(produced))
      .toBe("a89862d57860d06b0d53cae4d720830042a38fa90ece0cbab1b363a19384e4cd");
  });

  it("is deterministic and carries the canonical state without a Conversations reply id", () => {
    const input = normalizeIncidentTransitionInput({
      expected_version: 3,
      idempotency_key: "incident-transition-0004",
      reason: "Containment verified",
      status: "contained",
      containment: "Read-only mode active",
      next_action: "Monitor",
    });
    const transition = applyIncidentTransition(current(), input, "actor", NOW, "tenant-key-1").transition;
    const first = buildIncidentProjectionEvent("tenant-key-1", transition);
    const second = buildIncidentProjectionEvent("tenant-key-1", transition);
    expect(first).toEqual(second);
    expect(first.event_id).toBe(incidentEventId("tenant-key-1", INCIDENT_ID, 4));
    expect(first).toMatchObject({
      schema_version: 1,
      source: "todos",
      authority_id: "tenant-key-1",
      incident_id: INCIDENT_ID,
      incident_version: 4,
      incident: { status: "contained", blocked_scopes: ["channel:incidents"] },
    });
    expect(first).not.toHaveProperty("reply_to");
    expect(() => buildIncidentProjectionEvent("other-authority", transition)).toThrow(IncidentValidationError);
  });
});
