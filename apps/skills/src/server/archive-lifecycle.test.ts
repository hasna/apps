import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { ownBytes } from "../lib/skill-bundle.js";
import { publicPrincipal } from "./auth.js";
import { MemorySkillsStore } from "./store.js";
import { SqliteSkillsStore } from "./sqlite-store.js";

useDefaultTestTimeout();
import { listMergedSkills } from "./skills-api.js";

const principal = publicPrincipal({ orgId: "org_archive", orgSlug: "archive", orgName: "Archive", userId: "owner", email: "owner@example.test", apiKeyId: "key" });

function input() {
  const bytes = ownBytes(new TextEncoder().encode("immutable archive fixture"));
  return { principal, slug: "legacy-skill", displayName: "Legacy", description: "fixture", category: "Test", tags: ["fixture"], source: "custom", kind: "instruction" as const, version: "1.0.0", skillMd: "# Legacy\n", bundle: { sha256: "a".repeat(64), byteSize: bytes.byteLength, contentType: "application/gzip", storageKind: "db" as const, bytes } };
}

describe("skill archive lifecycle", () => {
  test("archives with CAS, hides discovery, blocks cloud eligibility, and preserves exact history", async () => {
    const store = new MemorySkillsStore();
    const published = await store.publishSkill(input());
    const archived = await store.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "archived", reason: "superseded" }, published.revisionId);
    expect(archived?.lifecycle).toBe("archived");
    expect(await listMergedSkills(store, principal)).toHaveLength(0);
    expect((await store.listSkillVersions(principal, "legacy-skill"))[0]?.bundleSha256).toBe("a".repeat(64));
    await expect(store.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "active" }, published.revisionId)).rejects.toMatchObject({ name: "SkillRevisionConflictError" });
    const reactivated = await store.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "active" }, archived!.revisionId);
    expect(reactivated?.lifecycle).toBe("active");
  });

  test("refuses archive while an org profile references the skill", async () => {
    const store = new MemorySkillsStore();
    const published = await store.publishSkill(input());
    await store.selectionStore.saveProfile(principal, "fleet", [{ slug: "legacy-skill", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }], null);
    await expect(store.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "archived" }, published.revisionId)).rejects.toMatchObject({ name: "SkillLifecycleConflictError", profiles: ["fleet"] });
  });

  test("SQLite lifecycle fence rejects a racing profile selection", async () => {
    const store = new SqliteSkillsStore(join(mkdtempSync(join(tmpdir(), "skills-archive-")), "server.db"));
    await store.ensureBootstrapApiKey("synthetic", { orgId: principal.orgId, orgSlug: principal.orgSlug, orgName: principal.orgName, userId: principal.userId, email: principal.email, apiKeyId: principal.apiKeyId });
    const published = await store.publishSkill(input());
    await store.selectionStore.saveProfile(principal, "fleet", [], null);
    const profile = await store.selectionStore.getProfile(principal, "fleet");
    const archived = await store.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "archived" }, published.revisionId);
    expect(archived?.lifecycle).toBe("archived");
    const refused = await store.selectionStore.saveProfile(principal, "fleet", [{ slug: "legacy-skill", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }], profile!.revision);
    expect(refused).toBeNull();
    await store.close();
  });
});
