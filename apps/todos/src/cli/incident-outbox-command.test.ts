import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  incidentEventId,
  incidentTransitionId,
  stableIncidentFingerprint,
  type IncidentProjectionEvent,
} from "../incidents/contracts.js";
import { canonicalIncidentJson } from "../incidents/outbox-publisher.js";
import type { IncidentOutboxRecord } from "../incidents/postgres-store.js";
import { localRoutingTestEnv } from "../test/local-routing-env.js";

const fixture = JSON.parse(readFileSync(
  new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
  "utf8",
)) as IncidentProjectionEvent;

const servers: Array<ReturnType<typeof Bun.serve>> = [];
let testRoot = "";

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-incident-outbox-cli-"));
});

afterEach(async () => {
  try {
    while (servers.length) await servers.pop()!.stop(true);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}` };
}

function cliEnv(baseUrl: string): Record<string, string | undefined> {
  const home = join(testRoot, "home");
  const cache = join(testRoot, "cache");
  const events = join(testRoot, "events");
  for (const directory of [home, cache, events]) {
    mkdirSync(directory, { recursive: true });
  }
  return localRoutingTestEnv({
    HOME: home,
    USERPROFILE: home,
    TMPDIR: testRoot,
    TMP: testRoot,
    TEMP: testRoot,
    XDG_CACHE_HOME: cache,
    BUN_INSTALL_CACHE_DIR: cache,
    HASNA_EVENTS_DIR: events,
    TODOS_DB_PATH: join(testRoot, "todos.db"),
    TODOS_AUTO_PROJECT: "false",
    HASNA_TODOS_STORAGE_MODE: "remote",
    TODOS_STORAGE_MODE: undefined,
    HASNA_TODOS_API_URL: baseUrl,
    HASNA_TODOS_API_KEY: "test-sentinel-key",
  });
}

function outboxRecord(status: "leased" | "acked"): IncidentOutboxRecord {
  return {
    event_id: fixture.event_id,
    projection_key: fixture.projection_key,
    incident_id: fixture.incident_id,
    incident_version: 1,
    depends_on_event_id: null,
    payload: structuredClone(fixture),
    status,
    attempts: 1,
    next_attempt_at: new Date().toISOString(),
    lease_token: status === "leased" ? "lease-cli" : null,
    leased_by: status === "leased" ? "publisher-cli" : null,
    lease_expires_at: status === "leased" ? new Date(Date.now() + 120_000).toISOString() : null,
    delivery_id: status === "acked" ? "42" : null,
    acked_at: status === "acked" ? new Date().toISOString() : null,
    last_error: null,
    failure_code: null,
    failure_fingerprint: null,
    consecutive_failures: 0,
    created_at: fixture.occurred_at,
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

function correlateRecord(
  source: IncidentOutboxRecord,
  event: IncidentProjectionEvent,
): IncidentOutboxRecord {
  return {
    ...source,
    event_id: event.event_id,
    projection_key: event.projection_key,
    incident_id: event.incident_id,
    incident_version: event.incident_version,
    payload: structuredClone(event),
    created_at: event.occurred_at,
  };
}

function failedOutboxRecord(
  event: IncidentProjectionEvent = fixture,
  failureCode = "CONV_HTTP_503",
): IncidentOutboxRecord {
  return correlateRecord({
    ...outboxRecord("acked"),
    status: "pending",
    delivery_id: null,
    acked_at: null,
    last_error: `Projection delivery failed: ${failureCode}`,
    failure_code: failureCode,
    failure_fingerprint: stableIncidentFingerprint({ failure_code: failureCode }),
    consecutive_failures: 1,
  }, event);
}

function deadOutboxRecord(event: IncidentProjectionEvent = fixture): IncidentOutboxRecord {
  return { ...failedOutboxRecord(event), status: "dead", attempts: 3, consecutive_failures: 3 };
}

function requeuedOutboxRecord(event: IncidentProjectionEvent = fixture): IncidentOutboxRecord {
  return {
    ...failedOutboxRecord(event),
    attempts: 0,
    last_error: null,
    failure_code: null,
    failure_fingerprint: null,
    consecutive_failures: 0,
  };
}

function projection(replayed: boolean) {
  return {
    id: 7,
    event_id: fixture.event_id,
    projection_key: fixture.projection_key,
    message_id: 42,
    schema_version: 1,
    source: "todos",
    tenant_id: "tenant-cli",
    authority_id: fixture.authority_id,
    incident_id: fixture.incident_id,
    transition_id: fixture.transition_id,
    incident_version: 1,
    occurred_at: fixture.occurred_at,
    status: fixture.incident.status,
    severity: fixture.incident.severity,
    blocking: true,
    supersedes_transition_id: null,
    supersedes_incident_id: null,
    superseded_by_incident_id: null,
    canonical_payload: canonicalIncidentJson(fixture),
    payload_hash: stableIncidentFingerprint(fixture),
    created_at: fixture.occurred_at,
    message: { id: 42 },
    replayed,
  };
}

async function runCli(args: string[], env: Record<string, string | undefined>) {
  const processHandle = Bun.spawn([process.execPath, "--no-env-file", "run", "src/cli/index.tsx", "--json", ...args], {
    cwd: new URL("../..", import.meta.url).pathname,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("incidents outbox-publish CLI", () => {
  it("dry-runs status only without resolving or sending projector credentials", async () => {
    const requests: string[] = [];
    const todos = serve((request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return new Response(JSON.stringify({
        status: { pending: 2, leased: 0, acked: 4, dead: 1, total: 7 },
      }), { headers: { "content-type": "application/json" } });
    });
    const result = await runCli([
      "incidents", "outbox-publish", "--dry-run", "--timeout-ms", "100",
    ], cliEnv(todos.baseUrl));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      outcome: "status",
      status: { pending: 2, leased: 0, acked: 4, dead: 1, total: 7 },
    });
    expect(result.stderr).toBe("");
    expect(requests).toEqual(["GET /v1/incidents/outbox/status"]);
  });

  it("returns zero for no work without calling the projector", async () => {
    const todos = serve(() => new Response(JSON.stringify({ outbox: [], count: 0 }), {
      headers: { "content-type": "application/json" },
    }));
    let projectorRequests = 0;
    const projector = serve(() => {
      projectorRequests += 1;
      return new Response(null, { status: 500 });
    });
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
    env.HASNA_CONVERSATIONS_API_KEY = "projector-test-sentinel";
    const result = await runCli(["incidents", "outbox-publish", "--limit", "1", "--timeout-ms", "100"], env);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      outcome: "complete",
      claimed: 0,
      acked: 0,
      failed: 0,
      events: [],
    });
    expect(projectorRequests).toBe(0);
  });

  it("returns zero only after a claimed event is exactly projected and ACKed", async () => {
    let claimCalls = 0;
    const todos = serve((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        claimCalls += 1;
        return new Response(JSON.stringify(claimCalls === 1
          ? { outbox: [outboxRecord("leased")], count: 1 }
          : { outbox: [], count: 0 }), { headers: { "content-type": "application/json" } });
      }
      if (path.endsWith("/ack")) {
        return new Response(JSON.stringify({ outbox: outboxRecord("acked") }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    const projector = serve(() => new Response(JSON.stringify({ projection: projection(false) }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
    env.HASNA_CONVERSATIONS_API_KEY = "projector-test-sentinel";
    const result = await runCli(["incidents", "outbox-publish", "--limit", "2", "--timeout-ms", "100"], env);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, outcome: "complete", claimed: 1, acked: 1, failed: 0 });
    expect(claimCalls).toBe(2);
  });

  it("rejects valid ACK records correlated to the wrong event or delivery identity", async () => {
    const alternate = otherEvent();
    for (const wrongAck of [
      correlateRecord(outboxRecord("acked"), alternate),
      { ...outboxRecord("acked"), delivery_id: "43" },
    ]) {
      const todos = serve((request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/claim")) {
          return new Response(JSON.stringify({ outbox: [outboxRecord("leased")], count: 1 }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (path.endsWith("/ack")) {
          return new Response(JSON.stringify({ outbox: wrongAck }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });
      let projectorCalls = 0;
      const projector = serve(() => {
        projectorCalls += 1;
        const replayed = projectorCalls > 1;
        return new Response(JSON.stringify({ projection: projection(replayed) }), {
          status: replayed ? 200 : 201,
          headers: { "content-type": "application/json" },
        });
      });
      const env = cliEnv(todos.baseUrl);
      env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
      env.HASNA_CONVERSATIONS_API_KEY = "projector-test-sentinel";
      const result = await runCli(["incidents", "outbox-publish", "--limit", "1", "--timeout-ms", "100"], env);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        outcome: "ack_pending",
        claimed: 1,
        acked: 0,
        failed: 0,
      });
      expect(projectorCalls).toBe(2);
      await servers.pop()!.stop(true);
      await servers.pop()!.stop(true);
    }
  });

  it("rejects a valid fail record correlated to a different submitted failure class", async () => {
    const todos = serve((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        return new Response(JSON.stringify({ outbox: [outboxRecord("leased")], count: 1 }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (path.endsWith("/fail")) {
        return new Response(JSON.stringify({ outbox: failedOutboxRecord(fixture, "CONV_HTTP_502") }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    const projector = serve(() => new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }));
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
    env.HASNA_CONVERSATIONS_API_KEY = "projector-test-sentinel";
    const result = await runCli(["incidents", "outbox-publish", "--limit", "1", "--timeout-ms", "100"], env);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      outcome: "fail_pending",
      claimed: 1,
      acked: 0,
      failed: 0,
      events: [{ event_id: fixture.event_id, status: "fail_pending", failure_code: "CONV_HTTP_503" }],
    });
  });

  it("rejects valid dead inspection and requeue records for a different requested event", async () => {
    const alternate = otherEvent();
    for (const [args, response] of [
      [["incidents", "outbox-show", fixture.event_id], deadOutboxRecord(alternate)],
      [[
        "incidents", "outbox-requeue", fixture.event_id,
        "--expected-attempts", "3",
        "--key", "cli-requeue-correlation-0001",
        "--reason", "Prove exact event response correlation",
      ], requeuedOutboxRecord(alternate)],
    ] as const) {
      const todos = serve(() => new Response(JSON.stringify({ outbox: response }), {
        headers: { "content-type": "application/json" },
      }));
      const result = await runCli([...args], cliEnv(todos.baseUrl));
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("TODOS_RESPONSE_INVALID");
      expect(result.stdout).not.toContain(alternate.event_id);
      await servers.pop()!.stop(true);
    }
  });

  it("exits nonzero with a redacted structured result for a malformed claim envelope", async () => {
    const todos = serve(() => new Response(JSON.stringify({ internal: "raw-body-marker" }), {
      headers: { "content-type": "application/json" },
    }));
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = "http://127.0.0.1:1";
    env.HASNA_CONVERSATIONS_API_KEY = "projector-sensitive-marker";
    const result = await runCli([
      "incidents", "outbox-publish", "--limit", "1", "--lease-seconds", "60", "--timeout-ms", "100",
    ], env);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      outcome: "claim_failed",
      claimed: 0,
      acked: 0,
      failed: 0,
      events: [],
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain("projector-sensitive-marker");
    expect(`${result.stdout}${result.stderr}`).not.toContain("raw-body-marker");
  });

  it("terminates nonzero when Todos sends headers and stalls the status body", async () => {
    const todos = serve(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":'));
      },
    }), { headers: { "content-type": "application/json" } }));
    const started = Date.now();
    const result = await runCli([
      "incidents", "outbox-publish", "--dry-run", "--timeout-ms", "20",
    ], cliEnv(todos.baseUrl));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, outcome: "status_failed" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns nonzero and redacted when projector delivery remains ambiguous", async () => {
    const todos = serve(() => new Response(JSON.stringify({ outbox: [outboxRecord("leased")], count: 1 }), {
      headers: { "content-type": "application/json" },
    }));
    const projector = serve(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"projection":'));
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
    env.HASNA_CONVERSATIONS_API_KEY = "projector-sensitive-marker";
    const result = await runCli(["incidents", "outbox-publish", "--limit", "1", "--timeout-ms", "20"], env);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, outcome: "delivery_pending", claimed: 1, acked: 0 });
    expect(`${result.stdout}${result.stderr}`).not.toContain("projector-sensitive-marker");
  });

  it("returns nonzero and redacted when both idempotent ACK attempts remain uncertain", async () => {
    let projectorCalls = 0;
    const todos = serve((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        return new Response(JSON.stringify({ outbox: [outboxRecord("leased")], count: 1 }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (path.endsWith("/ack")) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('{"outbox":')); },
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const projector = serve(() => {
      projectorCalls += 1;
      const replayed = projectorCalls > 1;
      return new Response(JSON.stringify({ projection: projection(replayed) }), {
        status: replayed ? 200 : 201,
        headers: { "content-type": "application/json" },
      });
    });
    const env = cliEnv(todos.baseUrl);
    env.HASNA_CONVERSATIONS_API_URL = projector.baseUrl;
    env.HASNA_CONVERSATIONS_API_KEY = "projector-sensitive-marker";
    const result = await runCli(["incidents", "outbox-publish", "--limit", "1", "--timeout-ms", "20"], env);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, outcome: "ack_pending", claimed: 1, acked: 0 });
    expect(projectorCalls).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("projector-sensitive-marker");
  });

  it("advertises only the explicit one-shot operator surface", async () => {
    const todos = serve(() => new Response(null, { status: 500 }));
    const result = await runCli(["incidents", "outbox-publish", "--help"], cliEnv(todos.baseUrl));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("one bounded incident projection outbox publisher invocation");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).not.toContain("--daemon");
    expect(result.stdout).not.toContain("--background");
    expect(result.stdout).not.toContain("--schedule");
  });
});
