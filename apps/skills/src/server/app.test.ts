import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { verifyBundleSignature } from "../lib/skill-bundles.js";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices, type StoreBackendFixture } from "./store-fixtures.js";
import { runWorkerOnce } from "./worker.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const SEED = [
  { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" } },
  { token: "sk_test_org_b", principal: { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" } },
];

// Resolved once, before any describe body runs, because Postgres availability can only
// be determined by connecting. Whatever is skipped says so on stdout - the point of
// parameterising is to be able to state which backends were actually covered.
const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[store-backends] ${notice}`);
console.log(`[store-backends] running the server API suite against: ${backends.map((b) => b.name).join(", ")}`);

/**
 * A packed skill bundle whose contents identify which org built it.
 *
 * Distinct bytes per caller is the point: a cross-org test that publishes identical
 * content to both orgs cannot tell "B read its own copy" from "B read A's copy", because
 * both answers are the same bytes. The marker makes the two outcomes distinguishable.
 */
function fixtureBundle(marker: string): { bytes: Uint8Array; sha256: string; skillMd: string } {
  const dir = mkdtempSync(join(tmpdir(), "skills-api-bundle-"));
  try {
    const skillMd = `---\nname: team-runbook\ndescription: ${marker} runbook\n---\n\n# ${marker}\n`;
    for (const [path, content] of Object.entries({
      "SKILL.md": skillMd,
      "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "team-runbook" }),
      "src/index.ts": `console.log(${JSON.stringify(marker)});\n`,
    })) {
      const absolute = join(dir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    const packed = packSkillBundle(dir);
    return { bytes: packed.bytes, sha256: packed.sha256, skillMd };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Versions are immutable (hasna/apps#1630): a republish with different bytes must name a new one.
function manifestFor(slug: string, marker: string, skillMd: string, sha256: string, version = "1.2.3"): Record<string, unknown> {
  return {
    slug,
    displayName: `${marker} Runbook`,
    description: `${marker} deployment runbook`,
    category: "Development Tools",
    tags: ["ops", marker],
    kind: "executable",
    version,
    source: "custom",
    skillMd,
    bundleSha256: sha256,
  };
}

async function testServer(backend: StoreBackendFixture, configOverrides: Record<string, unknown> = {}) {
  const fixture = await backend.create(SEED);
  const fetch = await createSkillsFetchHandler({
    store: fixture.store,
    governanceStore: fixture.governanceStore,
    config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore, ...configOverrides },
  });
  const server = Bun.serve({ port: 0, fetch });
  return {
    server,
    store: fixture.store,
    governanceStore: fixture.governanceStore,
    baseUrl: `http://127.0.0.1:${server.port}`,
    async stop() {
      server.stop(true);
      await fixture.close();
    },
  };
}

for (const backend of backends) {
  describe(`skills API (${backend.name})`, () => {
    test("serves unauthenticated health and requires auth for API routes", async () => {
      const ctx = await testServer(backend);
      try {
        const health = await fetch(`${ctx.baseUrl}/health`);
        expect(health.status).toBe(200);
        const healthBody = await health.json();
        expect(healthBody).toMatchObject({ ok: true, service: "skills" });
        // The server does not describe who is running it. One product, one
        // deployment story; /health reports liveness, not a deployment variant.
        expect(healthBody).not.toHaveProperty("mode");

        const denied = await fetch(`${ctx.baseUrl}/api/v1/skills`);
        expect(denied.status).toBe(401);
        expect(await denied.json()).toMatchObject({ code: "AUTH_REQUIRED" });

        // The pins surface sits behind the same gate: an unauthenticated list,
        // pin, and unpin all get 401 before any handler runs.
        const deniedPins = await fetch(`${ctx.baseUrl}/api/v1/pins`);
        expect(deniedPins.status).toBe(401);
        expect(await deniedPins.json()).toMatchObject({ code: "AUTH_REQUIRED" });
        for (const init of [
          { method: "PUT", body: JSON.stringify({}) },
          { method: "DELETE" },
        ]) {
          const deniedPin = await fetch(`${ctx.baseUrl}/api/v1/pins/deploy-notes`, {
            ...init,
            headers: { "Content-Type": "application/json" },
          });
          expect(deniedPin.status).toBe(401);
          expect(await deniedPin.json()).toMatchObject({ code: "AUTH_REQUIRED" });
        }
      } finally {
        await ctx.stop();
      }
    });

    test("serves /version for the deploy gate (200 + service identity + version match)", async () => {
      // Deploy gate criterion (O15-03836): GET /version must return 200 with
      // the service identity and the package version, so the gate can verify
      // which build is live. It previously fell through to the 404 handler,
      // so the gate could never pass at skills.hasna.xyz.
      const ctx = await testServer(backend);
      try {
        const res = await fetch(`${ctx.baseUrl}/version`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ ok: true, service: "skills" });
        expect(body.version).toBe(pkg.version);
        // The deploy gate must never confuse this endpoint with an API route:
        // it is unauthenticated, like /health and /ready.
        const denied = await fetch(`${ctx.baseUrl}/version`, { method: "POST" });
        expect(denied.status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });

    test("pins round-trip through the API and are scoped per org and principal", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);

        // A pin set survives: write, list, read back through the client.
        const pinned = await orgA.pin("deploy-notes", { reason: "team default" });
        expect(pinned).toMatchObject({ slug: "deploy-notes", metadata: { reason: "team default" } });
        expect(pinned.pinnedAt).toBeTruthy();
        expect((await orgA.listPins()).map((pin: { slug: string }) => pin.slug)).toEqual(["deploy-notes"]);

        // Another org pins the same slug; each org sees exactly its own pin.
        await orgB.pin("deploy-notes");
        expect((await orgA.listPins()).map((pin: { slug: string }) => pin.slug)).toEqual(["deploy-notes"]);
        expect((await orgB.listPins()).map((pin: { slug: string }) => pin.slug)).toEqual(["deploy-notes"]);
        expect((await orgA.listPins())[0]).toMatchObject({ metadata: { reason: "team default" } });

        // Repinning upserts to one row and refreshes the payload.
        await orgA.pin("deploy-notes", { reason: "revised" });
        expect((await orgA.listPins()).map((pin: { slug: string }) => pin.slug)).toEqual(["deploy-notes"]);
        expect((await orgA.listPins())[0]).toMatchObject({ metadata: { reason: "revised" } });

        // Unpin removes only the caller's pin.
        expect(await orgA.unpin("deploy-notes")).toBe(true);
        expect((await orgA.listPins())).toEqual([]);
        expect(await orgB.unpin("deploy-notes")).toBe(true);

        // A bad slug is refused before touching the store.
        const invalid = await fetch(`${ctx.baseUrl}/api/v1/pins/..%2Fescape`, {
          method: "PUT",
          headers: { authorization: "Bearer sk_test_org_a", "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect([400, 404]).toContain(invalid.status);
      } finally {
        await ctx.stop();
      }
    });

    test("tag routes: distinct tags, skills?tag=, tags/:tag/skills, pins?tag= (org-scoped)", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);

        // Unauthenticated tag reads are refused before any handler runs.
        for (const path of ["/api/v1/tags", "/api/v1/tags/ops/skills", "/api/v1/skills?tag=ops", "/api/v1/pins?tag=ops"]) {
          const denied = await fetch(`${ctx.baseUrl}${path}`);
          expect(denied.status).toBe(401);
          expect(await denied.json()).toMatchObject({ code: "AUTH_REQUIRED" });
        }

        const bundle = fixtureBundle("t7");
        const manifest = manifestFor("team-runbook", "t7marker", bundle.skillMd, bundle.sha256);
        expect((await orgA.publishSkill(manifest, bundle.bytes)).status).toBe(201);

        // The distinct-tags surface is the org's merged registry view: the published tags
        // plus the bundled corpus's, scoped so another org never sees this org's tags.
        const tags = await orgA.listTags();
        expect(tags).toContain("t7marker");
        expect(tags).toContain("ops");
        expect(tags).toContain("api"); // a bundled-corpus tag
        expect(await orgB.listTags()).not.toContain("t7marker");

        // A skill tagged in the hosted registry appears under its tag filter.
        const byTag = await orgA.skillsByTag("t7marker");
        expect(byTag).toContainEqual(expect.objectContaining({ slug: "team-runbook", version: "1.2.3" }));
        expect(await orgB.skillsByTag("t7marker")).toEqual([]);

        // GET /api/v1/skills?tag= serves the same filtered merged list with full payloads.
        const withTag = await fetch(`${ctx.baseUrl}/api/v1/skills?tag=t7marker`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(withTag.status).toBe(200);
        const filtered = (await withTag.json()) as Array<Record<string, unknown>>;
        expect(filtered.some((s) => s.slug === "team-runbook")).toBe(true);
        expect(filtered.every((s) => Array.isArray(s.tags) && (s.tags as string[]).includes("t7marker"))).toBe(true);

        // Bundled skills are inside the filtered universe as well.
        const bundledTag = await fetch(`${ctx.baseUrl}/api/v1/skills?tag=api`, { headers: { authorization: "Bearer sk_test_org_a" } });
        const bundledFiltered = (await bundledTag.json()) as Array<Record<string, unknown>>;
        expect(bundledFiltered.length).toBeGreaterThan(0);
        expect(bundledFiltered.every((s) => Array.isArray(s.tags) && (s.tags as string[]).includes("api"))).toBe(true);

        // Pins carry their skill's tags: pin the tagged skill, then filter by its tag.
        await orgA.pin("team-runbook", { reason: "tagged" });
        const pinsByTag = await fetch(`${ctx.baseUrl}/api/v1/pins?tag=t7marker`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(pinsByTag.status).toBe(200);
        const filteredPins = (await pinsByTag.json()) as Array<Record<string, unknown>>;
        expect(filteredPins.map((p) => p.slug)).toEqual(["team-runbook"]);

        // A pin of a BUNDLED skill appears under that skill's bundled tag.
        await orgA.pin("api-test-suite");
        const bundledPins = await fetch(`${ctx.baseUrl}/api/v1/pins?tag=api`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect((await bundledPins.json()) as Array<Record<string, unknown>>).toContainEqual(
          expect.objectContaining({ slug: "api-test-suite" }),
        );
        const pinsOtherTag = await fetch(`${ctx.baseUrl}/api/v1/pins?tag=zzz-none`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect((await pinsOtherTag.json()) as unknown[]).toEqual([]);
        // An empty tag query falls back to the unfiltered pin list (both pins
        // above: the published team-runbook and the bundled api-test-suite).
        const pinsNoTag = await fetch(`${ctx.baseUrl}/api/v1/pins`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect((await pinsNoTag.json()) as unknown[]).toHaveLength(2);

        // Published-wins precedence: a published row occupying a bundled slug
        // must not let the bundled copy resurface under a tag filter, in the
        // tag list, or via pins. Publish an override of api-test-suite whose
        // tags drop "api".
        const override = fixtureBundle("override");
        const overrideManifest = manifestFor("api-test-suite", "override", override.skillMd, override.sha256);
        expect((await orgA.publishSkill(overrideManifest, override.bytes)).status).toBe(201);
        const filteredApi = await fetch(`${ctx.baseUrl}/api/v1/skills?tag=api`, { headers: { authorization: "Bearer sk_test_org_a" } });
        const apiRows = (await filteredApi.json()) as Array<Record<string, unknown>>;
        expect(apiRows.some((s) => s.slug === "api-test-suite")).toBe(false);
        expect(await orgA.skillsByTag("api")).not.toContainEqual(expect.objectContaining({ slug: "api-test-suite" }));
        const pinsAfterOverride = await fetch(`${ctx.baseUrl}/api/v1/pins?tag=api`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect((await pinsAfterOverride.json()) as Array<Record<string, unknown>>).not.toContainEqual(
          expect.objectContaining({ slug: "api-test-suite" }),
        );
        // The override's own tags appear in the distinct-tags surface.
        expect(await orgA.listTags()).toContain("override");
        // The unfiltered listing still shows the published override (published
        // wins), so the views cannot disagree about which api-test-suite exists.
        const afterOverrideList = await orgA.listSkills();
        expect(afterOverrideList.some((s: Record<string, unknown>) => s.slug === "api-test-suite" && s.publishedSource === "custom")).toBe(true);
      } finally {
        await ctx.stop();
      }
    });

    test("lists skills, runs a deterministic worker path, and downloads authorized artifacts", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const skills = await client.listSkills();
        expect(Array.isArray(skills)).toBe(true);
        expect(skills.some((skill) => skill.name === "video-highlight-pack")).toBe(true);

        const submitted = await client.submitRun("video-highlight-pack", { transcript: "Hello world from server-run skills." }, ["--title", "Demo"]);
        expect(submitted.status).toBe("queued");
        expect(submitted.id).toBeTruthy();

        expect(await runWorkerOnce(ctx.store, "worker_test")).toBe(true);
        const run = await client.getRun(submitted.id!);
        expect(run).toMatchObject({ status: "succeeded", skill: "video-highlight-pack" });

        const logs = await client.getRunLogs(submitted.id!);
        expect(logs.map((log) => log.message).join("\n")).toContain("generated");

        const artifacts = await client.getRunArtifacts(submitted.id!);
        expect(artifacts.map((artifact) => artifact.relativePath)).toContain("transcript.md");
        const transcript = artifacts.find((artifact) => artifact.relativePath === "transcript.md");
        const downloaded = await client.downloadRunArtifact(submitted.id!, transcript.id);
        expect(downloaded.status).toBe(200);
        expect(await downloaded.text()).toContain("Hello world");
      } finally {
        await ctx.stop();
      }
    });

    test("enforces organization ownership on run and artifact routes", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const submitted = await orgA.submitRun("video-highlight-pack", { text: "secret run text" }, []);
        expect(await runWorkerOnce(ctx.store, "worker_test")).toBe(true);

        const crossRun = await orgB.getRun(submitted.id!);
        expect(crossRun).toBeNull();

        const artifacts = await orgA.getRunArtifacts(submitted.id!);
        const denied = await orgB.downloadRunArtifact(submitted.id!, artifacts[0].id);
        expect(denied.status).toBe(404);

        // Ownership is enforced on every read, not only the two the original test
        // covered. Logs and the artifact list are the paths that would leak a run's
        // contents to the wrong tenant if the org predicate were dropped from a JOIN.
        expect(await orgB.getRunLogs(submitted.id!)).toEqual([]);
        const crossArtifacts = await fetch(`${ctx.baseUrl}/api/v1/runs/${submitted.id}/artifacts`, {
          headers: { authorization: "Bearer sk_test_org_b" },
        });
        expect(crossArtifacts.status).toBe(404);
        expect(await crossArtifacts.json()).toMatchObject({ code: "RUN_NOT_FOUND" });
        expect((await orgB.listRuns()).map((run: { id: string }) => run.id)).not.toContain(submitted.id);
      } finally {
        await ctx.stop();
      }
    });

    test("cancelling a queued run through the API makes it terminal: unclaimable and uncounted", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const submitted = await client.submitRun("video-highlight-pack", { text: "never run" }, []);
        expect(submitted.status).toBe("queued");

        // On the table-backed governance stores (sqlite/postgres) the active-run
        // count reads the same skills_runs table the product store writes, so the
        // queued run is counted before the cancel. The memory governance store is
        // a separate in-memory ledger this API path never seeds, so its count
        // cannot observe the run and the ceiling half of the assertion does not
        // apply there.
        const tableBacked = ctx.governanceStore.backend !== "memory";
        if (tableBacked) {
          expect(await ctx.governanceStore.activeRunCount("org_a")).toBe(1);
        }

        const res = await fetch(`${ctx.baseUrl}/api/v1/runs/${submitted.id}/cancel`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a" },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: submitted.id, status: "cancelled" });

        // Terminal: no worker pass can claim it again, and it no longer counts
        // toward the org's concurrency ceiling.
        expect(await ctx.store.claimNextRun({ workerId: "worker_test" })).toBeNull();
        expect((await client.getRun(submitted.id!))?.status).toBe("cancelled");
        if (tableBacked) {
          expect(await ctx.governanceStore.activeRunCount("org_a")).toBe(0);
        }

        // Org isolation is preserved: another org cannot cancel this org's run.
        const denied = await fetch(`${ctx.baseUrl}/api/v1/runs/${submitted.id}/cancel`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_b" },
        });
        expect(denied.status).toBe(404);
        expect((await client.getRun(submitted.id!))?.status).toBe("cancelled");
      } finally {
        await ctx.stop();
      }
    });

    test("cancelling a claimed run fences the worker's generation so its late finish is refused", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const submitted = await client.submitRun("video-highlight-pack", { text: "claimed" }, []);
        const claimed = await ctx.store.claimNextRun({ workerId: "worker_fenced" });
        expect(claimed?.id).toBe(submitted.id);
        expect(claimed?.leaseGeneration).toBeGreaterThan(0);
        const workerGeneration = claimed!.leaseGeneration;

        const res = await fetch(`${ctx.baseUrl}/api/v1/runs/${submitted.id}/cancel`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a" },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: submitted.id, status: "cancelled" });

        // The worker's late terminal write is refused by the generation fence
        // the cancellation raised; the run stays cancelled.
        await expect(ctx.store.transitionRun!(submitted.id!, { status: "succeeded" }, workerGeneration)).rejects.toThrow(/lease_generation/);
        expect((await client.getRun(submitted.id!))?.status).toBe("cancelled");
      } finally {
        await ctx.stop();
      }
    });

    test("publishes a skill, serves it alongside the bundled corpus, and returns its bundle intact", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");

        const published = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);
        expect(await published.json()).toMatchObject({
          slug: "team-runbook",
          name: "team-runbook",
          displayName: "alpha Runbook",
          version: "1.2.3",
          kind: "executable",
          source: "remote",
          publishedSource: "custom",
          bundleSha256: bundle.sha256,
          bundleByteSize: bundle.bytes.byteLength,
        });

        const listed = await client.listSkills();
        expect(listed.some((skill) => skill.name === "team-runbook")).toBe(true);
        // Merged, not replaced: a bundled skill must still be there.
        expect(listed.some((skill) => skill.name === "video-highlight-pack")).toBe(true);

        expect(await client.getSkill("team-runbook")).toMatchObject({ slug: "team-runbook", bundleSha256: bundle.sha256 });
        expect(await client.getSkillMd("team-runbook")).toBe(bundle.skillMd);

        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(download.headers.get("x-skill-bundle-sha256")).toBe(bundle.sha256);
        const bytes = new Uint8Array(await download.arrayBuffer());
        expect(Array.from(bytes)).toEqual(Array.from(bundle.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("serves X-Skill-Bundle-Signature over the exact served bytes when a signing key is configured", async () => {
      const ctx = await testServer(backend, { bundleSigningKey: "test-signing-key-0123456789" });
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("signed");

        const published = await client.publishSkill(manifestFor("signed-runbook", "signed", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);

        const download = await client.downloadSkillBundle("signed-runbook");
        expect(download.status).toBe(200);
        const signature = download.headers.get("x-skill-bundle-signature");
        expect(signature).toBeTruthy();
        const bytes = new Uint8Array(await download.arrayBuffer());
        expect(Array.from(bytes)).toEqual(Array.from(bundle.bytes));
        expect(verifyBundleSignature(bytes, signature!, "test-signing-key-0123456789")).toBe(true);
      } finally {
        await ctx.stop();
      }
    });

    test("does not emit X-Skill-Bundle-Signature when no signing key is configured", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("unsigned");

        const published = await client.publishSkill(manifestFor("unsigned-runbook", "unsigned", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);

        const download = await client.downloadSkillBundle("unsigned-runbook");
        expect(download.status).toBe(200);
        expect(download.headers.get("x-skill-bundle-signature")).toBeNull();
        expect(download.headers.get("x-skill-bundle-sha256")).toBe(bundle.sha256);
      } finally {
        await ctx.stop();
      }
    });

    test("a published skill overrides a bundled skill of the same slug for that org only", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const bundle = fixtureBundle("override");

        await orgA.publishSkill(manifestFor("video-highlight-pack", "override", bundle.skillMd, bundle.sha256), bundle.bytes);

        expect(await orgA.getSkill("video-highlight-pack")).toMatchObject({ description: "override deployment runbook", source: "remote" });
        const listedA = await orgA.listSkills();
        expect(listedA.filter((skill) => skill.name === "video-highlight-pack")).toHaveLength(1);
        expect(listedA.find((skill) => skill.name === "video-highlight-pack")).toMatchObject({ displayName: "override Runbook" });

        // Org B still sees the bundled one, unchanged.
        const bundledForB = await orgB.getSkill("video-highlight-pack");
        expect(bundledForB.description).not.toBe("override deployment runbook");
        expect((await orgB.downloadSkillBundle("video-highlight-pack")).status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });

    test("published skills are invisible and untouchable across organizations", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const alpha = fixtureBundle("alpha");

        await orgA.publishSkill(manifestFor("team-runbook", "alpha", alpha.skillMd, alpha.sha256), alpha.bytes);

        // Anti-vacuity control FIRST: org A can read its own skill through every route
        // below. Without this, all the 404 assertions would pass just as well against a
        // server that had failed to store anything at all.
        expect(await orgA.getSkill("team-runbook")).toMatchObject({ slug: "team-runbook" });
        expect((await orgA.listSkills()).some((skill) => skill.name === "team-runbook")).toBe(true);
        expect((await orgA.downloadSkillBundle("team-runbook")).status).toBe(200);
        expect(await orgA.getSkillMd("team-runbook")).toBe(alpha.skillMd);

        // Org B: every read path.
        expect((await orgB.listSkills()).some((skill) => skill.name === "team-runbook")).toBe(false);
        expect(await orgB.getSkill("team-runbook")).toBeNull();
        expect(await orgB.getSkillMd("team-runbook")).toBeNull();
        expect((await orgB.downloadSkillBundle("team-runbook")).status).toBe(404);

        // Org B: every write path. A cross-org DELETE that reported success would be the
        // worst of these, since it destroys rather than discloses.
        expect((await orgB.deleteSkill("team-runbook")).status).toBe(404);
        const crossUpdate = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_b", "content-type": "application/json" },
          body: JSON.stringify({ description: "hijacked" }),
        });
        expect(crossUpdate.status).toBe(404);

        // Org A is untouched by all of that.
        expect(await orgA.getSkill("team-runbook")).toMatchObject({ description: "alpha deployment runbook" });

        // Org B publishes the SAME slug with DIFFERENT bytes. Each org must read its own.
        const beta = fixtureBundle("beta");
        expect(beta.sha256).not.toBe(alpha.sha256);
        expect((await orgB.publishSkill(manifestFor("team-runbook", "beta", beta.skillMd, beta.sha256, "1.2.4"), beta.bytes)).status).toBe(201);

        expect(await orgA.getSkill("team-runbook")).toMatchObject({ bundleSha256: alpha.sha256, description: "alpha deployment runbook" });
        expect(await orgB.getSkill("team-runbook")).toMatchObject({ bundleSha256: beta.sha256, description: "beta deployment runbook" });
        expect(await orgA.getSkillMd("team-runbook")).toBe(alpha.skillMd);
        expect(await orgB.getSkillMd("team-runbook")).toBe(beta.skillMd);

        const downloadedA = new Uint8Array(await (await orgA.downloadSkillBundle("team-runbook")).arrayBuffer());
        const downloadedB = new Uint8Array(await (await orgB.downloadSkillBundle("team-runbook")).arrayBuffer());
        expect(Array.from(downloadedA)).toEqual(Array.from(alpha.bytes));
        expect(Array.from(downloadedB)).toEqual(Array.from(beta.bytes));

        // Deleting B's copy must leave A's alone, including A's stored blob.
        expect((await orgB.deleteSkill("team-runbook")).status).toBe(200);
        expect(await orgB.getSkill("team-runbook")).toBeNull();
        expect((await orgA.downloadSkillBundle("team-runbook")).status).toBe(200);
        expect(Array.from(new Uint8Array(await (await orgA.downloadSkillBundle("team-runbook")).arrayBuffer()))).toEqual(Array.from(alpha.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("a published skill with no SKILL.md does not serve the bundled skill's instructions", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("shadow");

        // Control: the bundled skill's document is served before anything is published,
        // so the null below is the override taking effect and not a route that never works.
        const bundledDoc = await client.getSkillMd("video-highlight-pack");
        expect(bundledDoc).toBeTruthy();

        const manifest = manifestFor("video-highlight-pack", "shadow", "", bundle.sha256);
        delete manifest.skillMd;
        expect((await client.publishSkill(manifest, bundle.bytes)).status).toBe(201);

        // Falling through to the bundled document here would hand an agent one skill's
        // instructions under another skill's name - the published row is what this
        // instance serves under that slug, and it has no document.
        expect(await client.getSkillMd("video-highlight-pack")).toBeNull();
        expect(await client.getSkill("video-highlight-pack")).toMatchObject({ description: "shadow deployment runbook" });
      } finally {
        await ctx.stop();
      }
    });

    test("a metadata-only re-publish keeps the stored bundle instead of destroying it", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        const published = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);
        const firstPayload = await published.json();
        expect((await client.downloadSkillBundle("team-runbook")).status).toBe(200);

        // POST with JSON and no bundle part. This used to take the upsert path with a
        // NULL digest, hand the old digest to orphan collection, and delete the tarball -
        // so a metadata edit silently 404ed the bundle for every client, irreversibly.
        // The write is guarded: it names the revision the client read (If-Match).
        const metadataOnly = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json", "if-match": firstPayload.revisionId },
          body: JSON.stringify({ slug: "team-runbook", description: "just fixing a typo" }),
        });
        expect(metadataOnly.status).toBe(201);
        expect(await metadataOnly.json()).toMatchObject({ description: "just fixing a typo", bundleSha256: bundle.sha256 });

        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(bundle.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("refuses multipart parts the endpoint did not ask for", async () => {
      const ctx = await testServer(backend);
      try {
        const bundle = fixtureBundle("alpha");
        const form = new FormData();
        form.set("manifest", JSON.stringify(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256)));
        form.set("bundle", new Blob([bundle.bytes as BlobPart], { type: "application/gzip" }), "b.tar.gz");
        // Only `manifest` and `bundle` were ever measured, so extra parts were buffered
        // and counted against nothing - a hole straight through the configured cap.
        form.set("filler", "x".repeat(50_000));

        const response = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a" },
          body: form,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "UNEXPECTED_PART" });

        // Control: the identical request without the extra part succeeds, so the 400 is
        // the new refusal and not a broken multipart body.
        const clean = new FormData();
        clean.set("manifest", JSON.stringify(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256)));
        clean.set("bundle", new Blob([bundle.bytes as BlobPart], { type: "application/gzip" }), "b.tar.gz");
        const ok = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST", headers: { authorization: "Bearer sk_test_org_a" }, body: clean,
        });
        expect(ok.status).toBe(201);
      } finally {
        await ctx.stop();
      }
    });

    test("rejects a bundle whose bytes do not match the declared digest", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        const wrongDigest = "0".repeat(64);
        const response = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, wrongDigest), bundle.bytes);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "BUNDLE_DIGEST_MISMATCH" });
        // Nothing was stored: a rejected publish must not leave a half-published skill.
        expect(await client.getSkill("team-runbook")).toBeNull();
      } finally {
        await ctx.stop();
      }
    });

    test("refuses an oversized bundle without letting it reach the JSON reader", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        // The server's own limit, not the client's: lowered per-fixture so the test does
        // not have to transfer 25 MB to prove the cap exists.
        const small = await createSkillsFetchHandler({
          store: ctx.store,
          config: { inlineWorker: false, allowEphemeralStore: true, skillBundleLimitBytes: 128 },
        });
        const server = Bun.serve({ port: 0, fetch: small });
        try {
          const capped = new RemoteSkillsClient("sk_test_org_a", `http://127.0.0.1:${server.port}`);
          const response = await capped.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
          expect(response.status).toBe(413);
          expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
          // Control: the same request succeeds against the default limit, so the 413 is
          // the cap firing rather than the request being broken.
          expect((await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes)).status).toBe(201);
        } finally {
          server.stop(true);
        }
      } finally {
        await ctx.stop();
      }
    });

    test("rejects a slug that is not a valid skill name", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        for (const slug of ["../etc/passwd", "Has Spaces", "UPPER", "-leading-dash", ""]) {
          const response = await client.publishSkill(
            { ...manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), slug },
            bundle.bytes,
          );
          expect([400, 404]).toContain(response.status);
        }
      } finally {
        await ctx.stop();
      }
    });

    test("updates metadata in place and leaves the bundle attached", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        const current = await client.getSkill("team-runbook");

        // The update is guarded like every write to a live row: If-Match carries the
        // revision id the client read (the ETag value the server issued).
        const patched = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json", "if-match": current.revisionId },
          body: JSON.stringify({ description: "now with more detail" }),
        });
        expect(patched.status).toBe(200);
        const patchedPayload = await patched.json();
        expect(patchedPayload).toMatchObject({
          description: "now with more detail",
          // Untouched by a patch that did not mention them.
          version: "1.2.3",
          displayName: "alpha Runbook",
          bundleSha256: bundle.sha256,
        });
        // The revision advanced with the write and is echoed in the ETag.
        expect(patchedPayload.revisionId).not.toBe(current.revisionId);
        expect(patched.headers.get("etag")).toBe(`"${patchedPayload.revisionId}"`);
        expect((await client.downloadSkillBundle("team-runbook")).status).toBe(200);

        // A stale guard is refused with 409, never applied.
        const stale = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json", "if-match": current.revisionId },
          body: JSON.stringify({ description: "replayed write" }),
        });
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });

        // A patch against a slug this org never published is a 404, not an implicit create.
        const missing = await fetch(`${ctx.baseUrl}/api/v1/skills/never-published`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json" },
          body: JSON.stringify({ description: "x" }),
        });
        expect(missing.status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });

    test("a second publish of the same slug without If-Match gets 409 and the first survives", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const alpha = fixtureBundle("alpha");
        const beta = fixtureBundle("beta");
        const first = await client.publishSkill(manifestFor("team-runbook", "alpha", alpha.skillMd, alpha.sha256), alpha.bytes);
        expect(first.status).toBe(201);
        const firstPayload = await first.json();

        // Same slug, different bytes, no If-Match: refused, never a silent overwrite.
        const second = await client.publishSkill(manifestFor("team-runbook", "beta", beta.skillMd, beta.sha256, "1.2.4"), beta.bytes);
        expect(second.status).toBe(409);
        expect(await second.json()).toMatchObject({ code: "REVISION_CONFLICT", slug: "team-runbook" });

        // A stale If-Match is refused identically.
        const stale = await client.publishSkill(manifestFor("team-runbook", "beta", beta.skillMd, beta.sha256, "1.2.4"), beta.bytes, "0".repeat(64));
        expect(stale.status).toBe(409);

        // A guarded publish with the current revision lands.
        const guarded = await client.publishSkill(manifestFor("team-runbook", "beta", beta.skillMd, beta.sha256, "1.2.4"), beta.bytes, firstPayload.revisionId);
        expect(guarded.status).toBe(201);

        // The first publish's bytes were overwritten only by the guarded write: the
        // unguarded and stale attempts changed nothing in between.
        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(beta.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("GET returns the ETag and the bundle carries the revision headers", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        const published = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);
        expect(published.headers.get("etag")).toBeTruthy();

        const get = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(get.status).toBe(200);
        const etag = get.headers.get("etag");
        expect(etag).toBeTruthy();
        const payload = await get.json();
        expect(payload.revisionId).toBeTruthy();
        expect(payload.revisionNumber).toBeGreaterThanOrEqual(1);
        // The ETag IS the revision id, quoted exactly as RFC 9110 wants.
        expect(etag).toBe(`"${payload.revisionId}"`);

        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(download.headers.get("x-skill-revision-id")).toBe(payload.revisionId);
        expect(download.headers.get("x-skill-revision-number")).toBe(String(payload.revisionNumber));
        expect(download.headers.get("etag")).toBe(etag);
      } finally {
        await ctx.stop();
      }
    });

    test("If-Match '*' is refused as a statement about the request, not a pass", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);

        const wildcard = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes, "*");
        expect(wildcard.status).toBe(400);
        expect(await wildcard.json()).toMatchObject({ code: "INVALID_IF_MATCH" });
      } finally {
        await ctx.stop();
      }
    });

    test("delete tombstones the slug: 410 with the marker while the window is open, 404 after expiry", async () => {
      const ctx = await testServer(backend, { tombstoneWindowMs: 500 });
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);

        const deleted = await client.deleteSkill("team-runbook");
        expect(deleted.status).toBe(200);
        const deletedPayload = await deleted.json();
        expect(deletedPayload).toMatchObject({ deleted: true, slug: "team-runbook" });
        expect(deletedPayload.tombstonedAt).toBeTruthy();
        expect(deletedPayload.tombstonePurgeAfter).toBeTruthy();

        // Every read route answers 410 with the marker while the window is open.
        const get = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(get.status).toBe(410);
        expect(await get.json()).toMatchObject({ deleted: true, code: "TOMBSTONED", slug: "team-runbook" });

        const md = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook/skill.md`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(md.status).toBe(410);

        const dl = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook/bundle`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(dl.status).toBe(410);

        // The slug is hidden from listings.
        expect((await client.listSkills()).some((skill: { name: string }) => skill.name === "team-runbook")).toBe(false);

        // After the window expires, the next read purges and the slug is simply gone.
        await new Promise((resolve) => setTimeout(resolve, 600));
        const gone = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, { headers: { authorization: "Bearer sk_test_org_a" } });
        expect(gone.status).toBe(404);
        expect((await client.downloadSkillBundle("team-runbook")).status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });
  });
}
