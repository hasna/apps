import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACTIVE_INCIDENT_STATUSES,
  incidentEventId,
  incidentTransitionId,
  stableIncidentFingerprint,
  type IncidentProjectionEvent,
} from "./contracts.js";
import type { IncidentOutboxRecord } from "./postgres-store.js";
import {
  canonicalIncidentJson,
  inspectIncidentOutboxPublisher,
  publishIncidentOutboxOnce,
  resolveIncidentProjectorConfig,
  validateIncidentPublisherLeaseBudget,
  type IncidentOutboxPublisherApi,
} from "./outbox-publisher.js";

const fixture = JSON.parse(readFileSync(
  new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
  "utf8",
)) as IncidentProjectionEvent;
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
  while (servers.length) await servers.pop()!.stop(true);
});

function eventFor(id: string, version = 1): IncidentProjectionEvent {
  const occurredAt = new Date(Date.parse(fixture.occurred_at) + version * 1_000).toISOString();
  const eventId = incidentEventId(fixture.authority_id, id, version);
  const transitionId = incidentTransitionId(fixture.authority_id, id, version);
  return {
    ...structuredClone(fixture),
    event_id: eventId,
    projection_key: `todos:incident:${fixture.authority_id}:${id}:v${version}`,
    incident_id: id,
    transition_id: transitionId,
    incident_version: version,
    occurred_at: occurredAt,
    incident: {
      ...structuredClone(fixture.incident),
      id,
      version,
      created_at: version === 1 ? occurredAt : fixture.incident.created_at,
      updated_at: occurredAt,
    },
  };
}

function leased(event: IncidentProjectionEvent, suffix = "1"): IncidentOutboxRecord {
  return {
    event_id: event.event_id,
    projection_key: event.projection_key,
    incident_id: event.incident_id,
    incident_version: event.incident_version,
    depends_on_event_id: null,
    payload: event,
    status: "leased",
    attempts: 1,
    next_attempt_at: new Date().toISOString(),
    lease_token: `lease-${suffix}`,
    leased_by: "incident-projector",
    lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
    delivery_id: null,
    acked_at: null,
    last_error: null,
    failure_code: null,
    failure_fingerprint: null,
    consecutive_failures: 0,
    created_at: event.occurred_at,
    updated_at: new Date().toISOString(),
  };
}

function projection(
  event: IncidentProjectionEvent,
  options: { replayed: boolean; messageId?: number; channel?: string } = { replayed: false },
) {
  const messageId = options.messageId ?? 42;
  return {
    id: 7,
    event_id: event.event_id,
    projection_key: event.projection_key,
    message_id: messageId,
    schema_version: 1,
    source: "todos",
    tenant_id: "tenant-fixture",
    authority_id: event.authority_id,
    incident_id: event.incident_id,
    transition_id: event.transition_id,
    incident_version: event.incident_version,
    occurred_at: event.occurred_at,
    status: event.incident.status,
    severity: event.incident.severity,
    blocking: (ACTIVE_INCIDENT_STATUSES as readonly string[]).includes(event.incident.status)
      && event.incident.blocked_scopes.length > 0,
    supersedes_transition_id: event.incident_version > 1
      ? incidentTransitionId(event.authority_id, event.incident_id, event.incident_version - 1)
      : null,
    supersedes_incident_id: event.incident.supersedes_id,
    superseded_by_incident_id: event.incident.superseded_by_id,
    canonical_payload: canonicalIncidentJson(event),
    payload_hash: stableIncidentFingerprint(event),
    created_at: event.occurred_at,
    message: {
      id: messageId,
      uuid: `message-${messageId}`,
      session_id: "channel:incidents",
      from_agent: "todos-projector",
      to_agent: options.channel ?? "incidents",
      channel: options.channel ?? "incidents",
      project_id: null,
      content: "canonical display data",
      priority: "high",
      blocking: false,
      reply_to: null,
      working_dir: null,
      repository: null,
      branch: null,
      metadata: null,
      attachments: null,
      created_at: event.occurred_at,
    },
    replayed: options.replayed,
  };
}

type ApiCall = { operation: "status" | "claim" | "ack" | "fail"; event_id?: string; body?: unknown };

