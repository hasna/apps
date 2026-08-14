import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

const cleanupPaths: string[] = [];

function createCliEnv() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-env-validate-models-"));
  cleanupPaths.push(baseDir);

  return {
    PATH: process.env.PATH ?? "",
    HOME: baseDir,
    TESTERS_DIR: join(baseDir, "testers"),
  };
}

afterEach(() => {
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("testers env validate-models CLI", () => {
  test("reports missing default model credentials as JSON", () => {
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "env", "validate-models", "--json"],
      env: createCliEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(1);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.ok).toBe(false);
    expect(output.total).toBe(1);
    expect(output.items[0]).toMatchObject({
      provider: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
      reference: "$ANTHROPIC_API_KEY",
      ok: false,
    });
  });

  test("reports every supported provider without live validation when keys are missing", () => {
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "env",
        "validate-models",
        "--all-providers",
        "--json",
      ],
      env: createCliEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(1);
    const text = proc.stdout.toString();
    const output = JSON.parse(text);
    expect(output.total).toBe(5);
    expect(output.items.map((item: { provider: string }) => item.provider).sort()).toEqual([
      "anthropic",
      "cerebras",
      "google",
      "openai",
      "zai",
    ]);
  });
});
