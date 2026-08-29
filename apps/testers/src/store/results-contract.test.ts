// Contract lock for the hosted results WRITE surface (OPE21-00033).
//
// The runner records results through the Store; on the hosted transport the
// ApiStore maps createResult -> POST /v1/results and updateResult -> PUT
// /v1/results/:id. The server never routed those (only GET /v1/results/:id),
// so hosted-store sandbox runs 404'd on result recording. These tests lock
// the CLIENT half of the contract (which resource and method the runner's
// calls resolve to); the server half is locked by
// src/server/results-write.pg.test.ts (live Postgres round-trip) and the
// openapi.test.ts document assertions.
import { describe, expect, test } from "bun:test";
import { ApiStore } from "./index.js";
import { HasnaHttpError } from "../generated/storage-client/index.js";
import type { HasnaStorageClient } from "../generated/storage-client/index.js";

/**
 * Records the exact storage-client calls the ApiStore makes, so the test can
 * assert the resource path AND the HTTP verb without a network or a module
 * mock (the client object is injected — no mock.module, no cross-file leak).
 */
function recordingClient() {
  const calls: Array<{ op: string; resource: string; id?: string; body?: unknown }> = [];
  const rows: Record<string, { id: string; [k: string]: unknown }[]> = {
    results: [
      { id: "r-1", runId: "run-1", scenarioId: "sc-1", status: "skipped" },
    ],
  };
  const client = {
    name: "testers",
    baseUrl: "http://x/v1",
    transport: {} as HasnaStorageClient["transport"],
    async get<T>(resource: string, id: string) {
      calls.push({ op: "get", resource, id });
      return ((rows[resource] ?? []).find((r) => r.id === id) as T) ?? null;
    },
    async create<T>(resource: string, body: unknown) {
      calls.push({ op: "create", resource, body });
      const row = { id: `new-${(rows[resource] ?? []).length + 1}`, ...(body as object) };
      (rows[resource] ??= []).push(row);
      return row as T;
    },
    async update<T>(resource: string, id: string, patch: unknown) {
      calls.push({ op: "update", resource, id, body: patch });
      const row = (rows[resource] ?? []).find((r) => r.id === id);
      if (!row) throw new HasnaHttpError("PUT", `/${resource}/${id}`, 404, "not found");
      Object.assign(row, patch as object);
      return row as T;
    },
    async list<T>(resource: string) {
      calls.push({ op: "list", resource });
      return { items: (rows[resource] ?? []) as T[], total: (rows[resource] ?? []).length, cursor: undefined, raw: {} };
    },
    async delete() {
      throw new Error("unexpected delete");
    },
  } as unknown as HasnaStorageClient;
  return { s: new ApiStore(client), calls };
}

describe("ApiStore results write contract (OPE21-00033)", () => {
  test("createResult resolves to the 'results' collection (POST /v1/results)", async () => {
    const { s, calls } = recordingClient();
    const created = await s.createResult({ runId: "run-1", scenarioId: "sc-1", model: "quick", stepsTotal: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe("create");
    expect(calls[0]!.resource).toBe("results");
    expect(created.runId).toBe("run-1");
    expect(created.stepsTotal).toBe(4);
  });

  test("updateResult resolves to the 'results' entity (PUT /v1/results/:id)", async () => {
    const { s, calls } = recordingClient();
    const updated = await s.updateResult("r-1", { status: "passed", stepsCompleted: 1, durationMs: 900 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe("update");
    expect(calls[0]!.resource).toBe("results");
    expect(calls[0]!.id).toBe("r-1");
    expect(updated.status).toBe("passed");
    expect(updated.durationMs).toBe(900);
  });

  test("getResult resolves to the 'results' entity (GET /v1/results/:id)", async () => {
    const { s, calls } = recordingClient();
    const got = await s.getResult("r-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe("get");
    expect(calls[0]!.resource).toBe("results");
    expect(got?.id).toBe("r-1");
  });

  test("listResults resolves to runs/:id/results (GET /v1/runs/:id/results)", async () => {
    const { s, calls } = recordingClient();
    await s.listResults("run-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe("list");
    expect(calls[0]!.resource).toBe("runs/run-1/results");
  });
});
