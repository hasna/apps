/**
 * Regression: the pull re-check's local-existence sample raced the pack.
 *
 * The re-check sampled existsSync(localDir) BEFORE packing. A directory that appeared
 * between the sample and the pack made packing throw while the stale sample stayed
 * false — the pull then proceeded and installBundleAtomically() replaced (removed)
 * that newly created directory. (Review P1, final NO_GO on the terminated candidate.)
 *
 * The race window sits between two adjacent synchronous statements, so it cannot be
 * injected through the client's async boundaries. The fix moves the sample AFTER the
 * pack inside a small exported helper (`recheckLocalSide`) whose pack/exists ops are
 * injectable — the first test below pins the ordering deterministically by making the
 * pack throw while creating the directory and observing the post-pack sample. The
 * second test exercises the real full path: a partial directory planted during the
 * re-check's remote probe is never overwritten by the pull.
 */
import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { pushSkill } from "../cli/commands/publish.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { MemorySkillsStore } from "../server/store.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { computeContentHash } from "./skill-hash.js";
import { reconcileRegistry, recheckLocalSide } from "./registry-reconcile.js";

const SYNC_AUTH = "test-sync-token";
const PRINCIPAL = {
  orgId: "org_sync",
  orgSlug: "org-sync",
  orgName: "Sync Org",
  userId: "user_sync",
  email: "sync@example.com",
  apiKeyId: "key_sync",
};

describe("recheckLocalSide ordering (review P1)", () => {
  test("a directory appearing mid-pack is never read as still absent", () => {
    // The reviewer's exact interleaving: the plan saw no local directory (plannedLocal
    // undefined); between the existence sample and the pack a partial directory appears
    // (the pack throws on it). With the sample taken AFTER the pack, the directory is
    // provably on disk and the candidate counts as moved — the pull is skipped.
    let planted = false;
    const moved = recheckLocalSide(undefined, "/plans/saw/none", {
      // The pack runs while the concurrent editor creates the directory and throws on
      // the partial tree — localNow stays undefined exactly as in the defect.
      pack: () => {
        planted = true;
        throw new Error("Nothing to pack");
      },
      // Sampled after the pack: the directory exists now.
      exists: () => planted,
    });
    expect(moved).toBe(true);
  });

  test("a genuinely absent directory still counts as unchanged", () => {
    const moved = recheckLocalSide(undefined, "/plans/saw/none", {
      pack: () => {
        throw new Error("ENOENT");
      },
      exists: () => false,
    });
    expect(moved).toBe(false);
  });

  test("an unchanged present directory counts as unchanged", () => {
    const digest = "deadbeef";
    const moved = recheckLocalSide(digest, "/present", {
      pack: () => digest,
      exists: () => true,
    });
    expect(moved).toBe(false);
  });

  test("a changed present directory counts as moved", () => {
    const moved = recheckLocalSide("planned-digest", "/present", {
      pack: () => "new-digest",
      exists: () => true,
    });
    expect(moved).toBe(true);
  });
});

/** A minimal but valid skill; changing `flavor` changes the packed digest. */
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

function makeCorpus(skills: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "skills-toctou-corpus-"));
  for (const [name, files] of Object.entries(skills)) {
    const skillDir = join(root, name);
    for (const [path, content] of Object.entries(files)) {
      const absolute = join(skillDir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    // Fill skill.json's provenance.content_hash with the canonical hash of the
    // directory, exactly like the main reconcile suite, so a published bundle
    // validates.
    const manifestPath = join(skillDir, "skill.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { provenance: { content_hash: string } };
    manifest.provenance.content_hash = computeContentHash(skillDir);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return root;
}

async function withServer(fn: (ctx: { baseUrl: string }) => Promise<void>): Promise<void> {
  const store = new MemorySkillsStore();
  await store.ensureBootstrapApiKey(SYNC_AUTH, PRINCIPAL);
  const fetchHandler = await createSkillsFetchHandler({
    store,
    config: { inlineWorker: false, allowEphemeralStore: true },
  });
  const server = Bun.serve({ port: 0, fetch: fetchHandler });
  try {
    await fn({ baseUrl: `http://127.0.0.1:${server.port}` });
  } finally {
    server.stop(true);
  }
}

test("a partial local directory appearing during the pull re-check is never overwritten", async () => {
  const seed = makeCorpus({ "sync-b": skillFiles("sync-b", "1.0.0", "remote-b") });
  const local = makeCorpus({});
  const planted = join(local, "sync-b");
  try {
    await withServer(async (ctx) => {
      const client = new RemoteSkillsClient(SYNC_AUTH, ctx.baseUrl);
      const result = await pushSkill("sync-b", { rootDir: seed, client });
      expect(result.published).toBe(true);

      // The local side gains an EMPTY directory (nothing packable) during the pull
      // re-check: the remote probe answers first, then the local re-check packs and
      // samples. The pull must be skipped and reported, never executed.
      class PlantingClient extends RemoteSkillsClient {
        private planted = false;
        override async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
          if (slug === "sync-b" && !this.planted) {
            const dir = join(local, "sync-b");
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
              this.planted = true;
            }
          }
          return super.getSkillStatus(slug);
        }
      }
      const racing = new PlantingClient(SYNC_AUTH, ctx.baseUrl);
      const reconcile = await reconcileRegistry({ rootDir: local, client: racing });

      const entry = reconcile.skills.find((item) => item.slug === "sync-b");
      expect(entry?.action).toBe("pull");
      expect(entry?.result?.ok).toBe(false);
      expect(entry?.result?.detail).toMatch(/local changed during sync/);

      // The concurrent (planted) directory survives: still empty, not replaced by
      // the pulled bundle. installBundleAtomically() replacing it is the defect.
      expect(readdirSync(planted)).toEqual([]);
    });
  } finally {
    rmSync(seed, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  }
});
