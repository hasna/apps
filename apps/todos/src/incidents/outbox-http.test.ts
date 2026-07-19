import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  incidentEventId,
  incidentTransitionId,
  stableIncidentFingerprint,
  type IncidentProjectionEvent,
} from "./contracts.js";
import {
  createIncidentOutboxHttpApi,
  inspectIncidentOutboxPublisher,
  publishIncidentOutboxOnce,
  type IncidentOutboxPublisherCallOptions,
} from "./outbox-publisher.js";
import type { IncidentOutboxRecord } from "./postgres-store.js";

const fixture = JSON.parse(readFileSync(
  new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
  "utf8",
)) as IncidentProjectionEvent;
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
  while (servers.length) await servers.pop()!.stop(true);
});

function record(
  status: IncidentOutboxRecord["status"],
  event: IncidentProjectionEvent = fixture,
): IncidentOutboxRecord {
  const leased = status === "leased";
  const acked = status === "acked";
  const failed = status === "pending" || status === "dead";
  return {
    event_id: event.event_id,
    projection_key: event.projection_key,
    incident_id: event.incident_id,
    incident_version: event.incident_version,
    depends_on_event_id: null,
    payload: structuredClone(event),
    status,
    attempts: 1,
    next_attempt_at: new Date().toISOString(),
    lease_token: leased ? "lease-http" : null,
    leased_by: leased ? "incident-projector" : null,
    lease_expires_at: leased ? new Date(Date.now() + 120_000).toISOString() : null,
    delivery_id: acked ? "42" : null,
    acked_at: acked ? new Date().toISOString() : null,
    last_error: failed ? "Projection delivery failed: CONV_HTTP_503" : null,
    failure_code: failed ? "CONV_HTTP_503" : null,
    failure_fingerprint: failed
      ? stableIncidentFingerprint({ failure_code: "CONV_HTTP_503" })
      : null,
    consecutive_failures: failed ? 1 : 0,
    created_at: event.occurred_at,
    updated_at: new Date().toISOString(),
  };
}

function otherEvent(): IncidentProjectionEvent {
  const incidentId = "22222222-2222-4222-8222-222222222222";
  const event = structuredClone(fixture);
  event.event_id = incidentEventId(event.authority_id, incidentId, event.incident_version);
  event.projection_key = `todos:incident:${event.authority_id}:${incidentId}:v${event.incident_version}`;
  event.incident_id = incidentId;
  event.transition_id = incidentTransitionId(event.authority_id, incidentId, event.incident_version);
  event.incident.id = incidentId;
  return event;
}

function requeuedRecord(): IncidentOutboxRecord {
  return {
    ...record("pending"),
    attempts: 0,
    last_error: null,
    failure_code: null,
    failure_fingerprint: null,
    consecutive_failures: 0,
  };
}

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const liveSignal: IncidentOutboxPublisherCallOptions = { signal: new AbortController().signal };

