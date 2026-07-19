import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import {
  normalizeIncidentCreateInput,
  stableIncidentFingerprint,
} from "./contracts.js";
import {
  canonicalIncidentJson,
  createIncidentOutboxHttpApi,
  inspectIncidentOutboxPublisher,
  publishIncidentOutboxOnce,
  type IncidentOutboxPublisherCallOptions,
} from "./outbox-publisher.js";
import {
  createPostgresIncidentStore,
  postgresIncidentSchemaSql,
  type IncidentMutationResult,
} from "./postgres-store.js";
import { createTodosCloudQueryClient } from "../storage/cloud-client.js";
import { handleV1Request } from "../server/v1.js";

const DATABASE_URL = validatedTemporaryDatabaseUrl(process.env.TODOS_INCIDENT_PUBLISHER_TEST_DATABASE_URL);
const CONVERSATIONS_DIR = validatedConversationsDir(process.env.TODOS_INCIDENT_CONVERSATIONS_CONTRACT_DIR);
const AUTHORITY_ID = "todos.hasna.xyz:v1";
const INCIDENT_A = "11111111-1111-4111-8111-111111111111";
const INCIDENT_B = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT = "33333333-3333-4333-8333-333333333333";
const INCIDENT_C = "44444444-4444-4444-8444-444444444444";

function validatedTemporaryDatabaseUrl(value: string | undefined): string {
  if (!value) return "";
  if (process.env.TODOS_INCIDENT_PUBLISHER_TEST_ALLOW_TEMP_DATABASE !== "1") {
    throw new Error("Incident publisher PostgreSQL verification requires its explicit temporary-database gate");
  }
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    url.protocol !== "postgresql:"
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.port !== "5432"
    || url.password
    || url.search
    || url.hash
    || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(decodeURIComponent(url.username))
    || !/^todos_incident_e00050_[0-9]+_[0-9]+$/.test(database)
  ) throw new Error("Incident publisher verification accepts only its passwordless task-owned local PostgreSQL database");
  return value;
}

function validatedConversationsDir(value: string | undefined): string {
  if (!value) return "";
  if (!value.startsWith("/") || value.includes("\0")) throw new Error("Conversations contract path must be absolute");
  return value;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function stalledJson(status: number): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"response":"intentionally-lost"'));
    },
  }), { status, headers: { "content-type": "application/json" } });
}

