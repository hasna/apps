import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function cli(root: string, args: string[]) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: packageRoot, encoding: "utf8",
    env: {
      ...process.env,
      HOME: root, CONFIGS_HOME: root, HASNA_STATE_HOME: root,
      HASNA_CONFIGS_HOME: join(root, "render-state"), HASNA_INSTRUCTIONS_DB_PATH: join(root, "fixture.db"),
      HASNA_INSTRUCTIONS_LOCAL: "1", HASNA_INSTRUCTIONS_API_URL: "", HASNA_INSTRUCTIONS_API_KEY: "",
      INSTRUCTIONS_API_URL: "", INSTRUCTIONS_API_KEY: "", HASNA_INSTRUCTIONS_API_KEY_OVERRIDE: "",
      HASNA_INSTRUCTIONS_API_KEY_REF: "", HASNA_PROFILE: "", NO_COLOR: "1", FORCE_COLOR: "0",
    },
  });
}

describe("Sumi public CLI", () => {
  test("stores a Sumi rule, compiles a provider-scoped profile, and applies the consumed file", () => {
    const root = makeTempRoot("instructions-sumi-cli-");
    try {
      const rulePath = join(root, "sumi-rule.md");
      const bindingPath = join(root, "binding.json");
      const targetHome = join(root, "resolved-config");
      writeFileSync(rulePath, "SUMI_CLI_RULE_SENTINEL\n");
      writeFileSync(bindingPath, JSON.stringify({
        schema: "hasna.instructions.profile-config-binding/v1", activation: { mode: "always" },
        required: true, fallback: "fail", providers: [{ provider: "sumi", version_range: ">=0.2.22 <0.3.0" }],
      }));
      for (const args of [
        ["add", rulePath, "--name", "Sumi Rule", "--category", "rules", "--agent", "sumi"],
        ["profile", "create", "sumi-profile"],
        ["profile", "add", "sumi-profile", "sumi-rule"],
        ["profile", "binding", "sumi-profile", "sumi-rule", "--input", bindingPath, "--json"],
      ]) {
        const result = cli(root, args);
        expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
      }
      const options = ["--tool", "sumi", "--profile", "knowledge-work", "--compile-profile", "sumi-profile", "--provider-version", "0.2.22", "--no-station-profile", "--json"];
      const missingTarget = cli(root, ["session", "plan", ...options]);
      expect(missingTarget.status).toBe(1);
      expect(JSON.parse(missingTarget.stdout).blocked).toBe(true);
      const planned = cli(root, ["session", "plan", ...options, "--target-home", targetHome]);
      expect(planned.status).toBe(0);
      const plan = JSON.parse(planned.stdout);
      expect(plan.env).toEqual({ SUMI_CONFIG_DIR: targetHome });
      expect(plan.instructionGraph.capability).toMatchObject({ selected_representation: "flattened", loading_path: "AGENTS.md" });
      expect(plan.files.map((file: { relativePath: string }) => file.relativePath)).toEqual(["AGENTS.md"]);
      expect(planned.stdout).not.toContain("SUMI_CLI_RULE_SENTINEL");
      expect(existsSync(join(targetHome, "AGENTS.md"))).toBe(false);
      const applied = cli(root, ["session", "apply", ...options, "--target-home", targetHome]);
      expect(applied.status).toBe(0);
      expect(JSON.parse(applied.stdout).applied).toBe(true);
      expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("SUMI_CLI_RULE_SENTINEL");
      expect(existsSync(join(targetHome, "opencode.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
