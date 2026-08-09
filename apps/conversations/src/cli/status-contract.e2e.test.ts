import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-status-contract-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runStatus() {
  const env: Record<string, string> = {
    ...process.env,
    CONVERSATIONS_DB_PATH: TEST_DB,
    CONVERSATIONS_AGENT_ID: "status-contract-tester",
    FORCE_COLOR: "0",
  };

  for (const key of Object.keys(env)) {
    if (
      key.startsWith("HASNA_CONVERSATIONS_")
      || key === "CONVERSATIONS_API_URL"
      || key === "CONVERSATIONS_API_KEY"
      || key === "CONVERSATIONS_MODE"
      || key === "CONVERSATIONS_STORAGE_MODE"
    ) {
      delete env[key];
    }
  }

  const result = Bun.spawnSync({
    cmd: [...CLI, "status", "--json"],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("status JSON contract", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("reports the answering connection without deployment-mode keys or values", () => {
    const result = runStatus();
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("mode");
    expect(Object.keys(payload)).not.toContain("deploymentMode");
    expect(Object.keys(payload)).not.toContain("deploymentModes");
    expect(JSON.stringify(payload)).not.toMatch(/"(?:self_hosted|remote|hybrid)"/);
    expect(payload.db_path).toBe(TEST_DB);
    expect(payload.api_url).toBeUndefined();
  });
});
