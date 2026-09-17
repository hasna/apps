import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices } from "./store-fixtures.js";
import { publicPrincipal } from "./auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { HttpProfileClient } from "../lib/profile-client.js";
import { readSkillProfile, saveSkillProfile, readStationSkillState } from "../lib/profile-admin.js";
import { syncSelectionProfile, loadSelectedSkill } from "../lib/selection-resolver.js";
import { readSelectionProfile, readProjectSelection, readSkillSession, sessionReceiptPath, projectSelectionLockPath } from "../lib/selection-cache.js";

useDefaultTestTimeout();
const count = 4096, documentBytes = 8 * 1024 * 1024;
const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[profile-capacity] ${notice}`);

for (const backend of backends) test(`large profile survives API/client/cache/project/session/station without truncation (${backend.name})`, async () => {
  const principal = publicPrincipal({ orgId: "capacity-org", userId: "capacity-user", apiKeyId: "capacity-key" });
  const fixture = await backend.create([{ token: "fixture-capacity", principal }]);
  const root = mkdtempSync(join(tmpdir(), "skills-capacity-")), source = join(root, "source"), cacheDir = join(root, "cache"), projectDir = join(root, "project");
  mkdirSync(source); mkdirSync(projectDir);
  const markdown = "---\nname: shared-guide\ndescription: Shared immutable capacity fixture\nkind: instruction\n---\n\nReview the selected task.\n";
  writeFileSync(join(source, "SKILL.md"), markdown);
  const bundle = packSkillBundle(source);
  const selections = Array.from({ length: count }, (_, i) => ({ slug: `guide-${String(i).padStart(4, "0")}`, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, aliases: [`legacy-guide-${i}`], triggers: { keywords: ["x".repeat(160)] } }));
  expect(Buffer.byteLength(JSON.stringify({ selections }))).toBeGreaterThan(1024 * 1024);
  let handler: Awaited<ReturnType<typeof createSkillsFetchHandler>>;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: documentBytes + 1024, fetch: request => handler(request) });
  const origin = server.url.origin;
  const prior = Object.fromEntries(["HASNA_SKILLS_API_URL", "HASNA_SKILLS_API_KEY_OVERRIDE"].map(key => [key, process.env[key]]));
  try {
    const seeded = performance.now();
    for (const selection of selections) await fixture.store.publishSkill({ principal, slug: selection.slug, displayName: selection.slug, description: "Shared fixture", category: "Development Tools", tags: [], source: "custom", kind: "instruction", version: selection.version, skillMd: markdown, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.byteLength, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
    handler = await createSkillsFetchHandler({ store: fixture.store, governanceStore: fixture.governanceStore, config: { allowEphemeralStore: fixture.allowEphemeralStore, publicBaseUrl: origin, requestBodyLimitBytes: documentBytes } });
    process.env.HASNA_SKILLS_API_URL = origin; process.env.HASNA_SKILLS_API_KEY_OVERRIDE = "fixture-capacity";
    const started = performance.now();
    const saved = await saveSkillProfile("fleet", selections);
    expect(saved.selections).toEqual(selections);
    expect((await readSkillProfile("fleet")).selections).toEqual(selections);
    const client = new HttpProfileClient("fixture-capacity", origin);
    const resolved = await client.resolveProfile("fleet");
    expect(resolved.selections).toHaveLength(count);
    expect(Buffer.byteLength(JSON.stringify(resolved))).toBeGreaterThan(1024 * 1024);
    const synced = await syncSelectionProfile("fleet", { client, cacheDir, projectDir, stationId: "capacity-station" });
    expect(synced.stationReported).toBe(true);
    expect(readSelectionProfile("fleet", { cacheDir })?.profile).toEqual(resolved);
    expect(readProjectSelection(projectDir)?.profile).toEqual(resolved);
    const loaded = await loadSelectedSkill(`legacy-guide-${count - 1}`, "fleet", { client, cacheDir, projectDir, sessionId: "capacity-session" });
    expect(loaded.content).toBe(markdown);
    expect(loaded.selection.slug).toBe(selections[count - 1]!.slug);
    expect(readSkillSession("capacity-session", { cacheDir })?.profile).toEqual(resolved);
    for (const path of [projectSelectionLockPath(projectDir), sessionReceiptPath("capacity-session", { cacheDir })]) {
      expect(statSync(path).size).toBeGreaterThan(1024 * 1024);
      expect(statSync(path).size).toBeLessThanOrEqual(documentBytes);
    }
    expect((await readStationSkillState("capacity-station")).selections).toEqual(selections);
    const unchanged = await readSkillProfile("fleet");
    await expect(saveSkillProfile("fleet", [...selections, { ...selections[0]!, slug: "one-too-many", aliases: [] }], saved.revision)).rejects.toThrow();
    expect(await readSkillProfile("fleet")).toEqual(unchanged);
    const oversized = selections.map(selection => ({ ...selection, triggers: { keywords: Array.from({ length: 32 }, () => "界".repeat(256)) } }));
    await expect(saveSkillProfile("fleet", oversized, saved.revision)).rejects.toThrow();
    expect(await readSkillProfile("fleet")).toEqual(unchanged);
    const direct = async (input: unknown) => handler(new Request(`${origin}/api/v1/profiles/fleet`, { method: "PUT", headers: { authorization: "Bearer fixture-capacity", "content-type": "application/json", "if-match": `"${saved.revision}"` }, body: JSON.stringify(input) }));
    expect((await direct({ selections: [...selections, { ...selections[0]!, slug: "one-too-many", aliases: [] }] })).status).toBe(400);
    expect((await direct({ selections: [], padding: "x".repeat(documentBytes) })).status).toBe(413);
    // The raw request fits, but repeated resolution identity plus a complete
    // session would not. Refuse this before replacing the accepted revision.
    const projectionOverflow = selections.map(selection => ({ ...selection, triggers: { keywords: Array.from({ length: 7 }, () => "x".repeat(256)) } }));
    expect(Buffer.byteLength(JSON.stringify({ selections: projectionOverflow }))).toBeLessThan(documentBytes);
    expect((await direct({ selections: projectionOverflow })).status).toBe(413);
    expect(await readSkillProfile("fleet")).toEqual(unchanged);
    const strict = await createSkillsFetchHandler({ store: fixture.store, governanceStore: fixture.governanceStore, config: { allowEphemeralStore: fixture.allowEphemeralStore, publicBaseUrl: origin } });
    const response = await strict(new Request(`${origin}/api/v1/profiles/strict`, { method: "PUT", headers: { authorization: "Bearer fixture-capacity", "content-type": "application/json", "if-none-match": "*" }, body: JSON.stringify({ selections }) }));
    expect(response.status).toBe(413);
    expect(await fixture.store.selectionStore!.getProfile(principal, "strict")).toBeNull();
    const caps = await strict(new Request(`${origin}/api/v1/capabilities`, { headers: { authorization: "Bearer fixture-capacity" } }));
    expect(await caps.json()).toMatchObject({ profileLimits: { maxSelections: count, maxDocumentBytes: documentBytes, requestBodyLimitBytes: 1_000_000 } });
    console.log(JSON.stringify({ capacityBackend: backend.name, selections: count, seedMs: Math.round(started - seeded), lifecycleMs: Math.round(performance.now() - started), resolvedBytes: Buffer.byteLength(JSON.stringify(resolved)) }));
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    server.stop(true); await fixture.close(); rmSync(root, { recursive: true, force: true });
  }
});
