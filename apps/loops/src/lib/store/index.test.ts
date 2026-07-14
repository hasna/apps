import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../../api/index.js";
import { createSqliteLoopStorage } from "../storage/sqlite.js";
import { createHasnaStorageClient } from "../cloud/storage.js";
import { createHasnaHttpTransport } from "../cloud/transport.js";
import { ApiStore, CloudUnsupportedError, getStore, isCloudStore, LocalStore } from "./index.js";
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

describe("ApiStore end-to-end against the real /v1 server", () => {
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

  test("unsupported mutations fail loudly instead of silently hitting local sqlite", async () => {
    const store = apiStoreForServer(1);
    await expect(store.cancelWorkflowRun("wr_x")).rejects.toBeInstanceOf(CloudUnsupportedError);
    await expect(store.requeueWorkflowWorkItem("wi_x")).rejects.toBeInstanceOf(CloudUnsupportedError);
  });
});
