/**
 * skill-bundles.test.ts — the signed/versioned bundle envelope shared by the CI bundle
 * script, push, and pull: canonical hashing (deterministic across runs), bundle build +
 * verify round-trips, and HMAC signature round-trips with tamper rejection on both arms.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillBundle,
  signBundleBytes,
  verifyBundleSignature,
  SKILLS_SIGNING_KEY_ENV,
} from "./skill-bundles.js";
import { sha256Hex, unpackSkillBundle } from "./skill-bundle.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const SIGNING_KEY = "test-signing-key-0123456789";

function fixtureSkill(dir: string, name: string): void {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: A fixture skill\nkind: executable\n---\n\n# ${name}\n`);
  writeFileSync(join(dir, "skill.json"), JSON.stringify({ standard: "hasna.skill.v1", name, version: "1.0.0", kind: "executable" }));
  writeFileSync(join(dir, "scripts", "run.ts"), "console.log('run');\n");
  writeFileSync(join(dir, "references", "notes.md"), "# Notes\n");
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("buildSkillBundle — canonical hashing", () => {
  test("identical sources produce identical bundles and hashes (positive control)", () => {
    const a = tempDir("bundle-a-");
    const b = tempDir("bundle-b-");
    try {
      fixtureSkill(a, "demo-skill");
      fixtureSkill(b, "demo-skill");
      const first = buildSkillBundle({ name: "demo-skill", dir: a, version: "1.0.0", sourceCommit: "abc", signingKey: SIGNING_KEY });
      const second = buildSkillBundle({ name: "demo-skill", dir: b, version: "1.0.0", sourceCommit: "abc", signingKey: SIGNING_KEY });
      expect(first.bundle.sha256).toBe(second.bundle.sha256);
      expect(Buffer.from(first.bundle.bytes).toString("hex")).toBe(Buffer.from(second.bundle.bytes).toString("hex"));
      expect(first.manifest.content_hash).toBe(first.bundle.sha256);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("one changed byte changes the hash (negative control)", () => {
    const a = tempDir("bundle-c1-");
    const b = tempDir("bundle-c2-");
    try {
      fixtureSkill(a, "demo-skill");
      fixtureSkill(b, "demo-skill");
      writeFileSync(join(b, "SKILL.md"), "---\nname: demo-skill\ndescription: A fixture skill\nkind: executable\n---\n\n# Demo\n"); // one word changed
      const first = buildSkillBundle({ name: "demo-skill", dir: a, version: "1.0.0", sourceCommit: "abc" });
      const second = buildSkillBundle({ name: "demo-skill", dir: b, version: "1.0.0", sourceCommit: "abc" });
      expect(first.bundle.sha256).not.toBe(second.bundle.sha256);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("content_hash is the canonical sha256 of the bundle bytes", () => {
    const dir = tempDir("bundle-hash-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc" });
      expect(built.manifest.content_hash).toBe(sha256Hex(built.bundle.bytes));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the source commit and version are recorded in the manifest", () => {
    const dir = tempDir("bundle-meta-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "2.3.4", sourceCommit: "deadbeef", publishedAt: "2026-08-14T00:00:00.000Z", signingKey: "" });
      expect(built.manifest).toEqual({
        name: "demo-skill",
        version: "2.3.4",
        source_commit: "deadbeef",
        content_hash: built.bundle.sha256,
        published_at: "2026-08-14T00:00:00.000Z",
      });
      expect(built.manifest.signature).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skill bundle round-trip", () => {
  test("a built bundle unpacks to the original files", () => {
    const dir = tempDir("bundle-roundtrip-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc" });
      const entries = unpackSkillBundle(built.bundle.bytes);
      const byPath = new Map(entries.map((entry) => [entry.path, new TextDecoder().decode(entry.bytes)]));
      expect(byPath.get("SKILL.md")).toContain("name: demo-skill");
      expect(byPath.get("skill.json")).toContain('"version":"1.0.0"');
      expect(byPath.get("scripts/run.ts")).toBe("console.log('run');\n");
      expect(byPath.get("references/notes.md")).toBe("# Notes\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("bundle signatures", () => {
  test("sign then verify round-trips with the same key", () => {
    const dir = tempDir("bundle-sig-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc", signingKey: SIGNING_KEY });
      expect(built.manifest.signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
      expect(verifyBundleSignature(built.bundle.bytes, built.manifest.signature!, SIGNING_KEY)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a tampered bundle fails verification", () => {
    const dir = tempDir("bundle-tamper-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc", signingKey: SIGNING_KEY });
      const tampered = new Uint8Array(built.bundle.bytes);
      tampered[tampered.byteLength - 1] = tampered[tampered.byteLength - 1]! ^ 0xff;
      expect(verifyBundleSignature(tampered, built.manifest.signature!, SIGNING_KEY)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a signature from a different key fails verification", () => {
    const dir = tempDir("bundle-key-");
    try {
      fixtureSkill(dir, "demo-skill");
      const built = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc", signingKey: SIGNING_KEY });
      expect(verifyBundleSignature(built.bundle.bytes, built.manifest.signature!, "another-key")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("malformed signature strings are rejected", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(verifyBundleSignature(bytes, "not-a-signature", SIGNING_KEY)).toBe(false);
    expect(verifyBundleSignature(bytes, "hmac-sha256:xyz", SIGNING_KEY)).toBe(false);
    expect(verifyBundleSignature(bytes, `hmac-sha256:${"ab".repeat(31)}`, SIGNING_KEY)).toBe(false);
    expect(verifyBundleSignature(bytes, signBundleBytes(bytes, SIGNING_KEY), SIGNING_KEY)).toBe(true);
  });

  test("the signing key comes from the environment and is never required", () => {
    const dir = tempDir("bundle-env-");
    const savedKey = process.env[SKILLS_SIGNING_KEY_ENV];
    try {
      fixtureSkill(dir, "demo-skill");
      // Unset: unsigned manifest, no throw.
      delete process.env[SKILLS_SIGNING_KEY_ENV];
      const unsigned = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc" });
      expect(unsigned.manifest.signature).toBeUndefined();
      // Set: signed manifest.
      process.env[SKILLS_SIGNING_KEY_ENV] = SIGNING_KEY;
      const signed = buildSkillBundle({ name: "demo-skill", dir, version: "1.0.0", sourceCommit: "abc" });
      expect(signed.manifest.signature).toBeDefined();
      expect(verifyBundleSignature(signed.bundle.bytes, signed.manifest.signature!, SIGNING_KEY)).toBe(true);
    } finally {
      if (savedKey === undefined) delete process.env[SKILLS_SIGNING_KEY_ENV];
      else process.env[SKILLS_SIGNING_KEY_ENV] = savedKey;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
