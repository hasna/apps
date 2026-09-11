import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { hermeticHomeEnv } from "../test/hermetic.js";

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];

function runCli(args: string[], apiMode = false) {
  const env: Record<string, string> = {
    ...hermeticHomeEnv(),
    ...fixture.env,
    CONVERSATIONS_AGENT_ID: "cli-exit-tester",
    FORCE_COLOR: "0",
  };

  if (apiMode) {
    env.HASNA_CONVERSATIONS_API_URL = "http://127.0.0.1:9";
    env.HASNA_CONVERSATIONS_API_KEY = crypto.randomUUID();
  } else {
    delete env.HASNA_CONVERSATIONS_API_URL;
    delete env.HASNA_CONVERSATIONS_API_KEY;
  }

  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
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

function expectUnknownTopLevelCommand(args: string[], apiMode = false) {
  const result = runCli(args, apiMode);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unknown command 'heartbeat'");
  expect(result.stderr).not.toContain("interactive TUI");
  expect(result.stdout).not.toContain("Usage: conversations");
}

describe("top-level command routing", () => {
  afterAll(() => {


  });

  test("an unknown command is rejected instead of invoking the API-mode TUI fallback", () => {
    expectUnknownTopLevelCommand(["heartbeat"], true);
  });

  test("an unknown command with options is rejected as an unknown command", () => {
    expectUnknownTopLevelCommand(["heartbeat", "--from", "cli-exit-tester"], true);
  });

  test("help on an unknown command fails instead of returning unrelated root help", () => {
    expectUnknownTopLevelCommand(["heartbeat", "--help"]);
  });

  test("the supported nested heartbeat command remains available", () => {
    const result = runCli([
      "agents",
      "heartbeat",
      "--from",
      "cli-exit-tester",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      agent: "cli-exit-tester",
      status: "online",
      heartbeat: true,
    });
    // API clients must not announce a local store.
    expect(result.stderr).not.toContain("local store");
  });
});
