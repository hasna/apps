import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { useDefaultTestTimeout } from "../test-preload.js";
import {
  canonicalizeManifest,
  computeContentHash,
  normalizeLineEndings,
  verifyContentHash,
} from "./skill-hash.js";
import {
  validatePortableManifestContract,
  SEMVER_PATTERN,
  CONTENT_HASH_PATTERN,
  MAX_RUNTIME_TIMEOUT_SECONDS,
} from "./skill-contract.js";import {
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
  SKILL_RUNTIMES,
  SKILL_SANDBOX_MODES,
  SKILL_SYSTEM_DEPS_ALLOWLIST,
  type PortableSkillManifest,
} from "./portable-skills-types.js";
import {
  getPortableSkillsRoot,
  portPortableSkill,
  readPortableSkillManifest,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "./portable-skills.js";

useDefaultTestTimeout();

const CONTENT_HASH_RE = new RegExp(CONTENT_HASH_PATTERN);

function portableManifest(overrides: Partial<PortableSkillManifest> = {}): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: "sample-skill",
    description: "Sample portable skill for contract tests.",
    version: "0.1.0",
    displayName: "Sample Skill",
    category: "Development Tools",
    tags: ["custom", "sample-skill"],
    inputs: [{ name: "args", type: "string[]", required: false }],
    commands: [{ name: "sample-skill", entry: "src/index.ts" }],
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
    provenance: {
      source_commit: "unknown",
      content_hash: "a".repeat(64),
    },
    ...overrides,
  };
}

function makeSkillDir(overrides: Partial<PortableSkillManifest> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-contract-"));
  writeFileSync(join(dir, "SKILL.md"), `---\nname: sample-skill\ndescription: Sample portable skill for contract tests.\n---\n\n# Sample Skill\n`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('hi');\n");
  const manifest = portableManifest(overrides);
  writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

function issueCodes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("hasna.skill.v1 schema artifact", () => {
  test("schema file exists, is valid JSON, and carries the canonical $id", () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), "schemas/skill.schema.json"), "utf8"));
    expect(schema.$id).toBe("https://hasna.dev/schemas/skill.v1.json");
    expect(schema.required).toContain("standard");
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("description");
    expect(schema.required).toContain("version");
    expect(schema.properties.standard.const).toBe(PORTABLE_SKILL_STANDARD);
  });

  test("schema and validator agree on enums and allowlists", () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), "schemas/skill.schema.json"), "utf8"));
    expect(schema.properties.runtime.properties.runtime.enum).toEqual(SKILL_RUNTIMES);
    expect(schema.properties.runtime.properties.sandbox.enum).toEqual(SKILL_SANDBOX_MODES);
    expect(schema.properties.runtime.properties.system_deps.items.enum).toEqual(SKILL_SYSTEM_DEPS_ALLOWLIST);
    expect(schema.properties.runtime.properties.timeout.maximum).toBe(MAX_RUNTIME_TIMEOUT_SECONDS);
  });
});

