/**
 * `skills pull name@version` (hasna/apps#1630): the exact version is requested from the
 * instance, the bytes are digest-verified, and the marker records the version the
 * instance named, not whatever the metadata row currently says.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE_DIGEST_HEADER, PULL_MARKER_FILE, pullSkills, type SkillPullClient } from "./pull.js";
import { packSkillBundle } from "./skill-bundle.js";
import { revisionIdOf } from "./revision.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const MD = "---\nname: versioned-skill\ndescription: A versioned skill\nkind: executable\n---\n\n# Versioned\n";

function makeSource(version: string) {
  const dir = mkdtempSync(join(tmpdir(), "skills-pull-version-src-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), MD);
  writeFileSync(join(dir, "scripts", "run.ts"), `console.log('run ${version}')\n`);
  writeFileSync(join(dir, "skill.json"), JSON.stringify({ standard: "hasna.skill.v1", name: "versioned-skill", version, kind: "executable" }));
  return { dir, packed: packSkillBundle(dir) };
}

describe("pullSkills name@version", () => {
  test("requests the exact version, verifies its digest, and records it in the marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-pull-version-root-"));
    const v1 = makeSource("1.0.0");
    const v2 = makeSource("2.0.0");
    const requested: Array<string | undefined> = [];
    // The genuine content-addressed revision of the CURRENT row (v2), so a bare pull proves it.
    const currentRevision = revisionIdOf({ slug: "versioned-skill", displayName: "Versioned", description: "A versioned skill", category: "Development Tools", tags: [], source: "custom", kind: "executable", version: "2.0.0", skillMd: MD, bundleSha256: v2.packed.sha256, bundleByteSize: v2.packed.bytes.byteLength });
    const client: SkillPullClient = {
      async listSkills() { return [{ slug: "versioned-skill", name: "versioned-skill" }]; },
      // The metadata row is the CURRENT revision, with everything a revision proof needs -
      // exactly the shape that made an older-version pull fail closed before the fix.
      async getSkill() { return { kind: "executable", version: "2.0.0", revisionId: currentRevision, publishedSource: "custom", displayName: "Versioned", description: "A versioned skill", category: "Development Tools", tags: [], skillMd: MD }; },
      async getSkillVersion(_slug: string, version: string) {
        if (version === "1.0.0") return { bundleSha256: v1.packed.sha256 };
        if (version === "2.0.0") return { bundleSha256: v2.packed.sha256 };
        return null;
      },
      async getSkillMd() { return MD; },
      async getBundle(_slug: string, version?: string) {
        requested.push(version);
        if (version && version !== "1.0.0" && version !== "2.0.0") return new Response(null, { status: 404 });
        const source = version === "1.0.0" ? v1 : v2;
        return new Response(source.packed.bytes.buffer as ArrayBuffer, {
          headers: { [BUNDLE_DIGEST_HEADER]: source.packed.sha256, "X-Skill-Version": version ?? "2.0.0" },
        });
      },
    };
    try {
      const { results } = await pullSkills({ names: ["versioned-skill@1.0.0"], rootDir: root, client });
      expect(requested).toEqual(["1.0.0"]);
      expect(results[0]).toMatchObject({ success: true, version: "1.0.0", contentHash: v1.packed.sha256 });
      expect(readFileSync(join(root, "versioned-skill", "scripts", "run.ts"), "utf-8")).toBe("console.log('run 1.0.0')\n");
      const marker = JSON.parse(readFileSync(join(root, "versioned-skill", PULL_MARKER_FILE), "utf-8"));
      expect(marker.version).toBe("1.0.0");
      expect(marker.contentHash).toBe(v1.packed.sha256);

      // Without a version the current one is pulled and replaces the exact-version install.
      const latest = await pullSkills({ names: ["versioned-skill"], rootDir: root, client });
      expect(requested).toEqual(["1.0.0", undefined]);
      expect(latest.results[0]).toMatchObject({ success: true, version: "2.0.0", contentHash: v2.packed.sha256 });

      // A version the instance does not have is a clear failure that points at `skills versions`.
      const missing = await pullSkills({ names: ["versioned-skill@9.9.9"], rootDir: root, client });
      expect(missing.results[0].success).toBe(false);
      expect(missing.results[0].error).toContain("9.9.9");
      expect(missing.results[0].error).toContain("skills versions versioned-skill");
      // The earlier install is untouched by the failed pull.
      expect(readFileSync(join(root, "versioned-skill", "scripts", "run.ts"), "utf-8")).toBe("console.log('run 2.0.0')\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(v1.dir, { recursive: true, force: true });
      rmSync(v2.dir, { recursive: true, force: true });
    }
  });
});

describe("pullSkills name@version proofs", () => {
  test("refuses bytes that do not match the registry's recorded digest for that version", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-pull-version-root-"));
    const v1 = makeSource("1.0.0");
    const v2 = makeSource("2.0.0");
    const client: SkillPullClient = {
      async listSkills() { return []; },
      async getSkill() { return { kind: "executable", version: "2.0.0" }; },
      async getSkillMd() { return MD; },
      // The bytes are v2's but the registry says 1.0.0 is v1: a swapped body.
      async getBundle() {
        return new Response(v2.packed.bytes.buffer as ArrayBuffer, { headers: { [BUNDLE_DIGEST_HEADER]: v2.packed.sha256, "X-Skill-Version": "1.0.0" } });
      },
      async getSkillVersion() { return { bundleSha256: v1.packed.sha256 }; },
    };
    try {
      const { results } = await pullSkills({ names: ["versioned-skill@1.0.0"], rootDir: root, client });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("Digest proof failed");
      expect(readdirSync(root)).toEqual([]);
      const bad = await pullSkills({ names: ["versioned-skill@../etc"], rootDir: root, client });
      expect(bad.results[0].success).toBe(false);
      expect(bad.results[0].error).toContain("not a valid skill version");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(v1.dir, { recursive: true, force: true });
      rmSync(v2.dir, { recursive: true, force: true });
    }
  });
});
