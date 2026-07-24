// Regression: the cloud/API transport (ApiStore) must resolve the UUID-*prefix*
// short ids that the CLI's list/create output prints for resources with no
// dedicated shortId field (flows, workflows, agents) — mirroring LocalStore's
// resolvePartialId — AND must never report a false-success delete for an id that
// never resolved. Both were live failures against the deployed self_hosted server.
import { describe, expect, test } from "bun:test";
import { ApiStore } from "./index.js";
import { HasnaHttpError } from "../generated/storage-client/index.js";
import type { HasnaStorageClient } from "../generated/storage-client/index.js";

/**
 * A faithful stand-in for the deployed `/v1` server: strict full-id lookups
 * only (a short id 404s), GET→null on 404, PATCH→throw on 404, and an
 * idempotent DELETE that silently no-ops on a missing id (the exact behavior
 * that produced the silent false-success).
 */
function fakeServer(seed: Record<string, { id: string; [k: string]: unknown }[]>) {
  const tables: Record<string, { id: string; [k: string]: unknown }[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const client = {
    name: "testers",
    baseUrl: "http://x/v1",
    transport: {} as HasnaStorageClient["transport"],
    async list<T>(resource: string, options?: { query?: Record<string, unknown> }) {
      const rows = tables[resource] ?? [];
      const offset = Number(options?.query?.offset ?? 0);
      const limit = Number(options?.query?.limit ?? rows.length);
      return { items: rows.slice(offset, offset + limit) as T[], total: rows.length, cursor: undefined, raw: {} };
    },
    async get<T>(resource: string, id: string) {
      return ((tables[resource] ?? []).find((r) => r.id === id) as T) ?? null;
    },
    async create<T>(resource: string, body: unknown) {
      const row = body as { id: string };
      (tables[resource] ??= []).push(row);
      return row as T;
    },
    async update<T>(resource: string, id: string, patch: unknown) {
      const row = (tables[resource] ?? []).find((r) => r.id === id);
      if (!row) throw new HasnaHttpError("PATCH", `/${resource}/${id}`, 404, "not found");
      Object.assign(row, patch as object);
      return row as T;
    },
    async delete(resource: string, id: string) {
      const rows = tables[resource] ?? [];
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1); // present => remove; absent => idempotent no-op
    },
  } as unknown as HasnaStorageClient;
  return { client, tables };
}

const FLOW = "11111111-2222-3333-4444-555555555555";
const WF = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AGENT = "99999999-8888-7777-6666-555555555555";

describe("ApiStore short-id (UUID-prefix) resolution", () => {
  function store() {
    const { client, tables } = fakeServer({
      flows: [{ id: FLOW, name: "checkout flow", projectId: null, scenarioIds: [] }],
      workflows: [{ id: WF, name: "nightly", projectId: null, personaIds: [] }],
      agents: [{ id: AGENT, name: "brutus", lastSeenAt: "t0" }],
    });
    return { s: new ApiStore(client), tables };
  }

  test("getFlow resolves an 8-char prefix", async () => {
    const { s } = store();
    const f = await s.getFlow(FLOW.slice(0, 8));
    expect(f?.id).toBe(FLOW);
  });

  test("deleteFlow deletes via prefix and reports true", async () => {
    const { s, tables } = store();
    expect(await s.deleteFlow(FLOW.slice(0, 8))).toBe(true);
    expect(tables.flows.length).toBe(0);
  });

  test("deleteFlow on an unknown id reports false (no silent false-success)", async () => {
    const { s, tables } = store();
    expect(await s.deleteFlow("deadbeef")).toBe(false);
    expect(tables.flows.length).toBe(1); // untouched
  });

  test("getTestingWorkflow resolves a prefix", async () => {
    const { s } = store();
    expect((await s.getTestingWorkflow(WF.slice(0, 8)))?.id).toBe(WF);
  });

  test("deleteTestingWorkflow deletes via prefix and reports true", async () => {
    const { s, tables } = store();
    expect(await s.deleteTestingWorkflow(WF.slice(0, 8))).toBe(true);
    expect(tables.workflows.length).toBe(0);
  });

  test("heartbeatAgent resolves a prefix instead of PATCH-404", async () => {
    const { s } = store();
    const a = (await s.heartbeatAgent(AGENT.slice(0, 8))) as { id: string } | null;
    expect(a?.id).toBe(AGENT);
  });

  test("heartbeatAgent on an unknown id returns null", async () => {
    const { s } = store();
    expect(await s.heartbeatAgent("00000000")).toBeNull();
  });
});
