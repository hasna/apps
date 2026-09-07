/**
 * The full client-facing surface the shipped server serves: capabilities,
 * quotes, billing, credits, account/workspace updates, run resume, artifact
 * download suffix, input uploads, the updated-since feed, the /v1 dialect
 * aliases, and the passwordless auth flows. Every command the CLI registers
 * must be answerable by a deployment of THIS server — the "any API URL"
 * transport — not just by the platform's private server.
 */
import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { resolveStoreBackends, type StoreBackendFixture } from "./store-fixtures.js";
import { storeBackendNotices } from "./store-fixtures.js";
import { createSkillsFetchHandler, createSkillsServerState } from "./app.js";
import type { SkillsServerConfig } from "./config.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const backends: StoreBackendFixture[] = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[store-backends] ${notice}`);
console.log(`[store-backends] running the remote-surface suite against: ${backends.map((b) => b.name).join(", ")}`);

const SEED = [
  { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" } },
];

function testConfig(): Partial<SkillsServerConfig> {
  return {
    bootstrapApiKey: "sk_test_org_a",
    allowEphemeralStore: true,
    inlineWorker: false,
    requestBodyLimitBytes: 1_000_000,
    skillBundleLimitBytes: 25_000_000,
    tombstoneWindowMs: 1000,
    publicBaseUrl: "http://127.0.0.1:8790",
    seedBundledCorpus: false,
  };
}

async function makeServer(fixture: StoreBackendFixture) {
  const ctx = await fixture.create(SEED);
  const fetch = await createSkillsFetchHandler({
    store: ctx.store,
    governanceStore: ctx.governanceStore,
    config: testConfig(),
    runtimeState: createSkillsServerState(),
  });
  return { ctx, fetch };
}

function api(fetch: (request: Request) => Promise<Response>, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new Request(`http://127.0.0.1:8790${path}`, {
    ...init,
    headers: { Authorization: `Bearer sk_test_org_a`, ...init.headers },
  }));
}

