import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../../api/index.js";
import { createSqliteLoopStorage } from "../storage/sqlite.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "../cloud/storage.js";
import { createHasnaHttpTransport } from "../cloud/transport.js";
import { ApiStore, CloudUnsupportedError, getStore, isCloudStore, LocalStore } from "./index.js";
import { Store } from "../store.js";
import type { CreateLoopInput, CreateWorkflowInput } from "../../types.js";

const LOOP_INPUT: CreateLoopInput = {
  name: "store-e2e-loop",
  schedule: { type: "once", at: "2030-01-01T00:00:00Z" },
  target: { type: "command", command: "echo", args: ["hi"] },
};

const WORKFLOW_INPUT: CreateWorkflowInput = {
  name: "store-e2e-workflow",
  steps: [{ id: "s1", target: { type: "command", command: "echo", args: ["step"] } }],
};

/** Wire an ApiStore whose HTTP transport targets a real in-process API server. */
function apiStoreForServer(port: number): ApiStore {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const transport = createHasnaHttpTransport({ name: "loops", baseUrl, apiKey: "local-test-key" });
  return new ApiStore(createHasnaStorageClient("loops", transport), baseUrl);
}

describe("getStore resolver", () => {
  test("returns LocalStore when no API vars are set", () => {
    expect(getStore({})).toBeInstanceOf(LocalStore);
    expect(isCloudStore({})).toBe(false);
  });

  test("returns ApiStore (cloud-http) when both API vars are set", () => {
    const store = getStore({ HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" });
    expect(store).toBeInstanceOf(ApiStore);
    expect(store.transport).toBe("cloud-http");
    expect(isCloudStore({ HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" })).toBe(true);
  });

  test("rejects partial remote configuration instead of opening LocalStore", () => {
    expect(() => getStore({ HASNA_LOOPS_API_URL: "https://loops.example.test" })).toThrow("requires both");
    expect(() => getStore({ HASNA_LOOPS_API_KEY: "k" })).toThrow("requires both");
    expect(() => getStore({ HASNA_LOOPS_STORAGE_MODE: "self_hosted" })).toThrow("requires both");
    expect(() => getStore({ HASNA_LOOPS_STORAGE_MODE: "cloud" })).toThrow("requires both");
  });
});

describe("LocalStore public workflow events", () => {
  test("returns typed contracts, preserves historical custom events, and rejects malformed contracts", async () => {
    const raw = new Store(":memory:");
    const store = new LocalStore(raw);
    try {
      const workflow = raw.createWorkflow({
        name: "public-workflow-event-contract",
        steps: [{
          id: "worker",
          target: { type: "agent", provider: "codewith", prompt: "verify public event typing" },
        }],
      });

      const validRun = raw.createWorkflowRun({ workflow });
      raw.appendWorkflowEvent(validRun.id, "agent_session_contract", "worker", {
        version: 1,
        provider: "codewith",
        permissionMode: "default",
        sandbox: "workspace-write",
        manualBreakGlass: false,
        timeoutMs: null,
        restrictions: { enforcement: "metadata_only", providerEnforced: false },
      });
      const contract = (await store.listWorkflowEvents(validRun.id)).find(
        (event) => event.eventType === "agent_session_contract",
      );
      expect(contract?.eventType).toBe("agent_session_contract");
      if (!contract || "eventKind" in contract || contract.eventType !== "agent_session_contract") {
        throw new Error("public store did not return the typed agent session contract branch");
      }
      expect(contract.payload.provider).toBe("codewith");

      const malformedRun = raw.createWorkflowRun({ workflow });
      raw.appendWorkflowEvent(malformedRun.id, "agent_session_contract", "worker", { version: 1 });
      await expect(store.listWorkflowEvents(malformedRun.id)).rejects.toThrow(
        "invalid agent_session_contract workflow event",
      );

      const mixedRun = raw.createWorkflowRun({ workflow });
      raw.appendWorkflowEvent(mixedRun.id, "legacy_worker_note", "worker", {
        note: "preserve me",
        prompt: "do not expose me",
      });
      const mixed = await store.listWorkflowEvents(mixedRun.id);
      expect(mixed.map((event) => event.eventType)).toEqual(["created", "legacy_worker_note"]);
      expect(mixed[1]).toMatchObject({
        eventType: "legacy_worker_note",
        eventKind: "custom",
        stepId: "worker",
        payload: {
          note: "preserve me",
          prompt: "[redacted 16 chars]",
        },
      });
    } finally {
      await store.close();
    }
  });

  test("recovers workflow steps through the operator endpoint instead of the runner-scoped route", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:*"],
      roles: ["operator" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:*"], iat: 1, exp: null },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1", port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const workflow = await storage.createWorkflow(WORKFLOW_INPUT);
      const run = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(run.id, "s1");
      const store = apiStoreForServer((server as { port: number }).port);

      const recovered = await store.recoverWorkflowRun(run.id, "operator retry");
      expect(recovered.run.id).toBe(run.id);
      expect(recovered.recoveredSteps).toMatchObject([
        { workflowRunId: run.id, stepId: "s1", status: "pending" },
      ]);
      await store.close();
    } finally {
      server.stop?.(true);
      await storage.close();
    }
  });
});

describe("ApiStore end-to-end against the real /v1 server", () => {
  test("lists mixed-version custom workflow events through the API without breaking known events", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:*"],
      roles: ["admin" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:*"], iat: 1, exp: null },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1", port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const workflow = await storage.createWorkflow(WORKFLOW_INPUT);
      const run = await storage.createWorkflowRun({ workflow });
      await storage.appendWorkflowEvent(run.id, "legacy_worker_note", "s1", {
        note: "old producer payload",
        reason: "private operator context",
      });

      const store = apiStoreForServer((server as { port: number }).port);
      const events = await store.listWorkflowEvents(run.id);
      expect(events.map((event) => event.eventType)).toEqual(["created", "legacy_worker_note"]);
      expect(events[1]).toMatchObject({
        eventType: "legacy_worker_note",
        eventKind: "custom",
        stepId: "s1",
        payload: {
          note: "old producer payload",
          reason: "[redacted 24 chars]",
        },
      });
      await store.close();
    } finally {
      server.stop?.(true);
      await storage.close();
    }
  });

  test("loops + workflows + goals + receipts + history route to the hosted API, not local sqlite", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:*"],
      roles: ["admin" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:*"], iat: 1, exp: null },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1", port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const port = (server as { port: number }).port;
      const store = apiStoreForServer(port);

      // Loops CRUD over HTTP.
      const loop = await store.createLoop(LOOP_INPUT);
      expect(loop.name).toBe("store-e2e-loop");
      expect((await store.listLoops()).map((l) => l.id)).toContain(loop.id);
      expect(await store.countLoops()).toBeGreaterThanOrEqual(1);
      const renamed = await store.renameLoop(loop.id, "store-e2e-loop-renamed");
      expect(renamed.name).toBe("store-e2e-loop-renamed");
      expect((await store.requireUniqueLoop("store-e2e-loop-renamed")).id).toBe(loop.id);

      // Workflows — the resource that had NO cloud path before this fix.
      const workflow = await store.createWorkflow(WORKFLOW_INPUT);
      expect(workflow.name).toBe("store-e2e-workflow");
      expect((await store.listWorkflows()).map((w) => w.id)).toContain(workflow.id);
      expect(await store.countWorkflows()).toBeGreaterThanOrEqual(1);
      expect((await store.requireWorkflow(workflow.id)).id).toBe(workflow.id);
      expect((await store.findWorkflowByName("store-e2e-workflow"))?.id).toBe(workflow.id);
      const archived = await store.archiveWorkflow(workflow.id);
      expect(archived.status).toBe("archived");

      // Goals + receipts + history reads/writes are reachable over HTTP.
      expect(Array.isArray(await store.listGoals())).toBe(true);
      expect(await store.getGoal("nope")).toBeUndefined();
      expect(Array.isArray(await store.listRunReceipts())).toBe(true);
      const prune = await store.pruneHistory({ maxAgeDays: 30, dryRun: true });
      expect(prune.dryRun).toBe(true);

      await store.close();
    } finally {
      server.stop?.(true);
    }
  });

  test("ApiStore.updateLoop clears nextRunAt over HTTP when stop sets it undefined", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:*"],
      roles: ["admin" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:*"], iat: 1, exp: null },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1", port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const store = apiStoreForServer((server as { port: number }).port);
      const loop = await store.createLoop({ ...LOOP_INPUT, name: "api-store-stop-clears-nextrun" });
      // Scheduled once at 2030, so nextRunAt is populated before stop.
      expect(loop.nextRunAt).toBe("2030-01-01T00:00:00.000Z");

      // Mirror the CLI `stop` path: status -> stopped, nextRunAt -> undefined.
      // JSON.stringify drops undefined, so the clear only reaches the server if
      // ApiStore.updateLoop maps the explicit undefined to a wire null.
      const stopped = await store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined });
      expect(stopped.status).toBe("stopped");
      expect(stopped.nextRunAt).toBeUndefined();
      // The server-side store must actually be cleared, not just the response.
      expect((await storage.getLoop(loop.id))?.nextRunAt).toBeUndefined();
      await store.close();
    } finally {
      server.stop?.(true);
      await storage.close();
    }
  });

  test("ApiStore archive and unarchive preserve unique-name semantics over HTTP", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:*"],
      roles: ["admin" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:*"], iat: 1, exp: null },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1", port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const store = apiStoreForServer((server as { port: number }).port);
      const first = await store.createLoop({ ...LOOP_INPUT, name: "api-store-archive-dupe" });
      const second = await store.createLoop({ ...LOOP_INPUT, name: "api-store-archive-dupe" });

      await expect(store.archiveLoop("api-store-archive-dupe")).rejects.toThrow("ambiguous loop name");
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();

      expect((await store.archiveLoop(first.id)).id).toBe(first.id);
      expect((await store.archiveLoop("api-store-archive-dupe")).id).toBe(second.id);
      await expect(store.unarchiveLoop("api-store-archive-dupe")).rejects.toThrow("ambiguous loop name");
      expect((await storage.getLoop(first.id))?.archivedAt).toBeString();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();

      expect((await store.unarchiveLoop(first.id)).id).toBe(first.id);
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();
      expect((await store.unarchiveLoop("api-store-archive-dupe")).id).toBe(second.id);
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();
      await store.close();
    } finally {
      server.stop?.(true);
      await storage.close();
    }
  });

  test("ApiStore sends the original id-or-name directly to archive mutations", async () => {
    const posts: string[] = [];
    const transport = {
      get: async () => {
        throw new Error("archive mutations must not pre-resolve with GET");
      },
      post: async (path: string) => {
        posts.push(path);
        return { loop: { id: "server-selected", name: "mixed/name" } };
      },
    } as unknown as HasnaStorageClient["transport"];
    const store = new ApiStore({ transport } as HasnaStorageClient, "https://loops.example.test/v1");

    expect((await store.archiveLoop("mixed/name")).id).toBe("server-selected");
    expect((await store.unarchiveLoop("mixed/name")).id).toBe("server-selected");
    expect(posts).toEqual([
      "/loops/mixed%2Fname/archive",
      "/loops/mixed%2Fname/unarchive",
    ]);
  });

  test("unsupported mutations fail loudly instead of silently hitting local sqlite", async () => {
    const store = apiStoreForServer(1);
    await expect(store.cancelWorkflowRun("wr_x")).rejects.toBeInstanceOf(CloudUnsupportedError);
    await expect(store.requeueWorkflowWorkItem("wi_x")).rejects.toBeInstanceOf(CloudUnsupportedError);
  });

  test("fails closed when a remote workflow event has malformed base fields", async () => {
    const transport = {
      get: async () => ({
        events: [{
          id: 42,
          workflowRunId: null,
          sequence: 0,
          eventType: "created",
          stepId: 99,
          createdAt: "not-a-date",
        }],
      }),
    } as unknown as HasnaStorageClient["transport"];
    const client = { transport } as HasnaStorageClient;
    const store = new ApiStore(client, "https://loops.example.test/v1");
    await expect(store.listWorkflowEvents("run-1")).rejects.toThrow("invalid workflow event id");
  });
});