function outboxApi(
  records: IncidentOutboxRecord[],
  options: {
    ack?: (record: IncidentOutboxRecord, call: number) => Promise<IncidentOutboxRecord>;
    fail?: (record: IncidentOutboxRecord, body: { lease_token: string; failure_code: string; failure: string }) => Promise<IncidentOutboxRecord>;
  } = {},
): IncidentOutboxPublisherApi & { calls: ApiCall[] } {
  const queue = [...records];
  const calls: ApiCall[] = [];
  let ackCalls = 0;
  const api: IncidentOutboxPublisherApi & { calls: ApiCall[] } = {
    calls,
    async status() {
      calls.push({ operation: "status" });
      return { pending: queue.length, leased: 0, acked: 0, dead: 0, total: queue.length };
    },
    async claim(body) {
      calls.push({ operation: "claim", body });
      const record = queue.shift();
      return record ? [record] : [];
    },
    async ack(eventId, body) {
      calls.push({ operation: "ack", event_id: eventId, body });
      const record = records.find((candidate) => candidate.event_id === eventId)!;
      ackCalls += 1;
      if (options.ack) return options.ack(record, ackCalls);
      return {
        ...record,
        status: "acked",
        lease_token: null,
        leased_by: null,
        lease_expires_at: null,
        delivery_id: body.delivery_id,
        acked_at: new Date().toISOString(),
      };
    },
    async fail(eventId, body) {
      calls.push({ operation: "fail", event_id: eventId, body });
      const record = records.find((candidate) => candidate.event_id === eventId)!;
      if (options.fail) return options.fail(record, body);
      return {
        ...record,
        status: "pending",
        lease_token: null,
        leased_by: null,
        lease_expires_at: null,
        last_error: `Projection delivery failed: ${body.failure_code}`,
        failure_code: body.failure_code,
        failure_fingerprint: stableIncidentFingerprint({ failure_code: body.failure_code }),
        consecutive_failures: 1,
      };
    },
  };
  return api;
}

function projectorServer(handler: (request: Request, call: number) => Response | Promise<Response>) {
  let calls = 0;
  const requests: Request[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls += 1;
      requests.push(request.clone());
      return handler(request, calls);
    },
  });
  servers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    get calls() { return calls; },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const runDefaults = {
  limit: 10,
  leaseSeconds: 60,
  requestTimeoutMs: 100,
  projectorApiKey: "synthetic-projector-key",
};

