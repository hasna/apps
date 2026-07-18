import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  ApiError,
  ConversationsClient,
  type IncidentProjectionEventV1,
  type IncidentProjectionRecord,
} from "./index";

const fixtureArtifact = JSON.parse(
  readFileSync(new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url), "utf8"),
);
const fixture = {
  schema_version: 1,
  source: "todos",
  event_id: "iev_adf149b3daa8a314dd30b92b188f0024",
  projection_key: "todos:incident:todos.hasna.xyz:v1:11111111-1111-4111-8111-111111111111:v1",
  authority_id: "todos.hasna.xyz:v1",
  incident_id: "11111111-1111-4111-8111-111111111111",
  transition_id: "itr_adf149b3daa8a314dd30b92b188f0024",
  incident_version: 1,
  occurred_at: "2026-07-18T20:01:00.000Z",
  incident: {
    id: "11111111-1111-4111-8111-111111111111",
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
    containment: null,
    next_action: "Project and acknowledge the canonical incident state",
    deadline: null,
    closure_evidence: [],
    supersedes_id: null,
    superseded_by_id: null,
    resolved_at: null,
    version: 1,
    created_at: "2026-07-18T20:01:00.000Z",
    updated_at: "2026-07-18T20:01:00.000Z",
  },
} satisfies IncidentProjectionEventV1;

function responseProjection(replayed: boolean): IncidentProjectionRecord {
  return {
    id: 7,
    event_id: fixture.event_id,
    projection_key: fixture.projection_key,
    message_id: 42,
    schema_version: 1,
    source: "todos",
    tenant_id: "tenant-a",
    authority_id: fixture.authority_id,
    incident_id: fixture.incident_id,
    transition_id: fixture.transition_id,
    incident_version: fixture.incident_version,
    occurred_at: fixture.occurred_at,
    status: fixture.incident.status,
    severity: fixture.incident.severity,
    blocking: true,
    supersedes_transition_id: null,
    supersedes_incident_id: null,
    superseded_by_incident_id: null,
    canonical_payload: "canonical",
    payload_hash: "a89862d57860d06b0d53cae4d720830042a38fa90ece0cbab1b363a19384e4cd",
    created_at: fixture.occurred_at,
    message: { id: 42, content: "display only" },
    replayed,
  };
}

describe("generated projector client", () => {
  test("posts the exact Todos event with the supported key header and verifies new/replay responses", async () => {
    expect(fixtureArtifact).toEqual(fixture);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ConversationsClient({
      baseUrl: "https://conversations.invalid",
      apiKey: "projector-test-key",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        const replayed = requests.length > 1;
        return new Response(JSON.stringify({ projection: responseProjection(replayed) }), {
          status: replayed ? 200 : 201,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    const created = await client.appendIncidentProjection(fixture);
    const replay = await client.appendIncidentProjection(fixture);
    expect(created.projection.replayed).toBe(false);
    expect(replay.projection.replayed).toBe(true);
    expect(created.projection.event_id).toBe(fixture.event_id);
    expect(created.projection.message_id).toBe(42);
    expect(requests[0].url).toBe("https://conversations.invalid/v1/incident-projections");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-api-key"]).toBe("projector-test-key");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual(fixture);
  });

  test("preserves typed projector failures for deterministic reconciler handling", async () => {
    const client = new ConversationsClient({
      baseUrl: "https://conversations.invalid",
      fetch: (async () => new Response(JSON.stringify({
        error: "canonical version conflict",
        code: "INCIDENT_PROJECTION_CONFLICT",
      }), { status: 409, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    });
    try {
      await client.appendIncidentProjection(fixture);
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).body).toEqual({
        error: "canonical version conflict",
        code: "INCIDENT_PROJECTION_CONFLICT",
      });
    }
  });
});
