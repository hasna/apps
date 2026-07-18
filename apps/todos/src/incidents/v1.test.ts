import { beforeEach, describe, expect, test } from "bun:test";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import {
  applyIncidentTransition,
  buildIncidentProjectionEvent,
  createInitialIncident,
  normalizeIncidentCreateInput,
  type IncidentState,
  type IncidentTransition,
} from "./contracts.js";
import type {
  IncidentAuthorityContext,
  IncidentListFilter,
  IncidentOutboxRecord,
  IncidentOutboxRequeueInput,
  TodosIncidentStore,
} from "./postgres-store.js";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-18T20:00:00.000Z";

class MemoryIncidentStore implements TodosIncidentStore {
  readonly incidents = new Map<string, IncidentState>();
  readonly history = new Map<string, IncidentTransition[]>();
  readonly deadOutbox = new Map<string, IncidentOutboxRecord>();
  requeueCall: { eventId: string; input: IncidentOutboxRequeueInput; authority: IncidentAuthorityContext } | null = null;
  failCall: { eventId: string; leaseToken: string; failureCode: string; failure: string } | null = null;

  private key(authorityId: string, id: string): string {
    return `${authorityId}:${id}`;
  }

  async create(input: Parameters<TodosIncidentStore["create"]>[0], authority: IncidentAuthorityContext) {
    const applied = createInitialIncident(
      input,
      authority.authorityId,
      authority.actorId,
      NOW,
      authority.actorKeyId,
      authority.effectiveActorId,
      authority.actorActAs,
    );
    this.incidents.set(this.key(authority.authorityId, input.id), applied.incident);
    this.history.set(this.key(authority.authorityId, input.id), [applied.transition]);
    return {
      incident: applied.incident,
      transitions: [applied.transition],
      events: [buildIncidentProjectionEvent(authority.authorityId, applied.transition)],
      replayed: false,
    };
  }

  async get(id: string, authorityId: string) {
    return this.incidents.get(this.key(authorityId, id)) ?? null;
  }

  async list(filter: IncidentListFilter, authorityId: string) {
    return [...this.incidents.entries()]
      .filter(([key]) => key.startsWith(`${authorityId}:`))
      .map(([, incident]) => incident)
      .filter((incident) => !filter.status || incident.status === filter.status)
      .filter((incident) => !filter.activeOnly || !["resolved", "superseded"].includes(incident.status));
  }

  async listActiveBlockers(filter: Pick<IncidentListFilter, "scope" | "severity" | "owner" | "limit" | "before">, authorityId: string) {
    return (await this.list({ activeOnly: true }, authorityId))
      .filter((incident) => incident.blocked_scopes.length > 0)
      .filter((incident) => !filter.scope || incident.blocked_scopes.includes(filter.scope));
  }

  async transition(id: string, input: Parameters<TodosIncidentStore["transition"]>[1], authority: IncidentAuthorityContext) {
    const key = this.key(authority.authorityId, id);
    const current = this.incidents.get(key);
    if (!current) throw new Error(`missing fixture incident ${id}`);
    const applied = applyIncidentTransition(
      current,
      input,
      authority.actorId,
      NOW,
      authority.authorityId,
      authority.actorKeyId,
      authority.effectiveActorId,
      authority.actorActAs,
    );
    this.incidents.set(key, applied.incident);
    this.history.set(key, [...(this.history.get(key) ?? []), applied.transition]);
    return {
      incident: applied.incident,
      transitions: [applied.transition],
      events: [buildIncidentProjectionEvent(authority.authorityId, applied.transition)],
      replayed: false,
    };
  }

  async listTransitions(id: string, authorityId: string) {
    return this.history.get(this.key(authorityId, id)) ?? [];
  }

  async getDeadOutbox(eventId: string, authorityId: string) {
    return this.deadOutbox.get(this.key(authorityId, eventId)) ?? null;
  }