describe("strict incident outbox HTTP adapter", () => {
  it("uses exact v1 routes and strictly decodes status, claim, ack, fail, dead, and requeue envelopes", async () => {
    const calls: string[] = [];
    const endpoint = serve((request) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      expect(request.headers.get("x-api-key")).toBe("test-sentinel-key");
      expect(request.headers.get("authorization")).toBeNull();
      if (url.pathname.endsWith("/status")) return json({ status: { pending: 1, leased: 0, acked: 2, dead: 1, total: 4 } });
      if (url.pathname.endsWith("/claim")) return json({ outbox: [record("leased")], count: 1 });
      if (url.pathname.endsWith("/ack")) return json({ outbox: record("acked") });
      if (url.pathname.endsWith("/fail")) return json({ outbox: record("pending") });
      if (url.pathname.endsWith("/requeue")) return json({ outbox: requeuedRecord() });
      if (url.pathname.endsWith(`/${fixture.event_id}`)) return json({ outbox: record("dead") });
      return json({ outbox: [record("dead")], count: 1 });
    });
    const api = createIncidentOutboxHttpApi({
      baseUrl: `${endpoint.baseUrl}/v1`,
      apiKey: "test-sentinel-key",
    });
    await expect(api.status(liveSignal)).resolves.toEqual({ pending: 1, leased: 0, acked: 2, dead: 1, total: 4 });
    await expect(api.claim({ limit: 1, lease_seconds: 60 }, liveSignal)).resolves.toHaveLength(1);
    await expect(api.ack(fixture.event_id, { lease_token: "lease-http", delivery_id: "42" }, liveSignal))
      .resolves.toMatchObject({ status: "acked", delivery_id: "42" });
    await expect(api.fail(fixture.event_id, {
      lease_token: "lease-http",
      failure_code: "CONV_HTTP_503",
      failure: "Projection delivery failed: CONV_HTTP_503",
    }, liveSignal)).resolves.toMatchObject({ status: "pending", failure_code: "CONV_HTTP_503" });
    await expect(api.listDead({ limit: 1 }, liveSignal)).resolves.toHaveLength(1);
    await expect(api.getDead(fixture.event_id, liveSignal)).resolves.toMatchObject({ status: "dead" });
    await expect(api.requeue(fixture.event_id, {
      expected_attempts: 1,
      idempotency_key: "requeue-test-0001",
      reason: "operator test",
    }, liveSignal)).resolves.toMatchObject({ status: "pending", attempts: 0, consecutive_failures: 0 });
    expect(calls).toEqual([
      "GET /v1/incidents/outbox/status",
      "POST /v1/incidents/outbox/claim",
      `POST /v1/incidents/outbox/${fixture.event_id}/ack`,
      `POST /v1/incidents/outbox/${fixture.event_id}/fail`,
      "GET /v1/incidents/outbox?limit=1",
      `GET /v1/incidents/outbox/${fixture.event_id}`,
      `POST /v1/incidents/outbox/${fixture.event_id}/requeue`,
    ]);
  });

  it("never converts malformed status/claim/ack/fail envelopes into success or no-work", async () => {
    const endpoint = serve(() => json({}));
    const api = createIncidentOutboxHttpApi({ baseUrl: endpoint.baseUrl, apiKey: "test-sentinel-key" });
    await expect(api.status(liveSignal)).rejects.toThrow("TODOS_RESPONSE_INVALID");
    await expect(api.claim({ limit: 1, lease_seconds: 60 }, liveSignal)).rejects.toThrow("TODOS_RESPONSE_INVALID");
    await expect(api.ack(fixture.event_id, { lease_token: "lease-http", delivery_id: "42" }, liveSignal))
      .rejects.toThrow("TODOS_RESPONSE_INVALID");
    await expect(api.fail(fixture.event_id, {
      lease_token: "lease-http",
      failure_code: "CONV_HTTP_503",
      failure: "Projection delivery failed: CONV_HTTP_503",
    }, liveSignal)).rejects.toThrow("TODOS_RESPONSE_INVALID");
    await expect(inspectIncidentOutboxPublisher({ outbox: api, requestTimeoutMs: 50 })).resolves.toEqual({
      ok: false,
      outcome: "status_failed",
    });
    await expect(publishIncidentOutboxOnce({
      outbox: api,
      projectorBaseUrl: "http://127.0.0.1:1",
      projectorApiKey: "projector-test-sentinel",
      limit: 1,
      leaseSeconds: 60,
      requestTimeoutMs: 50,
    })).resolves.toMatchObject({ ok: false, outcome: "claim_failed", claimed: 0 });
  });

  it("rejects unknown keys, endpoint-state drift, and every invalid per-state credential bundle", async () => {
    type Adapter = ReturnType<typeof createIncidentOutboxHttpApi>;
    const status = (api: Adapter) => api.status(liveSignal);
    const claim = (api: Adapter) => api.claim({ limit: 1, lease_seconds: 60 }, liveSignal);
    const ack = (api: Adapter) => api.ack(
      fixture.event_id,
      { lease_token: "lease-http", delivery_id: "42" },
      liveSignal,
    );
    const fail = (api: Adapter) => api.fail(fixture.event_id, {
      lease_token: "lease-http",
      failure_code: "CONV_HTTP_503",
      failure: "Projection delivery failed: CONV_HTTP_503",
    }, liveSignal);
    const listDead = (api: Adapter) => api.listDead({ limit: 1 }, liveSignal);
    const getDead = (api: Adapter) => api.getDead(fixture.event_id, liveSignal);
    const requeue = (api: Adapter) => api.requeue(fixture.event_id, {
      expected_attempts: 3,
      idempotency_key: "requeue-negative-0001",
      reason: "strict negative contract",
    }, liveSignal);
    const pending = record("pending");
    const leased = record("leased");
    const acked = record("acked");
    const dead = record("dead");
    const reset = requeuedRecord();
    const other = otherEvent();
    const wrongFailureFingerprint = "b".repeat(64);
    expect(wrongFailureFingerprint).not.toBe(pending.failure_fingerprint);
    const numericEventTimestamp = structuredClone(leased);
    numericEventTimestamp.payload.occurred_at = "1";
    numericEventTimestamp.payload.incident.updated_at = "1";
    const invalidCalendarEventTimestamp = structuredClone(leased);
    invalidCalendarEventTimestamp.payload.occurred_at = "2026-02-30T00:00:00.000Z";
    invalidCalendarEventTimestamp.payload.incident.updated_at = "2026-02-30T00:00:00.000Z";
    const cases: Array<{ response: unknown; operation: (api: Adapter) => Promise<unknown> }> = [
      { response: { status: { pending: 0, leased: 0, acked: 0, dead: 0, total: 0 }, extra: true }, operation: status },
      { response: { status: { pending: 0, leased: 0, acked: 0, dead: 0, total: 0, extra: 0 } }, operation: status },
      { response: { outbox: [leased], count: 1, extra: true }, operation: claim },
      { response: { outbox: [{ ...leased, extra: true }], count: 1 }, operation: claim },
      { response: { outbox: leased, extra: true }, operation: ack },
      { response: { outbox: [pending], count: 1 }, operation: claim },
      { response: { outbox: leased }, operation: ack },
      { response: { outbox: record("acked", other) }, operation: ack },
      { response: { outbox: { ...acked, delivery_id: "43" } }, operation: ack },
      { response: { outbox: acked }, operation: fail },
      { response: { outbox: record("pending", other) }, operation: fail },
      { response: { outbox: {
        ...pending,
        last_error: "Projection delivery failed: CONV_HTTP_502",
        failure_code: "CONV_HTTP_502",
        failure_fingerprint: stableIncidentFingerprint({ failure_code: "CONV_HTTP_502" }),
      } }, operation: fail },
      { response: { outbox: reset }, operation: fail },
      { response: { outbox: [pending], count: 1 }, operation: listDead },
      { response: { outbox: pending }, operation: getDead },
      { response: { outbox: record("dead", other) }, operation: getDead },
      { response: { outbox: pending }, operation: requeue },
      { response: { outbox: {
        ...record("pending", other),
        attempts: 0,
        last_error: null,
        failure_code: null,
        failure_fingerprint: null,
        consecutive_failures: 0,
      } }, operation: requeue },
      { response: { outbox: { ...reset, lease_token: "unexpected" } }, operation: requeue },
      { response: { outbox: { ...reset, attempts: 1 } }, operation: fail },
      { response: { outbox: { ...reset, last_error: "unexpected", failure_code: "CONV_HTTP_503", failure_fingerprint: "a".repeat(64), consecutive_failures: 1 } }, operation: fail },
      { response: { outbox: { ...pending, failure_fingerprint: wrongFailureFingerprint } }, operation: fail },
      { response: { outbox: { ...pending, last_error: "Projection delivery failed: CONV_HTTP_502" } }, operation: fail },
      { response: { outbox: { ...leased, lease_token: null } }, operation: claim },
      { response: { outbox: [{ ...leased, lease_expires_at: null }], count: 1 }, operation: claim },
      { response: { outbox: [{ ...leased, failure_code: "CONV_HTTP_503", failure_fingerprint: null, consecutive_failures: 1, last_error: "failed" }], count: 1 }, operation: claim },
      { response: { outbox: { ...acked, delivery_id: null } }, operation: ack },
      { response: { outbox: { ...acked, acked_at: null } }, operation: ack },
      { response: { outbox: { ...acked, last_error: "unexpected" } }, operation: ack },
      { response: { outbox: { ...dead, failure_code: null } }, operation: getDead },
      { response: { outbox: { ...dead, failure_fingerprint: "not-hex" } }, operation: getDead },
      { response: { outbox: { ...dead, delivery_id: "unexpected" } }, operation: getDead },
      { response: { outbox: { ...pending, failure_code: "dynamic value" } }, operation: fail },
      { response: { outbox: numericEventTimestamp, count: 1 }, operation: claim },
      { response: { outbox: invalidCalendarEventTimestamp, count: 1 }, operation: claim },
      { response: { outbox: [{ ...leased, next_attempt_at: "1" }], count: 1 }, operation: claim },
      { response: { outbox: [{ ...leased, lease_expires_at: "2026-07-18T20:01:00Z" }], count: 1 }, operation: claim },
      { response: { outbox: { ...acked, acked_at: "2026-07-18T23:00:00.000+03:00" } }, operation: ack },
      { response: { outbox: { ...dead, created_at: "2026-02-30T00:00:00.000Z" } }, operation: getDead },
      { response: { outbox: { ...pending, updated_at: "2026-07-18T20:00:00.000+00:00" } }, operation: fail },
      { response: { outbox: { ...reset, next_attempt_at: "2026-07-18T20:00:00.0000Z" } }, operation: requeue },
    ];
    for (const testCase of cases) {
      const endpoint = serve(() => json(testCase.response));
      const api = createIncidentOutboxHttpApi({ baseUrl: endpoint.baseUrl, apiKey: "test-sentinel-key" });
      await expect(testCase.operation(api)).rejects.toThrow("TODOS_RESPONSE_INVALID");
      await servers.pop()!.stop(true);
    }
  });

  it("keeps caller cancellation active through a stalled response body for every core route", async () => {
    let requests = 0;
    const endpoint = serve(() => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const api = createIncidentOutboxHttpApi({ baseUrl: endpoint.baseUrl, apiKey: "test-sentinel-key" });
    const operations = [
      (options: IncidentOutboxPublisherCallOptions) => api.status(options),
      (options: IncidentOutboxPublisherCallOptions) => api.claim({ limit: 1, lease_seconds: 60 }, options),
      (options: IncidentOutboxPublisherCallOptions) => api.ack(fixture.event_id, { lease_token: "lease-http", delivery_id: "42" }, options),
      (options: IncidentOutboxPublisherCallOptions) => api.fail(fixture.event_id, {
        lease_token: "lease-http",
        failure_code: "CONV_HTTP_503",
        failure: "Projection delivery failed: CONV_HTTP_503",
      }, options),
    ];
    for (const operation of operations) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20);
      const started = Date.now();
      await expect(operation({ signal: controller.signal })).rejects.toThrow("TODOS_TIMEOUT");
      clearTimeout(timer);
      expect(controller.signal.aborted).toBe(true);
      expect(Date.now() - started).toBeLessThan(500);
    }
    expect(requests).toBe(4);
  });

  it("does not follow redirects or forward the Todos key", async () => {
    let targetRequests = 0;
    const target = serve((request) => {
      targetRequests += 1;
      expect(request.headers.get("x-api-key")).toBeNull();
      return json({});
    });
    const redirect = serve(() => new Response(null, {
      status: 307,
      headers: { location: `${target.baseUrl}/capture` },
    }));
    const api = createIncidentOutboxHttpApi({ baseUrl: redirect.baseUrl, apiKey: "test-sentinel-key" });
    await expect(api.status(liveSignal)).rejects.toThrow("TODOS_HTTP_307");
    expect(targetRequests).toBe(0);
  });

  it("fails closed on wrong content type and oversized bodies", async () => {
    const responses = [
      new Response(JSON.stringify({ status: { pending: 0, leased: 0, acked: 0, dead: 0, total: 0 } }), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      new Response("x".repeat(70_000), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "70000" },
      }),
    ];
    for (const response of responses) {
      const endpoint = serve(() => response.clone());
      const api = createIncidentOutboxHttpApi({ baseUrl: endpoint.baseUrl, apiKey: "test-sentinel-key" });
      await expect(api.status(liveSignal)).rejects.toThrow("TODOS_RESPONSE_INVALID");
      await servers.pop()!.stop(true);
    }
  });
});