describe("incident outbox publisher configuration", () => {
  it("resolves only an explicit nonconflicting Conversations authority and secret", () => {
    expect(resolveIncidentProjectorConfig({
      HASNA_CONVERSATIONS_API_URL: "https://conversations.example/v1",
      HASNA_CONVERSATIONS_API_KEY: "projector-key",
    })).toEqual({ baseUrl: "https://conversations.example", apiKey: "projector-key" });
    expect(() => resolveIncidentProjectorConfig({
      HASNA_CONVERSATIONS_API_URL: "https://one.example",
      CONVERSATIONS_API_URL: "https://two.example",
      HASNA_CONVERSATIONS_API_KEY: "projector-key",
    })).toThrow("CONV_API_URL_CONFLICT");
    expect(() => resolveIncidentProjectorConfig({
      HASNA_CONVERSATIONS_API_URL: "https://conversations.example",
      HASNA_CONVERSATIONS_API_KEY: "one",
      CONVERSATIONS_API_KEY: "two",
    })).toThrow("CONV_API_KEY_CONFLICT");
  });

  it("rejects credential-bearing, redirected-path, and plaintext nonloopback URLs", () => {
    for (const url of [
      "https://name:secret@conversations.example",
      "https://conversations.example/api/v1",
      "https://conversations.example/?key=secret",
      "http://conversations.example",
    ]) {
      expect(() => resolveIncidentProjectorConfig({
        HASNA_CONVERSATIONS_API_URL: url,
        HASNA_CONVERSATIONS_API_KEY: "projector-key",
      })).toThrow("CONV_API_URL_INVALID");
    }
  });

  it("rejects an unsafe lease budget before claim", async () => {
    expect(() => validateIncidentPublisherLeaseBudget({ leaseSeconds: 5, requestTimeoutMs: 5_000 }))
      .toThrow("INCIDENT_PUBLISH_LEASE_BUDGET_INVALID");
    const api = outboxApi([leased(fixture)]);
    await expect(publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: "http://127.0.0.1:1",
      ...runDefaults,
      leaseSeconds: 5,
      requestTimeoutMs: 5_000,
    })).rejects.toThrow("INCIDENT_PUBLISH_LEASE_BUDGET_INVALID");
    expect(api.calls).toEqual([]);
  });

  it("inspects status without claiming or requiring projector configuration", async () => {
    const api = outboxApi([leased(fixture)]);
    await expect(inspectIncidentOutboxPublisher({ outbox: api, requestTimeoutMs: 100 })).resolves.toEqual({
      ok: true,
      outcome: "status",
      status: { pending: 1, leased: 0, acked: 0, dead: 0, total: 1 },
    });
    expect(api.calls).toEqual([{ operation: "status" }]);
  });

  it("bounds a never-resolving status or claim request", async () => {
    const statusApi = outboxApi([]);
    statusApi.status = () => new Promise(() => undefined);
    const started = Date.now();
    await expect(inspectIncidentOutboxPublisher({ outbox: statusApi, requestTimeoutMs: 20 })).resolves.toEqual({
      ok: false,
      outcome: "status_failed",
    });
    expect(Date.now() - started).toBeLessThan(500);

    const claimApi = outboxApi([]);
    claimApi.claim = () => new Promise(() => undefined);
    await expect(publishIncidentOutboxOnce({
      outbox: claimApi,
      projectorBaseUrl: "http://127.0.0.1:1",
      ...runDefaults,
      requestTimeoutMs: 20,
    })).resolves.toEqual({
      ok: false,
      outcome: "claim_failed",
      claimed: 0,
      acked: 0,
      failed: 0,
      events: [],
    });
  });

  it("fails closed on inconsistent status arithmetic", async () => {
    const api = outboxApi([]);
    api.status = async () => ({ pending: 1, leased: 0, acked: 0, dead: 0, total: 0 });
    await expect(inspectIncidentOutboxPublisher({ outbox: api, requestTimeoutMs: 100 })).resolves.toEqual({
      ok: false,
      outcome: "status_failed",
    });
  });
});

