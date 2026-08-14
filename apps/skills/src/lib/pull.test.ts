import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pullSkills, PullSkillError, type SkillPullClient, BUNDLE_DIGEST_HEADER, BUNDLE_SIGNATURE_HEADER, installBundleAtomically, verifyBundleResponseBytes } from "./pull.js";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { clearRegistryCache, loadRegistryProfile } from "./registry.js";
import { MissingApiUrlError } from "./api-url.js";
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
  skills: Record<string, { md: string | null; meta?: Record<string, unknown>; bundle?: Uint8Array; bundleHeaders?: Record<string, string> }>,
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
      const bundle = skills[slug]?.bundle;
      if (!bundle) return null;
      return new Response(bundle.buffer as ArrayBuffer, { headers: skills[slug]?.bundleHeaders ?? {} });
    },
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

  test("fails closed with MissingApiUrlError when no instance origin is configured", async () => {
    // A key is present but no origin: the client must refuse to invent a host.
    const savedUrl = process.env.SKILLS_API_URL;
    const savedKey = process.env.SKILLS_API_KEY;
    delete process.env.SKILLS_API_URL;
    process.env.SKILLS_API_KEY = "sk_test_key";
    try {
      await expect(pullSkills({ names: ["pulled-runbook"] })).rejects.toBeInstanceOf(MissingApiUrlError);
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
