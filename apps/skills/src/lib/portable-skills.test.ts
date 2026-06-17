import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

import {
  getPortableSkillsRoot,
  listPortableSkills,
  portPortableSkill,
  readPortableSkillManifest,
  runPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "./portable-skills";

describe("portable skills", () => {
  test("scaffolds a standard skill folder with agent instructions and a runnable command", async () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    try {
      const result = scaffoldPortableSkill("Demo Skill", {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        description: "Demonstrates portable skill scaffolding.",
      });

      expect(result.created).toBe(true);
      expect(result.name).toBe("demo-skill");
      expect(result.path).toBe(join(home, ".hasna", "skills", "demo-skill"));
      expect(existsSync(join(result.path, "SKILL.md"))).toBe(true);
      expect(existsSync(join(result.path, "skill.json"))).toBe(true);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(true);

      const manifest = readPortableSkillManifest(result.path);
      expect(manifest).toMatchObject({
        name: "demo-skill",
        description: "Demonstrates portable skill scaffolding.",
        version: "0.1.0",
        commands: [{ name: "demo-skill", entry: "src/index.ts" }],
      });

      const validation = validatePortableSkillDirectory("demo-skill", result.path);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual([]);
      expect(validation.metadata.portableManifest?.standard).toBe("hasna.skill.v1");

      const run = await runPortableSkill("demo-skill", ["alpha", "beta"], {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        stdio: "pipe",
      });
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('"skill": "demo-skill"');
      expect(run.stdout).toContain('"alpha"');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("ports an existing skill folder into the portable standard", () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "portable-skill-source-"));
    try {
      const source = join(sourceRoot, "legacy-skill");
      mkdirSync(join(source, "src"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: legacy-skill
description: Legacy skill using existing SKILL.md conventions.
version: 1.2.3
tags:
  - legacy
---

# Legacy Skill

Use this skill when porting an existing folder.
`);
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name: "legacy-skill",
        version: "1.2.3",
      }, null, 2));
      writeFileSync(join(source, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('ported legacy skill');\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });

      expect(result.created).toBe(true);
      expect(result.name).toBe("legacy-skill");
      expect(existsSync(join(result.path, "skill.json"))).toBe(true);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(true);
      expect(readFileSync(join(result.path, "SKILL.md"), "utf8")).toContain("Legacy skill");

      const listed = listPortableSkills({ rootDir: getPortableSkillsRoot({ homeDir: home }) });
      expect(listed.map((skill) => skill.name)).toEqual(["legacy-skill"]);
      expect(listed[0]?.version).toBe("1.2.3");

      const validation = validatePortableSkillDirectory("legacy-skill", result.path);
      expect(validation.valid).toBe(true);
      expect(validation.metadata.portableManifest?.commands[0]?.entry).toBe("src/index.ts");
      const pkg = JSON.parse(readFileSync(join(result.path, "package.json"), "utf8"));
      expect(pkg.bin).toEqual({ "legacy-skill": "src/index.ts" });
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