describe("bounded one-shot incident projection delivery", () => {
  it("POSTs exact canonical v1 and ACKs a strict 201/new response with message_id", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe("/v1/incident-projections");
      expect(request.headers.get("x-api-key")).toBe("synthetic-projector-key");
      expect(request.headers.get("authorization")).toBeNull();
      expect(await request.json()).toEqual(fixture);
      return json({ projection: projection(fixture, { replayed: false }) }, 201);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
    });
    expect(result).toMatchObject({ ok: true, outcome: "complete", claimed: 1, acked: 1, failed: 0 });
    expect(result.events).toEqual([{
      event_id: fixture.event_id,
      status: "acked",
      message_id: 42,
      replayed: false,
    }]);
    expect(api.calls).toEqual([
      { operation: "claim", body: { limit: 1, lease_seconds: 60 } },
      { operation: "ack", event_id: fixture.event_id, body: { lease_token: "lease-1", delivery_id: "42" } },
      { operation: "claim", body: { limit: 1, lease_seconds: 60 } },
    ]);
  });

  it("ACKs a strict 200/identical replay and ignores mutable display routing", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(() => json({
      projection: projection(fixture, { replayed: true, channel: "renamed-incidents" }),
    }, 200));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
    });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true });
    expect(api.calls.find((call) => call.operation === "ack")?.body).toEqual({ lease_token: "lease-1", delivery_id: "42" });
  });

  it("reconciles an admitted POST timeout by exact replay before ACK", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(async (_request, call) => {
      if (call === 1) {
        await Bun.sleep(50);
        return json({ projection: projection(fixture, { replayed: false }) }, 201);
      }
      return json({ projection: projection(fixture, { replayed: true }) }, 200);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(projector.calls).toBe(2);
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true });
  });

  it("reconciles a POST timeout before admission with a strict 201/new retry", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(async (_request, call) => {
      if (call === 1) {
        await Bun.sleep(50);
        return json({ error: "not admitted" }, 503);
      }
      return json({ projection: projection(fixture, { replayed: false }) }, 201);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(projector.calls).toBe(2);
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: false });
  });

  for (const [name, mutate] of [
    ["event_id", (value: any) => { value.event_id = "iev_00000000000000000000000000000000"; }],
    ["projection_key", (value: any) => { value.projection_key += ":drift"; }],
    ["authority_id", (value: any) => { value.authority_id = "other-authority"; }],
    ["incident_id", (value: any) => { value.incident_id = "22222222-2222-4222-8222-222222222222"; }],
    ["transition_id", (value: any) => { value.transition_id = "itr_00000000000000000000000000000000"; }],
    ["incident_version", (value: any) => { value.incident_version = 2; }],
    ["occurred_at", (value: any) => { value.occurred_at = "2026-07-18T20:02:00.000Z"; }],
    ["schema_version", (value: any) => { value.schema_version = 2; }],
    ["source", (value: any) => { value.source = "conversations"; }],
    ["projection id", (value: any) => { value.id = 0; }],
    ["message id", (value: any) => { value.message_id = 0; }],
    ["message correlation", (value: any) => { value.message.id = 43; }],
    ["canonical_payload", (value: any) => { value.canonical_payload = "{}"; }],
    ["payload_hash", (value: any) => { value.payload_hash = "0".repeat(64); }],
    ["created_at", (value: any) => { value.created_at = "1"; }],
  ] as const) {
    it(`fails closed on a 2xx ${name} mismatch`, async () => {
      const api = outboxApi([leased(fixture)]);
      const body = projection(fixture, { replayed: false }) as any;
      mutate(body);
      const projector = projectorServer(() => json({ projection: body }, 201));
      const result = await publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: projector.baseUrl,
        ...runDefaults,
      });
      expect(result).toMatchObject({ ok: false, outcome: "failed", claimed: 1, acked: 0, failed: 1 });
      expect(result.events).toEqual([{ event_id: fixture.event_id, status: "failed", failure_code: "CONV_RESPONSE_INVALID" }]);
      expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(0);
      expect(api.calls.filter((call) => call.operation === "fail")).toHaveLength(1);
    });
  }

  it("rejects mismatched HTTP status and replay flag pairs", async () => {
    for (const [status, replayed] of [[201, true], [200, false], [202, false]] as const) {
      const api = outboxApi([leased(fixture)]);
      const projector = projectorServer(() => json({ projection: projection(fixture, { replayed }) }, status));
      const result = await publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: projector.baseUrl,
        ...runDefaults,
      });
      expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: "CONV_RESPONSE_INVALID" });
      expect(api.calls.some((call) => call.operation === "ack")).toBe(false);
      await servers.pop()!.stop(true);
    }
  });

  it("classifies stable HTTP and transport failures without raw bodies or secrets", async () => {
    for (const [status, body, expected] of [
      [400, { code: "INVALID_INCIDENT_PROJECTION", error: "token=must-not-persist" }, "INVALID_INCIDENT_PROJECTION"],
      [409, { code: "INCIDENT_PROJECTION_CONFLICT", error: "password=must-not-persist" }, "INCIDENT_PROJECTION_CONFLICT"],
      [401, { error: "key synthetic-projector-key" }, "CONV_HTTP_401"],
      [403, { error: "forbidden secret" }, "CONV_HTTP_403"],
      [429, { error: "retry request abc" }, "CONV_HTTP_429"],
      [503, { code: "anything", error: "postgres://secret@host/db" }, "CONV_HTTP_503"],
      [503, { error: "other body" }, "CONV_HTTP_503"],
    ] as const) {
      const api = outboxApi([leased(fixture)]);
      const projector = projectorServer(() => json(body, status));
      const result = await publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: projector.baseUrl,
        ...runDefaults,
      });
      expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: expected });
      const failBody = api.calls.find((call) => call.operation === "fail")!.body as Record<string, string>;
      expect(failBody.failure_code).toBe(expected);
      expect(failBody.failure).toBe(`Projection delivery failed: ${expected}`);
      expect(JSON.stringify(result)).not.toContain("synthetic-projector-key");
      expect(JSON.stringify(result)).not.toContain("secret");
      await servers.pop()!.stop(true);
    }
  });

  it("stops after one failed event without claiming or poisoning the next", async () => {
    const second = eventFor("22222222-2222-4222-8222-222222222222");
    const api = outboxApi([leased(fixture), leased(second, "2")]);
    const projector = projectorServer(() => json({ error: "unavailable" }, 503));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
    });
    expect(result).toMatchObject({ ok: false, claimed: 1, failed: 1 });
    expect(projector.calls).toBe(1);
    expect(api.calls.filter((call) => call.operation === "claim")).toHaveLength(1);
  });

  it("fails closed on an expired or malformed claimed lease before POST", async () => {
    for (const claimed of [
      { ...leased(fixture), lease_expires_at: new Date(Date.now() - 1_000).toISOString() },
      {} as IncidentOutboxRecord,
    ]) {
      const api = outboxApi([]);
      api.claim = async (body) => {
        api.calls.push({ operation: "claim", body });
        return [claimed];
      };
      const result = await publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: "http://127.0.0.1:1",
        ...runDefaults,
      });
      expect(result).toMatchObject({ ok: false, outcome: "claim_invalid", claimed: 0, acked: 0, failed: 0 });
      expect(api.calls.filter((call) => call.operation === "ack" || call.operation === "fail")).toHaveLength(0);
    }
  });

  it("strictly rejects malformed claimed payload fields without throwing or POSTing", async () => {
    const mutations: Array<(value: IncidentOutboxRecord) => void> = [
      (value) => { value.payload.authority_id = "bad authority"; },
      (value) => { (value.payload.incident.blocked_scopes as unknown) = "channel:incidents"; },
      (value) => { value.payload.incident.severity = "urgent" as never; },
      (value) => { value.payload.incident.updated_at = "not-a-timestamp"; },
      (value) => { value.payload.incident.id = "not-a-uuid"; },
      (value) => { value.payload.incident.version = 2; },
      (value) => { value.payload.authority_id = ` ${value.payload.authority_id} `; },
      (value) => { (value.payload as unknown as Record<string, unknown>).extra = true; },
      (value) => { (value.payload.incident as unknown as Record<string, unknown>).extra = true; },
    ];
    for (const mutate of mutations) {
      const claimed = leased(structuredClone(fixture));
      mutate(claimed);
      const api = outboxApi([]);
      api.claim = async (body) => {
        api.calls.push({ operation: "claim", body });
        return [claimed];
      };
      await expect(publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: "http://127.0.0.1:1",
        ...runDefaults,
      })).resolves.toMatchObject({ ok: false, outcome: "claim_invalid", claimed: 0 });
      expect(api.calls.filter((call) => call.operation === "ack" || call.operation === "fail")).toHaveLength(0);
    }
  });

  it("publishes a blocked superseded event before its dependent replacement", async () => {
    const replacementId = "22222222-2222-4222-8222-222222222222";
    const superseded = eventFor(fixture.incident_id, 2);
    superseded.incident = {
      ...superseded.incident,
      status: "superseded",
      next_action: null,
      superseded_by_id: replacementId,
      resolved_at: superseded.occurred_at,
    };
    const replacement = eventFor(replacementId, 1);
    replacement.incident = { ...replacement.incident, supersedes_id: fixture.incident_id };
    const supersededRecord = leased(superseded, "superseded");
    const replacementRecord = leased(replacement, "replacement");
    replacementRecord.depends_on_event_id = superseded.event_id;
    const api = outboxApi([supersededRecord, replacementRecord]);
    const projector = projectorServer(async (request) => {
      const event = await request.json() as IncidentProjectionEvent;
      return json({
        projection: projection(event, {
          replayed: false,
          messageId: event.event_id === superseded.event_id ? 71 : 72,
        }),
      }, 201);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      limit: 2,
    });
    expect(superseded.incident.blocked_scopes).toEqual(fixture.incident.blocked_scopes);
    expect(projection(superseded, { replayed: false }).blocking).toBe(false);
    expect(result).toMatchObject({ ok: true, claimed: 2, acked: 2, failed: 0 });
    expect(result.events.map((event) => event.event_id)).toEqual([superseded.event_id, replacement.event_id]);
  });

  it("derives blocking from the shared active-status contract for every incident status", async () => {
    const replacementId = "22222222-2222-4222-8222-222222222222";
    for (const [status, expectedBlocking] of [
      ["open", true],
      ["investigating", true],
      ["contained", true],
      ["monitoring", true],
      ["resolved", false],
      ["superseded", false],
    ] as const) {
      const event = eventFor(fixture.incident_id, 2);
      event.incident = {
        ...event.incident,
        status,
        containment: status === "contained" || status === "monitoring" ? "Bounded containment" : null,
        next_action: status === "resolved" || status === "superseded" ? null : "Continue bounded handling",
        blocked_scopes: status === "resolved" ? [] : [...fixture.incident.blocked_scopes],
        closure_evidence: status === "resolved" ? ["Closure independently verified"] : [],
        resolved_at: status === "resolved" || status === "superseded" ? event.occurred_at : null,
        superseded_by_id: status === "superseded" ? replacementId : null,
      };
      for (const [blocking, accepted] of [
        [expectedBlocking, true],
        [!expectedBlocking, false],
      ] as const) {
        const api = outboxApi([leased(event, `${status}-${String(blocking)}`)]);
        const response = { ...projection(event, { replayed: false }), blocking };
        const projector = projectorServer(() => json({ projection: response }, 201));
        const result = await publishIncidentOutboxOnce({
          outbox: api,
          projectorBaseUrl: projector.baseUrl,
          ...runDefaults,
        });
        expect(response.blocking).toBe(blocking);
        expect(result.ok).toBe(accepted);
        expect(result.events[0]?.status).toBe(accepted ? "acked" : "failed");
      }
    }
  });

  it("does not POST a claimed lease whose remaining budget is below the full bounded state machine", async () => {
    const claimed = leased(fixture);
    claimed.lease_expires_at = new Date(Date.now() + 1_200).toISOString();
    const api = outboxApi([claimed]);
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: "http://127.0.0.1:1",
      ...runDefaults,
      requestTimeoutMs: 100,
    });
    expect(result).toMatchObject({ ok: false, outcome: "lease_insufficient", claimed: 1, acked: 0, failed: 0 });
    expect(api.calls.filter((call) => call.operation === "ack" || call.operation === "fail")).toHaveLength(0);
  });

  it("claims the second event only after the first ACK settles", async () => {
    const second = eventFor("22222222-2222-4222-8222-222222222222");
    const api = outboxApi([leased(fixture), leased(second, "2")]);
    const trace: string[] = [];
    const originalClaim = api.claim.bind(api);
    api.claim = async (body) => { trace.push("claim"); return originalClaim(body); };
    const originalAck = api.ack.bind(api);
    api.ack = async (eventId, body) => { trace.push(`ack:${eventId}`); return originalAck(eventId, body); };
    const projector = projectorServer(async (request) => {
      const event = await request.json() as IncidentProjectionEvent;
      trace.push(`post:${event.event_id}`);
      if (event.event_id === fixture.event_id) await Bun.sleep(25);
      return json({ projection: projection(event, { replayed: false, messageId: event.event_id === fixture.event_id ? 42 : 43 }) }, 201);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      limit: 2,
    });
    expect(result).toMatchObject({ ok: true, claimed: 2, acked: 2 });
    expect(trace).toEqual([
      "claim", `post:${fixture.event_id}`, `ack:${fixture.event_id}`,
      "claim", `post:${second.event_id}`, `ack:${second.event_id}`,
    ]);
  });

  it("replays POST and retries identical ACK after a committed response is lost", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async (record, call) => {
        if (call === 1) throw new Error("raw remote response with key synthetic-projector-key");
        return { ...record, status: "acked", delivery_id: "42", lease_token: null, leased_by: null, lease_expires_at: null, acked_at: new Date().toISOString() };
      },
    });
    const projector = projectorServer((_request, call) => json({
      projection: projection(fixture, { replayed: call > 1 }),
    }, call > 1 ? 200 : 201));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
    });
    expect(result).toEqual({
      ok: true,
      outcome: "complete",
      claimed: 1,
      acked: 1,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true }],
    });
    expect(projector.calls).toBe(2);
    expect(api.calls.filter((call) => call.operation === "ack").map((call) => call.body)).toEqual([
      { lease_token: "lease-1", delivery_id: "42" },
      { lease_token: "lease-1", delivery_id: "42" },
    ]);
    expect(api.calls.filter((call) => call.operation === "fail")).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("synthetic-projector-key");
  });

  it("replays POST and retries identical ACK when the first ACK was not committed", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async (record, call) => {
        if (call === 1) throw new Error("connection reset before admission");
        return { ...record, status: "acked", delivery_id: "42", lease_token: null, leased_by: null, lease_expires_at: null, acked_at: new Date().toISOString() };
      },
    });
    const projector = projectorServer((_request, call) => json({
      projection: projection(fixture, { replayed: call > 1 }),
    }, call > 1 ? 200 : 201));
    const result = await publishIncidentOutboxOnce({ outbox: api, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true });
    expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(2);
  });

  it("leaves the lease untouched after bounded ACK reconciliation is still uncertain", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async () => new Promise(() => undefined),
    });
    const projector = projectorServer((_request, call) => json({
      projection: projection(fixture, { replayed: call > 1 }),
    }, call > 1 ? 200 : 201));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(result).toEqual({
      ok: false,
      outcome: "ack_pending",
      claimed: 1,
      acked: 0,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "ack_pending", message_id: 42 }],
    });
    expect(projector.calls).toBe(2);
    expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(2);
    expect(api.calls.filter((call) => call.operation === "fail")).toHaveLength(0);
  });

  it("leaves the lease untouched if ACK replay changes the delivery identity", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async () => { throw new Error("ambiguous ack"); },
    });
    const projector = projectorServer((_request, call) => json({
      projection: projection(fixture, { replayed: call > 1, messageId: call > 1 ? 43 : 42 }),
    }, call > 1 ? 200 : 201));
    const result = await publishIncidentOutboxOnce({ outbox: api, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(result).toEqual({
      ok: false,
      outcome: "ack_pending",
      claimed: 1,
      acked: 0,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "ack_pending", message_id: 42 }],
    });
    expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(1);
  });

  it("rejects 201/new discontinuity after a known projection success and ambiguous ACK", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async () => { throw new Error("ambiguous ack"); },
    });
    const projector = projectorServer(() => json({ projection: projection(fixture, { replayed: false }) }, 201));
    const result = await publishIncidentOutboxOnce({ outbox: api, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(result).toEqual({
      ok: false,
      outcome: "ack_pending",
      claimed: 1,
      acked: 0,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "ack_pending", message_id: 42 }],
    });
    expect(projector.calls).toBe(2);
    expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(1);
  });

  it("retries the same ACK after an ambiguous POST needed the second projector window", async () => {
    const api = outboxApi([leased(fixture)], {
      ack: async (record, call) => {
        if (call === 1) throw new Error("ambiguous ack");
        return { ...record, status: "acked", delivery_id: "42", lease_token: null, leased_by: null, lease_expires_at: null, acked_at: new Date().toISOString() };
      },
    });
    const projector = projectorServer(async (_request, call) => {
      if (call === 1) {
        await Bun.sleep(50);
        return json({ projection: projection(fixture, { replayed: false }) }, 201);
      }
      return json({ projection: projection(fixture, { replayed: true }) }, 200);
    });
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true });
    expect(projector.calls).toBe(2);
    expect(api.calls.filter((call) => call.operation === "ack")).toHaveLength(2);
  });

  it("stops after one bounded fail-record uncertainty", async () => {
    const api = outboxApi([leased(fixture)], {
      fail: async () => new Promise(() => undefined),
    });
    const projector = projectorServer(() => json({ error: "unavailable" }, 503));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(result).toEqual({
      ok: false,
      outcome: "fail_pending",
      claimed: 1,
      acked: 0,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "fail_pending", failure_code: "CONV_HTTP_503" }],
    });
  });

  it("fails closed when fail-record confirmation is reset or does not match its stable failure contract", async () => {
    const failureCode = "CONV_HTTP_503";
    const expectedFingerprint = stableIncidentFingerprint({ failure_code: failureCode });
    const failedRecord: IncidentOutboxRecord = {
      ...leased(fixture),
      status: "pending",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      last_error: `Projection delivery failed: ${failureCode}`,
      failure_code: failureCode,
      failure_fingerprint: expectedFingerprint,
      consecutive_failures: 1,
    };
    const resetRecord: IncidentOutboxRecord = {
      ...failedRecord,
      attempts: 0,
      last_error: null,
      failure_code: null,
      failure_fingerprint: null,
      consecutive_failures: 0,
    };
    const wrongFingerprint = "b".repeat(64);
    expect(wrongFingerprint).not.toBe(expectedFingerprint);

    for (const invalid of [
      resetRecord,
      { ...failedRecord, failure_fingerprint: wrongFingerprint },
      { ...failedRecord, last_error: "Projection delivery failed: CONV_HTTP_502" },
    ]) {
      const api = outboxApi([leased(fixture)], {
        fail: async () => invalid,
      });
      const projector = projectorServer(() => json({ error: "unavailable" }, 503));
      const result = await publishIncidentOutboxOnce({
        outbox: api,
        projectorBaseUrl: projector.baseUrl,
        ...runDefaults,
      });
      expect(result).toEqual({
        ok: false,
        outcome: "fail_pending",
        claimed: 1,
        acked: 0,
        failed: 0,
        events: [{ event_id: fixture.event_id, status: "fail_pending", failure_code: failureCode }],
      });
      await servers.pop()!.stop(true);
    }
  });

  it("reclaims later and accepts exact replay after a prior ACK-uncertain delivery with renamed routing", async () => {
    const firstApi = outboxApi([leased(fixture)], { ack: async () => { throw new Error("ambiguous ack"); } });
    let projected = false;
    const projector = projectorServer(() => {
      const replayed = projected;
      projected = true;
      return json({ projection: projection(fixture, { replayed, channel: replayed ? "incidents-renamed" : "incidents" }) }, replayed ? 200 : 201);
    });
    const first = await publishIncidentOutboxOnce({ outbox: firstApi, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(first.outcome).toBe("ack_pending");
    const secondApi = outboxApi([leased(fixture, "reclaim")]);
    const second = await publishIncidentOutboxOnce({ outbox: secondApi, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(second.events[0]).toEqual({ event_id: fixture.event_id, status: "acked", message_id: 42, replayed: true });
    expect(secondApi.calls.find((call) => call.operation === "ack")!.body).toEqual({
      lease_token: "lease-reclaim",
      delivery_id: "42",
    });
  });

  it("uses manual redirects and never forwards the projector key", async () => {
    let targetRequests = 0;
    const target = projectorServer(() => { targetRequests += 1; return json({}); });
    const redirect = projectorServer(() => new Response(null, {
      status: 307,
      headers: { location: `${target.baseUrl}/capture` },
    }));
    const api = outboxApi([leased(fixture)]);
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: redirect.baseUrl,
      ...runDefaults,
    });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: "CONV_HTTP_307" });
    expect(targetRequests).toBe(0);
  });

  it("requires JSON success and caps response bytes", async () => {
    for (const response of [
      new Response(JSON.stringify({ projection: projection(fixture, { replayed: false }) }), { status: 201, headers: { "content-type": "text/plain" } }),
      new Response("x".repeat(70_000), { status: 201, headers: { "content-type": "application/json", "content-length": "70000" } }),
      new Response("not-json", { status: 201, headers: { "content-type": "application/json" } }),
    ]) {
      const api = outboxApi([leased(fixture)]);
      const projector = projectorServer(() => response.clone());
      const result = await publishIncidentOutboxOnce({ outbox: api, projectorBaseUrl: projector.baseUrl, ...runDefaults });
      expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: "CONV_RESPONSE_INVALID" });
      await servers.pop()!.stop(true);
    }
  });

  it("caps a streamed response without Content-Length", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 70; index += 1) controller.enqueue(new Uint8Array(1_024));
        controller.close();
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const result = await publishIncidentOutboxOnce({ outbox: api, projectorBaseUrl: projector.baseUrl, ...runDefaults });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: "CONV_RESPONSE_INVALID" });
  });

  it("classifies non-2xx headers immediately even when the error body stalls", async () => {
    const api = outboxApi([leased(fixture)]);
    const projector = projectorServer(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"partial'));
      },
    }), { status: 503, headers: { "content-type": "application/json" } }));
    const result = await publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: projector.baseUrl,
      ...runDefaults,
      requestTimeoutMs: 20,
    });
    expect(result.events[0]).toEqual({ event_id: fixture.event_id, status: "failed", failure_code: "CONV_HTTP_503" });
    expect(projector.calls).toBe(1);
  });
});