  async listDeadOutbox(_options: Parameters<TodosIncidentStore["listDeadOutbox"]>[0], authorityId: string) {
    return [...this.deadOutbox.entries()]
      .filter(([key]) => key.startsWith(`${authorityId}:`))
      .map(([, record]) => record);
  }

  async getOutboxStatus(authorityId: string) {
    const dead = (await this.listDeadOutbox({}, authorityId)).length;
    return { pending: 0, leased: 0, acked: 0, dead, total: dead };
  }

  async claimOutbox() { return []; }
  async ackOutbox(): Promise<IncidentOutboxRecord> { throw new Error("unused"); }
  async failOutbox(eventId: string, leaseToken: string, failureCode: string, failure: string): Promise<IncidentOutboxRecord> {
    this.failCall = { eventId, leaseToken, failureCode, failure };
    return { event_id: eventId } as IncidentOutboxRecord;
  }
  async requeueOutbox(eventId: string, input: IncidentOutboxRequeueInput, authority: IncidentAuthorityContext): Promise<IncidentOutboxRecord> {
    this.requeueCall = { eventId, input, authority };
    return { event_id: eventId } as IncidentOutboxRecord;
  }
}

let principal: { agent: string | null; scopes: string[]; kid?: string };
let authorityId: string;
let incidentStore: MemoryIncidentStore;
let unrelatedTaskMutations: number;
let lastRequiredScopes: readonly string[];
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

function createBody(extra: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    idempotency_key: "incident-create-api-0001",
    title: "Todos coordination outage",
    severity: "high",
    owner: "platform-todos",
    affected_scopes: ["todos", "station01"],
    blocked_scopes: ["channel:incidents"],
    containment: "Remote writes held",
    next_action: "Verify stable authority",
    ...extra,
  };
}

function deadOutboxRecord(): IncidentOutboxRecord {
  const input = createInitialIncident(
    normalizeIncidentCreateInput(createBody()),
    "engineering",
    "agent-a",
    NOW,
  );
  const payload = buildIncidentProjectionEvent("engineering", input.transition);
  return {
    event_id: payload.event_id,
    projection_key: payload.projection_key,
    incident_id: payload.incident_id,
    incident_version: payload.incident_version,
    depends_on_event_id: null,
    payload,
    status: "dead",
    attempts: 3,
    next_attempt_at: NOW,
    lease_token: null,
    leased_by: null,
    lease_expires_at: null,
    delivery_id: null,
    acked_at: null,
    last_error: "projector unavailable",
    failure_code: "PROJECTOR_UNAVAILABLE",
    failure_fingerprint: "fingerprint-fixture",
    consecutive_failures: 3,
    created_at: NOW,
    updated_at: NOW,
  };
}

beforeEach(() => {
  principal = { agent: "agent-a", scopes: ["todos:*"], kid: "key-a" };
  authorityId = "engineering";
  incidentStore = new MemoryIncidentStore();
  unrelatedTaskMutations = 0;
  lastRequiredScopes = [];
  const genericStore = {
    tasks: { create: async () => { unrelatedTaskMutations += 1; } },
    audit: { logActivity: async () => {} },
  } as unknown as TodosStorageAdapter;
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => genericStore,
    getIncidentStore: () => incidentStore,
    getIncidentAuthorityId: () => authorityId,
    getVerifier: () => ({
      authenticate: async (_headers: Headers, options: { requiredScopes?: readonly string[] }) => {
        lastRequiredScopes = options.requiredScopes ?? [];
        return { ok: true, principal };
      },
    }) as unknown as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
});

