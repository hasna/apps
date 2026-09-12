/**
 * The hosted feedback route, against every available storage backend.
 *
 * `skills feedback` and the MCP `send_feedback` tool had no server route at
 * all: a keyed station appended the report to ~/.hasna/skills/feedback.jsonl
 * and a local install inserted it into ~/.hasna/skills/skills.db, so every
 * report stayed on the machine that made it. These assertions are the other
 * half of that port — the route must persist a real row and read it back, and
 * it must be org-scoped and authenticated like every other /api/v1 surface.
 */
import { describe, expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices, type StoreBackendFixture } from "./store-fixtures.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const SEED = [
  { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" } },
  { token: "sk_test_org_b", principal: { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" } },
];

const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[store-backends] ${notice}`);

async function testServer(backend: StoreBackendFixture) {
  const fixture = await backend.create(SEED);
  const fetchHandler = await createSkillsFetchHandler({
    store: fixture.store,
    governanceStore: fixture.governanceStore,
    config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore },
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fetchHandler });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    async stop() {
      server.stop(true);
      await fixture.close();
    },
  };
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } };
}

for (const backend of backends) {
  describe(`hosted feedback (${backend.name})`, () => {
    test("POST stores a real row and GET reads it back", async () => {
      const ctx = await testServer(backend);
      try {
        const created = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", {
          method: "POST",
          body: JSON.stringify({ message: "  the pull command is great  ", category: "feature", agent: "station03", version: "9.9.9", email: "a@example.com" }),
        }));
        expect(created.status).toBe(201);
        const body = await created.json();
        expect(body).toMatchObject({
          message: "the pull command is great",
          category: "feature",
          agent: "station03",
          version: "9.9.9",
          email: "a@example.com",
        });
        expect(typeof body.id).toBe("string");
        expect(body.id.startsWith("fbk_")).toBe(true);
        expect(typeof body.createdAt).toBe("string");

        const listed = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a"));
        expect(listed.status).toBe(200);
        const rows = await listed.json();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: body.id, message: "the pull command is great", category: "feature" });
      } finally {
        await ctx.stop();
      }
    });

    test("the same message twice is two reports, newest first", async () => {
      const ctx = await testServer(backend);
      try {
        for (const message of ["first", "second"]) {
          const response = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", { method: "POST", body: JSON.stringify({ message }) }));
          expect(response.status).toBe(201);
          expect(await response.json()).toMatchObject({ message, category: "general" });
        }
        const rows = await (await fetch(`${ctx.baseUrl}/api/v1/feedback?limit=10`, authed("sk_test_org_a"))).json();
        expect(rows.map((row: { message: string }) => row.message)).toEqual(["second", "first"]);
      } finally {
        await ctx.stop();
      }
    });

    test("reports written inside one millisecond still read back newest first", async () => {
      // The regression this exists for: SQLite timestamps have millisecond
      // resolution, so a tight burst ties on created_at and the ORDER BY's
      // second key decides. With a random id that key was meaningless and the
      // order inverted on a fast machine (CI) while holding on a slow one. Six
      // sends with no await between the POST bodies land in the same
      // millisecond on any current machine.
      const ctx = await testServer(backend);
      try {
        const sent = ["a", "b", "c", "d", "e", "f"];
        for (const message of sent) {
          const response = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", { method: "POST", body: JSON.stringify({ message }) }));
          expect(response.status).toBe(201);
        }
        const rows = await (await fetch(`${ctx.baseUrl}/api/v1/feedback?limit=10`, authed("sk_test_org_a"))).json();
        expect(rows.map((row: { message: string }) => row.message)).toEqual([...sent].reverse());
        // Ids are time-sortable, so the id order carries the same answer as the
        // ordering above even when every created_at is identical.
        const ids = rows.map((row: { id: string }) => row.id);
        expect(ids).toEqual([...ids].sort().reverse());
      } finally {
        await ctx.stop();
      }
    });

    test("one org never reads another's feedback", async () => {
      const ctx = await testServer(backend);
      try {
        await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", { method: "POST", body: JSON.stringify({ message: "org a only" }) }));
        const otherRows = await (await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_b"))).json();
        expect(otherRows).toEqual([]);
      } finally {
        await ctx.stop();
      }
    });

    test("an empty message, an unknown category and an unauthenticated call are all refused", async () => {
      const ctx = await testServer(backend);
      try {
        const empty = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", { method: "POST", body: JSON.stringify({ message: "   " }) }));
        expect(empty.status).toBe(400);
        expect(await empty.json()).toMatchObject({ code: "INVALID_FEEDBACK" });

        const badCategory = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", {
          method: "POST",
          body: JSON.stringify({ message: "hello", category: "praise" }),
        }));
        expect(badCategory.status).toBe(400);
        expect(await badCategory.json()).toMatchObject({ code: "INVALID_FEEDBACK_CATEGORY" });

        const tooLong = await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a", {
          method: "POST",
          body: JSON.stringify({ message: "x".repeat(10_001) }),
        }));
        expect(tooLong.status).toBe(400);
        expect(await tooLong.json()).toMatchObject({ code: "FEEDBACK_TOO_LONG" });

        for (const init of [{ method: "POST", body: JSON.stringify({ message: "anonymous" }) }, {}]) {
          const denied = await fetch(`${ctx.baseUrl}/api/v1/feedback`, { ...init, headers: { "Content-Type": "application/json" } });
          expect(denied.status).toBe(401);
          expect(await denied.json()).toMatchObject({ code: "AUTH_REQUIRED" });
        }

        // Nothing stored by any of the refusals above.
        expect(await (await fetch(`${ctx.baseUrl}/api/v1/feedback`, authed("sk_test_org_a"))).json()).toEqual([]);
      } finally {
        await ctx.stop();
      }
    });
  });
}
