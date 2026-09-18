import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
test("CLI discovery works without authority credentials and rejects ambiguous repeated overrides", () => {
  const home = makeTempRoot("instructions-discover-cli-");
  try {
    const bin = join(home, "bin"); mkdirSync(bin);
    writeFileSync(join(bin, "sumi"), "#!/bin/sh\nexit 77\n", { mode: 0o700 });
    const env = { HOME: home, PATH: bin, NO_COLOR: "1" };
    const args = ["src/cli/index.tsx", "harness", "discover", "--config-dir", "sumi=~/actual-config", "--project-root", "~/repo", "--json"];
    const result = spawnSync(process.execPath, args, { cwd: packageRoot, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.schema).toBe("hasna.instructions.harness-discovery/v1");
    expect(receipt.tools[3]).toMatchObject({ status: "executable-found", config: { path: join(home, "actual-config") }, projectPrompt: { path: join(home, "repo/AGENTS.md") } });
    expect(existsSync(join(home, ".hasna"))).toBe(false);
    expect(existsSync(join(home, "actual-config"))).toBe(false);
    const invalid = spawnSync(process.execPath, [...args, "--config-dir", "sumi=~/second"], { cwd: packageRoot, env, encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Duplicate configDir");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
