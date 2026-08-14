import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

const cleanupPaths: string[] = [];

function setupStatusDir() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-status-"));
  const testersDir = join(baseDir, ".hasna", "testers");
  cleanupPaths.push(baseDir);
  return { testersDir };
}

afterEach(() => {
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("testers status CLI", () => {
  test("advertises --json in help", () => {
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "status", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("--json");
  });

  test("supports structured --json output", () => {
    const { testersDir } = setupStatusDir();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "status", "--json"],
      env: {
        ...process.env,
        HASNA_TESTERS_DIR: testersDir,
        ANTHROPIC_API_KEY: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.status).toBe("warn");
    expect(output.anthropicApiKey).toEqual({ set: false });
    expect(output.database.path).toBe(join(testersDir, "testers.db"));
    expect(output.defaultModel).toBe("claude-haiku-4-5-20251001");
    expect(output.defaultImageModel).toBe("gpt-image-2");
    expect(output.screenshots.dir).toBe(join(testersDir, "screenshots"));
  });
});
