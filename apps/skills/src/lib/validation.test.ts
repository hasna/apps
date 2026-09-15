import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSkillFrontmatter, validateSkillDirectory } from "./skill-validation";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// Structural validation uses synthetic instruction, executable and hosted fixtures.
// The former bundled-corpus assertions are replaced by private-corpus and packlist gates.
describe("skill validation helpers", () => {
  test("parses inline and block-list SKILL.md frontmatter", () => {
    const parsed = parseSkillFrontmatter(`---
name: demo
description: Demo skill
display_name: Demo Skill
category: Development Tools
tags:
  - demo
  - testing
---

# Demo
`);

    expect(parsed).toEqual({
      name: "demo",
      description: "Demo skill",
      displayName: "Demo Skill",
      category: "Development Tools",
      tags: ["demo", "testing"],
    });
  });

  test("reports invalid fixture package and frontmatter issues", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: wrong-name
description: Demo skill
---

# Demo
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: "demo", version: "0.1.0" }));

      const result = validateSkillDirectory("demo", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("skill.frontmatter_name_mismatch");
      expect(result.issues.map((issue) => issue.code)).toContain("package.bin_missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reports malformed package.json in invalid fixture", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "README.md"), "# Demo\n");
      writeFileSync(join(skillDir, "package.json"), "{ invalid json }");

      const result = validateSkillDirectory("demo", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("package.invalid_json");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts a hardened valid fixture with explicit provenance", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Demo skill with complete metadata.
source: official
tags:
  - demo
  - testing
---

# Demo Skill
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "demo-skill",
        version: "0.1.0",
        bin: { "demo-skill": "src/index.ts" },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('demo skill validation fixture');\n");

      const result = validateSkillDirectory("demo-skill", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.metadata.runtime).toBe("local");
      expect(result.metadata.packageName).toBe("demo-skill");
      expect(result.metadata.binCommands).toEqual(["demo-skill"]);
      expect(result.metadata.skillMdFrontmatter?.source).toBe("official");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reports package, provenance, file-structure, and unsafe path issues deterministically", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Demo skill with invalid provenance.
source: untrusted-mirror
---

# Demo Skill
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "wrong-package",
        version: "0.1.0",
        bin: {
          "../escape": "src/index.ts",
          "demo skill": "src/index.ts",
          "demo-skill": "../outside.ts",
        },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('demo skill validation fixture');\n");
      writeFileSync(join(skillDir, ".env"), "SECRET=value\n");

      const result = validateSkillDirectory("demo-skill", skillDir);
      const codes = result.issues.map((issue) => issue.code);
      expect(result.valid).toBe(false);
      expect(codes).toEqual([...codes].sort());
      expect(codes).toEqual([
        "package.bin_command_invalid",
        "package.bin_command_invalid",
        "package.bin_target_unsafe",
        "package.name_mismatch",
        "skill.frontmatter_source_invalid",
        "skill.reserved_file",
      ]);
      expect(result.issues.map((issue) => issue.message)).toContain("package.json name 'wrong-package' does not match 'demo-skill'");
      expect(result.issues.map((issue) => issue.message)).toContain("package.json bin 'demo-skill' target '../outside.ts' must stay inside the skill directory");
      expect(result.issues.map((issue) => issue.message)).toContain("Reserved file '.env' is not allowed in skill packages");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts a hosted metadata fixture without local source or bin", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "hosted-demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: hosted-demo
description: Hosted metadata-only skill fixture.
source: private-hosted
tags:
  - premium
  - remote
---

# Hosted Demo
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "hosted-demo",
        version: "0.1.0",
        private: true,
        type: "module",
        skills: {
          runtime: "hosted",
          source: "remote",
        },
      }, null, 2));

      const result = validateSkillDirectory("hosted-demo", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.metadata.runtime).toBe("hosted");
      expect(result.metadata.binCommands).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("parses kind: instruction from SKILL.md frontmatter", () => {
    const parsed = parseSkillFrontmatter(`---
name: skill-project
description: Open or resume an existing Hasna repo project using the projects CLI.
kind: instruction
version: 0.1.0
source: private
---

# Skill Project
`);
    expect(parsed?.kind).toBe("instruction");
    expect(parsed?.name).toBe("skill-project");
  });

  test("accepts an instruction skill with only SKILL.md", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "skill-project");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: skill-project
description: Open or resume an existing Hasna repo project using the projects CLI.
kind: instruction
source: private
---

# Skill Project

Prose-only instruction skill for coding agents.
`);

      const result = validateSkillDirectory("skill-project", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.metadata.kind).toBe("instruction");
      expect(result.metadata.runtime).toBe("none");
      expect(result.metadata.binCommands).toEqual([]);
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).not.toContain("package.missing");
      expect(codes).not.toContain("package.bin_missing");
      expect(codes).not.toContain("skill.src_missing");
      expect(codes).not.toContain("skill.src_index_missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("allows an instruction skill to bundle helper scripts (bin + src not forbidden)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "feedback-pull");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: feedback-pull
description: Instruction skill that also bundles a real helper script.
kind: instruction
source: private
---

# Feedback Pull
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "feedback-pull",
        version: "0.1.0",
        bin: { "feedback-pull": "src/index.ts" },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('helper script bundled with an instruction skill');\n");

      const result = validateSkillDirectory("feedback-pull", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.metadata.kind).toBe("instruction");
      expect(result.metadata.binCommands).toEqual(["feedback-pull"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects an unknown kind value", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Skill with an unknown kind value.
kind: bogus
---

# Demo Skill
`);

      const result = validateSkillDirectory("demo-skill", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("skill.kind_invalid");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("executable skills (no kind) still require bin and src", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Executable skill missing bin and src.
---

# Demo Skill
`);

      const result = validateSkillDirectory("demo-skill", skillDir);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain("package.missing");
      expect(codes).toContain("skill.src_missing");
      expect(result.metadata.kind).toBe("executable");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts source: extension provenance", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "ext-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: ext-skill
description: Instruction skill sourced from a private extension.
kind: instruction
source: extension
---

# Ext Skill
`);

      const result = validateSkillDirectory("ext-skill", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues.map((issue) => issue.code)).not.toContain("skill.frontmatter_source_invalid");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects local source and bin declarations for hosted metadata fixtures", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "hosted-demo");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: hosted-demo
description: Hosted metadata-only skill fixture.
source: private-hosted
---

# Hosted Demo
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "hosted-demo",
        version: "0.1.0",
        private: true,
        type: "module",
        bin: { "hosted-demo": "src/index.ts" },
        skills: {
          runtime: "hosted",
          source: "remote",
        },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('hosted source leak');\n");

      const result = validateSkillDirectory("hosted-demo", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "package.hosted_bin_forbidden",
        "skill.hosted_source_forbidden",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
