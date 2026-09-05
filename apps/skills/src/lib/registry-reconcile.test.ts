/**
^ * The two-way reconcile between the canonical local corpus and the
 * hosted registry, against a real server over HTTP.
 *
 * The corpus is redirected with `rootDir` rather than by moving $HOME: these tests must
 * be identical on a clean machine and on a developer's, and a suite that reads the real
 * ~/.hasna/skills would pass or fail depending on what the operator happens to have
 * written there.
 */
import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { pushSkill } from "../cli/commands/publish.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { MemorySkillsStore } from "../server/store.js";
import { computeContentHash } from "./skill-hash.js";
import { PULL_MARKER_FILE } from "./pull.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { packSkillBundle } from "./skill-bundle.js";
import { reconcileRegistry, SYNC_CURSOR_FILE } from "./registry-reconcile.js";

const SYNC_AUTH = "test-sync-token";
const PRINCIPAL = {
  orgId: "org_sync",
  orgSlug: "org-sync",
  orgName: "Sync Org",
  userId: "user_sync",
  email: "sync@example.com",
  apiKeyId: "key_sync",
};

/**
 * A minimal but valid skill: SKILL.md with frontmatter, skill.json, and one source file.
 * Changing `flavor` changes the packed bundle digest deterministically (canonical gzip).
 */
function skillFiles(slug: string, version: string, flavor: string): Record<string, string> {
  return {
    "SKILL.md": `---\nname: ${slug}\ndescription: Sync fixture ${flavor}\nversion: ${version}\n---\n\n# ${slug}\n\n${flavor}\n`,
    "skill.json": JSON.stringify(
      {
        $schema: "https://hasna.dev/schemas/skill.v1.json",
        standard: "hasna.skill.v1",
        name: slug,
        description: `Sync fixture ${flavor}`,
        version,
        displayName: slug,
        category: "Development Tools",
        tags: ["custom", "sync"],
        commands: [{ name: slug, entry: "src/index.ts" }],
        runtime: {
          runtime: "bun",
          entrypoint: "src/index.ts",
          timeout: 900,
          needs_network: false,
          env: [],
          sandbox: "readonly-fs",
          system_deps: [],
          artifacts: [],
        },
        // Filled with the real canonical content hash by makeCorpus; the value here is
        // only a placeholder because the hash input canonicalizes the manifest (the
        // content_hash field is normalized away), so the final value is independent of
        // the placeholder.
        provenance: { source_commit: "unknown", content_hash: "0".repeat(64) },
      },
      null,
      2,
    ),
    "AGENTS.md": `# Agent Build Instructions\n\nBuild ${slug}.\n`,
    "package.json": JSON.stringify({ name: slug, version, type: "module", bin: { [slug]: "src/index.ts" } }, null, 2),
    "src/index.ts": `console.log('${flavor}');\n`,
  };
}

