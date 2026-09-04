/**
 * Behaviours that must be identical on every backend, asserted against each of them.
 *
 * These are the divergences an adversarial review actually found between the SQLite and
 * Postgres implementations - not hypotheticals. Each one is written as a single
 * expectation run per backend, so "SQLite behaves like Postgres" is a property the suite
 * checks rather than a claim the module header makes.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import { revisionIdOfRecord } from "../lib/revision.js";
import { publicPrincipal } from "./auth.js";
import { resolveStoreBackends } from "./store-fixtures.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ORG: Partial<ApiPrincipal> = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
const OTHER_ORG: Partial<ApiPrincipal> = { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" };
const backends = await resolveStoreBackends();

async function seeded(backend: (typeof backends)[number]) {
  const fixture = await backend.create([
    { token: "sk_parity", principal: ORG },
    { token: "sk_parity_other", principal: OTHER_ORG },
  ]);
  return { ...fixture, principal: publicPrincipal(ORG), otherPrincipal: publicPrincipal(OTHER_ORG) };
}

/** Distinguishable bytes, so "read its own" and "read the other org's" are different answers. */
function bundleBytes(marker: string): OwnedBytes {
  return ownBytes(new TextEncoder().encode(`bundle:${marker}:${"x".repeat(64)}`));
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * `version` defaults to 1.0.0. Pass a different one for a republish with different bytes
 * (versions are immutable, hasna/apps#1630) and null for an unversioned publish, which is
 * the only kind whose superseded bundle is still collectable.
 */
function publishInput(principal: ApiPrincipal, slug: string, marker: string, bytes?: OwnedBytes, version: string | null = "1.0.0") {
  return {
    principal,
    slug,
    displayName: `${marker} display`,
    description: `${marker} description`,
    category: "Development Tools",
    tags: [marker],
    source: "custom",
    kind: "executable" as const,
    ...(version === null ? {} : { version }),
    skillMd: `# ${marker}\n`,
    ...(bytes
      ? { bundle: { sha256: digestOf(bytes), byteSize: bytes.byteLength, contentType: "application/gzip", storageKind: "db" as const, bytes } }
      : {}),
  };
}

async function newRun(store: SkillsProductStore, principal: ApiPrincipal) {
  return store.createRun({ principal, slug: "audio-transcript-pack", input: {}, args: [] });
}

for (const backend of backends) {
  describe(`store parity (${backend.name})`, () => {
    test("concurrent appendLog calls all succeed with distinct sequences", async () => {
      const fixture = await seeded(backend);
      try {
        const run = await newRun(fixture.store, fixture.principal);
        // Postgres previously lost this race: SELECT MAX+1 then INSERT, with an await
        // between, gave 1 success and 4 `duplicate key value violates unique constraint`
        // - and executeRun's catch turns a logging failure into a failed run. Folding
        // MAX into the INSERT was not enough either, because READ COMMITTED hands every
        // concurrent statement the same snapshot.
        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) => fixture.store.appendLog(run.id, fixture.principal.orgId, "info", `message ${i}`)),
        );
        expect(results.filter((r) => r.status === "rejected")).toEqual([]);

        const sequences = (await fixture.store.listLogs(fixture.principal, run.id)).map((log) => log.sequence).sort((a, b) => a - b);
        expect(sequences).toEqual([1, 2, 3, 4, 5]);
      } finally {
        await fixture.close();
      }
    }, 30_000);

    test("listRuns treats a nonsensical limit the same way everywhere", async () => {
      const fixture = await seeded(backend);
      try {
        for (let i = 0; i < 3; i += 1) await newRun(fixture.store, fixture.principal);

        expect(await fixture.store.listRuns(fixture.principal, 2)).toHaveLength(2);
        expect(await fixture.store.listRuns(fixture.principal, 0)).toHaveLength(0);
        // SQLite reads LIMIT -1 as *unlimited*, so an unnormalised negative limit
        // returned the org's entire history from the one argument whose job is to bound
        // the response, while Postgres threw. Neither is acceptable; both now clamp.
        expect(await fixture.store.listRuns(fixture.principal, -1)).toHaveLength(0);
        expect(await fixture.store.listRuns(fixture.principal, 1.5)).toHaveLength(1);
        expect(await fixture.store.listRuns(fixture.principal, Number.NaN)).toHaveLength(0);
      } finally {
        await fixture.close();
      }
    });

    test("updateRun on an unknown id returns null rather than throwing", async () => {
      const fixture = await seeded(backend);
      try {
        expect(await fixture.store.updateRun("run_does_not_exist", { status: "failed" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("claiming drains the queue exactly once and then reports empty", async () => {
      const fixture = await seeded(backend);
      try {
        const runs = [await newRun(fixture.store, fixture.principal), await newRun(fixture.store, fixture.principal)];
        const claimed = [
          await fixture.store.claimNextRun({ workerId: "w1" }),
          await fixture.store.claimNextRun({ workerId: "w2" }),
        ];
        expect(claimed.map((run) => run?.id).sort()).toEqual(runs.map((run) => run.id).sort());
        expect(claimed.every((run) => run?.status === "running")).toBe(true);
        expect(await fixture.store.claimNextRun({ workerId: "w3" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("a createRun replay with the same idempotency key returns the first run", async () => {
      const fixture = await seeded(backend);
      try {
        // The replay is a read of the first run, never a second INSERT: on Postgres
        // the dedupe pre-read must run inside the RLS tenant context, because a
        // pooled connection carries no context between requests and the 0003 policy
        // (`org_id = current_setting('app.skills_org_id', true) OR ...`) hides the
        // first row from a context-less read - which would fall through to the
        // INSERT and violate the partial unique index skills_runs_org_idempotency_idx.
        // A superuser role bypasses RLS, so this assertion binds only when the
        // postgres backend runs as a non-superuser role (HASNA_SKILLS_TEST_DATABASE_URL).
        const first = await fixture.store.createRun({
          principal: fixture.principal,
          slug: "audio-transcript-pack",
          input: {},
          args: [],
          idempotencyKey: "parity-replay-key",
        });
        const replay = await fixture.store.createRun({
          principal: fixture.principal,
          slug: "audio-transcript-pack",
          input: {},
          args: [],
          idempotencyKey: "parity-replay-key",
        });
        expect(replay.id).toBe(first.id);

        // The same key in a different org is a distinct run: the uniqueness
        // constraint is (org_id, idempotency_key), so one tenant's key cannot
        // collide with - or reveal - another's.
        const other = await fixture.store.createRun({
          principal: fixture.otherPrincipal,
          slug: "audio-transcript-pack",
          input: {},
          args: [],
          idempotencyKey: "parity-replay-key",
        });
        expect(other.id).not.toBe(first.id);
        expect(other.orgId).toBe("org_b");
      } finally {
        await fixture.close();
      }
    });

    test("authentication is repeatable and does not depend on a per-request write landing", async () => {
      const fixture = await seeded(backend);
      try {
        const { hashApiKey } = await import("./auth.js");
        const hash = hashApiKey("sk_parity");
        // SQLite now refreshes last_used_at at most once a minute rather than on every
        // call, because that write is synchronous and blocked the whole event loop.
        // Repeated authentication must still return the identical principal.
        const first = await fixture.store.authenticateApiKeyHash(hash);
        const second = await fixture.store.authenticateApiKeyHash(hash);
        expect(second).toEqual(first);
        expect(first).toMatchObject({ orgId: "org_a", scopes: ["skills:read", "runs:write"] });
      } finally {
        await fixture.close();
      }
    });

    test("published skills and their bundles are scoped to the publishing org", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        const beta = bundleBytes("beta");
        expect(digestOf(alpha)).not.toBe(digestOf(beta));

        await fixture.store.publishSkill(publishInput(fixture.principal, "shared-slug", "alpha", alpha));
        await fixture.store.publishSkill(publishInput(fixture.otherPrincipal, "shared-slug", "beta", beta));

        // The same slug in two orgs is two rows, not one overwritten row. This is what
        // the composite (org_id, slug) primary key buys, and the reason 0002 had to
        // rebuild the table rather than add a column.
        const mine = await fixture.store.getSkill(fixture.principal, "shared-slug");
        const theirs = await fixture.store.getSkill(fixture.otherPrincipal, "shared-slug");
        expect(mine).toMatchObject({ orgId: "org_a", description: "alpha description" });
        expect(theirs).toMatchObject({ orgId: "org_b", description: "beta description" });

        expect((await fixture.store.listSkills(fixture.principal)).map((s) => s.description)).toEqual(["alpha description"]);
        expect((await fixture.store.listSkills(fixture.otherPrincipal)).map((s) => s.description)).toEqual(["beta description"]);

        // A digest is not a capability: knowing org A's digest must not fetch its bytes.
        expect(await fixture.store.getSkillBundle(fixture.otherPrincipal, digestOf(alpha))).toBeNull();
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(beta))).toBeNull();

        const ownBundle = await fixture.store.getSkillBundle(fixture.principal, digestOf(alpha));
        expect(ownBundle).toBeTruthy();
        expect(Array.from(ownBundle!.bytes!)).toEqual(Array.from(alpha));
      } finally {
        await fixture.close();
      }
    });

    test("a cross-org delete or update reports not-found and changes nothing", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        await fixture.store.publishSkill(publishInput(fixture.principal, "only-mine", "alpha", alpha));

        expect(await fixture.store.deleteSkill(fixture.otherPrincipal, "only-mine", 60_000)).toBeNull();
        expect(await fixture.store.updateSkill(fixture.otherPrincipal, "only-mine", { description: "hijacked" })).toBeNull();

        expect(await fixture.store.getSkill(fixture.principal, "only-mine")).toMatchObject({ description: "alpha description" });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(alpha))).toBeTruthy();

        // The owning org can, which is what makes the two refusals above mean something.
        // Under the tombstone contract the row is stamped rather than dropped; the slug
        // stays hidden from listings and the bundle survives until the purge.
        const deleted = await fixture.store.deleteSkill(fixture.principal, "only-mine", 60_000);
        expect(deleted).toBeTruthy();
        expect(deleted!.tombstonedAt).toBeTruthy();
        expect(deleted!.tombstonePurgeAfter).toBeTruthy();
        expect(await fixture.store.getSkill(fixture.principal, "only-mine")).toMatchObject({ tombstonedAt: deleted!.tombstonedAt });
        expect((await fixture.store.listSkills(fixture.principal)).map((s) => s.slug)).not.toContain("only-mine");
        // The tombstoned row still references the blob; only the purge collects it.
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(alpha))).toBeTruthy();
      } finally {
        await fixture.close();
      }
    });

    test("republishing replaces the bundle and collects the one nothing references", async () => {
      const fixture = await seeded(backend);
      try {
        const first = bundleBytes("first");
        const second = bundleBytes("second");
        // Unversioned publishes: a version row would pin the first bundle (see the next test).
        await fixture.store.publishSkill(publishInput(fixture.principal, "evolving", "first", first, null));
        const v1 = await fixture.store.getSkill(fixture.principal, "evolving");
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(first))).toBeTruthy();

        // A guarded republish: the guard names the revision the client read.
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "evolving", "second", second, null), expectedRevisionId: v1!.revisionId });
        expect(await fixture.store.getSkill(fixture.principal, "evolving")).toMatchObject({ bundleSha256: digestOf(second) });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(second))).toBeTruthy();
        // The superseded blob is gone rather than accumulating on every push.
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(first))).toBeNull();

        // Publishing is an upsert: one row, not two.
        expect(await fixture.store.listSkills(fixture.principal)).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    });

    test("a bundle referenced by an immutable version survives the republish that supersedes it", async () => {
      const fixture = await seeded(backend);
      try {
        const first = bundleBytes("v-first");
        const second = bundleBytes("v-second");
        await fixture.store.publishSkill(publishInput(fixture.principal, "kept", "first", first, "1.0.0"));
        const v1 = await fixture.store.getSkill(fixture.principal, "kept");
        // Same version, different bytes: refused, and nothing changed.
        await expect(
          fixture.store.publishSkill({ ...publishInput(fixture.principal, "kept", "second", second, "1.0.0"), expectedRevisionId: v1!.revisionId }),
        ).rejects.toMatchObject({ name: "SkillVersionExistsError", slug: "kept", version: "1.0.0" });
        expect(await fixture.store.getSkill(fixture.principal, "kept")).toMatchObject({ bundleSha256: digestOf(first), revisionId: v1!.revisionId });
        // Same version, same bytes: idempotent.
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "kept", "first", first, "1.0.0"), expectedRevisionId: v1!.revisionId });
        expect(await fixture.store.listSkillVersions(fixture.principal, "kept")).toHaveLength(1);
        // A new version supersedes the row but the old bundle stays: a version references it.
        const v2 = await fixture.store.getSkill(fixture.principal, "kept");
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "kept", "second", second, "1.0.1"), expectedRevisionId: v2!.revisionId });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(first))).toBeTruthy();
        expect((await fixture.store.listSkillVersions(fixture.principal, "kept")).map((v) => [v.version, v.bundleSha256])).toEqual([
          ["1.0.1", digestOf(second)],
          ["1.0.0", digestOf(first)],
        ]);
        expect(await fixture.store.getSkillVersion(fixture.principal, "kept", "1.0.0")).toMatchObject({ bundleSha256: digestOf(first), bundleByteSize: first.byteLength });
        expect(await fixture.store.getSkillVersion(fixture.otherPrincipal, "kept", "1.0.0")).toBeNull();
        expect(await fixture.store.listSkillVersions(fixture.otherPrincipal, "kept")).toEqual([]);
      } finally {
        await fixture.close();
      }
    });

    test("a bundle shared by two skills survives deleting one of them", async () => {
      const fixture = await seeded(backend);
      try {
        const shared = bundleBytes("shared");
        await fixture.store.publishSkill(publishInput(fixture.principal, "skill-one", "shared", shared, null));
        await fixture.store.publishSkill(publishInput(fixture.principal, "skill-two", "shared", shared, null));

        // Window 0: the purge is due immediately but runs only when invoked, so the
        // tombstone semantics stay observable in between.
        expect(await fixture.store.deleteSkill(fixture.principal, "skill-one", 0)).toBeTruthy();
        // Content addressing means one blob backs both rows; collecting it here would
        // silently empty a skill that was never touched.
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(shared))).toBeTruthy();

        // Both rows are tombstoned (not hard-deleted), so both still reference the blob;
        // only the purge collects it.
        expect(await fixture.store.deleteSkill(fixture.principal, "skill-two", 0)).toBeTruthy();
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(shared))).toBeTruthy();

        await fixture.store.purgeExpiredTombstones(fixture.principal);
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(shared))).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("a metadata-only publish and update leave optional fields well-defined", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "prose-only", "prose"));
        const record = await fixture.store.getSkill(fixture.principal, "prose-only");
        expect(record).toMatchObject({ slug: "prose-only", version: "1.0.0" });
        expect(record!.bundleSha256).toBeUndefined();
        expect(record!.bundleByteSize).toBeUndefined();
        expect(record!.publishedByUserId).toBe("user_a");
        expect(record!.revisionId).toBeTruthy();
        expect(record!.revisionNumber).toBe(1);

        // The update is guarded by the revision the client read, like every write to a
        // live row under the optimistic-concurrency contract.
        const updated = await fixture.store.updateSkill(fixture.principal, "prose-only", { description: "revised" }, record!.revisionId);
        expect(updated).toMatchObject({ description: "revised", version: "1.0.0", displayName: "prose display" });
        expect(updated!.revisionId).not.toBe(record!.revisionId);
        expect(updated!.revisionNumber).toBe(2);
        expect(await fixture.store.updateSkill(fixture.principal, "never-existed", { description: "x" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("pins round-trip and are scoped to org and principal", async () => {
      const fixture = await seeded(backend);
      try {
        const pin = await fixture.store.pinSkill(fixture.principal, "deploy-notes", { reason: "team default" });
        expect(pin).toMatchObject({ orgId: "org_a", principal: "key_a", slug: "deploy-notes", metadata: { reason: "team default" } });
        expect(pin.pinnedAt).toBeTruthy();

        // Same slug, another org: a distinct pin, not the same row.
        await fixture.store.pinSkill(fixture.otherPrincipal, "deploy-notes");
        expect((await fixture.store.listPins(fixture.principal)).map((p) => p.slug)).toEqual(["deploy-notes"]);
        expect((await fixture.store.listPins(fixture.otherPrincipal)).map((p) => p.slug)).toEqual(["deploy-notes"]);

        // Another API key in the SAME org is a different principal: its pin set is its own.
        const sameOrgOtherKey = publicPrincipal({ ...ORG, apiKeyId: "key_a2" });
        expect(await fixture.store.listPins(sameOrgOtherKey)).toEqual([]);
        await fixture.store.pinSkill(sameOrgOtherKey, "deploy-notes", { scope: "personal" });
        expect((await fixture.store.listPins(sameOrgOtherKey)).map((p) => p.slug)).toEqual(["deploy-notes"]);

        // Cross-org read of a slug known to exist in org A returns nothing.
        expect((await fixture.store.listPins(fixture.otherPrincipal)).map((p) => p.slug)).toEqual(["deploy-notes"]);
        expect((await fixture.store.listPins(fixture.otherPrincipal))[0]).toMatchObject({ orgId: "org_b", principal: "key_b" });
      } finally {
        await fixture.close();
      }
    });

    test("a second publish without a revision guard is refused and the first survives", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        const beta = bundleBytes("beta");
        await fixture.store.publishSkill(publishInput(fixture.principal, "contended", "alpha", alpha));
        const first = await fixture.store.getSkill(fixture.principal, "contended");

        // Missing guard against a live row: refused with a conflict, never a silent overwrite.
        await expect(fixture.store.publishSkill(publishInput(fixture.principal, "contended", "beta", beta))).rejects.toMatchObject({
          name: "SkillRevisionConflictError",
          slug: "contended",
          currentRevisionId: first!.revisionId,
        });
        // A stale guard is refused identically.
        await expect(
          fixture.store.publishSkill({ ...publishInput(fixture.principal, "contended", "beta", beta), expectedRevisionId: "0".repeat(64) }),
        ).rejects.toMatchObject({ name: "SkillRevisionConflictError" });

        // The first publish survived untouched, and the refused bytes were never stored.
        const after = await fixture.store.getSkill(fixture.principal, "contended");
        expect(after).toMatchObject({ bundleSha256: digestOf(alpha), revisionId: first!.revisionId, revisionNumber: first!.revisionNumber });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(beta))).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("tags list and tag-filtered skills are scoped to the org and exact-match", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "alpha-skill", "alpha"));
        await fixture.store.publishSkill(publishInput(fixture.principal, "ops-skill", "ops"));
        await fixture.store.publishSkill(publishInput(fixture.otherPrincipal, "beta-skill", "beta"));

        // Distinct tags of THIS org's published skills only, sorted, no duplicates.
        expect(await fixture.store.listTags(fixture.principal)).toEqual(["alpha", "ops"]);
        expect(await fixture.store.listTags(fixture.otherPrincipal)).toEqual(["beta"]);

        // Tag filter is exact-match and org-scoped.
        expect((await fixture.store.listSkillsByTag(fixture.principal, "alpha")).map((s) => s.slug)).toEqual(["alpha-skill"]);
        expect((await fixture.store.listSkillsByTag(fixture.otherPrincipal, "alpha"))).toEqual([]);
        expect((await fixture.store.listSkillsByTag(fixture.principal, "beta"))).toEqual([]);

        // A tag that exists nowhere matches nothing; a case-twisted tag does not match.
        expect(await fixture.store.listSkillsByTag(fixture.principal, "zzz-none")).toEqual([]);
        expect(await fixture.store.listSkillsByTag(fixture.principal, "ALPHA")).toEqual([]);

        // Republishing with changed tags moves the skill between filters. The
        // revision guard is required on the T8 write path, so it is passed.
        const before = await fixture.store.getSkill(fixture.principal, "alpha-skill");
        await fixture.store.updateSkill(fixture.principal, "alpha-skill", { tags: ["ops"] }, before!.revisionId);
        expect((await fixture.store.listSkillsByTag(fixture.principal, "alpha"))).toEqual([]);
        expect((await fixture.store.listSkillsByTag(fixture.principal, "ops")).map((s) => s.slug)).toEqual(["alpha-skill", "ops-skill"]);
        expect(await fixture.store.listTags(fixture.principal)).toEqual(["ops"]);
      } finally {
        await fixture.close();
      }
    });

    test("pins filter by tag through the tag projection, and purge clears it", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "alpha-skill", "alpha"));
        await fixture.store.pinSkill(fixture.principal, "alpha-skill");
        // A pin of a slug with no registry row carries no tags in the projection.
        await fixture.store.pinSkill(fixture.principal, "unpublished-skill");

        expect((await fixture.store.listPinsByTag(fixture.principal, "alpha")).map((p) => p.slug)).toEqual(["alpha-skill"]);
        expect((await fixture.store.listPinsByTag(fixture.otherPrincipal, "alpha"))).toEqual([]);
        expect(await fixture.store.listPinsByTag(fixture.principal, "zzz-none")).toEqual([]);

        // T8 delete tombstones; with a zero window the tombstone is already
        // expired, so the next tag read purges the row and drops the projection
        // with it (live-window behaviour is covered by the tombstone test).
        await fixture.store.deleteSkill(fixture.principal, "alpha-skill", 0);
        expect(await fixture.store.listTags(fixture.principal)).toEqual([]);
        expect(await fixture.store.listPinsByTag(fixture.principal, "alpha")).toEqual([]);
      } finally {
        await fixture.close();
      }
    });

    test("tag reads purge expired tombstones and exclude live ones", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "alpha-skill", "alpha"));

        // Live tombstone (60s window): excluded from tag-filtered skills and
        // published slugs, but its tags stay in the projection until purge -
        // the same window the merged listing keeps the slug tombstoned.
        await fixture.store.deleteSkill(fixture.principal, "alpha-skill", 60_000);
        expect(await fixture.store.listPublishedSlugs(fixture.principal)).toEqual([]);
        expect(await fixture.store.listSkillsByTag(fixture.principal, "alpha")).toEqual([]);
        expect(await fixture.store.listTags(fixture.principal)).toEqual(["alpha"]);

        // Expired tombstone (0 window): the next tag read purges the row and
        // drops the projection with it.
        await fixture.store.publishSkill(publishInput(fixture.principal, "alpha-skill", "alpha"));
        await fixture.store.deleteSkill(fixture.principal, "alpha-skill", 0);
        expect(await fixture.store.listTags(fixture.principal)).toEqual([]);
        expect(await fixture.store.listSkillsByTag(fixture.principal, "alpha")).toEqual([]);
      } finally {
        await fixture.close();
      }
    });

    test("duplicate tags publish safely and dedupe in the projection", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "dup-skill", "alpha"), tags: ["alpha", "alpha"] });
        expect(await fixture.store.listTags(fixture.principal)).toEqual(["alpha"]);
        expect((await fixture.store.listSkillsByTag(fixture.principal, "alpha")).map((s) => s.slug)).toEqual(["dup-skill"]);
      } finally {
        await fixture.close();
      }
    });

    test("re-pinning upserts to one row and refreshes pinnedAt", async () => {
      const fixture = await seeded(backend);
      try {
        const first = await fixture.store.pinSkill(fixture.principal, "notes");
        const second = await fixture.store.pinSkill(fixture.principal, "notes", { v: 2 });
        expect((await fixture.store.listPins(fixture.principal)).map((p) => p.slug)).toEqual(["notes"]);
        expect(second.metadata).toEqual({ v: 2 });
        // Upsert, not append: the row count does not grow, and the timestamp moves.
        expect(second.pinnedAt >= first.pinnedAt).toBe(true);
      } finally {
        await fixture.close();
      }
    });

    test("a guarded publish lands a new revision and bumps the counter", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        const beta = bundleBytes("beta");
        await fixture.store.publishSkill(publishInput(fixture.principal, "guarded", "alpha", alpha));
        const v1 = await fixture.store.getSkill(fixture.principal, "guarded");
        expect(v1!.revisionNumber).toBe(1);

        const v2 = await fixture.store.publishSkill({ ...publishInput(fixture.principal, "guarded", "beta", beta, "1.0.1"), expectedRevisionId: v1!.revisionId });
        expect(v2.revisionId).not.toBe(v1!.revisionId);
        expect(v2.revisionNumber).toBe(2);
        expect(v2.bundleSha256).toBe(digestOf(beta));
        expect(await fixture.store.getSkill(fixture.principal, "guarded")).toMatchObject({ revisionId: v2.revisionId, revisionNumber: 2 });
      } finally {
        await fixture.close();
      }
    });

    test("unpinning removes the pin and reports false for a missing one", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.pinSkill(fixture.principal, "gone-later");
        expect(await fixture.store.unpinSkill(fixture.principal, "gone-later")).toBe(true);
        expect(await fixture.store.unpinSkill(fixture.principal, "gone-later")).toBe(false);
        expect(await fixture.store.unpinSkill(fixture.otherPrincipal, "never-pinned")).toBe(false);
        expect(await fixture.store.listPins(fixture.principal)).toEqual([]);
      } finally {
        await fixture.close();
      }
    });

    test("a stale update guard is refused; a current guard lands once", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "patchable", "alpha"));
        const v1 = await fixture.store.getSkill(fixture.principal, "patchable");

        // No guard, and a stale guard, are both refused.
        await expect(fixture.store.updateSkill(fixture.principal, "patchable", { description: "stale write" })).rejects.toMatchObject({
          name: "SkillRevisionConflictError",
        });
        await expect(fixture.store.updateSkill(fixture.principal, "patchable", { description: "stale write" }, "0".repeat(64))).rejects.toMatchObject({
          name: "SkillRevisionConflictError",
        });

        const updated = await fixture.store.updateSkill(fixture.principal, "patchable", { description: "current write" }, v1!.revisionId);
        expect(updated!.description).toBe("current write");
        expect(updated!.revisionId).not.toBe(v1!.revisionId);
        expect(updated!.revisionNumber).toBe(2);

        // The guard advanced with the write: replaying v1's guard no longer lands.
        await expect(fixture.store.updateSkill(fixture.principal, "patchable", { description: "replay" }, v1!.revisionId)).rejects.toMatchObject({
          name: "SkillRevisionConflictError",
        });
      } finally {
        await fixture.close();
      }
    });

    test("a revision that advances between read and write is a 409, never a silent overwrite", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "racer", "alpha"));
        const v1 = await fixture.store.getSkill(fixture.principal, "racer");

        // Simulate the concurrent writer deterministically: the pre-read inside
        // updateSkill is intercepted once, and a second update lands BEFORE the first
        // one's guarded UPDATE executes. On Postgres this is the real await-gap race;
        // on the synchronous backends the same check must hold for parity.
        const realGetSkill = fixture.store.getSkill.bind(fixture.store);
        const realUpdateSkill = fixture.store.updateSkill.bind(fixture.store);
        let armed = true;
        const interceptingGet = (async (principal: ApiPrincipal, slug: string) => {
          const record = await realGetSkill(principal, slug);
          if (armed && record && !record.tombstonedAt && record.slug === "racer") {
            armed = false;
            // The concurrent writer: a full guarded update completes before the outer
            // caller's UPDATE is issued.
            await realUpdateSkill(principal, slug, { description: "concurrent writer" }, record.revisionId);
          }
          return record;
        }) as typeof fixture.store.getSkill;
        fixture.store.getSkill = interceptingGet;

        // The outer update held v1's revision; the row moved on underneath it. The
        // stale write must be refused with REVISION_CONFLICT — a 404 would falsely
        // claim the skill vanished, and silently landing would destroy the newer write.
        await expect(fixture.store.updateSkill(fixture.principal, "racer", { description: "stale outer write" }, v1!.revisionId)).rejects.toMatchObject({
          name: "SkillRevisionConflictError",
        });
        fixture.store.getSkill = realGetSkill;

        // The concurrent writer's content survived intact.
        const after = await fixture.store.getSkill(fixture.principal, "racer");
        expect(after!.description).toBe("concurrent writer");
        expect(after!.revisionNumber).toBe(2);
      } finally {
        await fixture.close();
      }
    });

    test("tombstone lifecycle: delete marks, reads still see the marker, purge removes row and bundle", async () => {
      const fixture = await seeded(backend);
      try {
        const bytes = bundleBytes("gone");
        await fixture.store.publishSkill(publishInput(fixture.principal, "gone-soon", "alpha", bytes));
        const before = await fixture.store.getSkill(fixture.principal, "gone-soon");

        // A window long enough to outlive the assertions: the row must stay tombstoned
        // (visible to the marker, hidden from listings) until the purge is invoked.
        const deleted = await fixture.store.deleteSkill(fixture.principal, "gone-soon", 60_000);
        expect(deleted!.tombstonedAt).toBeTruthy();
        expect(deleted!.tombstonePurgeAfter).toBeTruthy();
        expect(deleted!.revisionId).toBe(before!.revisionId);

        // The read still sees the row — with the tombstone marker.
        expect(await fixture.store.getSkill(fixture.principal, "gone-soon")).toMatchObject({ tombstonedAt: deleted!.tombstonedAt });
        // listSkills hides tombstoned rows.
        expect((await fixture.store.listSkills(fixture.principal)).map((s) => s.slug)).not.toContain("gone-soon");
        // An update against a tombstoned row is not-found, not a conflict (nothing live to overwrite).
        expect(await fixture.store.updateSkill(fixture.principal, "gone-soon", { description: "x" }, before!.revisionId)).toBeNull();

        // Re-delete is idempotent: the same tombstone, the window is NOT extended.
        const again = await fixture.store.deleteSkill(fixture.principal, "gone-soon", 60_000);
        expect(again!.tombstonedAt).toBe(deleted!.tombstonedAt);
        expect(again!.tombstonePurgeAfter).toBe(deleted!.tombstonePurgeAfter);

        // Nothing is expired yet: a purge invocation is a no-op for this row.
        expect((await fixture.store.purgeExpiredTombstones(fixture.principal)).map((r) => r.slug)).not.toContain("gone-soon");
        expect(await fixture.store.getSkill(fixture.principal, "gone-soon")).toMatchObject({ tombstonedAt: deleted!.tombstonedAt });

        // A zero-window delete makes the purge due immediately; the next purge drops the
        // row and collects the bundle it was the last reference to.
        const purgeableBytes = bundleBytes("purgeable");
        await fixture.store.publishSkill(publishInput(fixture.principal, "purge-me", "alpha", purgeableBytes, null));
        await fixture.store.deleteSkill(fixture.principal, "purge-me", 0);
        const purged = await fixture.store.purgeExpiredTombstones(fixture.principal);
        expect(purged.map((r) => r.slug)).toContain("purge-me");
        expect(await fixture.store.getSkill(fixture.principal, "purge-me")).toBeNull();
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(purgeableBytes))).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("a re-publish over a tombstoned slug revives it without a guard", async () => {
      const fixture = await seeded(backend);
      try {
        const bytes = bundleBytes("revive");
        await fixture.store.publishSkill(publishInput(fixture.principal, "revived", "alpha", bytes));
        const before = await fixture.store.getSkill(fixture.principal, "revived");
        await fixture.store.deleteSkill(fixture.principal, "revived", 60_000);

        // Nothing live exists to overwrite: the publish revives the slug as a fresh
        // revision, clearing the tombstone. The counter keeps counting writes.
        const revived = await fixture.store.publishSkill(publishInput(fixture.principal, "revived", "beta"));
        expect(revived.tombstonedAt).toBeUndefined();
        expect(revived.revisionNumber).toBe(before!.revisionNumber + 1);
        expect((await fixture.store.listSkills(fixture.principal)).map((s) => s.slug)).toContain("revived");
      } finally {
        await fixture.close();
      }
    });

    test("the revision id is the hash of the published content (recompute property)", async () => {
      const fixture = await seeded(backend);
      try {
        const bytes = bundleBytes("provable");
        await fixture.store.publishSkill(publishInput(fixture.principal, "provable", "alpha", bytes));
        const v1 = await fixture.store.getSkill(fixture.principal, "provable");
        expect(revisionIdOfRecord(v1!)).toBe(v1!.revisionId);

        // A metadata-only re-publish carries the stored bundle (digest AND size) into the
        // hash, so a client holding the payload can recompute the id it was given.
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "provable", "alpha2"), expectedRevisionId: v1!.revisionId });
        const v2 = await fixture.store.getSkill(fixture.principal, "provable");
        expect(v2!.bundleSha256).toBe(digestOf(bytes));
        expect(v2!.bundleByteSize).toBe(bytes.byteLength);
        expect(revisionIdOfRecord(v2!)).toBe(v2!.revisionId);
        expect(v2!.revisionId).not.toBe(v1!.revisionId);

        const v3 = await fixture.store.updateSkill(fixture.principal, "provable", { description: "edited" }, v2!.revisionId);
        expect(revisionIdOfRecord(v3!)).toBe(v3!.revisionId);
        expect(v3!.revisionNumber).toBe(v2!.revisionNumber + 1);
      } finally {
        await fixture.close();
      }
    });

    test("a metadata-only re-publish keeps the published SKILL.md and the revision covers it", async () => {
      const fixture = await seeded(backend);
      try {
        const bytes = bundleBytes("kept");
        const md = "---\nname: kept-doc\ndescription: has a document\nkind: instruction\n---\n# v1\n";
        await fixture.store.publishSkill({ ...publishInput(fixture.principal, "kept-doc", "alpha", bytes), skillMd: md });
        const v1 = await fixture.store.getSkill(fixture.principal, "kept-doc");
        expect(v1!.skillMd).toBe(md);

        // Metadata-only re-publish: no skillMd, no bundle. The stored document must
        // survive (mirroring the bundle COALESCE — a metadata update is not an
        // instruction to discard the published document), and the new revision must
        // identify the STORED document so a client recomputing from the served
        // metadata gets the same id.
        const v2 = await fixture.store.publishSkill({
          ...publishInput(fixture.principal, "kept-doc", "beta"),
          skillMd: undefined,
          expectedRevisionId: v1!.revisionId,
        });
        expect(v2.skillMd).toBe(md);

        const after = await fixture.store.getSkill(fixture.principal, "kept-doc");
        expect(after!.skillMd).toBe(md);
        expect(after!.bundleSha256).toBe(digestOf(bytes));
        expect(revisionIdOfRecord(after!)).toBe(after!.revisionId);
        expect(after!.revisionId).toBe(v2.revisionId);
      } finally {
        await fixture.close();
      }
    });
  });
}