describe("canonical content hashing", () => {
  test("is stable across runs and line-ending / key-order variants", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-hash-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nBody line 1.\r\nBody line 2.\r\n");
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "setup.sh"), "#!/bin/sh\necho hi\r\n");
      const manifest = portableManifest();
      writeFileSync(join(dir, "skill.json"), JSON.stringify({ ...manifest, zzz: "last" }, null, 2));

      const first = computeContentHash(dir);
      const second = computeContentHash(dir);
      expect(first).toBe(second);
      expect(first).toMatch(CONTENT_HASH_RE);

      // Same logical content, different physical form: CRLF -> LF, key order
      // shuffled, content_hash blanked. The hash must not change.
      writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nBody line 1.\nBody line 2.\n");
      writeFileSync(join(dir, "scripts", "setup.sh"), "#!/bin/sh\necho hi\n");
      writeFileSync(join(dir, "skill.json"), JSON.stringify({ zzz: "last", ...manifest }, null, 2));
      expect(computeContentHash(dir)).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("changes when bundle content changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-hash-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nBody.\n");
      writeFileSync(join(dir, "skill.json"), JSON.stringify(portableManifest(), null, 2));
      const before = computeContentHash(dir);
      writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nBody changed.\n");
      expect(computeContentHash(dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("canonicalizeManifest blanks content_hash and sorts keys", () => {
    const canonical = canonicalizeManifest(JSON.stringify({ b: 2, content_hash: "x".repeat(64), a: 1 }));
    expect(canonical).not.toContain("content_hash");
    expect(canonical.indexOf('"a"')).toBeLessThan(canonical.indexOf('"b"'));
  });

  test("normalizeLineEndings collapses CRLF and CR", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  test("verifyContentHash accepts a matching hash and rejects a stale one", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-hash-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nBody.\n");
      writeFileSync(join(dir, "skill.json"), JSON.stringify(portableManifest(), null, 2));
      const computed = computeContentHash(dir);
      const matching = portableManifest({ provenance: { source_commit: "unknown", content_hash: computed } });
      expect(verifyContentHash(dir, matching).valid).toBe(true);
      const stale = portableManifest({ provenance: { source_commit: "unknown", content_hash: "b".repeat(64) } });
      const verification = verifyContentHash(dir, stale);
      expect(verification.valid).toBe(false);
      expect(verification.computedHash).toBe(computed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("contract validation", () => {
  test("accepts a fully valid manifest", () => {
    const issues = validatePortableManifestContract(portableManifest());
    expect(issues).toEqual([]);
  });

  test("rejects a wrong standard", () => {
    const issues = validatePortableManifestContract(portableManifest({ standard: "hasna.skill.v2" }));
    expect(issueCodes(issues)).toContain("contract.standard_invalid");
  });

  test("rejects invalid names and non-semver versions", () => {
    expect(issueCodes(validatePortableManifestContract(portableManifest({ name: "Bad Name" })))).toContain("contract.name_invalid");
    expect(issueCodes(validatePortableManifestContract(portableManifest({ version: "1.2" })))).toContain("contract.version_invalid");
    expect(issueCodes(validatePortableManifestContract(portableManifest({ version: "v1.2.3" })))).toContain("contract.version_invalid");
    expect(new RegExp(SEMVER_PATTERN).test("1.2.3-rc.1+build.5")).toBe(true);
  });

  test("requires the runtime contract and validates its fields", () => {
    const { runtime: _runtime, ...withoutRuntime } = portableManifest();
    expect(issueCodes(validatePortableManifestContract(withoutRuntime, { strict: true }))).toContain("contract.runtime_missing");
    expect(validatePortableManifestContract(withoutRuntime)).toEqual([]);

    const badRuntime = portableManifest({ runtime: { runtime: "python" as never } });
    expect(issueCodes(validatePortableManifestContract(badRuntime))).toContain("contract.runtime_invalid");

    const badSandbox = portableManifest({ runtime: { ...portableManifest().runtime!, sandbox: "everything" as never } });
    expect(issueCodes(validatePortableManifestContract(badSandbox))).toContain("contract.sandbox_invalid");

    const badTimeout = portableManifest({ runtime: { ...portableManifest().runtime!, timeout: 901 } });
    expect(issueCodes(validatePortableManifestContract(badTimeout))).toContain("contract.timeout_invalid");

    const zeroTimeout = portableManifest({ runtime: { ...portableManifest().runtime!, timeout: 0 } });
    expect(issueCodes(validatePortableManifestContract(zeroTimeout))).toContain("contract.timeout_invalid");

    const badNetwork = portableManifest({ runtime: { ...portableManifest().runtime!, needs_network: "yes" as unknown as boolean } });
    expect(issueCodes(validatePortableManifestContract(badNetwork))).toContain("contract.needs_network_invalid");
  });

  test("env carries reference names only and system_deps is allowlisted", () => {
    const badEnv = portableManifest({ runtime: { ...portableManifest().runtime!, env: ["OPENAI_API_KEY", "lower-case-key"] } });
    expect(issueCodes(validatePortableManifestContract(badEnv))).toContain("contract.env_invalid");

    const badDep = portableManifest({ runtime: { ...portableManifest().runtime!, system_deps: ["ffmpeg", "sudo" as never] } });
    expect(issueCodes(validatePortableManifestContract(badDep))).toContain("contract.system_dep_not_allowed");

    const good = portableManifest({ runtime: { ...portableManifest().runtime!, system_deps: ["ffmpeg", "curl"] } });
    expect(validatePortableManifestContract(good)).toEqual([]);
  });

  test("python3 is an allowed runtime", () => {
    const python = portableManifest({ runtime: { ...portableManifest().runtime!, runtime: "python3", entrypoint: "main.py" } });
    expect(validatePortableManifestContract(python)).toEqual([]);
  });

  test("content_hash is required when required, validated when declared", () => {
    const noHash = portableManifest({ provenance: { source_commit: "unknown" } });
    expect(issueCodes(validatePortableManifestContract(noHash, { strict: true }))).toContain("contract.content_hash_missing");
    expect(validatePortableManifestContract(noHash, { strict: false })).toEqual([]);

    const malformed = portableManifest({ provenance: { source_commit: "unknown", content_hash: "not-a-hash" } });
    expect(issueCodes(validatePortableManifestContract(malformed))).toContain("contract.content_hash_invalid");
  });

  test("content_hash mismatch is detected against the bundle", () => {
    const dir = makeSkillDir();
    try {
      const manifest = readPortableSkillManifest(dir);
      manifest.provenance = { source_commit: "unknown", content_hash: "c".repeat(64) };
      const issues = validatePortableManifestContract(manifest, { strict: true, skillPath: dir });
      expect(issueCodes(issues)).toContain("contract.content_hash_mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("template emission", () => {
  test("skills new/scaffold emits a complete valid skill.json with a matching content_hash", () => {
    const home = mkdtempSync(join(tmpdir(), "skill-tpl-"));
    try {
      const result = scaffoldPortableSkill("contract-skill", {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        description: "Contract template skill.",
      });
      const manifest = readPortableSkillManifest(result.path);
      expect(manifest.standard).toBe(PORTABLE_SKILL_STANDARD);
      expect(manifest.runtime).toMatchObject({ runtime: "bun", timeout: 900, needs_network: false, sandbox: "readonly-fs" });
      expect(manifest.provenance?.content_hash).toMatch(CONTENT_HASH_RE);
      expect(verifyContentHash(result.path, manifest).valid).toBe(true);

      const validation = validatePortableSkillDirectory("contract-skill", result.path);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual([]);

      // Consumer frontmatter stays minimal: name + description only.
      const skillMd = readFileSync(join(result.path, "SKILL.md"), "utf8");
      const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      expect(frontmatter).toContain("name:");
      expect(frontmatter).toContain("description:");
      expect(frontmatter).not.toContain("version:");
      expect(frontmatter).not.toContain("source:");
      expect(frontmatter).not.toContain("category:");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("instruction scaffold emits a complete valid manifest", () => {
    const home = mkdtempSync(join(tmpdir(), "skill-tpl-"));
    try {
      const result = scaffoldPortableSkill("prose-skill", {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        description: "Prose contract template.",
        kind: "instruction",
      });
      const manifest = readPortableSkillManifest(result.path);
      expect(manifest.kind).toBe("instruction");
      expect(manifest.runtime?.runtime).toBe("bun");
      expect(manifest.provenance?.content_hash).toBeTruthy();
      const validation = validatePortableSkillDirectory("prose-skill", result.path);
      expect(validation.valid).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("port fills missing contract fields and refreshes the content_hash", () => {
    const home = mkdtempSync(join(tmpdir(), "skill-tpl-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "skill-port-"));
    try {
      const source = join(sourceRoot, "old-skill");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: old-skill
description: Old skill with thin metadata.
version: 0.3.1
---

# Old Skill

Body.
`);
      const result = portPortableSkill(source, { rootDir: getPortableSkillsRoot({ homeDir: home }) });
      const manifest = readPortableSkillManifest(result.path);
      expect(manifest.version).toBe("0.3.1");
      expect(manifest.runtime).toMatchObject({ runtime: "bun", sandbox: "readonly-fs" });
      expect(manifest.provenance?.content_hash).toMatch(CONTENT_HASH_RE);
      expect(verifyContentHash(result.path, manifest).valid).toBe(true);

      const validation = validatePortableSkillDirectory("old-skill", result.path);
      expect(validation.valid).toBe(true);

      // Editing content invalidates the ported manifest until re-hashed/versioned.
      writeFileSync(join(result.path, "SKILL.md"), "---\nname: old-skill\ndescription: Old skill with thin metadata.\n---\n\nBody edited.\n");
      const staleValidation = validatePortableSkillDirectory("old-skill", result.path);
      expect(staleValidation.valid).toBe(false);
      expect(issueCodes(staleValidation.issues)).toContain("contract.content_hash_mismatch");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  test("SKILL.md-only legacy skills stay valid without a skill.json hash", () => {
    const home = mkdtempSync(join(tmpdir(), "skill-tpl-"));
    try {
      const root = getPortableSkillsRoot({ homeDir: home });
      const skillDir = join(root, "legacy-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: legacy-skill
description: Legacy prose skill with no skill.json.
kind: instruction
---

# Legacy Skill
`);
      const validation = validatePortableSkillDirectory("legacy-skill", skillDir);
      expect(validation.valid).toBe(true);
      expect(existsSync(join(skillDir, "skill.json"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