/** Fill skill.json's provenance.content_hash with the canonical hash of the directory. */
function refillContentHash(skillDir: string): void {
  const manifestPath = join(skillDir, "skill.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { provenance: { content_hash: string } };
  // computeContentHash canonicalizes the manifest (content_hash excluded from the
  // input), so filling the field afterwards does not change the value.
  manifest.provenance.content_hash = computeContentHash(skillDir);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function makeCorpus(skills: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "skills-reconcile-corpus-"));
  for (const [name, files] of Object.entries(skills)) {
    const skillDir = join(root, name);
    for (const [path, content] of Object.entries(files)) {
      const absolute = join(skillDir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    refillContentHash(skillDir);
  }
  return root;
}

function packDigest(skillDir: string): string {
  return packSkillBundle(skillDir).sha256;
}

function readMarker(dir: string): Record<string, unknown> | null {
  const path = join(dir, PULL_MARKER_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

async function withServer(fn: (ctx: { baseUrl: string; store: MemorySkillsStore }) => Promise<void>): Promise<void> {
  const store = new MemorySkillsStore();
  await store.ensureBootstrapApiKey(SYNC_AUTH, PRINCIPAL);
  const fetchHandler = await createSkillsFetchHandler({
    store,
    config: { inlineWorker: false, allowEphemeralStore: true },
  });
  const server = Bun.serve({ port: 0, fetch: fetchHandler });
  try {
    await fn({ baseUrl: `http://127.0.0.1:${server.port}`, store });
  } finally {
    server.stop(true);
  }
}

/** Seed one skill onto the instance through the real publish path. */
async function seedRemote(client: RemoteSkillsClient, seedCorpus: string, slug: string): Promise<string> {
  const result = await pushSkill(slug, { rootDir: seedCorpus, client });
  expect(result.published).toBe(true);
  return result.sha256;
}

async function findRemote(client: RemoteSkillsClient, slug: string): Promise<Record<string, unknown> | undefined> {
  const listed = await client.listSkills();
  return listed.find((skill) => (skill.slug ?? skill.name) === slug);
}

describe("reconcileRegistry", () => {
  test("converges a divergent corpus and registry with no conflicts, and is idempotent", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const seedDigest = await seedRemote(client, seed, "sync-b");
        const localDigest = packDigest(join(local, "sync-a"));

        const result = await reconcileRegistry({ rootDir: local, client });

        expect(result.summary.conflicts).toBe(0);
        expect(result.summary.errors).toBe(0);
        expect(result.summary.pushed).toBe(1);
        // Verified pulls only: the seeded published skill pulls; the bundled corpus rows
        // (no bundle digest) are skipped, never pulled through the unverifiable fallback.
        expect(result.summary.pulled).toBe(1);
        const entryA = result.skills.find((entry) => entry.slug === "sync-a");
        expect(entryA?.action).toBe("push");
        const entryB = result.skills.find((entry) => entry.slug === "sync-b");
        expect(entryB?.action).toBe("pull");
        const bundledSkip = result.skills.find((entry) => entry.state === "remote-only" && entry.action === "skip");
        expect(bundledSkip?.reason).toMatch(/no bundle digest/);

        // Local-only skill reached the registry with the local digest.
        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const remoteA = await findRemote(reader, "sync-a");
        expect(remoteA?.bundleSha256).toBe(localDigest);

        // Remote-only skill landed in the corpus with a verified marker.
        const pulledDir = join(local, "sync-b");
        expect(existsSync(join(pulledDir, "SKILL.md"))).toBe(true);
        const marker = readMarker(pulledDir);
        expect(marker?.contentHash).toBe(seedDigest);

        // The cursor records the run.
        const cursor = JSON.parse(readFileSync(join(local, SYNC_CURSOR_FILE), "utf-8"));
        expect(cursor.runCount).toBe(1);
        expect(typeof cursor.lastSyncedAt).toBe("string");

        // A second run is a no-op: the corpus and the registry agree.
        const second = await reconcileRegistry({ rootDir: local, client });
        expect(second.summary.pushed).toBe(0);
        expect(second.summary.pulled).toBe(0);
        expect(second.summary.conflicts).toBe(0);
        expect(second.summary.errors).toBe(0);
        const cursor2 = JSON.parse(readFileSync(join(local, SYNC_CURSOR_FILE), "utf-8"));
        expect(cursor2.runCount).toBe(2);
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("--dry-run writes nothing: no corpus change, no remote change, no markers, no cursor", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-b");

        const result = await reconcileRegistry({ rootDir: local, client, dryRun: true });

        // The plan is complete and honest...
        expect(result.summary.pushed).toBe(1);
        expect(result.summary.pulled).toBeGreaterThanOrEqual(1);
        expect(result.summary.conflicts).toBe(0);
        expect(result.dryRun).toBe(true);

        // ...and nothing was written anywhere. Readback, not inference.
        expect(existsSync(join(local, "sync-b"))).toBe(false);
        expect(existsSync(join(local, "sync-a", PULL_MARKER_FILE))).toBe(false);
        expect(existsSync(join(local, SYNC_CURSOR_FILE))).toBe(false);
        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect(await findRemote(reader, "sync-a")).toBeUndefined();
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a same-slug divergence with no baseline is a conflict, skipped and reported by default", async () => {
    const seed = makeCorpus({ "sync-c": skillFiles("sync-c", "1.0.0", "remote-c") });
    const local = makeCorpus({ "sync-c": skillFiles("sync-c", "2.0.0", "local-c") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const seedDigest = await seedRemote(client, seed, "sync-c");

        const result = await reconcileRegistry({ rootDir: local, client });

        expect(result.summary.conflicts).toBe(1);
        const entry = result.skills.find((item) => item.slug === "sync-c");
        expect(entry?.state).toBe("conflict");
        expect(entry?.action).toBe("skip");
        expect(entry?.reason).toMatch(/cannot prove|changed/i);

        // Neither side moved.
        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect((await findRemote(reader, "sync-c"))?.bundleSha256).toBe(seedDigest);
        expect(readFileSync(join(local, "sync-c", "SKILL.md"), "utf-8")).toContain("local-c");
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("--conflict=local resolves the divergence by pushing local over remote", async () => {
    const seed = makeCorpus({ "sync-c": skillFiles("sync-c", "1.0.0", "remote-c") });
    const local = makeCorpus({ "sync-c": skillFiles("sync-c", "2.0.0", "local-c") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-c");
        const localDigest = packDigest(join(local, "sync-c"));

        const result = await reconcileRegistry({ rootDir: local, client, conflict: "local" });

        expect(result.summary.conflicts).toBe(1);
        const entry = result.skills.find((item) => item.slug === "sync-c");
        expect(entry?.state).toBe("conflict");
        expect(entry?.action).toBe("push");

        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect((await findRemote(reader, "sync-c"))?.bundleSha256).toBe(localDigest);

        // The pushed baseline is recorded as a per-skill marker with the sync source.
        const marker = readMarker(join(local, "sync-c"));
        expect(marker?.contentHash).toBe(localDigest);
        expect(marker?.source).toBe("sync");
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("--conflict=remote resolves the divergence by pulling remote over local", async () => {
    const seed = makeCorpus({ "sync-c": skillFiles("sync-c", "1.0.0", "remote-c") });
    const local = makeCorpus({ "sync-c": skillFiles("sync-c", "2.0.0", "local-c") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const seedDigest = await seedRemote(client, seed, "sync-c");

        const result = await reconcileRegistry({ rootDir: local, client, conflict: "remote" });

        expect(result.summary.conflicts).toBe(1);
        const entry = result.skills.find((item) => item.slug === "sync-c");
        expect(entry?.state).toBe("conflict");
        expect(entry?.action).toBe("pull");

        // The local copy was replaced by the verified remote bundle.
        expect(readFileSync(join(local, "sync-c", "SKILL.md"), "utf-8")).toContain("remote-c");
        const marker = readMarker(join(local, "sync-c"));
        expect(marker?.contentHash).toBe(seedDigest);
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a locally-changed skill pushes without a conflict", async () => {
    const seedV1 = makeCorpus({ "sync-d": skillFiles("sync-d", "1.0.0", "v1") });
    const seedV2 = makeCorpus({ "sync-d": skillFiles("sync-d", "2.0.0", "v2") });
    const local = makeCorpus({});
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seedV1, "sync-d");

        // First sync establishes the baseline: sync-d is pulled with a verified marker.
        await reconcileRegistry({ rootDir: local, client });
        const v1Digest = packDigest(join(local, "sync-d"));
        expect(readMarker(join(local, "sync-d"))?.contentHash).toBe(v1Digest);

        // Local edits the pulled skill (content_hash must be re-computed, exactly as an
        // author re-hashing after a content change — the push path validates it).
        for (const [path, content] of Object.entries(skillFiles("sync-d", "2.0.0", "v2"))) {
          const absolute = join(local, "sync-d", path);
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, content);
        }
        refillContentHash(join(local, "sync-d"));
        const v2Digest = packDigest(join(local, "sync-d"));

        const result = await reconcileRegistry({ rootDir: local, client });
        expect(result.summary.conflicts).toBe(0);
        const entry = result.skills.find((item) => item.slug === "sync-d");
        expect(entry?.state).toBe("changed-locally");
        expect(entry?.action).toBe("push");

        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect((await findRemote(reader, "sync-d"))?.bundleSha256).toBe(v2Digest);
        expect(readMarker(join(local, "sync-d"))?.contentHash).toBe(v2Digest);
      });
    } finally {
      rmSync(seedV1, { recursive: true, force: true });
      rmSync(seedV2, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a remotely-changed skill pulls without a conflict", async () => {
    const seedV1 = makeCorpus({ "sync-e": skillFiles("sync-e", "1.0.0", "v1") });
    const seedV2 = makeCorpus({ "sync-e": skillFiles("sync-e", "2.0.0", "v2") });
    const local = makeCorpus({});
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seedV1, "sync-e");
        await reconcileRegistry({ rootDir: local, client });

        // The remote advances past the baseline.
        const v2Digest = await seedRemote(client, seedV2, "sync-e");

        const result = await reconcileRegistry({ rootDir: local, client });
        expect(result.summary.conflicts).toBe(0);
        const entry = result.skills.find((item) => item.slug === "sync-e");
        expect(entry?.state).toBe("changed-remotely");
        expect(entry?.action).toBe("pull");

        expect(readFileSync(join(local, "sync-e", "SKILL.md"), "utf-8")).toContain("v2");
        expect(readMarker(join(local, "sync-e"))?.contentHash).toBe(v2Digest);
      });
    } finally {
      rmSync(seedV1, { recursive: true, force: true });
      rmSync(seedV2, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("--push does not pull, and --pull does not push", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-b");

        const pushed = await reconcileRegistry({ rootDir: local, client, push: true });
        expect(pushed.summary.pushed).toBe(1);
        expect(pushed.summary.pulled).toBe(0);
        expect(existsSync(join(local, "sync-b"))).toBe(false);

        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect(await findRemote(reader, "sync-a")).toBeDefined();
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("identical digests are in-sync and written nothing", async () => {
    const seed = makeCorpus({ "sync-f": skillFiles("sync-f", "1.0.0", "same") });
    const local = makeCorpus({ "sync-f": skillFiles("sync-f", "1.0.0", "same") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-f");

        const result = await reconcileRegistry({ rootDir: local, client });
        expect(result.summary.pushed).toBe(0);
        expect(result.summary.conflicts).toBe(0);
        const entry = result.skills.find((item) => item.slug === "sync-f");
        expect(entry?.state).toBe("in-sync");
        expect(entry?.action).toBe("none");
        expect(readMarker(join(local, "sync-f"))).toBeNull();
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("fails closed with no configured client", async () => {
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await expect(reconcileRegistry({ rootDir: local, client: null })).rejects.toThrow(/No API key/);
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("rejects an unknown conflict policy", async () => {
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await expect(reconcileRegistry({ rootDir: local, client, conflict: "bogus" as never })).rejects.toThrow(/conflict/i);
      });
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("dry run on a legacy layout writes nothing (no migration, no cursor)", async () => {
    // A legacy-layout home: a flat skill at the app root, no migration record, no
    // installed/ corpus. getPortableSkillsRoot() would MIGRATE this by copying the
    // skill into installed/ — a write. The dry-run path must resolve write-free.
    const home = mkdtempSync(join(tmpdir(), "skills-reconcile-home-"));
    const appDir = join(home, ".hasna", "skills");
    const legacy = join(appDir, "legacy-flat");
    mkdirSync(legacy, { recursive: true });
    for (const [path, content] of Object.entries(skillFiles("legacy-flat", "1.0.0", "legacy"))) {
      const absolute = join(legacy, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    refillContentHash(legacy);
    const before = readFileSync(join(legacy, "SKILL.md"), "utf-8");
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ homeDir: home, client, dryRun: true });

        expect(result.migrationPending).toBe(true);
        // The legacy layout is untouched...
        expect(readFileSync(join(legacy, "SKILL.md"), "utf-8")).toBe(before);
        // ...nothing was migrated into installed/...
        expect(existsSync(join(appDir, "installed"))).toBe(false);
        // ...and no cursor was written anywhere under the app dir.
        const cursorPaths: string[] = [];
        (function walk(dir: string): void {
          if (!existsSync(dir)) return;
          for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) walk(path);
            else if (entry === SYNC_CURSOR_FILE) cursorPaths.push(path);
          }
        })(appDir);
        expect(cursorPaths).toEqual([]);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a stored-credential dry run resolves the client write-free: no app dir, no legacy merge, no config copy", async () => {
    // Fresh HOME holding ONLY the shared credentials file. Client resolution used to
    // read the stored credential through getAuthFilePath() and the origin through
    // loadConfig() — both routed through getDataDir(), which WRITES: it mkdirs the
    // app dir, merges legacy ~/.skills content and copies ~/.skillsrc as config.json.
    // A dry run must resolve the same client against the same files without any of
    // that (review P1: client resolution ran unconditionally before the read-only
    // corpus branch, so a stored-auth `sync --dry-run` still wrote ~/.hasna/skills).
    //
    // Both the credential and the ORIGIN come from `~/.hasna/skills/config/credentials`
    // — the shared @hasna/contracts disk tier — with no API environment variable set,
    // so this is also the regression test for the ladder's disk tier being read
    // without touching this app's data directory at all.
    const home = mkdtempSync(join(tmpdir(), "skills-reconcile-home-"));
    const legacyDir = join(home, ".skills");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "auth.json"), JSON.stringify({ apiKey: SYNC_AUTH }));

    const previousHome = process.env.HOME;
    const previousSkillsDir = process.env.HASNA_SKILLS_DIR;
    const previousApiKey = process.env.SKILLS_API_KEY;
    const previousApiUrl = process.env.SKILLS_API_URL;
    process.env.HOME = home;
    delete process.env.HASNA_SKILLS_DIR;
    delete process.env.SKILLS_API_KEY;
    delete process.env.SKILLS_API_URL;
    try {
      // A minimal stub instance answering only the listing. A real in-process skills
      // server merges the machine's own local registry into its listing
      // (listMergedSkills -> loadRegistry -> getDataDir), which would write the app
      // dir as a fixture artifact of the server, not of the dry-run client path this
      // P1 names. The stub isolates the client path: resolve the credential + origin,
      // enumerate, plan — and write nothing.
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (req.method === "GET" && url.pathname === "/api/v1/skills") {
            return Response.json([]);
          }
          return new Response("not found", { status: 404 });
        },
      });
      try {
        const credentialsDir = join(home, ".hasna", "skills", "config");
        mkdirSync(credentialsDir, { recursive: true });
        writeFileSync(
          join(credentialsDir, "credentials"),
          `HASNA_SKILLS_API_URL=http://127.0.0.1:${server.port}\nHASNA_SKILLS_API_KEY=${SYNC_AUTH}\n`,
          { mode: 0o600 },
        );
        const local = makeCorpus({});
        const result = await reconcileRegistry({ rootDir: local, dryRun: true });

        expect(result.dryRun).toBe(true);
        // Positive control: the write-free resolution found the stored credential and
        // origin — the plan enumerated the registry rather than failing on a missing
        // credential.
        expect(result.summary.remote).toBe(0);

        // The dry run must not have populated the app dir, merged the legacy tree, or
        // copied the legacy config — the writes getDataDir() performs on any call.
        // (`~/.hasna/skills/config/` exists because this test wrote the credential
        // there; nothing else may.)
        expect(readdirSync(join(home, ".hasna", "skills"))).toEqual(["config"]);
        expect(readdirSync(legacyDir)).toEqual(["auth.json"]);
      } finally {
        server.stop(true);
      }
    } finally {
      process.env.HOME = previousHome;
      if (previousSkillsDir === undefined) delete process.env.HASNA_SKILLS_DIR;
      else process.env.HASNA_SKILLS_DIR = previousSkillsDir;
      if (previousApiKey === undefined) delete process.env.SKILLS_API_KEY;
      else process.env.SKILLS_API_KEY = previousApiKey;
      if (previousApiUrl === undefined) delete process.env.SKILLS_API_URL;
      else process.env.SKILLS_API_URL = previousApiUrl;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a version-only divergence with identical digest is a conflict, not in-sync", async () => {
    const seed = makeCorpus({ "sync-v": skillFiles("sync-v", "1.0.0", "v1") });
    const local = makeCorpus({ "sync-v": skillFiles("sync-v", "1.0.0", "v1") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        // Publish with a version OVERRIDE: the stored row version differs from the
        // version inside the bundle, so digest equality does not imply version equality.
        await pushSkill("sync-v", { rootDir: seed, client, version: "9.9.9" });

        const result = await reconcileRegistry({ rootDir: local, client });
        const entry = result.skills.find((item) => item.slug === "sync-v");
        expect(entry?.state).toBe("conflict");
        expect(entry?.reason).toMatch(/version divergence/i);
        expect(result.summary.conflicts).toBe(1);

        // The declared policy resolves it: local wins by pushing (refreshing the stored
        // version to the bundle's own version).
        const resolved = await reconcileRegistry({ rootDir: local, client, conflict: "local" });
        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const remote = await findRemote(reader, "sync-v");
        expect(remote?.version).toBe("1.0.0");
        expect(resolved.summary.conflicts).toBe(1);
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a local divergence from a bundled row is pushed, not declared in-sync", async () => {
    // The bundled corpus rows carry no bundle digest AND no version, so the version axis
    // cannot fire for them. Local divergence is detected through the baseline marker:
    // once a sync recorded a baseline, a local digest that moved away from it is
    // changed-locally and pushed (a published row overrides the bundled one).
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const listed = await client.listSkills();
        const bundled = listed.find((row) => !row.bundleSha256 && typeof (row.slug ?? row.name) === "string") as
          { slug?: string; name?: string } | undefined;
        const slug = bundled?.slug ?? bundled?.name;
        expect(slug).toBeDefined();

        const local = makeCorpus({ [slug!]: skillFiles(slug!, "0.0.1", "local-edit") });
        // A baseline from an earlier sync whose digest the current local pack no longer
        // matches — the same shape as a user editing a previously-pushed skill.
        const skillDir = join(local, slug!);
        writeFileSync(
          join(skillDir, PULL_MARKER_FILE),
          `${JSON.stringify({ managedBy: "@hasna/skills", skill: slug, source: "sync", contentHash: "d".repeat(64), syncedAt: "2026-08-18T00:00:00.000Z" }, null, 2)}\n`,
        );
        try {
          const result = await reconcileRegistry({ rootDir: local, client });
          const entry = result.skills.find((item) => item.slug === slug);
          expect(entry?.state).toBe("changed-locally");
          expect(entry?.action).toBe("push");
          expect(result.summary.conflicts).toBe(0);

          // The instance now serves a published row with a digest for the slug.
          const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
          const remote = await findRemote(reader, slug!);
          expect(remote?.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
        } finally {
          rmSync(local, { recursive: true, force: true });
        }
      });
    } finally {
      // No persistent fixture outside the server.
    }
  });

  test("--conflict=remote on a version divergence converges on the next run", async () => {
    const seed = makeCorpus({ "sync-v": skillFiles("sync-v", "1.0.0", "v1") });
    const local = makeCorpus({ "sync-v": skillFiles("sync-v", "1.0.0", "v1") });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await pushSkill("sync-v", { rootDir: seed, client, version: "9.9.9" });

        // The declared remote policy pulls: the bundle is identical, so the pull's sidecar
        // marker records the remote version (9.9.9). The next sync must read that marker
        // version as the synced local version and report in-sync — the conflict must not
        // re-report forever.
        const resolved = await reconcileRegistry({ rootDir: local, client, conflict: "remote" });
        expect(resolved.summary.conflicts).toBe(1);
        const entry = resolved.skills.find((item) => item.slug === "sync-v");
        expect(entry?.action).toBe("pull");
        expect(readMarker(join(local, "sync-v"))?.version).toBe("9.9.9");

        const after = await reconcileRegistry({ rootDir: local, client });
        expect(after.summary.conflicts).toBe(0);
        expect(after.skills.find((item) => item.slug === "sync-v")?.state).toBe("in-sync");
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a failed registry listing fails closed instead of reading as an empty registry", async () => {
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        // A client whose credential the server does not know: the listing returns an
        // error object, never an array. Treating that as "0 remote skills" would plan
        // every local skill as a push into an unauthorized void.
        const badClient = new RemoteSkillsClient("wrong-token", ctx.baseUrl);
        await expect(reconcileRegistry({ rootDir: local, client: badClient })).rejects.toThrow(/Registry listing failed/);
      });
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("the cursor is not advanced when a push fails", async () => {
    const local = makeCorpus({});
    // A local skill that fails validation at push time: the content hash does not match
    // the bundle, so the publish path refuses it.
    const invalidDir = join(local, "sync-invalid");
    for (const [path, content] of Object.entries(skillFiles("sync-invalid", "1.0.0", "broken"))) {
      const absolute = join(invalidDir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client });
        expect(result.summary.errors).toBeGreaterThanOrEqual(1);
        expect(result.cursor).toBeUndefined();
        expect(existsSync(join(local, SYNC_CURSOR_FILE))).toBe(false);
      });
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a remote change between plan and push skips the push instead of overwriting", async () => {
    const seed = makeCorpus({});
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        // A concurrent publisher lands sync-a on the registry AFTER the listing the plan
        // was built from: the re-check sees the new digest while listSkills did not.
        class RacingClient extends RemoteSkillsClient {
          override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
            if (slug === "sync-a") {
              return { status: 200, body: { slug, name: slug, version: "1.0.0", bundleSha256: "a".repeat(64), source: "remote" } };
            }
            return super.getSkillStatus(slug);
          }
        }
        const client = new RacingClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client });

        const entry = result.skills.find((item) => item.slug === "sync-a");
        expect(entry?.action).toBe("push");
        expect(entry?.result?.ok).toBe(false);
        expect(entry?.result?.detail).toMatch(/remote changed during sync/);

        // The registry never received the push: the concurrent state was not overwritten.
        const reader = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        expect(await findRemote(reader, "sync-a")).toBeUndefined();
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a remote change between plan and pull skips the pull instead of replacing local", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({});
    try {
      await withServer(async (ctx) => {
        const base = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(base, seed, "sync-b");
        // The remote moves again after the listing the plan was built from.
        class RacingClient extends RemoteSkillsClient {
          override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
            if (slug === "sync-b") {
              return { status: 200, body: { slug, name: slug, version: "2.0.0", bundleSha256: "b".repeat(64), source: "remote" } };
            }
            return super.getSkillStatus(slug);
          }
        }
        const client = new RacingClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client });

        const entry = result.skills.find((item) => item.slug === "sync-b");
        expect(entry?.action).toBe("pull");
        expect(entry?.result?.ok).toBe(false);
        expect(entry?.result?.detail).toMatch(/remote changed during sync/);
        expect(existsSync(join(local, "sync-b"))).toBe(false);
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a local edit between plan and pull skips the pull instead of replacing local", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({});
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-b");
        // The local side gains a divergent copy of the same slug between plan and pull:
        // the first re-check call (the remote re-check) triggers the local edit, and the
        // local re-pack then sees a digest different from the planned absence.
        class LocalRacingClient extends RemoteSkillsClient {
          private edited = false;
          override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
            if (slug === "sync-b" && !this.edited) {
              const dir = join(local, "sync-b");
              if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
                for (const [path, content] of Object.entries(skillFiles("sync-b", "1.0.0", "concurrent-edit"))) {
                  const absolute = join(dir, path);
                  mkdirSync(dirname(absolute), { recursive: true });
                  writeFileSync(absolute, content);
                }
                refillContentHash(dir);
                this.edited = true;
              }
            }
            return super.getSkillStatus(slug);
          }
        }
        const racing = new LocalRacingClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client: racing });

        const entry = result.skills.find((item) => item.slug === "sync-b");
        // The pull was planned; the local directory appeared before the pull's re-check,
        // so the pull was skipped and the concurrent local state was not replaced.
        expect(entry?.action).toBe("pull");
        expect(entry?.result?.ok).toBe(false);
        expect(entry?.result?.detail).toMatch(/local changed during sync/);
        // The concurrent content survives untouched.
        expect(readFileSync(join(local, "sync-b", "SKILL.md"), "utf-8")).toContain("concurrent-edit");
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a partial unpackable local directory appearing mid-run skips the pull", async () => {
    const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
    const local = makeCorpus({});
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
        await seedRemote(client, seed, "sync-b");
        // The local side gains a directory with NO packable content (only a dotfile) —
        // packSkillBundle throws for it, and the re-check must treat a present-but-
        // unpackable tree as "changed", never as "still missing".
        class PartialClient extends RemoteSkillsClient {
          private planted = false;
          override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
            if (slug === "sync-b" && !this.planted) {
              const dir = join(local, "sync-b");
              if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, ".partial"), "not packable\n");
                this.planted = true;
              }
            }
            return super.getSkillStatus(slug);
          }
        }
        const racing = new PartialClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client: racing });

        const entry = result.skills.find((item) => item.slug === "sync-b");
        expect(entry?.action).toBe("pull");
        expect(entry?.result?.ok).toBe(false);
        expect(entry?.result?.detail).toMatch(/local changed during sync/);
        // The partial tree was not replaced by a pull.
        expect(readFileSync(join(local, "sync-b", ".partial"), "utf-8")).toBe("not packable\n");
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });

  test("a failing re-check is an error, never a silent skip or a successful run", async () => {
    const seed = makeCorpus({});
    const local = makeCorpus({ "sync-a": skillFiles("sync-a", "1.0.0", "local-a") });
    try {
      await withServer(async (ctx) => {
        // The registry answers the listing, then the re-check GET fails (network-level).
        // Fail-closed: the push is aborted as an ERROR, the cursor is not written, and
        // the run reports errors so the CLI exits non-zero.
        class FailingRecheckClient extends RemoteSkillsClient {
          override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
            if (slug === "sync-a") throw new Error("network unreachable");
            return super.getSkillStatus(slug);
          }
        }
        const client = new FailingRecheckClient(SYNC_AUTH, ctx.baseUrl);
        const result = await reconcileRegistry({ rootDir: local, client });

        expect(result.summary.errors).toBeGreaterThanOrEqual(1);
        expect(result.cursor).toBeUndefined();
        expect(existsSync(join(local, SYNC_CURSOR_FILE))).toBe(false);
        const entry = result.skills.find((item) => item.slug === "sync-a");
        expect(entry?.result?.ok).toBe(false);
        expect(entry?.result?.detail).toMatch(/network unreachable/);
      });
    } finally {
      rmSync(seed, { recursive: true, force: true });
      rmSync(local, { recursive: true, force: true });
    }
  });
});
