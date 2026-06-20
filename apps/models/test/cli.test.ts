import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testEnv = () => ({
  ...process.env,
  HASNA_MODELS_HOME: mkdtempSync(join(tmpdir(), "models-cli-")),
  NO_COLOR: "1",
});

test("subcommand --json returns machine-readable action errors", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "info",
    "not-a-namespaced-ref",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: testEnv(),
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");

  const body = JSON.parse(result.stdout) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain("Expected a namespaced repo id");
});

test("numeric CLI options reject trailing junk", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "list",
    "--catalog",
    "--limit",
    "2abc",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: testEnv(),
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Expected a positive integer");
});
