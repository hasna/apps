import { describe, expect, it } from "bun:test";
import type { TodosPostgresQueryClient, TodosPostgresQueryResult } from "../storage/postgres-sync.js";
import { applyIncidentTransition, buildIncidentProjectionEvent, createInitialIncident, normalizeIncidentCreateInput, normalizeIncidentTransitionInput, stableIncidentFingerprint, supersedeIncident, type IncidentState } from "./contracts.js";
import {
  IncidentIdempotencyConflictError,
  IncidentLeaseConflictError,
  IncidentVersionConflictError,
  createPostgresIncidentStore,
  postgresIncidentRollbackSql,
  postgresIncidentSchemaSql,
} from "./postgres-store.js";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const OLD_INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-18T20:00:00.000Z";
const OFFSET_NOW = "2026-07-18T23:00:00.000+03:00";
const NEXT = "2026-07-18T20:00:01.000Z";
const OFFSET_NEXT = "2026-07-18T23:00:01.000+03:00";

interface ScriptItem {
  marker: string;
  rows?: unknown[];
  error?: Error;
}

class ScriptedClient implements TodosPostgresQueryClient {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  constructor(private readonly script: ScriptItem[]) {}

  async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<TodosPostgresQueryResult<T>> {
    this.calls.push({ sql, values });
    const item = this.script.shift();
    if (!item) throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    expect(sql).toContain(item.marker);
    if (item.error) throw item.error;
    return { rows: (item.rows ?? []) as T[] };
  }
}

function createInput() {
  return normalizeIncidentCreateInput({
    id: INCIDENT_ID,
    idempotency_key: "incident-create-0001",
    title: "Todos coordination outage",
    severity: "high",
    owner: "platform-todos",
    affected_scopes: ["todos", "station01"],
    blocked_scopes: ["channel:incidents"],
    containment: "Remote writes held",
    next_action: "Verify authority",
  });
}

function createdEnvelope() {
  const applied = createInitialIncident(createInput(), "engineering", "actor", NOW, "key-a");
  const event = buildIncidentProjectionEvent("engineering", applied.transition);
  return { incident: applied.incident, transitions: [applied.transition], events: [event] };
}

