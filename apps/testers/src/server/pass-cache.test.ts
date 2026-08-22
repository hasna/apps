// Regression test for todos ff19ac0f — "the hosted scenario-update path never
// persists the pass cache".
//
// Root cause: the client's ApiStore.updateScenarioPassedCache issues
// PATCH /v1/scenarios/:id, but the /v1 scenarios id-branch handled only
// GET/PUT/DELETE, so PATCH fell through to the catch-all `err("not found", 404)`.
// The generated storage client surfaces non-2xx as HasnaHttpError, which the
// runner deliberately swallows ("Non-critical — don't fail the run if cache
// update fails") — so the pass-cache write silently no-oped on the hosted path,
// the runSingleScenario cache-hit skip could never fire, and every hosted
// scenario read as never-passed. The local SQLite store persisted both columns;
// only the hosted transport was broken.
//
// This test boots the REAL /v1 route handler (handleV1 -> route) via Bun.serve
// and drives it with the REAL ApiStore over the REAL generated HTTP storage
// client. Only the PG-backed bits (cloud pool, API-key auth) are stubbed; the
// PATCH path under test performs one UPDATE against the fake db and must return
// the updated row.
//
// NOTE on env hygiene: bun test shares one process across files, so top-level
// process.env mutation here would leak into sibling test files and flip their
// stores to cloud-http. All env needs are scoped to beforeAll/afterAll, and the
// client-side test passes an explicit env object to resolveStorageClient.

import { mock, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

// Static imports execute BEFORE mock.module registration below, so these
// hold the REAL (unmocked) module surfaces. bun test reuses worker processes
// across files: process.env mutations and module mocks registered here leak
// into sibling test files, so the mock factories return a benign SUPERSET of
// the real module (only the two call sites this test needs are overridden,
// and env needs are scoped to beforeAll/afterAll).
import * as realCloud from "../db/cloud.js";
import * as realAuth from "@hasna/contracts/auth";

// Repo root = <repo>/apps/testers/src/server/pass-cache.test.ts -> ../../../../  is <repo>/
const repoRoot = new URL("../../../../", import.meta.url).pathname;
const cloudPath = join(repoRoot, "apps/testers/src/db/cloud.ts");
const contractsAuthPath = join(repoRoot, "apps/testers/node_modules/@hasna/contracts/dist/auth/index.js");
const v1Path = join(repoRoot, "apps/testers/src/server/v1.ts");
const storageClientPath = join(repoRoot, "apps/testers/src/generated/storage-client/index.js");
const storePath = join(repoRoot, "apps/testers/src/store/index.js");

// The real handleV1 -> getAuth() reads resolveSigningSecret() from the env
// before the mocked verifyApiKey runs; scope that one variable to this file.
beforeAll(() => {
  process.env.HASNA_TESTERS_API_SIGNING_KEY = "repro-signing-secret";
});
afterAll(() => {
  delete process.env.HASNA_TESTERS_API_SIGNING_KEY;
});

// Fake db: one scenario row, stateful so the PATCH handler's UPDATE actually
// persists last_passed_at/last_passed_url and returns the updated row.
const baseRow = {
  id: "sc-1",
  short_id: "TST-1",
  project_id: null,
  name: "repro scenario",
  description: "",
  steps: "[]",
  tags: "[]",
  priority: "medium",
  model: null,
  timeout_ms: null,
  target_path: null,
  requires_auth: 0,
  auth_config: null,
  metadata: null,
  assertions: "[]",
  persona_id: null,
  scenario_type: "browser",
  required_role: null,
  version: 1,
  created_at: "2026-08-22T00:00:00.000Z",
  updated_at: "2026-08-22T00:00:00.000Z",
  last_passed_at: null,
  last_passed_url: null,
  parameters: null,
};
const state = { row: { ...baseRow } };
const fakeDb = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "get")
        return async (sql: string, params?: unknown[]) => {
          if (String(sql).startsWith("UPDATE scenarios")) {
            state.row = {
              ...state.row,
              last_passed_at: String(params?.[1] ?? null),
              last_passed_url: String(params?.[2] ?? null),
              updated_at: String(params?.[3] ?? null),
            };
            return state.row;
          }
          if (String(sql).includes("FROM scenarios")) return state.row;
          // Loud failure instead of a plausible empty result: the cloud mock
          // leaks into sibling files via the shared worker process, and an
          // unexpected query must not silently return fake data there.
          throw new Error(`pass-cache.test fakeDb: unexpected SQL: ${String(sql).slice(0, 120)}`);
        };
      return async () => {
        throw new Error("pass-cache.test fakeDb: unexpected db call");
      };
    },
  },
);

mock.module(cloudPath, () => ({
  ...realCloud,
  getCloudClient: () => fakeDb,
  databaseUrlPresent: () => true,
}));
mock.module(contractsAuthPath, () => ({
  ...realAuth,
  verifyApiKey: () => ({ authenticate: async () => ({ ok: true }) }),
}));

const { handleV1 } = await import(v1Path);

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    return handleV1(req, url.pathname, req.method, url.searchParams);
  },
});
const baseUrl = `http://127.0.0.1:${server.port}`;

test("server: GET /v1/scenarios/sc-1 reaches the id-branch and returns 200", async () => {
  const res = await fetch(`${baseUrl}/v1/scenarios/sc-1`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBe("sc-1");
  expect(body.lastPassedAt).toBeNull();
});

test("server: PATCH /v1/scenarios/sc-1 {lastPassedUrl} persists the pass cache and returns 200", async () => {
  const res = await fetch(`${baseUrl}/v1/scenarios/sc-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastPassedUrl: "https://example.com/pass" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBe("sc-1");
  expect(body.lastPassedUrl).toBe("https://example.com/pass");
  expect(typeof body.lastPassedAt).toBe("string");
  // The persisted value must be visible to a subsequent read (server-side write).
  const after = await (await fetch(`${baseUrl}/v1/scenarios/sc-1`)).json();
  expect(after.lastPassedUrl).toBe("https://example.com/pass");
  expect(typeof after.lastPassedAt).toBe("string");
});

test("server: PATCH with a missing lastPassedUrl rejects with 400", async () => {
  const res = await fetch(`${baseUrl}/v1/scenarios/sc-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test("client: ApiStore.updateScenarioPassedCache resolves over the real client (no HasnaHttpError)", async () => {
  const { resolveStorageClient } = await import(storageClientPath);
  const { ApiStore } = await import(storePath);
  // Explicit env object — never mutate process.env for hosted-routing tests
  // (bun test shares one process across files).
  const resolved = resolveStorageClient("testers", {
    HASNA_TESTERS_API_URL: baseUrl,
    HASNA_TESTERS_API_KEY: "repro-key",
  });
  if (resolved.transport !== "cloud-http") throw new Error("expected cloud-http transport");
  const store = new ApiStore(resolved.client);
  // The client method is fire-and-forget (mirrors the local store's void
  // updateScenarioPassedCache); the regression is that it THREW HasnaHttpError
  // 404 because no PATCH route existed. Resolution is the fix; the persisted
  // value is asserted server-side above.
  await store.updateScenarioPassedCache("sc-1", "https://example.com/pass-2");
  const after = await (await fetch(`${baseUrl}/v1/scenarios/sc-1`)).json();
  expect(after.lastPassedUrl).toBe("https://example.com/pass-2");
  expect(typeof after.lastPassedAt).toBe("string");
});
