import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pullSkills, PullSkillError, type SkillPullClient, BUNDLE_DIGEST_HEADER, BUNDLE_SIGNATURE_HEADER, BUNDLE_REVISION_ID_HEADER, BUNDLE_REVISION_NUMBER_HEADER, installBundleAtomically, verifyBundleResponseBytes, PULL_MARKER_FILE } from "./pull.js";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { clearRegistryCache, loadRegistryProfile } from "./registry.js";
import { revisionIdOf } from "./revision.js";
import { packSkillBundle, sha256Hex, unpackSkillBundle } from "./skill-bundle.js";
import { signBundleBytes } from "./skill-bundles.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * A stand-in for RemoteSkillsClient that answers from an in-memory table, so the
 * corpus-writing and enumeration behaviour of `pullSkills` can be tested without a
 * network or an origin. The real HTTP path is exercised end-to-end in pull.e2e.test.ts.
 */
function fakeClient(
  skills: Record<
    string,
    {
      md: string | null;
      meta?: Record<string, unknown>;
      bundle?: Uint8Array;
      bundleHeaders?: Record<string, string>;
      tombstoned?: boolean;
      /** When set, getBundle answers this status instead of serving a bundle (e.g. 404 after purge). */
      bundleStatus?: number;
    }
  >,
  listing?: unknown[],
): SkillPullClient {
  return {
    async listSkills() {
      return listing ?? Object.keys(skills).map((slug) => ({ slug, name: slug }));
    },
    async getSkill(slug: string) {
      return skills[slug]?.meta ?? null;
    },
    async getSkillMd(slug: string) {
      return skills[slug]?.md ?? null;
    },
    async getBundle(slug: string) {
      const entry = skills[slug];
      if (!entry) return null;
      // A tombstoned slug answers 410, exactly like the hosted registry (todos d061fcda).
      if (entry.tombstoned) return new Response(null, { status: 410 });
      // A purged slug answers 404: the published row is gone (todos d061fcda).
      if (entry.bundleStatus) return new Response(null, { status: entry.bundleStatus });
      if (!entry.bundle) return null;
      return new Response(entry.bundle.buffer as ArrayBuffer, { headers: entry.bundleHeaders ?? {} });
    },
  };
}

/**
 * The metadata payload a revisioned instance serves for a published skill, with the
 * revision id computed over the SAME canonical content the pull recomputes from. The
 * proof "the recorded revision identifies the installed content" must be real — never
 * an arbitrary 64-hex id.
 */
function revisionMetaFor(
  slug: string,
  md: string,
  opts: { source?: string; version?: string; bundleSha256?: string; bundleByteSize?: number; kind?: "executable" | "instruction" } = {},
): Record<string, unknown> {
  const kind = opts.kind ?? "instruction";
  const source = opts.source ?? "custom";
  const displayName = `Display ${slug}`;
  const description = `Description of ${slug}`;
  const category = "Development Tools";
  const tags = ["ops"];
  const revisionId = revisionIdOf({
    slug,
    displayName,
    description,
    category,
    tags,
    source,
    kind,
    ...(opts.version ? { version: opts.version } : {}),
    skillMd: md,
    ...(opts.bundleSha256 ? { bundleSha256: opts.bundleSha256 } : {}),
    ...(opts.bundleByteSize !== undefined ? { bundleByteSize: opts.bundleByteSize } : {}),
  });
  return {
    displayName,
    description,
    category,
    tags,
    source: "remote",
    publishedSource: source,
    kind,
    ...(opts.version ? { version: opts.version } : {}),
    skillMd: md,
    revisionId,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "skills-pull-corpus-"));
}

const INSTRUCTION_MD =
  "---\nname: pulled-runbook\ndescription: The team deploy runbook\nkind: instruction\ncategory: Development Tools\ntags:\n  - ops\n  - deploy\n---\n\n# Pulled Runbook\n\nStep one. Step two.\n";

