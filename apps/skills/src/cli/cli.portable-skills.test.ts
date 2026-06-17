import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

import { runCliInCwd } from "./cli.test-utils";

describe("CLI portable skills", () => {
  test("new, list, show, validate, and run work against ~/.hasna/skills", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    try {
      const env = { HOME: home };
      const created = await runCliInCwd([
        "new",
        "my-skill",
        "--description",
        "My portable skill for CLI tests.",
        "--json",
      ], cwd, env);
      expect(created.exitCode).toBe(0);
      expect(created.stderr).toBe("");
      const createdData = JSON.parse(created.stdout);
      expect(createdData).toMatchObject({
        name: "my-skill",
        created: true,
      });
      expect(createdData.path).toBe(join(home, ".hasna", "skills", "my-skill"));
      expect(existsSync(join(createdData.path, "AGENTS.md"))).toBe(true);

      const listed = await runCliInCwd(["list", "--json"], cwd, env);
      expect(listed.exitCode).toBe(0);
      const listData = JSON.parse(listed.stdout);
      const localSkill = listData.find((skill: any) => skill.name === "my-skill");
      expect(localSkill).toMatchObject({
        name: "my-skill",
        source: "custom",
        description: "My portable skill for CLI tests.",
      });

      const shown = await runCliInCwd(["show", "my-skill", "--json"], cwd, env);
      expect(shown.exitCode).toBe(0);
      const shownData = JSON.parse(shown.stdout);
      expect(shownData).toMatchObject({
        name: "my-skill",
        source: "custom",
        cliCommand: "skills run my-skill",
      });

      const validation = await runCliInCwd(["validate", "my-skill", "--json"], cwd, env);
      expect(validation.exitCode).toBe(0);
      const validationData = JSON.parse(validation.stdout);
      expect(validationData.valid).toBe(true);
      expect(validationData.metadata.portableManifest.commands[0]).toMatchObject({
        name: "my-skill",
        entry: "src/index.ts",
      });

      const run = await runCliInCwd(["run", "--json", "my-skill", "hello"], cwd, env);
      expect(run.exitCode).toBe(0);
      const runData = JSON.parse(run.stdout);
      expect(runData).toMatchObject({
        skill: "my-skill",
        args: ["hello"],
        exitCode: 0,
      });
      expect(runData.stdout).toContain('"hello"');
      expect(runData.run.paths.exportDir).toContain(".skills/exports/my-skill/");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("scaffold alias and add/port normalize existing folders", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "cli-portable-source-"));
    try {
      const env = { HOME: home };
      const scaffolded = await runCliInCwd(["scaffold", "alias-skill", "--json"], cwd, env);
      expect(scaffolded.exitCode).toBe(0);
      expect(JSON.parse(scaffolded.stdout).name).toBe("alias-skill");

      const source = join(sourceRoot, "source-skill");
      mkdirSync(join(source, "src"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: source-skill
description: Existing source skill ready to port.
version: 0.2.0
---

# Source Skill
`);
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name: "source-skill",
        version: "0.2.0",
        bin: { "source-skill": "src/index.ts" },
      }, null, 2));
      writeFileSync(join(source, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('from source skill');\n");

      const added = await runCliInCwd(["add", source, "--json"], cwd, env);
      expect(added.exitCode).toBe(0);
      const addedData = JSON.parse(added.stdout);
      expect(addedData).toMatchObject({ name: "source-skill", created: true });
      expect(existsSync(join(addedData.path, "skill.json"))).toBe(true);
      expect(existsSync(join(addedData.path, "AGENTS.md"))).toBe(true);

      const portedAgain = await runCliInCwd(["port", source, "--json", "--overwrite"], cwd, env);
      expect(portedAgain.exitCode).toBe(0);
      expect(JSON.parse(portedAgain.stdout)).toMatchObject({ name: "source-skill", created: true });
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
