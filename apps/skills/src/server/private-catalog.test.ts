import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { getDataDir } from "../lib/config.js";
import { clearRegistryCache, getSkill } from "../lib/registry.js";
import { createSkillsFetchHandler } from "./app.js";
import { publicPrincipal } from "./auth.js";
import { resolveServerConfig } from "./config.js";
import { resolveStoreBackends } from "./store-fixtures.js";

useDefaultTestTimeout();

const slug = "private-catalog-sentinel";
const localTag = "machine-private-tag";
const tenantTag = "tenant-private-tag";
const principalA = publicPrincipal({ orgId: "catalog_a", orgSlug: "catalog-a", userId: "catalog_user_a", email: "catalog-a@example.test", apiKeyId: "catalog_key_a" });
const principalB = publicPrincipal({ orgId: "catalog_b", orgSlug: "catalog-b", userId: "catalog_user_b", email: "catalog-b@example.test", apiKeyId: "catalog_key_b" });

for (const backend of await resolveStoreBackends()) {
  test(`${backend.name}: only the authenticated tenant's published catalog reaches every API read`, async () => {
    const local = join(getDataDir(), "installed", slug);
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, "SKILL.md"), `---\nname: ${slug}\ndescription: machine-only canary\ntags: [${localTag}]\nkind: instruction\n---\n\n# Machine-only instructions\n`);
    clearRegistryCache();
    // Positive control: the machine's CLI can see its own source. The server must not.
    expect(getSkill(slug)?.description).toBe("machine-only canary");
    const fixture = await backend.create([
      { token: "catalog-fixture-a", principal: principalA },
      { token: "catalog-fixture-b", principal: principalB },
    ]);
    const handler = await createSkillsFetchHandler({ store: fixture.store, governanceStore: fixture.governanceStore,
      runtime: null, config: { allowEphemeralStore: fixture.allowEphemeralStore, inlineWorker: false } });
    const read = (path: string, token = "catalog-fixture-b") => handler(new Request(`http://localhost/v1/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }));
    try {
      // Empty accounts start empty even when the server has a populated local catalog.
      for (const token of ["catalog-fixture-a", "catalog-fixture-b"]) {
        await fixture.store.pinSkill(token.endsWith("a") ? principalA : principalB, slug);
        for (const path of ["skills", "tags", `skills?tag=${localTag}`, `tags/${localTag}/skills`, `pins?tag=${localTag}`]) {
          const response = await read(path, token);
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual([]);
        }
        for (const suffix of ["", "/skill.md", "/bundle", "/versions"]) {
          expect((await read(`skills/${slug}${suffix}`, token)).status).toBe(404);
        }
      }
      await fixture.store.publishSkill({ principal: principalA, slug, displayName: "Tenant canary", description: "tenant-owned",
        category: "Development Tools", tags: [tenantTag], kind: "instruction", source: "custom", skillMd: "# Tenant-only instructions\n" });
      expect(await (await read("skills", "catalog-fixture-a")).json()).toHaveLength(1);
      expect(await (await read("tags", "catalog-fixture-a")).json()).toEqual([tenantTag]);
      expect(await (await read(`pins?tag=${tenantTag}`, "catalog-fixture-a")).json()).toHaveLength(1);
      expect(await (await read(`skills/${slug}/skill.md`, "catalog-fixture-a")).text()).toBe("# Tenant-only instructions\n");
      for (const path of ["skills", "tags", `skills?tag=${tenantTag}`, `tags/${tenantTag}/skills`, `pins?tag=${tenantTag}`]) {
        expect(await (await read(path)).json()).toEqual([]);
      }
      expect((await read(`skills/${slug}`)).status).toBe(404);
      expect((await read(`skills/${slug}/skill.md`)).status).toBe(404);
      await fixture.store.deleteSkill(principalA, slug, 0);
      await fixture.store.purgeExpiredTombstones(principalA);
      expect((await read(`skills/${slug}`, "catalog-fixture-a")).status).toBe(404);
      expect((await read(`skills/${slug}/skill.md`, "catalog-fixture-a")).status).toBe(404);
      expect(getSkill(slug)?.description).toBe("machine-only canary");
    } finally {
      await handler.close();
      await fixture.close();
      clearRegistryCache();
    }
  });
}

test("ordinary durable startup and restart never import a machine's skill files", async () => {
  const data = getDataDir();
  const local = join(data, "installed", slug);
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, "SKILL.md"), `---\nname: ${slug}\ndescription: boot canary\nkind: instruction\n---\n# Machine-only boot canary\n`);
  clearRegistryCache();
  expect(getSkill(slug)?.description).toBe("boot canary");
  const config = { ...resolveServerConfig({ HASNA_SKILLS_SEED_BUNDLED_CORPUS: "1" }),
    databaseUrl: join(data, "private-catalog-server.db"), bootstrapApiKey: "catalog-boot-fixture" };
  expect(config).not.toHaveProperty("seedBundledCorpus");
  const request = (path: string, init: RequestInit = {}) => new Request(`http://localhost/v1/${path}`, {
    ...init, headers: { authorization: "Bearer catalog-boot-fixture", "content-type": "application/json" },
  });
  const first = await createSkillsFetchHandler({ config, runtime: null });
  let published: unknown;
  try {
    expect(await (await first(request("skills"))).json()).toEqual([]);
    expect((await first(request(`skills/${slug}/skill.md`))).status).toBe(404);
    const response = await first(request("skills", { method: "POST", body: JSON.stringify({ slug,
      displayName: "Owned document", description: "Explicitly published", category: "Development Tools", tags: [tenantTag],
      kind: "instruction", source: "custom", skillMd: "# Explicitly published document\n" }) }));
    expect(response.status).toBe(201);
    published = await response.json();
  } finally {
    await first.close();
  }
  const restarted = await createSkillsFetchHandler({ config, runtime: null });
  try {
    expect(await (await restarted(request("skills"))).json()).toEqual([published]);
    expect(await (await restarted(request(`skills/${slug}/skill.md`))).text()).toBe("# Explicitly published document\n");
  } finally {
    await restarted.close();
    clearRegistryCache();
  }
});
