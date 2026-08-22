// Regression: the hosted/API transport (ApiStore) must derive a scenario's
// lastRunAt from the most recent RESULT's created_at (any status) — matching
// LocalStore, which computes MAX(results.created_at) — and never from the
// scenario row's lastPassedAt. The hosted server never writes last_passed_at
// from results, so a scenario that ran (and failed) minutes ago carried
// lastPassedAt=null forever and was wrongly reported stale, while the local
// store correctly excluded it. This mirrors the get_stale_scenarios tool
// contract: "Scenarios not run in this many days are considered stale".
import { describe, expect, test } from "bun:test";
import { ApiStore } from "./index.js";
import type { HasnaStorageClient } from "../generated/storage-client/index.js";
import type { ScenarioResultStats } from "../db/results.js";

/**
 * Faithful stand-in for the deployed `/v1` server: strict full-id lookups
 * only, GET→null on 404, PATCH→throw on 404, and an idempotent DELETE. The
 * result-stats aggregate route is served from an explicit stats map so the
 * test controls exactly what the server-side aggregate returns.
 */
function fakeServer(
  seed: Record<string, { id: string; [k: string]: unknown }[]>,
  stats: Record<string, ScenarioResultStats>,
) {
  const tables: Record<string, { id: string; [k: string]: unknown }[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const client = {
    name: "testers",
    baseUrl: "http://x/v1",
    transport: {
      async get<T>(path: string) {
        const m = /^\/scenarios\/([^/]+)\/result-stats$/.exec(path);
        if (!m) throw new Error(`unexpected transport.get path: ${path}`);
        return stats[decodeURIComponent(m[1]!)] as T;
      },
    } as HasnaStorageClient["transport"],
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
      if (!row) throw new Error(`PATCH /${resource}/${id} 404`);
      Object.assign(row, patch as object);
      return row as T;
    },
    async delete(resource: string, id: string) {
      const rows = tables[resource] ?? [];
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  } as unknown as HasnaStorageClient;
  return { client, tables };
}

const RECENTLY_FAILED = "22222222-2222-2222-2222-222222222222";
const NEVER_RUN = "33333333-3333-3333-3333-333333333333";
const RECENT = new Date().toISOString();

describe("ApiStore.findStaleScenarios derives lastRunAt from the last result, not lastPassedAt", () => {
  function store() {
    // Both scenarios carry lastPassedAt=null (the hosted server never writes
    // it from results). recently-failed HAS a recent failed result; never-run
    // has no results at all.
    const { client, tables } = fakeServer(
      {
        scenarios: [
          { id: RECENTLY_FAILED, name: "recently-failed", lastPassedAt: null, lastPassedUrl: null },
          { id: NEVER_RUN, name: "never-run", lastPassedAt: null, lastPassedUrl: null },
        ],
      },
      {
        [RECENTLY_FAILED]: { lastStatus: "failed", total: 1, passed: 0, lastRunAt: RECENT },
        [NEVER_RUN]: { lastStatus: null, total: 0, passed: 0, lastRunAt: null },
      },
    );
    return { s: new ApiStore(client), tables };
  }

  test("a scenario with a recent failed result is NOT stale even though lastPassedAt is null", async () => {
    const { s } = store();
    const stale = await s.findStaleScenarios(7);
    expect(stale.map((x) => x.name)).toEqual(["never-run"]);
  });

  test("a never-run scenario IS stale and carries lastRunAt null", async () => {
    const { s } = store();
    const stale = await s.findStaleScenarios(7);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.name).toBe("never-run");
    expect(stale[0]!.lastRunAt).toBeNull();
  });
});
