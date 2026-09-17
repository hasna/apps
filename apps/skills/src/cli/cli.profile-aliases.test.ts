import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import { SqliteGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler, type SkillsFetchHandler } from "../server/app.js";
import { publicPrincipal } from "../server/auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";

useDefaultTestTimeout();
const root = mkdtempSync(join(tmpdir(), "skills-alias-cli-")), binary = join(root, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("compiled CLI refuses unsupported alias writes and resolves canonical bytes after sync", async () => {
  const home = join(root, "home"), project = join(root, "project"), source = join(root, "source");
  for (const path of [home, project, source]) mkdirSync(path, { recursive: true });
  const skillMd = "---\nname: review-code\ndescription: Review the requested changes\nkind: instruction\n---\nRead only the requested change.\n";
  writeFileSync(join(source, "SKILL.md"), skillMd);
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "review-code", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source), database = join(root, "server.sqlite");
  const store = new SqliteSkillsStore(database), governanceStore = new SqliteGovernanceStore(database);
  const principal = publicPrincipal({ orgId: "org_alias", orgSlug: "alias", userId: "user_alias", apiKeyId: "key_alias" });
  await store.ensureBootstrapApiKey("fixture-alias-credential", principal);
  await store.publishSkill({ principal, slug: "review-code", displayName: "Review code", description: "Alias fixture", category: "Development Tools", tags: [], source: "custom", kind: "instruction", version: "1.0.0", skillMd, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
  let handler: SkillsFetchHandler | undefined, advertiseAliases = false, corruptSave = false;
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (path.endsWith("/capabilities") && !advertiseAliases) return Response.json({ profileResolution: true });
    const response = handler ? await handler(request) : new Response(null, { status: 503 });
    if (corruptSave && request.method === "PUT" && path.includes("/profiles/") && response.ok) {
      const body = await response.json() as any;
      body.selections[0].version = "9.0.0";
      return Response.json(body, { status: response.status });
    }
    return response;
  } });
  const origin = server.url.origin;
  handler = await createSkillsFetchHandler({ store, governanceStore, runtime: null, config: { publicBaseUrl: origin } });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: join(home, ".hasna", "skills"), HASNA_SKILLS_API_KEY: "fixture-alias-credential", HASNA_SKILLS_API_URL: origin, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: project, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  }
  async function ok(args: string[]) { const result = await run([...args, "--json"]); expect(result.exitCode).toBe(0); expect(result.stderr).toBe(""); return JSON.parse(result.stdout); }
  const selection = { slug: "review-code", aliases: ["legacy-review"], version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
  const file = join(root, "profile.json"); writeFileSync(file, JSON.stringify({ selections: [selection] }));
  try {
    const refused = await run(["profiles", "set", "engineering", "--file", file, "--json"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("does not advertise selection aliases");
    expect(requests.some(request => request.startsWith("PUT "))).toBe(false);
    advertiseAliases = true;
    expect((await ok(["profiles", "set", "engineering", "--file", file])).selections).toEqual([selection]);
    await ok(["sync", "--selection-profile", "engineering", "--station", "station-alias"]);
    expect((await ok(["load", "legacy-review@1.0.0", "--selection-profile", "engineering"])).content).toBe(skillMd);
    expect((await ok(["context", "$legacy-review@1.0.0", "--selection-profile", "engineering"])).selections[0]).toMatchObject({ slug: "review-code", bundleDigest: selection.bundleDigest });
    expect(requests.some(request => request.includes("/skills/legacy-review"))).toBe(false);
    const station = await store.selectionStore!.getStationState(principal, "station-alias");
    expect(station?.selections).toEqual([selection]);
    expect((await run(["load", "legacy-review@2.0.0", "--selection-profile", "engineering", "--json"])).exitCode).toBe(1);
    corruptSave = true;
    const altered = await run(["profiles", "set", "altered-receipt", "--file", file, "--json"]);
    expect(altered.exitCode).toBe(1);
    expect(altered.stderr).toContain("did not preserve the complete selections");
    expect(requests.filter(request => request === "PUT /api/v1/profiles/altered-receipt")).toHaveLength(1);
  } finally { server.stop(true); await handler.close(); await governanceStore.close(); await store.close(); }
});
