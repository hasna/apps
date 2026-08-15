import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  test("reloads OpenCode capability variants across CLI processes and explains plan and apply selection", () => {
    const root = makeTempRoot("instructions-profile-opencode-");
    try {
      const rulePath = join(root, "exact-once.md");
      const targetHome = join(root, "opencode-home");
      writeFileSync(rulePath, "OPEN_CODE_CLI_EXACT_ONCE\n");

      expect(runCli(["add", rulePath, "--name", "Exact Once", "--category", "rules", "--agent", "global"], root).status).toBe(0);
      expect(runCli(["profile", "create", "opencode-profile"], root).status).toBe(0);
      expect(runCli(["profile", "add", "opencode-profile", "exact-once"], root).status).toBe(0);

      const stable = runCli([
        "session", "plan", "--tool", "opencode", "--profile", "account001",
        "--compile-profile", "opencode-profile", "--provider-version", "1.18.18",
        "--target-home", targetHome, "--json",
      ], root);
      expect(stable.status).toBe(0);
      const stablePlan = JSON.parse(stable.stdout) as {
        instructionGraph: { capability: { provider_variant: string; loading_path: string }; source_hash: string };
        files: Array<{ relativePath: string }>;
      };
      expect(stablePlan.instructionGraph.capability).toEqual(expect.objectContaining({
        provider_variant: "v1-instructions",
        loading_path: "opencode.json instructions",
      }));
      expect(stablePlan.files.some((file) => file.relativePath === "AGENTS.md")).toBe(false);

      const next = runCli([
        "session", "plan", "--tool", "opencode", "--profile", "account001",
        "--compile-profile", "opencode-profile", "--provider-version", "v0.0.0-next-17403",
        "--provider-variant", "v2-agents", "--target-home", targetHome, "--json",
      ], root);
      expect(next.status).toBe(0);
      const nextPlan = JSON.parse(next.stdout) as typeof stablePlan;
      expect(nextPlan.instructionGraph.capability).toEqual(expect.objectContaining({
        provider_variant: "v2-agents",
        loading_path: "AGENTS.md",
      }));
      expect(nextPlan.files.some((file) => file.relativePath === "AGENTS.md")).toBe(true);
      expect(nextPlan.instructionGraph.source_hash).not.toBe(stablePlan.instructionGraph.source_hash);

      const explained = runCli([
        "session", "apply", "--tool", "opencode", "--profile", "account001",
        "--compile-profile", "opencode-profile", "--provider-version", "0.0.0",
        "--provider-variant", "v2-agents", "--target-home", targetHome, "--dry-run",
      ], root);
      expect(explained.status).toBe(0);
      expect(explained.stdout).toContain("capability: hasna.instructions.provider-capability/v1 descriptor=1");
      expect(explained.stdout).toContain("variant=v2-agents range=*");
      expect(explained.stdout).toContain("loading path: AGENTS.md (flattened)");

      const invalidHome = join(root, "invalid-home");
      const invalid = runCli([
        "session", "apply", "--tool", "opencode", "--profile", "account001",
        "--compile-profile", "opencode-profile", "--provider-version", "1.18.18",
        "--provider-variant", "unknown", "--target-home", invalidHome,
      ], root);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("PROVIDER_VARIANT_UNSUPPORTED");
      expect(existsSync(invalidHome)).toBe(false);

      const invalidVersionHome = join(root, "invalid-version-home");
      const invalidVersion = runCli([
        "session", "apply", "--tool", "opencode", "--profile", "account001",
        "--compile-profile", "opencode-profile", "--provider-version", "not-a-version",
        "--provider-variant", "v2-agents", "--target-home", invalidVersionHome,
      ], root);
      expect(invalidVersion.status).toBe(1);
      expect(invalidVersion.stderr).toContain("Invalid provider version: not-a-version");
      expect(existsSync(invalidVersionHome)).toBe(false);

      const ignoredVariant = runCli([
        "session", "plan", "--tool", "opencode", "--profile", "account001",
        "--source", `global:exact-once=${rulePath}`,
        "--provider-variant", "v2-agents", "--target-home", invalidHome,
      ], root);
      expect(ignoredVariant.status).toBe(1);
      expect(ignoredVariant.stderr).toContain("--provider-variant requires --compile-profile");
      expect(existsSync(invalidHome)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