const auth = (fetch: (request: Request) => Promise<Response>, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(new Request(`http://127.0.0.1:8790${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } }));

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

for (const backend of backends) {
  describe(`remote surface on ${backend.name}`, () => {
    test("serves capabilities under both /v1 and /api/v1 dialects", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        for (const prefix of ["/api/v1", "/v1"]) {
          const res = await api(fetch, `${prefix}/capabilities`);
          expect(res.status).toBe(200);
          const body = await res.json() as Record<string, unknown>;
          expect(body).toMatchObject({ product: "skills", contractVersion: 1, apiVersion: 1 });
          expect((body.capabilities as string[]).sort()).toEqual(["runs.submit", "runs.uploads"]);
          expect(body.billing).toMatchObject({ unit: "credits", boundedRunApproval: true });
        }
      } finally { await ctx.close(); }
    });

    test("quotes an existing skill at zero credits and 404s unknown slugs", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        // Publish a skill so there is something to quote.
        const form = new FormData();
        form.set("manifest", JSON.stringify({ slug: "quote-me", version: "1.0.0", displayName: "Quote Me", description: "d", category: "Development Tools", tags: ["test"], kind: "executable", source: "custom" }));
        const published = await api(fetch, "/api/v1/skills", { method: "POST", body: form });
        expect(published.status).toBe(201);
        const quote = await api(fetch, "/api/v1/skills/quote-me/quote", post({ input: {}, args: [] }));
        expect(quote.status).toBe(200);
        expect(await quote.json()).toMatchObject({ skill: "quote-me", availability: { status: "available" }, pricing: { costCredits: 0 } });
        const missing = await api(fetch, "/api/v1/skills/never-published/quote", post({ input: {}, args: [] }));
        expect(missing.status).toBe(404);
      } finally { await ctx.close(); }
    });

    test("billing and credits answer the deterministic zero-credit contract", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        expect(await (await api(fetch, "/api/v1/billing/status")).json()).toMatchObject({ creditBalance: 0, hasPaymentMethod: false });
        expect(await (await api(fetch, "/api/v1/billing/usage")).json()).toEqual([]);
        expect(await (await api(fetch, "/api/v1/billing/invoices")).json()).toEqual([]);
        expect(await (await api(fetch, "/api/v1/billing/credits")).json()).toEqual([]);
        for (const path of ["/api/v1/billing/checkout", "/api/v1/billing/portal", "/api/v1/billing/credits"]) {
          const res = await api(fetch, path, post({}));
          expect(res.status).toBe(503);
          expect(((await res.json()) as { code?: string }).code).toBe("SUBSCRIPTION_CHECKOUT_UNAVAILABLE");
        }
      } finally { await ctx.close(); }
    });

    test("account and workspace updates persist per process and validate names", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const profile = await api(fetch, "/api/v1/account/profile", { method: "PATCH", body: JSON.stringify({ displayName: "Ada Lovelace" }) });
        expect(profile.status).toBe(200);
        expect(await profile.json()).toMatchObject({ user: { id: "user_a", email: "a@example.com", displayName: "Ada Lovelace", role: "owner" } });
        const workspace = await api(fetch, "/api/v1/workspaces/current", { method: "PATCH", body: JSON.stringify({ name: "Analytical Engines" }) });
        expect(workspace.status).toBe(200);
        expect(await workspace.json()).toMatchObject({ organization: { id: "org_a", slug: "org-a", name: "Analytical Engines" } });
        const bad = await api(fetch, "/api/v1/account/profile", { method: "PATCH", body: JSON.stringify({ displayName: "" }) });
        expect(bad.status).toBe(400);
      } finally { await ctx.close(); }
    });

    test("runs resume only queued runs and serves the artifact download suffix", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const created = await api(fetch, "/api/v1/runs/quote-me", post({ input: {}, args: [] }));
        expect(created.status).toBe(202);
        const run = await created.json() as { id: string };
        const resumed = await api(fetch, `/api/v1/runs/${run.id}/resume`, post({}));
        expect(resumed.status).toBe(202);
        const terminal = await api(fetch, `/api/v1/runs/${run.id}/cancel`, post({}));
        expect(terminal.status).toBe(200);
        const refused = await api(fetch, `/api/v1/runs/${run.id}/resume`, post({}));
        expect(refused.status).toBe(409);
        const missing = await api(fetch, "/api/v1/runs/nope/download", post({}));
        expect(missing.status).toBe(404);
      } finally { await ctx.close(); }
    });

    test("input uploads: admission opens targets, PUT lands bytes, unknown targets 404", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const created = await api(fetch, "/api/v1/runs/quote-me", post({ input: {}, args: [] }));
        const run = await created.json() as { id: string };
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const sha = createHash("sha256").update(bytes).digest("hex");
        const admission = await api(fetch, `/api/v1/runs/${run.id}/uploads`, post({ files: [{ name: "input.txt", sizeBytes: bytes.byteLength, sha256: sha, contentType: "text/plain" }] }));
        expect(admission.status).toBe(200);
        const targets = await admission.json() as { files: Array<{ name: string; uploadUrl: string }> };
        expect(targets.files).toHaveLength(1);
        const uploaded = await fetch(new Request(targets.files[0]!.uploadUrl, { method: "PUT", body: bytes, headers: { "Content-Type": "text/plain" } }));
        expect(uploaded.status).toBe(200);
        const unknown = await fetch(new Request(`http://127.0.0.1:8790/api/v1/runs/${run.id}/uploads/other.bin`, { method: "PUT", body: bytes }));
        expect(unknown.status).toBe(404);
        // A terminal run refuses new uploads.
        await api(fetch, `/api/v1/runs/${run.id}/cancel`, post({}));
        const refused = await api(fetch, `/api/v1/runs/${run.id}/uploads`, post({ files: [] }));
        expect(refused.status).toBe(409);
      } finally { await ctx.close(); }
    });

    test("the updated-since feed pages by cursor", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        // Publish two skills with distinct timestamps.
        for (const slug of ["alpha-one", "beta-two"]) {
          const form = new FormData();
          form.set("manifest", JSON.stringify({ slug, version: "1.0.0", displayName: slug, description: "d", category: "Development Tools", tags: ["test"], kind: "instruction", source: "custom" }));
          expect((await api(fetch, "/api/v1/skills", { method: "POST", body: form })).status).toBe(201);
        }
        const page1 = await api(fetch, "/api/v1/skills/updated?since=2020-01-01T00:00:00Z&limit=1");
        expect(page1.status).toBe(200);
        const body1 = await page1.json() as { skills: Array<{ slug: string; updatedAt: string }>; nextCursor?: string | null };
        expect(body1.skills).toHaveLength(1);
        expect(body1.nextCursor).toBeTypeOf("string");
        const page2 = await api(fetch, `/api/v1/skills/updated?since=2020-01-01T00:00:00Z&cursor=${body1.nextCursor}&limit=1`);
        const body2 = await page2.json() as { skills: Array<{ slug: string }> };
        expect(body2.skills).toHaveLength(1);
        expect(body2.skills[0]!.slug).not.toBe(body1.skills[0]!.slug);
        const invalid = await api(fetch, "/api/v1/skills/updated?since=not-a-date");
        expect(invalid.status).toBe(400);
      } finally { await ctx.close(); }
    });

    test("passwordless email login: code, verify, session, keys CRUD", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const sent = await auth(fetch, "/api/auth/login", post({ email: "a@example.com" }));
        expect(sent.status).toBe(200);
        const sentBody = await sent.json() as { verificationCode?: string };
        expect(sentBody.verificationCode).toMatch(/^\d{6}$/);

        const wrong = await auth(fetch, "/api/auth/verify", post({ email: "a@example.com", code: "000000" }));
        expect(wrong.status).toBe(401);

        const verified = await auth(fetch, "/api/auth/verify", post({ email: "a@example.com", code: sentBody.verificationCode }));
        expect(verified.status).toBe(200);
        const session = await verified.json() as { token: string; user: { id: string; email: string }; organization: { slug: string } };
        expect(session.token).toBeTruthy();
        expect(session.user).toMatchObject({ id: "user_a", email: "a@example.com" });
        expect(session.organization.slug).toBe("org-a");

        const withSession = (path: string, init: RequestInit = {}) =>
          fetch(new Request(`http://127.0.0.1:8790${path}`, { ...init, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...init.headers } }));

        const whoami = await withSession("/api/auth/whoami");
        expect(whoami.status).toBe(200);
        expect((await whoami.json()) as Record<string, unknown>).toMatchObject({ user: { id: "user_a" }, organization: { slug: "org-a" } });

        const created = await withSession("/api/auth/keys", post({ name: "ci-robot" }));
        expect(created.status).toBe(200);
        const keyRow = await created.json() as { key: string; id: string };
        expect(keyRow.key).toMatch(/^sk_/);
        // The new key authenticates.
        const keyWhoami = await api(fetch, "/api/auth/whoami", { method: "GET", headers: { Authorization: `Bearer ${keyRow.key}` } } as RequestInit);
        expect(keyWhoami.status).toBe(200);

        const listed = await withSession("/api/auth/keys");
        expect(listed.status).toBe(200);
        const rows = await listed.json() as Array<{ id: string; name: string }>;
        expect(rows.some((row) => row.id === keyRow.id && row.name === "ci-robot")).toBe(true);
        expect(rows.some((row) => "key" in row)).toBe(false);

        const revoked = await withSession(`/api/auth/keys/${keyRow.id}`, { method: "DELETE" });
        expect(revoked.status).toBe(200);
        const after = await withSession("/api/auth/keys");
        expect((await after.json() as Array<{ id: string }>).some((row) => row.id === keyRow.id)).toBe(false);
        // The revoked key no longer authenticates.
        const stale = await api(fetch, "/api/auth/whoami", { method: "GET", headers: { Authorization: `Bearer ${keyRow.key}` } } as RequestInit);
        expect(stale.status).toBe(401);
      } finally { await ctx.close(); }
    });

    test("device login completes on the first poll (no browser surface)", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const started = await auth(fetch, "/api/auth/device/start", post({ client: "skills-cli" }));
        expect(started.status).toBe(200);
        const grant = await started.json() as { deviceCode: string; userCode: string; verificationUriComplete: string };
        expect(grant.deviceCode).toMatch(/^\d{6}$/);
        const token = await auth(fetch, "/api/auth/device/token", post({ deviceCode: grant.deviceCode }));
        expect(token.status).toBe(200);
        const session = await token.json() as { token: string; user: { id: string } };
        expect(session.token).toBeTruthy();
        expect(session.user.id).toBe("user_a");
        // Grants are single-use.
        const replayed = await auth(fetch, "/api/auth/device/token", post({ deviceCode: grant.deviceCode }));
        expect(replayed.status).toBe(401);
      } finally { await ctx.close(); }
    });

    test("login/verify/keys are also served under the /v1/auth alias", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        const sent = await auth(fetch, "/v1/auth/login", post({ email: "a@example.com" }));
        expect(sent.status).toBe(200);
        const code = ((await sent.json()) as { verificationCode: string }).verificationCode;
        const verified = await auth(fetch, "/v1/auth/verify", post({ email: "a@example.com", code }));
        expect(verified.status).toBe(200);
        const { token } = await verified.json() as { token: string };
        const whoami = await fetch(new Request("http://127.0.0.1:8790/v1/auth/whoami", { headers: { Authorization: `Bearer ${token}` } }));
        expect(whoami.status).toBe(200);
        expect((await whoami.json()) as Record<string, unknown>).toMatchObject({ user: { id: "user_a" } });
      } finally { await ctx.close(); }
    });

    test("API key store methods round-trip per backend", async () => {
      const { ctx, fetch } = await makeServer(backend);
      try {
        // The store seam itself: create/list/revoke and authentication.
        const created = await ctx.store.createApiKey!({ orgId: "org_a", userId: "user_a", orgSlug: "org-a", orgName: "Org A", email: "a@example.com", role: "owner", apiKeyId: "key_a", scopes: ["skills:read"] }, { name: "seam-key" });
        expect(created.key).toMatch(/^sk_/);
        const principal = await ctx.store.authenticateApiKeyHash(createHash("sha256").update(created.key).digest("hex"));
        expect(principal?.userId).toBe("user_a");
        expect(await ctx.store.listApiKeys!({ orgId: "org_a", userId: "user_a" } as never)).toHaveLength(2);
        expect(await ctx.store.revokeApiKey!({ orgId: "org_a", userId: "user_a" } as never, created.id)).toBe(true);
        expect(await ctx.store.authenticateApiKeyHash(createHash("sha256").update(created.key).digest("hex"))).toBeNull();
      } finally { await ctx.close(); }
    });
  });
}

// Keep the randomBytes import referenced for the PUT body helper symmetry.
void randomBytes;