describe("pullSkills", () => {
  test("writes a pulled skill into the corpus with SKILL.md and skill.json", () => {
    const root = tempRoot();
    try {
      return pullSkills({
        names: ["pulled-runbook"],
        rootDir: root,
        client: fakeClient({
          "pulled-runbook": {
            md: INSTRUCTION_MD,
            meta: { kind: "instruction", category: "Development Tools", tags: ["ops", "deploy"], version: "2.0.0", description: "The team deploy runbook" },
          },
        }),
      }).then(({ results }) => {
        expect(results).toHaveLength(1);
        const [result] = results;
        expect(result.success).toBe(true);
        expect(result.name).toBe("pulled-runbook");
        expect(result.kind).toBe("instruction");
        expect(result.created).toBe(true);

        const skillDir = join(root, "pulled-runbook");
        expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
        expect(existsSync(join(skillDir, "skill.json"))).toBe(true);

        // SKILL.md is written verbatim — it is the agent-facing artifact.
        expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(INSTRUCTION_MD);

        const manifest = JSON.parse(readFileSync(join(skillDir, "skill.json"), "utf-8"));
        expect(manifest.name).toBe("pulled-runbook");
        expect(manifest.kind).toBe("instruction");
        expect(manifest.version).toBe("2.0.0");
        expect(manifest.category).toBe("Development Tools");
        expect(manifest.tags).toEqual(["ops", "deploy"]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("re-pulling the same skill is idempotent", async () => {
    const root = tempRoot();
    try {
      const client = fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } });
      const first = await pullSkills({ names: ["pulled-runbook"], rootDir: root, client });
      const skillDir = join(root, "pulled-runbook");
      const mdAfterFirst = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      const jsonAfterFirst = readFileSync(join(skillDir, "skill.json"), "utf-8");

      const second = await pullSkills({ names: ["pulled-runbook"], rootDir: root, client });

      expect(first.results[0].created).toBe(true);
      expect(second.results[0].created).toBe(false);
      expect(second.results[0].success).toBe(true);
      // Same bytes on a re-pull: nothing drifts.
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(mdAfterFirst);
      expect(readFileSync(join(skillDir, "skill.json"), "utf-8")).toBe(jsonAfterFirst);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("honours $HASNA_SKILLS_DIR for the corpus path", async () => {
    // The hermetic preload points $HASNA_SKILLS_DIR at a per-test temp dir, so pulling
    // with no explicit rootDir must land under getPortableSkillsRoot() — proving the
    // env override is honoured rather than a hard-coded $HOME path.
    const { results } = await pullSkills({
      names: ["pulled-runbook"],
      client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
    });
    expect(results[0].success).toBe(true);
    const expected = join(getPortableSkillsRoot(), "pulled-runbook");
    expect(results[0].path).toBe(expected);
    expect(existsSync(join(expected, "SKILL.md"))).toBe(true);
  });

  test("writes into the migrated skills/ root when the layout-migration record exists", async () => {
    // Interlock with the home-migration layout (PR #116): after `skills storage
    // migrate`, sync reads the corpus from <app folder>/skills, so pull must write
    // there too — otherwise pulled skills are invisible to sync.
    const home = mkdtempSync(join(tmpdir(), "skills-pull-migrated-home-"));
    try {
      const appDir = join(home, ".hasna", "skills");
      const cache = join(appDir, "skills");
      mkdirSync(cache, { recursive: true });
      writeFileSync(
        join(cache, ".layout-migration.json"),
        `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), moved: ["installed"], note: "test" })}\n`,
      );

      const { results } = await pullSkills({
        names: ["pulled-runbook"],
        homeDir: home,
        client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
      });
      expect(results[0].success).toBe(true);
      const expected = join(cache, "pulled-runbook");
      expect(results[0].path).toBe(expected);
      expect(existsSync(join(expected, "SKILL.md"))).toBe(true);
      // Nothing lands in the pre-migration installed/ root.
      expect(existsSync(join(appDir, "installed", "pulled-runbook"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("writes into installed/ when no layout-migration record exists", async () => {
    // Negative control for the interlock: a hand-made skills/ dir without the
    // migration record is not the corpus, and pull keeps using installed/.
    const home = mkdtempSync(join(tmpdir(), "skills-pull-unmigrated-home-"));
    try {
      const appDir = join(home, ".hasna", "skills");
      mkdirSync(join(appDir, "skills"), { recursive: true });

      const { results } = await pullSkills({
        names: ["pulled-runbook"],
        homeDir: home,
        client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
      });
      expect(results[0].success).toBe(true);
      const expected = join(appDir, "installed", "pulled-runbook");
      expect(results[0].path).toBe(expected);
      expect(existsSync(join(expected, "SKILL.md"))).toBe(true);
      expect(existsSync(join(appDir, "skills", "pulled-runbook"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a pulled skill is surfaced by loadRegistry (the CLI list --all / MCP list_skills path)", async () => {
    await pullSkills({
      names: ["pulled-runbook"],
      client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
    });
    // Both `skills list --all` and the MCP `list_skills` tool read loadRegistryProfile("all").
    clearRegistryCache();
    const all = loadRegistryProfile("all");
    const found = all.find((skill) => skill.name === "pulled-runbook");
    expect(found).toBeDefined();
    expect(found?.kind).toBe("instruction");
    // It is NOT in the curated basic profile (custom/pulled skills are gated out of it).
    expect(loadRegistryProfile("basic").some((s) => s.name === "pulled-runbook")).toBe(false);
  });

  test("--all enumerates every skill the instance serves", async () => {
    const root = tempRoot();
    try {
      const { results } = await pullSkills({
        all: true,
        rootDir: root,
        client: fakeClient({
          alpha: { md: "---\nname: alpha\ndescription: A\nkind: instruction\n---\n# A\n" },
          beta: { md: "---\nname: beta\ndescription: B\nkind: instruction\n---\n# B\n" },
        }),
      });
      expect(results.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
      expect(results.every((r) => r.success)).toBe(true);
      expect(existsSync(join(root, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(root, "beta", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a clear failure when the instance has no such skill", async () => {
    const root = tempRoot();
    try {
      const { results } = await pullSkills({
        names: ["missing-skill"],
        rootDir: root,
        client: fakeClient({}),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("not found");
      expect(existsSync(join(root, "missing-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires at least one name or --all", async () => {
    await expect(
      pullSkills({ client: fakeClient({}) }),
    ).rejects.toBeInstanceOf(PullSkillError);
  });

  test("fails closed when an origin is configured but no credential resolves", async () => {
    // The shared ladder refuses to hand back an authority it has no key for, so
    // a pull cannot quietly become a no-op against the local corpus. (A key
    // WITHOUT an origin is no longer a failure at all — it reaches the fleet
    // gateway; see fleet-credentials.test.ts.)
    const savedUrl = process.env.SKILLS_API_URL;
    const savedKey = process.env.SKILLS_API_KEY;
    process.env.SKILLS_API_URL = "https://skills.internal.example";
    delete process.env.SKILLS_API_KEY;
    try {
      await expect(pullSkills({ names: ["pulled-runbook"] })).rejects.toThrow(/no API key resolved/);
    } finally {
      if (savedUrl === undefined) delete process.env.SKILLS_API_URL;
      else process.env.SKILLS_API_URL = savedUrl;
      if (savedKey === undefined) delete process.env.SKILLS_API_KEY;
      else process.env.SKILLS_API_KEY = savedKey;
    }
  });

  test("errors clearly when no API key is available to reach the instance", async () => {
    // client: null models createRemoteSkillsClient() finding no credential.
    await expect(pullSkills({ names: ["x"], client: null })).rejects.toBeInstanceOf(PullSkillError);
  });
});

/** Build a real canonical bundle for a one-file skill directory. */
function makeBundleSkill(name: string, content: string, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "skills-bundle-src-"));
  const files: Record<string, string> = { "SKILL.md": content, ...extra };
  for (const [path, bytes] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    writeFileSync(full, bytes);
  }
  return { dir, packed: packSkillBundle(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BUNDLED_MD =
  "---\nname: bundled-skill\ndescription: A bundled executable skill\nkind: executable\n---\n\n# Bundled\n";

describe("pullSkills — verified bundle path", () => {
  test("installs a verified bundle atomically and records version/hash/commit in the marker", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("bundled-skill", BUNDLED_MD, {
      "scripts/run.ts": "console.log('run')",
      "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "bundled-skill", version: "1.2.3", kind: "executable", source_commit: "abc123" }),
    });
    try {
      const { results } = await pullSkills({
        names: ["bundled-skill"],
        rootDir: root,
        client: fakeClient({
          "bundled-skill": {
            md: BUNDLED_MD,
            meta: { kind: "executable", version: "1.2.3" },
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256 },
          },
        }),
      });
      const [result] = results;
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.version).toBe("1.2.3");
      expect(result.contentHash).toBe(source.packed.sha256);

      const skillDir = join(root, "bundled-skill");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(BUNDLED_MD);
      expect(readFileSync(join(skillDir, "scripts", "run.ts"), "utf-8")).toBe("console.log('run')");

      const marker = JSON.parse(readFileSync(join(skillDir, ".hasna-skills.json"), "utf-8"));
      expect(marker.managedBy).toBe("@hasna/skills");
      expect(marker.source).toBe("pull");
      expect(marker.version).toBe("1.2.3");
      expect(marker.contentHash).toBe(source.packed.sha256);
      expect(marker.sourceCommit).toBe("abc123");
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("re-pulling the same bundle replaces the entry atomically (idempotent, created=false)", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("bundled-skill", BUNDLED_MD);
    try {
      const client = fakeClient({
        "bundled-skill": { md: BUNDLED_MD, bundle: source.packed.bytes, bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256 } },
      });
      const first = await pullSkills({ names: ["bundled-skill"], rootDir: root, client });
      const second = await pullSkills({ names: ["bundled-skill"], rootDir: root, client });
      expect(first.results[0].created).toBe(true);
      expect(second.results[0].created).toBe(false);
      expect(second.results[0].success).toBe(true);
      expect(readFileSync(join(root, "bundled-skill", "SKILL.md"), "utf-8")).toBe(BUNDLED_MD);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("rejects a bundle whose digest header does not match its bytes, and installs nothing", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("bundled-skill", BUNDLED_MD);
    try {
      const { results } = await pullSkills({
        names: ["bundled-skill"],
        rootDir: root,
        client: fakeClient({
          "bundled-skill": {
            md: BUNDLED_MD,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: "0".repeat(64) },
          },
        }),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("digest mismatch");
      expect(existsSync(join(root, "bundled-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("rejects a bundle whose signature does not verify against the configured key", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("bundled-skill", BUNDLED_MD);
    try {
      const { results } = await pullSkills({
        names: ["bundled-skill"],
        rootDir: root,
        signingKey: "correct-key",
        client: fakeClient({
          "bundled-skill": {
            md: BUNDLED_MD,
            bundle: source.packed.bytes,
            bundleHeaders: {
              [BUNDLE_DIGEST_HEADER]: source.packed.sha256,
              [BUNDLE_SIGNATURE_HEADER]: signBundleBytes(source.packed.bytes, "wrong-key"),
            },
          },
        }),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("signature mismatch");
      expect(existsSync(join(root, "bundled-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("accepts a bundle whose signature verifies against the configured key", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("bundled-skill", BUNDLED_MD);
    try {
      const { results } = await pullSkills({
        names: ["bundled-skill"],
        rootDir: root,
        signingKey: "correct-key",
        client: fakeClient({
          "bundled-skill": {
            md: BUNDLED_MD,
            bundle: source.packed.bytes,
            bundleHeaders: {
              [BUNDLE_DIGEST_HEADER]: source.packed.sha256,
              [BUNDLE_SIGNATURE_HEADER]: signBundleBytes(source.packed.bytes, "correct-key"),
            },
          },
        }),
      });
      expect(results[0].success).toBe(true);
      const marker = JSON.parse(readFileSync(join(root, "bundled-skill", ".hasna-skills.json"), "utf-8"));
      expect(marker.signature).toContain("hmac-sha256:");
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("records the installed revision id in the result and the marker", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("revisioned-skill", BUNDLED_MD);
    const meta = revisionMetaFor("revisioned-skill", BUNDLED_MD, {
      kind: "executable",
      version: "1.2.3",
      bundleSha256: source.packed.sha256,
      bundleByteSize: source.packed.bytes.byteLength,
    });
    const revisionId = String(meta.revisionId);
    try {
      const { results } = await pullSkills({
        names: ["revisioned-skill"],
        rootDir: root,
        client: fakeClient({
          "revisioned-skill": {
            md: BUNDLED_MD,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: {
              [BUNDLE_DIGEST_HEADER]: source.packed.sha256,
              [BUNDLE_REVISION_ID_HEADER]: revisionId,
              [BUNDLE_REVISION_NUMBER_HEADER]: "3",
            },
          },
        }),
      });
      expect(results[0].success).toBe(true);
      expect(results[0].revisionId).toBe(revisionId);

      const marker = JSON.parse(readFileSync(join(root, "revisioned-skill", ".hasna-skills.json"), "utf-8"));
      expect(marker.revisionId).toBe(revisionId);
      expect(marker.contentHash).toBe(source.packed.sha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a declared revision that does not identify the served content fails closed", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("unprovable-skill", BUNDLED_MD);
    try {
      // The instance declares a revision that is NOT the content-addressed sha of what it
      // serves: the pull must refuse to install and refuse to record, never accept it.
      const { results } = await pullSkills({
        names: ["unprovable-skill"],
        rootDir: root,
        client: fakeClient({
          "unprovable-skill": {
            md: BUNDLED_MD,
            meta: revisionMetaFor("unprovable-skill", BUNDLED_MD, {
              kind: "executable",
              bundleSha256: source.packed.sha256,
              bundleByteSize: source.packed.bytes.byteLength,
            }),
            bundle: source.packed.bytes,
            bundleHeaders: {
              [BUNDLE_DIGEST_HEADER]: source.packed.sha256,
              [BUNDLE_REVISION_ID_HEADER]: "ab".repeat(32),
              [BUNDLE_REVISION_NUMBER_HEADER]: "1",
            },
          },
        }),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("Revision proof failed");
      // Nothing was installed: no corpus entry, no marker with an unprovable id.
      expect(existsSync(join(root, "unprovable-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("pull after a remote change detects the newer revision", async () => {
    const root = tempRoot();
    const v1 = makeBundleSkill("evolving-skill", "---\nname: evolving-skill\ndescription: v1\nkind: instruction\n---\n# v1\n");
    const v2 = makeBundleSkill("evolving-skill", "---\nname: evolving-skill\ndescription: v2\nkind: instruction\n---\n# v2\n");
    const md1 = "---\nname: evolving-skill\ndescription: v1\nkind: instruction\n---\n# v1\n";
    const md2 = "---\nname: evolving-skill\ndescription: v2\nkind: instruction\n---\n# v2\n";
    try {
      const clientFor = (md: string, packed: { bytes: Uint8Array; sha256: string }, number: number) => {
        const meta = revisionMetaFor("evolving-skill", md, { bundleSha256: packed.sha256, bundleByteSize: packed.bytes.byteLength });
        return fakeClient({
          "evolving-skill": {
            md,
            meta,
            bundle: packed.bytes,
            bundleHeaders: {
              [BUNDLE_DIGEST_HEADER]: packed.sha256,
              [BUNDLE_REVISION_ID_HEADER]: String(meta.revisionId),
              [BUNDLE_REVISION_NUMBER_HEADER]: String(number),
            },
          },
        });
      };

      const first = await pullSkills({ names: ["evolving-skill"], rootDir: root, client: clientFor(md1, v1.packed, 1) });
      expect(first.results[0].success).toBe(true);
      expect(first.results[0].revisionId).toBe(String(revisionMetaFor("evolving-skill", md1, { bundleSha256: v1.packed.sha256, bundleByteSize: v1.packed.bytes.byteLength }).revisionId));
      const markerAfterFirst = JSON.parse(readFileSync(join(root, "evolving-skill", ".hasna-skills.json"), "utf-8"));
      expect(markerAfterFirst.revisionId).toBe(String(revisionMetaFor("evolving-skill", md1, { bundleSha256: v1.packed.sha256, bundleByteSize: v1.packed.bytes.byteLength }).revisionId));
      expect(markerAfterFirst.contentHash).toBe(v1.packed.sha256);

      // The remote moved to a newer revision; a re-pull detects and records it.
      const second = await pullSkills({ names: ["evolving-skill"], rootDir: root, client: clientFor(md2, v2.packed, 2) });
      expect(second.results[0].success).toBe(true);
      expect(second.results[0].revisionId).toBe(String(revisionMetaFor("evolving-skill", md2, { bundleSha256: v2.packed.sha256, bundleByteSize: v2.packed.bytes.byteLength }).revisionId));
      expect(second.results[0].contentHash).toBe(v2.packed.sha256);
      const markerAfterSecond = JSON.parse(readFileSync(join(root, "evolving-skill", ".hasna-skills.json"), "utf-8"));
      expect(markerAfterSecond.revisionId).toBe(String(revisionMetaFor("evolving-skill", md2, { bundleSha256: v2.packed.sha256, bundleByteSize: v2.packed.bytes.byteLength }).revisionId));
      expect(markerAfterSecond.contentHash).toBe(v2.packed.sha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
      v1.cleanup();
      v2.cleanup();
    }
  });

  test("a tombstoned skill is removed from the corpus by pull, then reported missing after expiry", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("doomed-skill", BUNDLED_MD);
    const meta = revisionMetaFor("doomed-skill", BUNDLED_MD, { bundleSha256: source.packed.sha256, bundleByteSize: source.packed.bytes.byteLength });
    const revisionId = String(meta.revisionId);
    try {
      // First: install it.
      const installed = await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({
          "doomed-skill": {
            md: BUNDLED_MD,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, [BUNDLE_REVISION_ID_HEADER]: revisionId },
          },
        }),
      });
      expect(installed.results[0].success).toBe(true);
      expect(existsSync(join(root, "doomed-skill", "SKILL.md"))).toBe(true);

      // The instance tombstones the slug: pull sees the 410 and reconciles by removing
      // the local copy — the tombstone contract, visible at the client boundary.
      const tombstoned = await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({ "doomed-skill": { md: null, tombstoned: true } }),
      });
      expect(tombstoned.results[0].success).toBe(true);
      expect(tombstoned.results[0].tombstoned).toBe(true);
      expect(tombstoned.results[0].removed).toBe(true);
      expect(existsSync(join(root, "doomed-skill"))).toBe(false);

      // After the tombstone window expires the slug is purged: pull reports not-found.
      const expired = await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({}),
      });
      expect(expired.results[0].success).toBe(false);
      expect(expired.results[0].error).toContain("not found");
      // A second tombstone pull with no local copy is still a clean reconcile.
      const alreadyGone = await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({ "doomed-skill": { md: null, tombstoned: true } }),
      });
      expect(alreadyGone.results[0].success).toBe(true);
      expect(alreadyGone.results[0].removed).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a 410 tombstone never deletes an unmanaged or user-created local skill", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("doomed-skill", BUNDLED_MD);
    const meta = revisionMetaFor("doomed-skill", BUNDLED_MD, { bundleSha256: source.packed.sha256, bundleByteSize: source.packed.bytes.byteLength });
    try {
      // Install a pull-managed copy first, then remove its marker to model a skill the
      // user created or took over locally (no `.hasna-skills.json`).
      await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({
          "doomed-skill": {
            md: BUNDLED_MD,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, [BUNDLE_REVISION_ID_HEADER]: String(meta.revisionId) },
          },
        }),
      });
      rmSync(join(root, "doomed-skill", PULL_MARKER_FILE));
      const localBytes = readFileSync(join(root, "doomed-skill", "SKILL.md"), "utf-8");

      // The remote 410 arrives: the unmanaged directory must survive.
      const result = await pullSkills({
        names: ["doomed-skill"],
        rootDir: root,
        client: fakeClient({ "doomed-skill": { md: null, tombstoned: true } }),
      });
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].tombstoned).toBe(true);
      expect(result.results[0].removed).toBe(false);
      expect(result.results[0].leftInPlace).toBe(true);
      expect(existsSync(join(root, "doomed-skill", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(root, "doomed-skill", "SKILL.md"), "utf-8")).toBe(localBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a purged published slug is reported, never swapped for the bundled skill", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("purged-skill", BUNDLED_MD);
    const meta = revisionMetaFor("purged-skill", BUNDLED_MD, { bundleSha256: source.packed.sha256, bundleByteSize: source.packed.bytes.byteLength });
    try {
      // First: the slug is published and pulled (a revision-marked local install).
      await pullSkills({
        names: ["purged-skill"],
        rootDir: root,
        client: fakeClient({
          "purged-skill": {
            md: BUNDLED_MD,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, [BUNDLE_REVISION_ID_HEADER]: String(meta.revisionId) },
          },
        }),
      });
      const installedBytes = readFileSync(join(root, "purged-skill", "SKILL.md"), "utf-8");

      // The tombstone window passes and the published row is purged; the bundled skill
      // with the same slug is what the metadata endpoint now serves, and the bundle
      // endpoint answers 404. The pull must report the published slug as purged/absent,
      // NOT reinstall the different bundled skill over the local copy.
      const bundledMd = "---\nname: purged-skill\ndescription: THE BUNDLED skill, a different thing\nkind: instruction\n---\n# Bundled\n";
      const purged = await pullSkills({
        names: ["purged-skill"],
        rootDir: root,
        client: fakeClient({
          "purged-skill": {
            md: bundledMd,
            meta: { displayName: "Bundled purged-skill", description: "THE BUNDLED skill, a different thing", category: "Development Tools", tags: [], kind: "instruction", source: "remote" },
            bundleStatus: 404,
          },
        }),
      });
      expect(purged.results[0].success).toBe(true);
      expect(purged.results[0].purged).toBe(true);
      expect(purged.results[0].removed).toBeFalsy();
      // The local published install is untouched and the bundled content was NOT installed.
      expect(existsSync(join(root, "purged-skill", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(root, "purged-skill", "SKILL.md"), "utf-8")).toBe(installedBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a bundle-only published skill (no SKILL.md) pulls and proves its revision", async () => {
    // Publishing permits a bundle without a SKILL.md (skill-validation warns, never
    // blocks), the publisher omits skillMd when absent, and the server hashes the row
    // over the canonical null form. The bundle path must recompute the revision over
    // the served metadata plus the verified bundle bytes — skillMd absent included —
    // instead of refusing the declared revision.
    const root = tempRoot();
    const source = makeBundleSkill("bundle-only", BUNDLED_MD);
    const meta = {
      displayName: "Display bundle-only",
      description: "Description of bundle-only",
      category: "Development Tools",
      tags: ["ops"],
      source: "remote",
      publishedSource: "custom",
      kind: "instruction",
      bundleSha256: source.packed.sha256,
      bundleByteSize: source.packed.bytes.byteLength,
      revisionId: revisionIdOf({
        slug: "bundle-only",
        displayName: "Display bundle-only",
        description: "Description of bundle-only",
        category: "Development Tools",
        tags: ["ops"],
        source: "custom",
        kind: "instruction",
        // skillMd absent hashes as the canonical null form — exactly what the server
        // records for a bundle-only publish.
        bundleSha256: source.packed.sha256,
        bundleByteSize: source.packed.bytes.byteLength,
      }),
    };
    try {
      const { results } = await pullSkills({
        names: ["bundle-only"],
        rootDir: root,
        client: fakeClient({
          "bundle-only": {
            md: null,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, [BUNDLE_REVISION_ID_HEADER]: String(meta.revisionId) },
          },
        }),
      });
      expect(results[0].success).toBe(true);
      expect(results[0].revisionId).toBe(String(meta.revisionId));
      const installed = readFileSync(join(root, "bundle-only", "SKILL.md"), "utf-8");
      expect(installed).toBe(BUNDLED_MD);
      const marker = JSON.parse(readFileSync(join(root, "bundle-only", ".hasna-skills.json"), "utf-8"));
      expect(marker.revisionId).toBe(String(meta.revisionId));
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a bundle-less pull proves the revision against the SKILL.md it actually installs", async () => {
    const root = tempRoot();
    const oldMd = "---\nname: md-only-skill\ndescription: first\nkind: instruction\n---\n# v1\n";
    const newMd = "---\nname: md-only-skill\ndescription: second\nkind: instruction\n---\n# v2\n";
    // The metadata response carries revision r1 for oldMd, but by the time the pull
    // fetches the SKILL.md the row has changed (newMd): the separately fetched bytes are
    // what will be installed, and the declared revision does not identify them. The pull
    // must fail closed rather than record r1 against newMd.
    const meta = revisionMetaFor("md-only-skill", oldMd);
    try {
      const { results } = await pullSkills({
        names: ["md-only-skill"],
        rootDir: root,
        client: fakeClient({
          "md-only-skill": { md: newMd, meta },
        }),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("Revision proof failed");
      expect(existsSync(join(root, "md-only-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a bundle-less pull installs SKILL.md byte-for-byte and proves its revision", async () => {
    const root = tempRoot();
    // Deliberately NO trailing newline: the corpus writer must not normalize the bytes,
    // because the revision proof covers the exact fetched document (the server stores
    // and hashes it verbatim). Appending a newline would record a revision that does
    // not identify the installed bytes.
    const md = "---\nname: no-newline-skill\ndescription: no trailing newline\nkind: instruction\n---\n# v1";
    const meta = revisionMetaFor("no-newline-skill", md);
    try {
      const { results } = await pullSkills({
        names: ["no-newline-skill"],
        rootDir: root,
        client: fakeClient({ "no-newline-skill": { md, meta } }),
      });
      expect(results[0].success).toBe(true);
      expect(results[0].revisionId).toBe(String(meta.revisionId));
      const installed = readFileSync(join(root, "no-newline-skill", "SKILL.md"), "utf-8");
      expect(installed).toBe(md);
      const marker = JSON.parse(readFileSync(join(root, "no-newline-skill", ".hasna-skills.json"), "utf-8"));
      expect(marker.revisionId).toBe(String(meta.revisionId));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a purged published slug on a bundle-less instance is reported, not reinstalled", async () => {
    const root = tempRoot();
    const source = makeBundleSkill("purged-md-only", BUNDLED_MD);
    const meta = revisionMetaFor("purged-md-only", BUNDLED_MD, { bundleSha256: source.packed.sha256, bundleByteSize: source.packed.bytes.byteLength });
    try {
      // Install the published revision first.
      await pullSkills({
        names: ["purged-md-only"],
        rootDir: root,
        client: fakeClient({
          "purged-md-only": {
            md: BUNDLED_MD,
            meta,
            bundle: source.packed.bytes,
            bundleHeaders: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, [BUNDLE_REVISION_ID_HEADER]: String(meta.revisionId) },
          },
        }),
      });
      const installedBytes = readFileSync(join(root, "purged-md-only", "SKILL.md"), "utf-8");

      // After purge the instance serves only the bundled SKILL.md with no revision id and
      // no bundle at all. The pull reports the published slug as purged rather than
      // installing the bundled skill over the local copy.
      const bundledMd = "---\nname: purged-md-only\ndescription: bundled replacement\nkind: instruction\n---\n# Bundled\n";
      const purged = await pullSkills({
        names: ["purged-md-only"],
        rootDir: root,
        client: fakeClient({
          "purged-md-only": {
            md: bundledMd,
            meta: { displayName: "Bundled purged-md-only", description: "bundled replacement", category: "Development Tools", tags: [], kind: "instruction", source: "remote" },
          },
        }),
      });
      expect(purged.results[0].success).toBe(true);
      expect(purged.results[0].purged).toBe(true);
      expect(existsSync(join(root, "purged-md-only", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(root, "purged-md-only", "SKILL.md"), "utf-8")).toBe(installedBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
      source.cleanup();
    }
  });

  test("a bundle-less re-pull atomically replaces the entry when a mid-write failure would otherwise destroy it", async () => {
    const root = tempRoot();
    const v1 = "---\nname: atomic-demo\ndescription: first\nkind: instruction\n---\n# Demo v1\n";
    const v2 = "---\nname: atomic-demo\ndescription: second\nkind: instruction\n---\n# Demo v2\n";
    try {
      // Install v1 through the real metadata-only pull path.
      const first = await pullSkills({
        names: ["atomic-demo"],
        rootDir: root,
        client: fakeClient({ "atomic-demo": { md: v1, meta: { kind: "instruction" } } }),
      });
      expect(first.results[0].success).toBe(true);
      expect(readFileSync(join(root, "atomic-demo", "SKILL.md"), "utf-8")).toBe(v1);

      // Squat a DIRECTORY on skill.json inside the live entry: the direct-overwrite
      // writer (writeCorpusSkill) would now throw EISDIR on its skill.json write,
      // AFTER SKILL.md was already overwritten — destroying v1 and leaving a
      // truncated/mismatched pair. The atomic installer never writes into the live
      // target, so the re-pull must swap the whole tree (squat included) aside and
      // install v2 complete.
      rmSync(join(root, "atomic-demo", "skill.json"));
      mkdirSync(join(root, "atomic-demo", "skill.json"));

      const second = await pullSkills({
        names: ["atomic-demo"],
        rootDir: root,
        client: fakeClient({ "atomic-demo": { md: v2, meta: { kind: "instruction" } } }),
      });
      expect(second.results[0].success).toBe(true);
      expect(readFileSync(join(root, "atomic-demo", "SKILL.md"), "utf-8")).toBe(v2);
      // skill.json is a real manifest file again, never the squatting directory.
      const manifest = JSON.parse(readFileSync(join(root, "atomic-demo", "skill.json"), "utf-8"));
      expect(manifest.name).toBe("atomic-demo");
      // No staging or backup leftovers in the corpus root.
      const leftovers = readdirSync(root).filter((entry) => entry.startsWith(".pull-"));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verifyBundleResponseBytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = sha256Hex(bytes);

  test("accepts a matching digest header", () => {
    const response = new Response(bytes, { headers: { [BUNDLE_DIGEST_HEADER]: sha256Hex(bytes) } });
    const verified = verifyBundleResponseBytes(bytes.buffer.slice(0), response);
    expect(verified.contentHash).toBe(sha256Hex(bytes));
    expect(verified.serverHash).toBe(sha256Hex(bytes));
  });

  test("rejects a mismatching digest header", () => {
    const response = new Response(bytes, { headers: { [BUNDLE_DIGEST_HEADER]: "0".repeat(64) } });
    expect(() => verifyBundleResponseBytes(bytes.buffer.slice(0), response)).toThrow(PullSkillError);
  });

  test("rejects a malformed signature string", () => {
    const response = new Response(bytes, {
      headers: { [BUNDLE_SIGNATURE_HEADER]: "not-a-signature" },
    });
    expect(() => verifyBundleResponseBytes(bytes.buffer.slice(0), response, { signingKey: "key" })).toThrow(PullSkillError);
  });

  test("records the revision id and number from the headers", () => {
    const revisionId = "ef".repeat(32);
    const response = new Response(bytes, {
      headers: {
        [BUNDLE_DIGEST_HEADER]: sha256Hex(bytes),
        [BUNDLE_REVISION_ID_HEADER]: revisionId,
        [BUNDLE_REVISION_NUMBER_HEADER]: "7",
      },
    });
    const verified = verifyBundleResponseBytes(bytes.buffer.slice(0), response);
    expect(verified.revisionId).toBe(revisionId);
    expect(verified.revisionNumber).toBe(7);
  });

  test("rejects a malformed revision id header", () => {
    const response = new Response(bytes, {
      headers: { [BUNDLE_DIGEST_HEADER]: sha256Hex(bytes), [BUNDLE_REVISION_ID_HEADER]: "not-a-revision-id" },
    });
    expect(() => verifyBundleResponseBytes(bytes.buffer.slice(0), response)).toThrow(PullSkillError);
  });

  test("rejects a malformed revision number header", () => {
    const response = new Response(bytes, {
      headers: { [BUNDLE_DIGEST_HEADER]: sha256Hex(bytes), [BUNDLE_REVISION_ID_HEADER]: "ef".repeat(32), [BUNDLE_REVISION_NUMBER_HEADER]: "-1" },
    });
    expect(() => verifyBundleResponseBytes(bytes.buffer.slice(0), response)).toThrow(PullSkillError);
  });
});

describe("installBundleAtomically", () => {
  test("writes entries, marker, and swaps over an existing entry without partial state", () => {
    const root = tempRoot();
    try {
      const first = installBundleAtomically("demo", [
        { path: "SKILL.md", bytes: new Uint8Array(new TextEncoder().encode("v1")), mode: 0o644 },
      ], { rootDir: root }, { version: "1.0.0", contentHash: "aaa" });
      expect(first.created).toBe(true);
      expect(readFileSync(join(first.path, "SKILL.md"), "utf-8")).toBe("v1");

      const second = installBundleAtomically("demo", [
        { path: "SKILL.md", bytes: new Uint8Array(new TextEncoder().encode("v2")), mode: 0o644 },
      ], { rootDir: root }, { version: "2.0.0", contentHash: "bbb" });
      expect(second.created).toBe(false);
      expect(readFileSync(join(second.path, "SKILL.md"), "utf-8")).toBe("v2");
      const marker = JSON.parse(readFileSync(join(second.path, ".hasna-skills.json"), "utf-8"));
      expect(marker.version).toBe("2.0.0");
      expect(marker.contentHash).toBe("bbb");
      // No staging or backup leftovers in the corpus root.
      const leftovers = readdirSync(root).filter((entry) => entry.startsWith(".pull-"));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
