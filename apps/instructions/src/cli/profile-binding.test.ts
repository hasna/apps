import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], root: string) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      CONFIGS_HOME: root,
      HASNA_CONFIGS_HOME: join(root, ".hasna", "configs"),
      HASNA_INSTRUCTIONS_DB_PATH: join(root, "instructions.db"),
      HASNA_INSTRUCTIONS_API_URL: "",
      HASNA_INSTRUCTIONS_API_KEY: "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

describe("profile instruction binding CLI", () => {
  test("persists a binding and compiles the profile into a provider render plan", () => {
    const root = makeTempRoot("instructions-profile-binding-");
    try {
      const rulePath = join(root, "typescript-rule.md");
      const bindingPath = join(root, "binding.json");
      const projectRoot = join(root, "project");
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(rulePath, "# TypeScript rule\n");
      writeFileSync(bindingPath, JSON.stringify({
        schema: "hasna.instructions.profile-config-binding/v1",
        activation: { mode: "glob", globs: ["**/*.ts"], description: "TypeScript only" },
        required: true,
        fallback: "fail",
        providers: [{ provider: "cursor", version_range: ">=1.0.0" }],
      }));

      expect(runCli(["add", rulePath, "--name", "TypeScript Rule", "--category", "rules", "--agent", "global"], root).status).toBe(0);
      expect(runCli(["profile", "create", "compiled-profile"], root).status).toBe(0);
      expect(runCli(["profile", "add", "compiled-profile", "typescript-rule"], root).status).toBe(0);
      const saved = runCli(["profile", "binding", "compiled-profile", "typescript-rule", "--input", bindingPath, "--json"], root);
      expect(saved.status).toBe(0);
      expect(JSON.parse(saved.stdout).binding.activation).toEqual({ mode: "glob", globs: ["**/*.ts"], description: "TypeScript only" });

      const planned = runCli([
        "session", "plan", "--tool", "cursor", "--profile", "account001",
        "--compile-profile", "compiled-profile", "--provider-version", "1.2.3",
        "--project-root", projectRoot, "--json",
      ], root);
      expect(planned.status).toBe(0);
      const plan = JSON.parse(planned.stdout) as {
        instructionGraph: { units: Array<{ config_slug: string }>; artifacts: Array<{ representation: string }> };
        manifest: { sources: Array<{ globs?: string[]; metadata?: { activation?: { mode?: string } } }> };
      };
      expect(plan.instructionGraph.units.map((unit) => unit.config_slug)).toEqual(["typescript-rule"]);
      expect(plan.instructionGraph.artifacts[0]?.representation).toBe("conditional-rule");
      expect(plan.manifest.sources[0]?.metadata?.activation?.mode).toBe("glob");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
