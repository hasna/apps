import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];

function runStatus() {
  const env: Record<string, string> = {
    ...fixture.env,
    CONVERSATIONS_AGENT_ID: "status-contract-tester",
    FORCE_COLOR: "0",
  };

  for (const key of Object.keys(env)) {
    if (
      key.startsWith("HASNA_CONVERSATIONS_")
      || key === "CONVERSATIONS_API_URL"
      || key === "CONVERSATIONS_API_KEY"
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


  });

  test("reports the answering connection as the shared API authority without a database path", () => {
    const result = runStatus();
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    // Exact key set: one connection-location field plus the five stats. No
    // other selector field may ride along in the payload.
    expect(Object.keys(payload).sort()).toEqual([
      "api_url",
      "total_channels",
      "total_messages",
      "total_projects",
      "total_sessions",
      "unread_messages",
    ]);
    expect(payload.db_path).toBeUndefined();
    expect(payload.api_url).toBe(fixture.url);
  });
});
