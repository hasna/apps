import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { beforeAll, afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { hermeticHomeEnv } from "../test/hermetic.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "convchanid-cli-"));
const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];

setDefaultTimeout(15_000);

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...hermeticHomeEnv(),
      ...fixture.env,
      CONVERSATIONS_AGENT_ID: "channel-id-test",
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

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("channel stable id CLI JSON", () => {
  test("create, list, and rename expose one unchanged stable id", () => {
    const created = runCli(["channel", "create", "stable-before", "--from", "alice", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);
    const createdChannel = JSON.parse(created.stdout);
    expect(createdChannel.id).toMatch(/^chn_[0-9a-f]{32}$/);
    expect(createdChannel.name).toBe("stable-before");

    const listedBefore = runCli(["channel", "list", "--json"]);
    expect(listedBefore.exitCode, listedBefore.stderr).toBe(0);
    expect(JSON.parse(listedBefore.stdout)).toContainEqual(expect.objectContaining({
      id: createdChannel.id,
      name: "stable-before",
    }));

    const renamed = runCli(["channel", "rename", "stable-before", "stable-after", "--json"]);
    expect(renamed.exitCode, renamed.stderr).toBe(0);
    expect(JSON.parse(renamed.stdout)).toMatchObject({
      id: createdChannel.id,
      name: "stable-after",
    });

    const listedAfter = runCli(["channel", "list", "--json"]);
    expect(listedAfter.exitCode, listedAfter.stderr).toBe(0);
    expect(JSON.parse(listedAfter.stdout)).toContainEqual(expect.objectContaining({
      id: createdChannel.id,
      name: "stable-after",
    }));
  });
});
