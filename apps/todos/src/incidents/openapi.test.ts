import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "../server/openapi.js";

describe("canonical incident OpenAPI contract", () => {
  test("publishes exact state, provenance, projection, and no-hard-delete contracts", () => {
    const document = buildV1OpenApiDocument("test");
    const schemas = document.components.schemas;

    expect(schemas.Incident.properties.severity.enum).toEqual(["info", "low", "medium", "high", "critical"]);
    expect(schemas.Incident.properties.status.enum).toEqual([
      "open", "investigating", "contained", "monitoring", "resolved", "superseded",
    ]);
    for (const field of ["owner", "affected_scopes", "blocked_scopes", "closure_evidence", "version"]) {
      expect(schemas.Incident.required).toContain(field);
    }
    for (const field of ["actor_id", "effective_actor_id", "actor_key_id", "actor_act_as", "before", "after"]) {
      expect(schemas.IncidentTransition.required).toContain(field);
    }
    expect(schemas.IncidentTransition.properties.authority_id.pattern).toBe("^[A-Za-z0-9._:-]{1,128}$");
    expect(schemas.Incident.properties.blocked_scopes.items["x-incident-scope-patterns"]).toEqual([
      "^agent:[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$",
      "^channel:[a-z0-9]+(?:-[a-z0-9]+)*$",
      "^project:[A-Za-z0-9][A-Za-z0-9_-]{0,119}$",
    ]);
    expect(schemas.IncidentProjectionEvent.properties).not.toHaveProperty("conversation_id");
    expect(schemas.IncidentProjectionEvent.properties).not.toHaveProperty("reply_id");
    expect(schemas.IncidentOutboxRecord.required).toContain("depends_on_event_id");
    expect(schemas.IncidentOutboxRecord.required).toContain("failure_code");
    expect(schemas.IncidentOutboxRecord.required).toContain("failure_fingerprint");
    expect(schemas.IncidentOutboxRecord.required).toContain("consecutive_failures");
    expect(schemas.CreateIncidentInput).toMatchObject({ additionalProperties: false });
    expect(schemas.CreateIncidentInput.properties).not.toHaveProperty("actor_id");
    expect(schemas.CreateIncidentInput.properties).not.toHaveProperty("agent_id");

    const incidents = document.paths["/v1/incidents"];
    expect(incidents.post.description).toMatch(/does not create a task or dispatch an agent/i);
    expect(Object.keys(incidents.post.responses).sort()).toEqual(["200", "201", "409"]);
    expect(document.paths["/v1/incidents/{id}"]).not.toHaveProperty("delete");
    expect(document.paths["/v1/incidents/blockers"].get.description).toMatch(/blocked_scopes only/i);
    expect(document.paths["/v1/incidents/outbox/claim"].post.description).toContain("todos:incidents:project");
    expect(document.paths["/v1/incidents/outbox/{event_id}/requeue"].post.description)
      .toContain("todos:incidents:recover");
    expect(document.paths["/v1/incidents/outbox"].get.operationId).toBe("listDeadIncidentOutbox");
    expect(document.paths["/v1/incidents/outbox/{event_id}"].get.operationId).toBe("getDeadIncidentOutbox");
    expect(document.paths["/v1/incidents/outbox/status"].get.operationId).toBe("getIncidentOutboxStatus");
    expect(document.paths["/v1/incidents/outbox/{event_id}/fail"].post.requestBody.content["application/json"].schema.required)
      .toEqual(["lease_token", "failure_code", "failure"]);
    const generated = readFileSync(new URL("../sdk/v1.generated.ts", import.meta.url), "utf8");
    expect(generated).toContain("async listDeadIncidentOutbox(");
    expect(generated).toContain("async getDeadIncidentOutbox(");
    expect(generated).toContain("async getIncidentOutboxStatus(");
    expect(generated).toContain('"failure_code": string; "failure": string');
    expect(generated).toContain('"failure_fingerprint": string | null; "consecutive_failures": number');
    expect(generated).toContain('"blocked_scopes": Array<string>');
    expect(generated).not.toContain('"blocked_scopes": Array<unknown');
  });

  test("generated SDK encodes identifiers and sends the flattened transition wire body", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? "GET",
          url: String(input),
          body: init?.body as string | undefined,
        });
        if (String(input).endsWith("/requeue")) return Response.json({ outbox: {} });
        return Response.json({ result: {} });
      }) as typeof fetch,
    });

    await client.transitionIncident("incident/one", {
      expected_version: 3,
      idempotency_key: "transition-fixture",
      reason: "Contain the incident",
      status: "contained",
      containment: "Projector paused",
    });
    await client.requeueIncidentOutbox("event/dead", {
      expected_attempts: 5,
      idempotency_key: "requeue-fixture",
      reason: "Projector repaired",
    });

    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://todos.test/v1/incidents/incident%2Fone/transitions",
        body: JSON.stringify({
          expected_version: 3,
          idempotency_key: "transition-fixture",
          reason: "Contain the incident",
          status: "contained",
          containment: "Projector paused",
        }),
      },
      {
        method: "POST",
        url: "https://todos.test/v1/incidents/outbox/event%2Fdead/requeue",
        body: JSON.stringify({
          expected_attempts: 5,
          idempotency_key: "requeue-fixture",
          reason: "Projector repaired",
        }),
      },
    ]);
  });
});
