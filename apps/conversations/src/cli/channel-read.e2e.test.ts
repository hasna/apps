import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...fixture.env,
      CONVERSATIONS_AGENT_ID: "channel-reader",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("channel read CLI", () => {
  afterAll(() => {


  });

  test("distinguishes an empty channel from a missing channel", () => {
    const created = runCli(["channel", "create", "empty-read-channel"]);
    expect(created.exitCode).toBe(0);

    const empty = runCli(["channel", "read", "empty-read-channel", "--limit", "1"]);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout).toContain("No messages in #empty-read-channel.");
    // API clients must not announce a local store.
    expect(empty.stderr).not.toContain("local store");

    const missing = runCli(["channel", "read", "missing-read-channel", "--limit", "1"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("Channel #missing-read-channel not found.");
  });

  test("emits a JSON error for a missing channel with --json", () => {
    const missing = runCli(["channel", "read", "missing-json-channel", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).not.toContain("local store");
    expect(JSON.parse(missing.stdout)).toEqual({
      error: "Channel #missing-json-channel not found.",
    });
  });
});