describe("/v1 canonical incidents", () => {
  test("fails closed without a stable server-owned authority", async () => {
    dependencies.getIncidentAuthorityId = () => { throw new Error("HASNA_TODOS_AUTHORITY_ID is required"); };
    const response = await request("/v1/incidents");
    expect(response?.status).toBe(503);
    expect(await response!.json()).toEqual({ error: "HASNA_TODOS_AUTHORITY_ID is required" });
  });

  test("rejects caller provenance and never turns incident creation into task or agent dispatch", async () => {
    expect((await request("/v1/incidents", "POST", createBody({ actor_id: "spoofed" })))?.status).toBe(400);
    expect((await request("/v1/incidents", "POST", createBody({ agent_id: "spawn-me" })))?.status).toBe(400);
    const created = await request("/v1/incidents", "POST", createBody());
    expect(created?.status).toBe(201);
    expect(unrelatedTaskMutations).toBe(0);
    expect(incidentStore.incidents.size).toBe(1);
  });

  test("keeps one authority across key rotation while preserving authenticated transition provenance", async () => {
    expect((await request("/v1/incidents", "POST", createBody()))?.status).toBe(201);
    principal = { agent: "agent-b", scopes: ["todos:*"], kid: "key-b" };
    expect((await request(`/v1/incidents/${INCIDENT_ID}`))?.status).toBe(200);
    const changed = await request(`/v1/incidents/${INCIDENT_ID}/transitions`, "POST", {
      expected_version: 1,
      idempotency_key: "test-api-a",
      reason: "Containment verified",
      status: "contained",
      containment: "Remote writes held",
      next_action: "Monitor",
    });
    expect(changed?.status).toBe(200);
    const body = await changed!.json() as { result: { transitions: IncidentTransition[] } };
    expect(body.result.transitions[0]).toMatchObject({ authority_id: "engineering", actor_id: "agent-b", actor_key_id: "key-b" });

    authorityId = "other-authority";
    expect((await request(`/v1/incidents/${INCIDENT_ID}`))?.status).toBe(404);
  });

  test("derives blockers only from canonical nonterminal rows and exposes no hard delete", async () => {
    await request("/v1/incidents", "POST", createBody());
    const blocked = await request("/v1/incidents/blockers?scope=channel%3Aincidents");
    expect(await blocked!.json()).toMatchObject({ count: 1, active_statuses: ["open", "investigating", "contained", "monitoring"] });
    expect(await (await request("/v1/incidents/blockers?scope=station01"))!.json()).toMatchObject({ count: 0 });
    expect((await request("/v1/incidents?conversation_ack=true"))?.status).toBe(400);
    expect((await request(`/v1/incidents/${INCIDENT_ID}`, "DELETE"))?.status).toBe(405);
    expect(await incidentStore.get(INCIDENT_ID, "engineering")).not.toBeNull();
  });

  test("records the authenticated administrator, not an act-as header, as immutable incident actor", async () => {
    principal = { agent: "admin-agent", scopes: ["todos:*"], kid: "admin-key" };
    const response = await request("/v1/incidents", "POST", createBody(), { "x-todos-act-as": "effective-agent" });
    expect(response?.status).toBe(201);
    const body = await response!.json() as { result: { transitions: IncidentTransition[] } };
    expect(body.result.transitions[0]).toMatchObject({
      actor_id: "admin-agent",
      effective_actor_id: "effective-agent",
      actor_key_id: "admin-key",
      actor_act_as: true,
    });

    principal = { agent: "writer", scopes: ["todos:write"], kid: "writer-key" };
    expect((await request("/v1/incidents", "POST", createBody({ idempotency_key: "incident-create-api-0002" }), {
      "x-todos-act-as": "other-agent",
    }))?.status).toBe(403);
  });

  test("requests dedicated projector and recovery scopes for outbox operations", async () => {
    expect((await request("/v1/incidents/outbox/claim", "POST", {}))?.status).toBe(200);
    expect(lastRequiredScopes).toEqual(["todos:incidents:project"]);

    expect((await request("/v1/incidents/outbox/event-1/requeue", "POST", {
      expected_attempts: 12,
      idempotency_key: "incident-requeue-api-0001",
      reason: "Destination recovered",
    }))?.status).toBe(200);
    expect(lastRequiredScopes).toEqual(["todos:incidents:recover"]);
    expect(incidentStore.requeueCall).toMatchObject({
      eventId: "event-1",
      authority: { authorityId: "engineering", actorId: "agent-a", effectiveActorId: "agent-a", actorActAs: false },
    });
  });

  test("returns typed 400s for malformed claim, ack, fail, and recovery inputs", async () => {
    const cases: Array<[string, unknown]> = [
      ["/v1/incidents/outbox/claim", { limit: 0 }],
      ["/v1/incidents/outbox/claim", { lease_seconds: null }],
      ["/v1/incidents/outbox/event-1/ack", { lease_token: "", delivery_id: "delivery" }],
      ["/v1/incidents/outbox/event-1/ack", { lease_token: "lease", delivery_id: "" }],
      ["/v1/incidents/outbox/event-1/fail", { lease_token: "lease", failure_code: "PROJECTOR_HTTP_503", failure: "" }],
      ["/v1/incidents/outbox/event-1/fail", { lease_token: "lease", failure_code: "dynamic value", failure: "failed" }],
      ["/v1/incidents/outbox/event-1/requeue", {
        expected_attempts: 0, idempotency_key: "incident-requeue-api-0002", reason: "Recovered",
      }],
      ["/v1/incidents/outbox/event-1/requeue", {
        expected_attempts: 3, idempotency_key: "short", reason: "Recovered",
      }],
      ["/v1/incidents/outbox/event-1/requeue", {
        expected_attempts: 3, idempotency_key: "incident-requeue-api-0002", reason: "",
      }],
    ];
    for (const [path, body] of cases) {
      const response = await request(path, "POST", body);
      expect(response?.status).toBe(400);
      expect(await response!.json()).toMatchObject({ code: "INCIDENT_VALIDATION_ERROR" });
    }
    expect(incidentStore.requeueCall).toBeNull();
    expect(incidentStore.failCall).toBeNull();
  });

  test("redacts projector failures before durable storage", async () => {
    const response = await request("/v1/incidents/outbox/event-1/fail", "POST", {
      lease_token: "lease-1",
      failure_code: "PROJECTOR_HTTP_503",
      failure: "upstream rejected Authorization: Bearer fixture_super_secret_value_12345",
    });
    expect(response?.status).toBe(200);
    expect(incidentStore.failCall).toEqual({
      eventId: "event-1",
      leaseToken: "lease-1",
      failureCode: "PROJECTOR_HTTP_503",
      failure: "upstream rejected Authorization: Bearer [REDACTED]",
    });
  });

  test("exposes authority-scoped dead-event inspection without lease credentials", async () => {
    const record = deadOutboxRecord();
    incidentStore.deadOutbox.set(`engineering:${record.event_id}`, record);

    const listed = await request("/v1/incidents/outbox?limit=10");
    expect(listed?.status).toBe(200);
    expect(lastRequiredScopes).toEqual(["todos:incidents:recover"]);
    expect(await listed!.json()).toEqual({ outbox: [record], count: 1 });

    const status = await request("/v1/incidents/outbox/status");
    expect(status?.status).toBe(200);
    expect(await status!.json()).toEqual({ status: { pending: 0, leased: 0, acked: 0, dead: 1, total: 1 } });

    const exact = await request(`/v1/incidents/outbox/${encodeURIComponent(record.event_id)}`);
    expect(exact?.status).toBe(200);
    expect(await exact!.json()).toEqual({ outbox: record });
    expect(record).toMatchObject({
      status: "dead",
      lease_token: null,
      leased_by: null,
      lease_expires_at: null,
      failure_code: "PROJECTOR_UNAVAILABLE",
      failure_fingerprint: "fingerprint-fixture",
      consecutive_failures: 3,
    });

    expect((await request("/v1/incidents/outbox?limit=0"))?.status).toBe(400);
    expect((await request("/v1/incidents/outbox/missing"))?.status).toBe(404);
  });
});