async function boundedApiCall<T>(operation: (options: IncidentOutboxPublisherCallOptions) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    return await operation({ signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

describe.skipIf(!DATABASE_URL || !CONVERSATIONS_DIR)("incident publisher real dual-HTTP PostgreSQL gate", () => {
  it("proves concurrency, ordered replay, ACK ambiguity, causal handoff, dead-letter recovery, and exact cleanup ownership", async () => {
    const databaseName = new URL(DATABASE_URL).pathname.slice(1);
    const databaseUser = decodeURIComponent(new URL(DATABASE_URL).username);
    const requireFromConversations = createRequire(join(CONVERSATIONS_DIR, "package.json"));
    const { Pool } = requireFromConversations("pg") as { Pool: new (options: Record<string, unknown>) => any };
    const queryModule = await import(pathToFileURL(join(CONVERSATIONS_DIR, "src/generated/storage-kit/query.ts")).href);
    const migrationsModule = await import(pathToFileURL(join(CONVERSATIONS_DIR, "src/lib/pg-migrations.ts")).href);
    const conversationsApiModule = await import(pathToFileURL(join(CONVERSATIONS_DIR, "src/server/api.ts")).href);

    const todosClient = createTodosCloudQueryClient(DATABASE_URL, { max: 12 });
    const conversationsPool = new Pool({
      host: "/var/run/postgresql",
      port: 5432,
      database: databaseName,
      user: databaseUser,
      max: 12,
    });
    const conversationsClient = queryModule.createQueryClient(conversationsPool);
    const servers: Array<{ stop(closeActiveConnections?: boolean): void | Promise<void> }> = [];
    let clock = Date.now();
    const now = () => new Date(clock).toISOString();
    const todosStore = createPostgresIncidentStore(todosClient, { now });

    try {
      expect((await todosClient.query<{ timezone: string }>(
        "SELECT current_setting('TimeZone') AS timezone",
      )).rows[0]?.timezone).toBe("Europe/Bucharest");
      expect((await conversationsClient.get(
        "SELECT current_setting('TimeZone') AS timezone",
      ))?.timezone).toBe("Europe/Bucharest");
      for (const migration of migrationsModule.PG_MIGRATIONS as string[]) await conversationsClient.execute(migration);
      for (const statement of postgresIncidentSchemaSql()) await todosClient.query(statement);

      const signingSecret = randomBytes(48).toString("hex");
      const conversationsKeys = new ApiKeyStore(conversationsClient);
      const conversationsVerifier = verifyApiKey({
        app: "conversations",
        signingSecret,
        isRevoked: async () => false,
      });
      const conversationsServer = conversationsApiModule.startApiServer({
        host: "127.0.0.1",
        port: 0,
        deps: {
          client: conversationsClient,
          keys: conversationsKeys,
          verifier: conversationsVerifier,
          incidentProjector: {
            tenant_id: "tenant-e00050",
            authority_id: AUTHORITY_ID,
            routing: { channel: "incidents" },
          },
        },
      });
      servers.push(conversationsServer);
      const conversationsBase = `http://127.0.0.1:${conversationsServer.port}`;
      const projectorKey = mintApiKey({
        app: "conversations",
        agent: "todos-projector-e00050",
        scopes: ["conversations:incident-project"],
        signingSecret,
      }).token;

      const todosVerifier = verifyApiKey({
        app: "todos",
        signingSecret,
        isRevoked: async () => false,
      });
      const todosProjectKey = mintApiKey({
        app: "todos",
        agent: "incident-publisher-e00050",
        scopes: ["todos:incident-project"],
        signingSecret,
      }).token;
      const todosRecoveryKey = mintApiKey({
        app: "todos",
        agent: "incident-recovery-e00050",
        scopes: ["todos:incident-recover"],
        signingSecret,
      }).token;
      const todosReadKey = mintApiKey({
        app: "todos",
        agent: "incident-read-e00050",
        scopes: ["todos:read"],
        signingSecret,
      }).token;
      const todosUnrelatedKey = mintApiKey({
        app: "todos",
        agent: "incident-write-e00050",
        scopes: ["todos:write"],
        signingSecret,
      }).token;
      const todosWildcardKey = mintApiKey({
        app: "todos",
        agent: "incident-admin-e00050",
        scopes: ["todos:*"],
        signingSecret,
      }).token;
      const todosServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const response = await handleV1Request(request, new URL(request.url), {
            getVerifier: () => todosVerifier,
            ensureSchema: async () => undefined,
            getStorageAdapter: () => ({ audit: {} }) as never,
            getIncidentStore: () => todosStore,
            getIncidentAuthorityId: () => AUTHORITY_ID,
          });
          return response ?? json({ error: "not found" }, 404);
        },
      });
      servers.push(todosServer);
      const todosBase = `http://127.0.0.1:${todosServer.port}`;

      const todosRequest = (path: string, apiKey: string, init: RequestInit = {}) => fetch(`${todosBase}${path}`, {
        ...init,
        headers: {
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
          "x-api-key": apiKey,
        },
      });
      expect((await todosRequest("/v1/incidents/outbox/status", todosWildcardKey)).status).toBe(200);
      expect((await todosRequest("/v1/incidents/outbox", todosWildcardKey)).status).toBe(200);
      expect((await todosRequest("/v1/incidents/outbox/claim", todosWildcardKey, {
        method: "POST",
        body: JSON.stringify({ limit: 1, lease_seconds: 10 }),
      })).status).toBe(200);

      const forcedProjectorFailures = new Set<string>();
      const projectorAttempts = new Map<string, number>();
      const projectorBodies = new Map<string, string>();
      let lostProjectionEvent: string | null = null;
      const projectorProxy = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const body = await request.text();
          const event = JSON.parse(body) as { event_id: string };
          projectorAttempts.set(event.event_id, (projectorAttempts.get(event.event_id) ?? 0) + 1);
          projectorBodies.set(event.event_id, body);
          if (forcedProjectorFailures.has(event.event_id)) return json({ error: "synthetic unavailable" }, 503);
          if (lostProjectionEvent === null) lostProjectionEvent = event.event_id;
          const upstream = await fetch(`${conversationsBase}/v1/incident-projections`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": request.headers.get("x-api-key") ?? "",
            },
            body,
          });
          const responseBody = await upstream.text();
          if (event.event_id === lostProjectionEvent && projectorAttempts.get(event.event_id) === 1) {
            return stalledJson(upstream.status);
          }
          return new Response(responseBody, {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
          });
        },
      });
      servers.push(projectorProxy);

      const ackAttempts = new Map<string, Array<string>>();
      let lostAckEvent: string | null = null;
      const todosProxy = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url);
          const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
          const upstream = await fetch(`${todosBase}${url.pathname}${url.search}`, {
            method: request.method,
            headers: {
              "accept": "application/json",
              "x-api-key": request.headers.get("x-api-key") ?? "",
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body }),
          });
          const responseBody = await upstream.text();
          const ackMatch = /\/incidents\/outbox\/(iev_[0-9a-f]{32})\/ack$/.exec(url.pathname);
          if (ackMatch && body) {
            const deliveryId = String((JSON.parse(body) as { delivery_id: string }).delivery_id);
            const attempts = ackAttempts.get(ackMatch[1]!) ?? [];
            attempts.push(deliveryId);
            ackAttempts.set(ackMatch[1]!, attempts);
            if (lostAckEvent === null) lostAckEvent = ackMatch[1]!;
            if (ackMatch[1] === lostAckEvent && attempts.length === 1) return stalledJson(upstream.status);
          }
          return new Response(responseBody, {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
          });
        },
      });
      servers.push(todosProxy);

      const outbox = createIncidentOutboxHttpApi({
        baseUrl: `http://127.0.0.1:${todosProxy.port}`,
        apiKey: todosProjectKey,
      });
      const recoveryOutbox = createIncidentOutboxHttpApi({
        baseUrl: `http://127.0.0.1:${todosProxy.port}`,
        apiKey: todosRecoveryKey,
      });
      const publish = (limit = 1) => publishIncidentOutboxOnce({
        outbox,
        projectorBaseUrl: `http://127.0.0.1:${projectorProxy.port}`,
        projectorApiKey: projectorKey,
        limit,
        leaseSeconds: 10,
        requestTimeoutMs: 250,
      });
      const actor = { authorityId: AUTHORITY_ID, actorId: "incident-publisher-e00050", actorKeyId: "key-e00050" };

      const createA = await todosStore.create(normalizeIncidentCreateInput({
        id: INCIDENT_A,
        idempotency_key: "e00050-create-a-v1",
        title: "Concurrent incident A",
        severity: "high",
        owner: "publisher-e00050",
        affected_scopes: ["service:todos"],
        blocked_scopes: ["channel:incidents"],
        next_action: "Project version one",
      }), actor);
      clock += 1_000;
      const transitionResponse = await todosRequest(
        `/v1/incidents/${INCIDENT_A}/transitions`,
        todosWildcardKey,
        {
          method: "POST",
          body: JSON.stringify({
            expected_version: 1,
            idempotency_key: "test-a-test-a-test-a",
            reason: "Containment proved",
            status: "contained",
            containment: "One-shot publisher remains bounded",
            next_action: "Project version two after version one",
          }),
        },
      );
      expect(transitionResponse.status).toBe(200);
      const transitionA = ((await transitionResponse.json()) as { result: IncidentMutationResult }).result;
      const rawCreatedAt = (await todosClient.query<{ created_at: string }>(
        `SELECT to_jsonb(created_at) #>> '{}' AS created_at
         FROM todos_incidents WHERE authority_id = $1 AND incident_id = $2`,
        [AUTHORITY_ID, INCIDENT_A],
      )).rows[0]?.created_at;
      expect(rawCreatedAt).toMatch(/\+03:00$/);
      expect((await todosStore.get(INCIDENT_A, AUTHORITY_ID))?.created_at).toBe(createA.incident.created_at);
      expect(typeof transitionA.events[0]!.occurred_at).toBe("string");
      expect(transitionA.events[0]!.occurred_at).toMatch(/Z$/);
      expect(transitionA.events[0]!.incident.created_at).toBe(createA.incident.created_at);
      expect(typeof transitionA.events[0]!.incident.updated_at).toBe("string");
      expect(transitionA.events[0]!.incident.updated_at).toMatch(/Z$/);
      expect(transitionA.transitions[0]!.before?.created_at).toBe(createA.incident.created_at);
      expect(transitionA.transitions[0]!.after.updated_at).toBe(transitionA.events[0]!.occurred_at);
      const transitionAEventSnapshot = canonicalIncidentJson(transitionA.events[0]!);
      clock += 1_000;
      const createB = await todosStore.create(normalizeIncidentCreateInput({
        id: INCIDENT_B,
        idempotency_key: "e00050-create-b-v1",
        title: "Concurrent incident B",
        severity: "medium",
        owner: "publisher-e00050",
        affected_scopes: ["service:conversations"],
        blocked_scopes: ["agent:publisher-e00050"],
        next_action: "Project independently",
      }), actor);

      const concurrent = await Promise.all([publish(1), publish(1)]);
      expect(concurrent.map(({ ok, outcome, claimed, acked, failed, events }) => ({ ok, outcome, claimed, acked, failed, events }))).toEqual([
        { ok: true, outcome: "complete", claimed: 1, acked: 1, failed: 0, events: expect.any(Array) },
        { ok: true, outcome: "complete", claimed: 1, acked: 1, failed: 0, events: expect.any(Array) },
      ]);
      expect(new Set(concurrent.flatMap((result) => result.events.map((event) => event.event_id)))).toEqual(new Set([
        createA.events[0]!.event_id,
        createB.events[0]!.event_id,
      ]));
      expect(lostProjectionEvent).not.toBeNull();
      expect(lostAckEvent).not.toBeNull();
      expect(projectorAttempts.get(lostProjectionEvent!)).toBe(2);
      expect(ackAttempts.get(lostAckEvent!)).toEqual([
        ackAttempts.get(lostAckEvent!)![0],
        ackAttempts.get(lostAckEvent!)![0],
      ]);

      const versionTwo = await publish(1);
      expect(versionTwo.events[0]?.event_id).toBe(transitionA.events[0]!.event_id);
      expect(versionTwo.ok).toBe(true);
      expect(canonicalIncidentJson(transitionA.events[0]!)).toBe(transitionAEventSnapshot);
      expect(typeof transitionA.events[0]!.occurred_at).toBe("string");
      expect(typeof transitionA.events[0]!.incident.updated_at).toBe("string");
      const versionTwoBody = projectorBodies.get(transitionA.events[0]!.event_id);
      expect(versionTwoBody).toBeDefined();
      const canonicalVersionTwo = canonicalIncidentJson(JSON.parse(versionTwoBody!));
      expect(await conversationsClient.get(
        `SELECT canonical_payload, payload_hash
         FROM incident_projections WHERE event_id = $1`,
        [transitionA.events[0]!.event_id],
      )).toEqual({
        canonical_payload: canonicalVersionTwo,
        payload_hash: stableIncidentFingerprint(JSON.parse(versionTwoBody!)),
      });

      clock += 1_000;
      const replacement = await todosStore.create(normalizeIncidentCreateInput({
        id: REPLACEMENT,
        idempotency_key: "test-b-test-b-test-b",
        title: "Causal replacement",
        severity: "medium",
        owner: "publisher-e00050",
        affected_scopes: ["service:todos"],
        blocked_scopes: ["project:wks_8vJJzXTiFo6sxwRkpPqoI"],
        next_action: "Project only after reciprocal supersession",
        supersedes_id: INCIDENT_A,
        supersedes_expected_version: 2,
      }), actor);
      const causal = await publish(2);
      expect(causal.ok).toBe(true);
      expect(causal.events.map((event) => event.event_id)).toEqual(replacement.events.map((event) => event.event_id));

      clock += 1_000;
      const createC = await todosStore.create(normalizeIncidentCreateInput({
        id: INCIDENT_C,
        idempotency_key: "e00050-create-c-v1",
        title: "Dead-letter recovery incident",
        severity: "low",
        owner: "publisher-e00050",
        affected_scopes: ["service:todos"],
        blocked_scopes: [],
        next_action: "Prove stable failure recovery",
      }), actor);
      const failedEventId = createC.events[0]!.event_id;
      forcedProjectorFailures.add(failedEventId);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const failed = await publish(1);
        expect(failed).toMatchObject({ ok: false, outcome: "failed", claimed: 1, acked: 0, failed: 1 });
        clock += 3_600_000;
      }
      const dead = await boundedApiCall((options) => recoveryOutbox.getDead(failedEventId, options));
      expect(dead).toMatchObject({
        status: "dead",
        attempts: 3,
        failure_code: "CONV_HTTP_503",
        consecutive_failures: 3,
      });
      const deadList = await boundedApiCall((options) => recoveryOutbox.listDead({ limit: 10 }, options));
      expect(deadList.map((event) => event.event_id)).toEqual([failedEventId]);
      const requeued = await boundedApiCall((options) => recoveryOutbox.requeue(failedEventId, {
        expected_attempts: 3,
        idempotency_key: "e00050-requeue-c-v1",
        reason: "Synthetic projector failure removed after exact review",
      }, options));
      expect(requeued).toMatchObject({ status: "pending", attempts: 0, consecutive_failures: 0, failure_code: null });
      forcedProjectorFailures.delete(failedEventId);
      const recovered = await publish(1);
      expect(recovered).toMatchObject({ ok: true, claimed: 1, acked: 1, failed: 0 });

      const status = await inspectIncidentOutboxPublisher({ outbox, requestTimeoutMs: 500 });
      expect(status).toEqual({
        ok: true,
        outcome: "status",
        status: { pending: 0, leased: 0, acked: 6, dead: 0, total: 6 },
      });
      const projectionCounts = await conversationsClient.get(`SELECT
        COUNT(*)::int AS projections,
        COUNT(DISTINCT event_id)::int AS distinct_events,
        COUNT(DISTINCT message_id)::int AS distinct_messages
        FROM incident_projections`);
      expect(projectionCounts).toEqual({ projections: 6, distinct_events: 6, distinct_messages: 6 });
      expect((await conversationsClient.get("SELECT COUNT(*)::int AS count FROM messages"))?.count).toBe(6);
      expect((await todosClient.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM todos_incident_outbox_recoveries",
      )).rows[0]?.count).toBe(1);

      const projectorReadDenied = await fetch(`${conversationsBase}/v1/incident-projections/${createA.events[0]!.event_id}`, {
        headers: { "x-api-key": projectorKey },
      });
      expect(projectorReadDenied.status).toBe(403);
      const genericTodosReadDenied = await fetch(`${todosBase}/v1/tasks`, {
        headers: { "x-api-key": todosProjectKey },
      });
      expect(genericTodosReadDenied.status).toBe(403);

      expect((await todosRequest("/v1/incidents/outbox", todosProjectKey)).status).toBe(403);
      expect((await todosRequest(`/v1/incidents/outbox/${failedEventId}/requeue`, todosProjectKey, {
        method: "POST",
        body: JSON.stringify({
          expected_attempts: 3,
          idempotency_key: "e00050-project-denied",
          reason: "Project key must not recover",
        }),
      })).status).toBe(403);
      expect((await todosRequest("/v1/incidents/outbox/status", todosRecoveryKey)).status).toBe(403);
      expect((await todosRequest("/v1/incidents/outbox/claim", todosRecoveryKey, {
        method: "POST",
        body: JSON.stringify({ limit: 1, lease_seconds: 10 }),
      })).status).toBe(403);
      for (const action of ["ack", "fail"] as const) {
        expect((await todosRequest(`/v1/incidents/outbox/${failedEventId}/${action}`, todosRecoveryKey, {
          method: "POST",
          body: JSON.stringify(action === "ack"
            ? { lease_token: "denied", delivery_id: "denied" }
            : { lease_token: "denied", failure_code: "DENIED", failure: "denied" }),
        })).status).toBe(403);
      }
      for (const insufficientKey of [todosReadKey, todosUnrelatedKey]) {
        expect((await todosRequest("/v1/incidents/outbox/status", insufficientKey)).status).toBe(403);
        expect((await todosRequest("/v1/incidents/outbox", insufficientKey)).status).toBe(403);
      }

      const todoRows = await todosClient.query<{ event_id: string; delivery_id: string }>(
        "SELECT event_id, delivery_id FROM todos_incident_projection_outbox WHERE status='acked' ORDER BY event_id",
      );
      expect(todoRows.rows).toHaveLength(6);
      expect(new Set(todoRows.rows.map((row) => row.delivery_id)).size).toBe(6);

      const sharedFixture = readFileSync(join(CONVERSATIONS_DIR, "fixtures/todos-incident-projection-v1.json"), "utf8");
      expect(JSON.parse(sharedFixture)).toEqual(JSON.parse(readFileSync(
        new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
        "utf8",
      )));
    } finally {
      while (servers.length) await servers.pop()!.stop(true);
      await Promise.allSettled([todosClient.close(), conversationsClient.close()]);
    }
  }, 60_000);
});