function outboxRecord(overrides: Record<string, unknown> = {}) {
  const event = createdEnvelope().events[0]!;
  return {
    event_id: event.event_id,
    projection_key: event.projection_key,
    incident_id: event.incident_id,
    incident_version: event.incident_version,
    depends_on_event_id: null,
    payload: event,
    status: "leased",
    attempts: 1,
    next_attempt_at: NOW,
    lease_token: "lease-1",
    leased_by: "projector",
    lease_expires_at: "2026-07-18T20:01:00.000Z",
    delivery_id: null,
    acked_at: null,
    last_error: null,
    failure_code: null,
    failure_fingerprint: null,
    consecutive_failures: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("Postgres incident schema", () => {
  it("defines authority-composite state, immutable history, ordered durable outbox, and reversible DDL", () => {
    const sql = postgresIncidentSchemaSql().join("\n");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS todos_incidents");
    expect(sql).toContain("PRIMARY KEY (service, authority_id, incident_id)");
    expect(sql).toContain("UNIQUE (service, authority_id, idempotency_key)");
    expect(sql).toContain("CHECK (status IN ('open','investigating','contained','monitoring','resolved','superseded'))");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS todos_incident_transitions");
    expect(sql).toContain("todos_incident_transition_immutable");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS todos_incident_projection_outbox");
    expect(sql).toContain("UNIQUE (service, authority_id, incident_id, incident_version)");
    expect(sql).toContain("payload jsonb NOT NULL");
    expect(sql).toContain("depends_on_event_id text");
    expect(sql).toContain("failure_code text");
    expect(sql).toContain("failure_fingerprint text");
    expect(sql).toContain("consecutive_failures integer NOT NULL DEFAULT 0");
    expect(sql).toContain("effective_actor_id text NOT NULL");
    expect(sql).toContain("actor_act_as boolean NOT NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS todos_incident_outbox_recoveries");
    expect(sql).toContain("incident outbox recovery history is immutable");

    expect(postgresIncidentRollbackSql()).toEqual([
      "DROP TABLE IF EXISTS todos_incident_outbox_recoveries",
      "DROP TABLE IF EXISTS todos_incident_projection_outbox",
      "DROP TABLE IF EXISTS todos_incident_transitions",
      "DROP TABLE IF EXISTS todos_incidents",
      "DROP FUNCTION IF EXISTS todos_incident_transition_immutable()",
      "DROP FUNCTION IF EXISTS todos_incident_outbox_recoveries_immutable()",
    ]);
  });
});

describe("Postgres incident atomic commands", () => {
  it("creates state, transition, and outbox in one atomic mutation statement", async () => {
    const envelope = createdEnvelope();
    const client = new ScriptedClient([
      { marker: "todos:incident-create-replay", rows: [] },
      { marker: "todos:incident-create-atomic", rows: [{ result: envelope }] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW });
    const result = await store.create(createInput(), { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" });
    expect(result).toEqual({ ...envelope, replayed: false });
    const mutation = client.calls[1]!;
    expect(mutation.sql).toContain("WITH replacement AS");
    expect(mutation.sql).toContain("INSERT INTO todos_incidents");
    expect(mutation.sql).toContain("INSERT INTO todos_incident_transitions");
    expect(mutation.sql).toContain("INSERT INTO todos_incident_projection_outbox");
    expect(mutation.sql).toContain("supersedes_expected_version");
    expect(mutation.sql).toContain("actor_id, effective_actor_id, actor_key_id, actor_act_as");
    expect(mutation.sql).toContain("depends_on_event_id");
    expect(mutation.sql).toContain("CASE WHEN $9::text IS NULL THEN NULL ELSE $13::jsonb->>'event_id' END");
    expect(mutation.values).toContain("engineering");
  });

  it("atomically records reciprocal supersession and makes replacement projection depend on the old event", async () => {
    const oldInput = normalizeIncidentCreateInput({ ...createInput(), id: OLD_INCIDENT_ID, idempotency_key: "incident-old-create-0001" });
    const old = createInitialIncident(oldInput, "engineering", "actor", NOW, "key-a").incident;
    const replacementInput = normalizeIncidentCreateInput({
      ...createInput(),
      supersedes_id: OLD_INCIDENT_ID,
      supersedes_expected_version: 1,
    });
    const created = createInitialIncident(replacementInput, "engineering", "actor", NOW, "key-a");
    const superseded = supersedeIncident(
      old,
      INCIDENT_ID,
      1,
      "engineering",
      "actor",
      NOW,
      replacementInput.idempotency_key,
      "key-a",
    );
    const oldEvent = buildIncidentProjectionEvent("engineering", superseded.transition);
    const newEvent = buildIncidentProjectionEvent("engineering", created.transition);
    const envelope = {
      incident: created.incident,
      transitions: [superseded.transition, created.transition],
      events: [oldEvent, newEvent],
    };
    const client = new ScriptedClient([
      { marker: "todos:incident-create-replay", rows: [] },
      { marker: "todos:incident-get", rows: [{ incident: old }] },
      { marker: "todos:incident-create-atomic", rows: [{ result: envelope }] },
    ]);
    const result = await createPostgresIncidentStore(client, { now: () => NOW }).create(
      replacementInput,
      { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" },
    );
    expect(result.incident.supersedes_id).toBe(OLD_INCIDENT_ID);
    expect(result.events[0]!.incident.superseded_by_id).toBe(INCIDENT_ID);
    expect(result.events[0]!.incident.blocked_scopes).toEqual(old.blocked_scopes);
    expect(result.events[1]!.incident.supersedes_id).toBe(OLD_INCIDENT_ID);
    const mutation = client.calls[2]!;
    expect(mutation.sql).toContain("CASE WHEN $9::text IS NULL THEN NULL ELSE $13::jsonb->>'event_id' END");
    expect(mutation.values[12]).toMatchObject({ event_id: oldEvent.event_id, incident_id: OLD_INCIDENT_ID });
    expect(mutation.values[6]).toMatchObject({ event_id: newEvent.event_id, incident_id: INCIDENT_ID });
  });

  it("returns exact idempotent replay but rejects key reuse with a different fingerprint", async () => {
    const envelope = createdEnvelope();
    const fingerprint = stableIncidentFingerprint(createInput());
    const replayClient = new ScriptedClient([
      { marker: "todos:incident-create-replay", rows: [{ request_fingerprint: fingerprint, result: envelope }] },
    ]);
    const replay = await createPostgresIncidentStore(replayClient, { now: () => NOW }).create(
      createInput(),
      { authorityId: "engineering", actorId: "rotated-key-actor", actorKeyId: "key-b" },
    );
    expect(replay.replayed).toBe(true);
    expect(replayClient.calls).toHaveLength(1);

    const conflictClient = new ScriptedClient([
      { marker: "todos:incident-create-replay", rows: [{ request_fingerprint: "different", result: envelope }] },
    ]);
    await expect(createPostgresIncidentStore(conflictClient).create(
      createInput(),
      { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" },
    )).rejects.toBeInstanceOf(IncidentIdempotencyConflictError);
  });

  it("recognizes Bun.SQL's errno SQLSTATE and replays the concurrent winner", async () => {
    const envelope = createdEnvelope();
    const client = new ScriptedClient([
      { marker: "todos:incident-create-replay", rows: [] },
      {
        marker: "todos:incident-create-atomic",
        error: Object.assign(new Error("duplicate key"), {
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "23505",
        }),
      },
      {
        marker: "todos:incident-create-replay",
        rows: [{ request_fingerprint: stableIncidentFingerprint(createInput()), result: envelope }],
      },
    ]);

    const result = await createPostgresIncidentStore(client, { now: () => NOW }).create(
      createInput(),
      { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" },
    );
    expect(result).toEqual({ ...envelope, replayed: true });
  });

  it("re-reads a concurrent identical transition after a zero-row CAS before declaring a version conflict", async () => {
    const current = createdEnvelope().incident;
    const input = normalizeIncidentTransitionInput({
      expected_version: 1,
      idempotency_key: "test-race-a",
      reason: "Containment verified",
      status: "contained",
      containment: "Remote writes held",
      next_action: "Monitor",
    });
    const applied = applyIncidentTransition(current, input, "actor", NOW, "engineering", "key-a");
    const event = buildIncidentProjectionEvent("engineering", applied.transition);
    const envelope = { incident: applied.incident, transitions: [applied.transition], events: [event] };
    const fingerprint = stableIncidentFingerprint({
      incident_id: INCIDENT_ID,
      expected_version: input.expected_version,
      idempotency_key: input.idempotency_key,
      reason: input.reason,
      patch: input.patch,
    });
    const client = new ScriptedClient([
      { marker: "todos:incident-transition-replay", rows: [] },
      { marker: "todos:incident-get", rows: [{ incident: current }] },
      { marker: "todos:incident-transition-atomic", rows: [] },
      { marker: "todos:incident-transition-replay", rows: [{ request_fingerprint: fingerprint, result: envelope }] },
    ]);
    const result = await createPostgresIncidentStore(client, { now: () => NOW }).transition(
      INCIDENT_ID,
      input,
      { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" },
    );
    expect(result).toEqual({ ...envelope, replayed: true });
  });

  it("classifies a zero-row CAS as a real version conflict only when no idempotent winner exists", async () => {
    const current = createdEnvelope().incident;
    const input = normalizeIncidentTransitionInput({
      expected_version: 1,
      idempotency_key: "test-race-b",
      reason: "Containment verified",
      owner: "next-owner",
    });
    const latest = { ...current, owner: "other-owner", version: 2 };
    const client = new ScriptedClient([
      { marker: "todos:incident-transition-replay", rows: [] },
      { marker: "todos:incident-get", rows: [{ incident: current }] },
      { marker: "todos:incident-transition-atomic", rows: [] },
      { marker: "todos:incident-transition-replay", rows: [] },
      { marker: "todos:incident-get", rows: [{ incident: latest }] },
    ]);
    await expect(createPostgresIncidentStore(client, { now: () => NOW }).transition(
      INCIDENT_ID,
      input,
      { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" },
    )).rejects.toBeInstanceOf(IncidentVersionConflictError);
  });

  it("canonicalizes offset-bearing PostgreSQL timestamps before building transitions and returning outbox records", async () => {
    const canonicalCurrent = {
      ...createdEnvelope().incident,
      deadline: "2026-07-19T00:00:00.000Z",
    };
    const offsetCurrent = {
      ...canonicalCurrent,
      deadline: "2026-07-19T03:00:00.000+03:00",
      created_at: OFFSET_NOW,
      updated_at: OFFSET_NOW,
    };
    const input = normalizeIncidentTransitionInput({
      expected_version: 1,
      idempotency_key: "test-offset-transition-v2",
      reason: "Decode PostgreSQL timestamps before hashing",
      status: "contained",
      containment: "Canonical UTC representation restored",
      next_action: "Project the exact v2 payload",
    });
    const applied = applyIncidentTransition(canonicalCurrent, input, "actor", NEXT, "engineering", "key-a");
    const event = buildIncidentProjectionEvent("engineering", applied.transition);
    const envelope = { incident: applied.incident, transitions: [applied.transition], events: [event] };
    const rawOutbox = {
      event_id: event.event_id,
      projection_key: event.projection_key,
      incident_id: event.incident_id,
      incident_version: event.incident_version,
      depends_on_event_id: null,
      payload: {
        ...event,
        occurred_at: OFFSET_NEXT,
        incident: {
          ...event.incident,
          deadline: "2026-07-19T03:00:00.000+03:00",
          created_at: OFFSET_NOW,
          updated_at: OFFSET_NEXT,
        },
      },
      status: "leased",
      attempts: 1,
      next_attempt_at: OFFSET_NEXT,
      lease_token: "lease-offset",
      leased_by: "projector",
      lease_expires_at: "2026-07-18T23:01:01.000+03:00",
      delivery_id: null,
      acked_at: null,
      last_error: null,
      failure_code: null,
      failure_fingerprint: null,
      consecutive_failures: 0,
      created_at: OFFSET_NEXT,
      updated_at: OFFSET_NEXT,
    };
    const client = new ScriptedClient([
      { marker: "todos:incident-transition-replay", rows: [] },
      { marker: "todos:incident-get", rows: [{ incident: offsetCurrent }] },
      { marker: "todos:incident-transition-atomic", rows: [{ result: envelope }] },
      { marker: "todos:incident-outbox-claim", rows: [{ outbox: rawOutbox }] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NEXT, leaseToken: () => "lease-offset" });
    const authority = { authorityId: "engineering", actorId: "actor", actorKeyId: "key-a" };

    const result = await store.transition(INCIDENT_ID, input, authority);
    expect(result).toEqual({ ...envelope, replayed: false });
    const mutation = client.calls[2]!;
    expect(mutation.values[4]).toMatchObject({
      deadline: "2026-07-19T00:00:00.000Z",
      created_at: NOW,
      updated_at: NEXT,
    });
    expect(mutation.values[5]).toMatchObject({
      created_at: NEXT,
      before: { created_at: NOW, updated_at: NOW },
      after: { created_at: NOW, updated_at: NEXT },
    });
    expect(mutation.values[6]).toMatchObject({
      occurred_at: NEXT,
      incident: { created_at: NOW, updated_at: NEXT },
    });

    const [claimed] = await store.claimOutbox(authority, { limit: 1, leaseSeconds: 60 });
    expect(claimed).toMatchObject({
      next_attempt_at: NEXT,
      lease_expires_at: "2026-07-18T20:01:01.000Z",
      acked_at: null,
      created_at: NEXT,
      updated_at: NEXT,
      payload: {
        occurred_at: NEXT,
        incident: {
          deadline: "2026-07-19T00:00:00.000Z",
          resolved_at: null,
          created_at: NOW,
          updated_at: NEXT,
        },
      },
    });
  });

  it("rejects malformed PostgreSQL timestamps instead of silently canonicalizing them", async () => {
    const malformed = { ...createdEnvelope().incident, created_at: "2026-02-30T00:00:00.000Z" };
    const store = createPostgresIncidentStore(new ScriptedClient([
      { marker: "todos:incident-get", rows: [{ incident: malformed }] },
    ]));
    await expect(store.get(INCIDENT_ID, "engineering")).rejects.toThrow("Invalid incident created_at timestamp");
  });

  it("uses authority-scoped canonical rows for reads and active blocker queries", async () => {
    const incident = createdEnvelope().incident;
    const client = new ScriptedClient([
      { marker: "todos:incident-get", rows: [{ incident }] },
      { marker: "todos:incident-active-blockers", rows: [{ incident }] },
    ]);
    const store = createPostgresIncidentStore(client);
    expect(await store.get(INCIDENT_ID, "engineering")).toEqual(incident);
    expect(await store.listActiveBlockers({ scope: "channel:incidents" }, "engineering")).toEqual([incident]);
    for (const call of client.calls) {
      expect(call.sql).toContain("authority_id = $2");
      expect(call.values).toContain("engineering");
      expect(call.sql.toLowerCase()).not.toContain("conversation");
      expect(call.sql.match(/\bFROM todos_incidents\b/g)?.length).toBe(1);
    }
    expect(client.calls[1]!.sql).toContain("status NOT IN ('resolved','superseded')");
    expect(client.calls[1]!.sql).toContain("jsonb_array_length(blocked_scopes) > 0");
    expect(client.calls[1]!.sql).toContain("blocked_scopes ?");
    expect(client.calls[1]!.sql).not.toContain("affected_scopes ?");
  });

  it("serializes outbox claims per incident and acks only the exact lease", async () => {
    const event = buildIncidentProjectionEvent("engineering", createdEnvelope().transitions[0]!);
    const record = {
      event_id: event.event_id,
      projection_key: event.projection_key,
      incident_id: event.incident_id,
      incident_version: event.incident_version,
      depends_on_event_id: null,
      payload: event,
      status: "leased",
      attempts: 1,
      next_attempt_at: NOW,
      lease_token: "lease-1",
      leased_by: "projector",
      lease_expires_at: "2026-07-18T20:01:00.000Z",
      delivery_id: null,
      acked_at: null,
      last_error: null,
      failure_code: null,
      failure_fingerprint: null,
      consecutive_failures: 0,
      created_at: NOW,
      updated_at: NOW,
    };
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-claim", rows: [{ outbox: record }] },
      { marker: "todos:incident-outbox-ack", rows: [] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW, leaseToken: () => "lease-1" });
    expect(await store.claimOutbox({ authorityId: "engineering", actorId: "projector", actorKeyId: "key-a" })).toEqual([record]);
    expect(client.calls[0]!.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(client.calls[0]!.sql).toContain("WITH expired AS");
    expect(client.calls[0]!.sql).toContain("expired.consecutive_failures + 1");
    expect(client.calls[0]!.sql).toContain("candidate.consecutive_failures < $11");
    expect(client.calls[0]!.values).toContain("LEASE_EXPIRED_NO_ACK");
    expect(client.calls[0]!.values).toContain(3);
    expect(client.calls[0]!.sql).toContain("older.incident_version < candidate.incident_version");
    expect(client.calls[0]!.sql).toContain("dependency.event_id = candidate.depends_on_event_id AND dependency.status = 'acked'");
    await expect(store.ackOutbox(event.event_id, "wrong-lease", "message-1", {
      authorityId: "engineering", actorId: "projector", actorKeyId: "key-a",
    })).rejects.toBeInstanceOf(IncidentLeaseConflictError);
  });

  it("replays the exact ACK delivery idempotently and rejects a changed delivery identity", async () => {
    const leased = outboxRecord();
    const acked = outboxRecord({
      status: "acked",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      delivery_id: "42",
      acked_at: NOW,
    });
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-ack", rows: [{ outbox: acked }] },
      { marker: "todos:incident-outbox-ack", rows: [{ outbox: acked }] },
      { marker: "todos:incident-outbox-ack", rows: [] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW });
    const authority = { authorityId: "engineering", actorId: "projector", actorKeyId: "key-a" };
    expect(await store.ackOutbox(leased.event_id, "lease-1", "42", authority)).toEqual(acked);
    expect(await store.ackOutbox(leased.event_id, "lease-1", "42", authority)).toEqual(acked);
    await expect(store.ackOutbox(leased.event_id, "lease-1", "43", authority))
      .rejects.toBeInstanceOf(IncidentLeaseConflictError);
    expect(client.calls[0]!.sql).toContain("status = 'acked' AND delivery_id = $6");
    expect(client.calls[1]!.values[5]).toBe("42");
    expect(client.calls[2]!.values[5]).toBe("43");
  });

  it("dead-letters the third unchanged failure class without persisting credential-bearing runtime details", async () => {
    const fingerprint = stableIncidentFingerprint({ failure_code: "CONV_HTTP_503" });
    const first = outboxRecord({
      status: "pending",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      last_error: "request req-1 at 20:00 Bearer [REDACTED]",
      failure_code: "CONV_HTTP_503",
      failure_fingerprint: fingerprint,
      consecutive_failures: 1,
    });
    const third = { ...first, status: "dead", attempts: 3, last_error: "request req-3 at 20:02", consecutive_failures: 3 };
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-fail", rows: [{ outbox: first }] },
      { marker: "todos:incident-outbox-fail", rows: [{ outbox: third }] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW, maxConsecutiveFailures: 3 });
    const authority = { authorityId: "todos.hasna.xyz:v1", actorId: "projector", actorKeyId: "key-a" };

    expect((await store.failOutbox(
      first.event_id,
      "lease-1",
      "CONV_HTTP_503",
      [
        "request req-1 at 20:00",
        "postgresql://alice:uri-marker@127.0.0.1/db",
        "Authorization: Bearer auth-marker",
        "x-api-key: key-marker",
        '{"password":"pw-marker","token":"tok-marker","api_key":"key-marker"}',
      ].join("\n"),
      authority,
    )).status).toBe("pending");
    expect((await store.failOutbox(
      first.event_id,
      "lease-3",
      "CONV_HTTP_503",
      "request req-3 at 20:02\npassword: pw-marker",
      authority,
    )).status).toBe("dead");
    expect(client.calls[0]!.values[6]).toBe("Projection delivery failed: CONV_HTTP_503");
    expect(client.calls[1]!.values[6]).toBe("Projection delivery failed: CONV_HTTP_503");
    for (const marker of ["uri-marker", "auth-marker", "key-marker", "pw-marker", "tok-marker"]) {
      expect(JSON.stringify(client.calls.map((call) => call.values[6]))).not.toContain(marker);
    }
    expect(client.calls[0]!.values[8]).toBe(fingerprint);
    expect(client.calls[1]!.values[8]).toBe(fingerprint);
    expect(client.calls[0]!.sql).toContain("consecutive_failures + 1");
  });

  it("resets consecutive failure counting when the stable failure class changes", async () => {
    const first = outboxRecord({
      status: "pending",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      failure_code: "CONV_HTTP_503",
      failure_fingerprint: stableIncidentFingerprint({ failure_code: "CONV_HTTP_503" }),
      consecutive_failures: 2,
    });
    const changed = {
      ...first,
      failure_code: "CONV_HTTP_409_INCIDENT_PROJECTION_CONFLICT",
      failure_fingerprint: stableIncidentFingerprint({ failure_code: "CONV_HTTP_409_INCIDENT_PROJECTION_CONFLICT" }),
      consecutive_failures: 1,
    };
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-fail", rows: [{ outbox: changed }] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW });
    const result = await store.failOutbox(
      first.event_id,
      "lease-next",
      changed.failure_code,
      "typed conflict",
      { authorityId: "todos.hasna.xyz:v1", actorId: "projector", actorKeyId: "key-a" },
    );
    expect(result.consecutive_failures).toBe(1);
    expect(client.calls[0]!.values[8]).not.toBe(first.failure_fingerprint);
  });

  it("lists and gets only authority-scoped dead events and returns outbox status counts", async () => {
    const dead = outboxRecord({
      status: "dead",
      attempts: 3,
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      failure_code: "CONV_HTTP_503",
      failure_fingerprint: stableIncidentFingerprint({ failure_code: "CONV_HTTP_503" }),
      consecutive_failures: 3,
    });
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-dead-list", rows: [{ outbox: dead }] },
      { marker: "todos:incident-outbox-dead-get", rows: [{ outbox: dead }] },
      { marker: "todos:incident-outbox-status", rows: [
        { status: "pending", count: 2 }, { status: "acked", count: "5" }, { status: "dead", count: 1 },
      ] },
    ]);
    const store = createPostgresIncidentStore(client);
    expect(await store.listDeadOutbox({ limit: 10 }, "todos.hasna.xyz:v1")).toEqual([dead]);
    expect(await store.getDeadOutbox(dead.event_id, "todos.hasna.xyz:v1")).toEqual(dead);
    expect(await store.getOutboxStatus("todos.hasna.xyz:v1")).toEqual({ pending: 2, leased: 0, acked: 5, dead: 1, total: 8 });
    expect(client.calls[0]!.sql).toContain("record.status = 'dead'");
    expect(client.calls[1]!.sql).toContain("record.status = 'dead'");
    expect(client.calls.every((call) => call.values.includes("todos.hasna.xyz:v1"))).toBe(true);
  });

  it("audits an exact dead event requeue before the ordered claim and ack chain can resume", async () => {
    const event = buildIncidentProjectionEvent("engineering", createdEnvelope().transitions[0]!);
    const base = {
      event_id: event.event_id,
      projection_key: event.projection_key,
      incident_id: event.incident_id,
      incident_version: event.incident_version,
      depends_on_event_id: null,
      payload: event,
      next_attempt_at: NOW,
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      delivery_id: null,
      acked_at: null,
      last_error: null,
      failure_code: null,
      failure_fingerprint: null,
      consecutive_failures: 0,
      created_at: NOW,
      updated_at: NOW,
    };
    const pending = { ...base, status: "pending", attempts: 0 };
    const leased = {
      ...pending,
      status: "leased",
      attempts: 1,
      lease_token: "lease-recovery",
      leased_by: "operator",
      lease_expires_at: "2026-07-18T20:01:00.000Z",
    };
    const acked = {
      ...leased,
      status: "acked",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      delivery_id: "message-recovery",
      acked_at: NOW,
    };
    const client = new ScriptedClient([
      { marker: "todos:incident-outbox-requeue-replay", rows: [] },
      { marker: "todos:incident-outbox-requeue-atomic", rows: [{ outbox: pending }] },
      { marker: "todos:incident-outbox-claim", rows: [{ outbox: leased }] },
      { marker: "todos:incident-outbox-ack", rows: [{ outbox: acked }] },
    ]);
    const store = createPostgresIncidentStore(client, { now: () => NOW, leaseToken: () => "lease-recovery" });
    const authority = { authorityId: "engineering", actorId: "operator", actorKeyId: "key-operator" };
    expect(await store.requeueOutbox(event.event_id, {
      expectedAttempts: 12,
      idempotencyKey: "incident-requeue-0001",
      reason: "Projection destination recovered",
    }, authority)).toEqual(pending);
    expect(client.calls[1]!.sql).toContain("status = 'dead'");
    expect(client.calls[1]!.sql).toContain("INSERT INTO todos_incident_outbox_recoveries");
    expect(await store.claimOutbox(authority)).toEqual([leased]);
    expect(await store.ackOutbox(event.event_id, "lease-recovery", "message-recovery", authority)).toEqual(acked);
  });

  it("does not expose a hard-delete operation", () => {
    const store = createPostgresIncidentStore(new ScriptedClient([]));
    expect(store).not.toHaveProperty("delete");
  });
});
