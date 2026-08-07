import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "convchanid-cli-"));
const TEST_DB = join(TEST_DIR, "channels.db");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
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
