import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import {
  computeIncidentProjectionIds,
  metadataSpoofsIncidentProjection,
  validateIncidentProjection,
} from "./incident-projection-contract";
import type { IncidentProjectionRequestV1, IncidentProjectorContext } from "../types";

const context: IncidentProjectorContext = { tenant_id: "tenant-a", authority_id: "todos.hasna.xyz:v1" };
const incidentId = "11111111-1111-4111-8111-111111111111";

function fixture(version = 1): IncidentProjectionRequestV1 {
  const ids = computeIncidentProjectionIds(context.authority_id, incidentId, version);
  return {
    schema_version: 1,
    source: "todos",
    authority_id: context.authority_id,
    incident_id: incidentId,
    transition_id: ids.transition_id,
    incident_version: version,
    occurred_at: `2026-07-18T20:0${version}:00Z`,
    event_id: ids.event_id,
    projection_key: ids.projection_key,
    incident: {
      id: incidentId,
      title: "Conversations projection incident",
      severity: "high",
      status: "investigating",
      owner: "Friday",
      affected_scopes: ["service:conversations"],
      blocked_scopes: ["agent:friday", "channel:internal-engineering"],
      containment: null,
      next_action: "Ship the projection primitive",
      deadline: null,
      closure_evidence: [],
      supersedes_id: null,
      superseded_by_id: null,
      resolved_at: null,
      version,
      created_at: "2026-07-18T20:01:00Z",
      updated_at: `2026-07-18T20:0${version}:00Z`,
    },
  };
}

describe("Todos v1 incident projection contract", () => {
  test("accepts the byte-shared canonical Todos fixture with the frozen payload hash", () => {
    const raw = readFileSync(new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url), "utf8");
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "63cb9fafe606006003d033fbd2060d35ca10b6a520afa6a960a8e639c2be48ef",
    );
    const shared = JSON.parse(raw);
    const result = validateIncidentProjection(shared, context);
    expect(result.payload_hash).toBe("a89862d57860d06b0d53cae4d720830042a38fa90ece0cbab1b363a19384e4cd");
    expect(result.request.event_id).toBe("iev_adf149b3daa8a314dd30b92b188f0024");
  });

  test("validates the frozen wire and deterministic identifiers", () => {
    const result = validateIncidentProjection(fixture(), context);
    expect(result.request.incident.severity).toBe("high");
    expect(result.request.incident.status).toBe("investigating");
    expect(result.blocking).toBe(true);
    expect(result.supersedes_transition_id).toBeNull();
    expect(result.payload_hash).toHaveLength(64);
  });

  test("derives the N-1 transition without relying on a numeric reply id", () => {
    const result = validateIncidentProjection(fixture(2), context);
    expect(result.supersedes_transition_id).toBe(
      computeIncidentProjectionIds(context.authority_id, incidentId, 1).transition_id,
    );
  });

  test("rejects enum drift, top-level drift, spoofed authority, and mismatched ids", () => {
    const invalidSeverity = fixture() as any;
    invalidSeverity.incident.severity = "sev1";
    expect(() => validateIncidentProjection(invalidSeverity, context)).toThrow("incident.severity");

    const invalidStatus = fixture() as any;
    invalidStatus.incident.status = "closed";
    expect(() => validateIncidentProjection(invalidStatus, context)).toThrow("incident.status");

    const authoritySpoof = { ...fixture(), authority_id: "attacker" } as any;
    expect(() => validateIncidentProjection(authoritySpoof, context)).toThrow("selected Conversations authority");

    const badId = fixture() as any;
    badId.event_id = "iev_attacker";
    expect(() => validateIncidentProjection(badId, context)).toThrow("deterministic Todos v1 value");

    expect(() => computeIncidentProjectionIds("todos.hasna.xyz/v1", incidentId, 1)).toThrow(
      "letters, digits, dot, underscore, colon, or hyphen",
    );
  });

  test("accepts only the frozen recipient-scope grammar", () => {
    const accepted = fixture();
    accepted.incident.blocked_scopes = [
      "agent:projector-01",
      "channel:incidents",
      "project:wks_8vJJzXTiFo6sxwRkpPqoI",
    ];
    expect(validateIncidentProjection(accepted, context).request.incident.blocked_scopes).toEqual(
      accepted.incident.blocked_scopes,
    );
    for (const scope of ["agent-coordination", "channel:Internal_Engineering", "project:bad/id", "team:all"]) {
      const rejected = fixture();
      rejected.incident.blocked_scopes = [scope];
      expect(() => validateIncidentProjection(rejected, context)).toThrow("frozen recipient grammar");
    }
  });

  test("matches the producer's 128-character blocked-scope boundary", () => {
    const accepted = fixture();
    accepted.incident.blocked_scopes = [`agent:A${"a".repeat(121)}`];
    expect(accepted.incident.blocked_scopes[0]).toHaveLength(128);
    expect(validateIncidentProjection(accepted, context).request.incident.blocked_scopes).toEqual(
      accepted.incident.blocked_scopes,
    );
    const rejected = fixture();
    rejected.incident.blocked_scopes = [`agent:A${"a".repeat(122)}`];
    expect(rejected.incident.blocked_scopes[0]).toHaveLength(129);
    expect(() => validateIncidentProjection(rejected, context)).toThrow("at most 128 characters");
  });

  test("mirrors resolved invariants and rejects source/snapshot identity drift", () => {
    const terminal = fixture() as any;
    terminal.incident.status = "resolved";
    terminal.incident.resolved_at = "2026-07-18T20:05:00Z";
    expect(() => validateIncidentProjection(terminal, context)).toThrow("cannot retain incident.blocked_scopes");

    const identity = fixture() as any;
    identity.incident.version = 2;
    expect(() => validateIncidentProjection(identity, context)).toThrow("must match incident.version");
  });

  test("rejects lifecycle shapes the Todos create path cannot emit", () => {
    const timestampDrift = fixture();
    timestampDrift.incident.created_at = "2026-07-18T20:00:00Z";
    expect(() => validateIncidentProjection(timestampDrift, context)).toThrow("version 1 requires");

    const terminal = fixture();
    terminal.incident.status = "resolved";
    terminal.incident.blocked_scopes = [];
    terminal.incident.next_action = null;
    terminal.incident.closure_evidence = ["closed"];
    terminal.incident.resolved_at = terminal.incident.updated_at;
    expect(() => validateIncidentProjection(terminal, context)).toThrow("version 1 must contain an active");
  });

  test("detects reserved projection metadata in object and serialized forms", () => {
    expect(metadataSpoofsIncidentProjection({ event_id: "iev_fake" })).toBe(true);
    expect(metadataSpoofsIncidentProjection('{"canonical_incident_projection":{"event_id":"iev_fake"}}')).toBe(true);
    expect(metadataSpoofsIncidentProjection({ display: { severity: "high" } })).toBe(false);
    expect(metadataSpoofsIncidentProjection("plain text")).toBe(false);
  });
});

export { context as incidentProjectionTestContext, fixture as incidentProjectionFixture };
