import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "conversations-channel-identity-"));
const TEST_DB = join(TEST_DIR, "channels.db");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

setDefaultTimeout(60_000);

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: "channel-identity-test",
      FORCE_COLOR: "0",
    }),
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

describe("channel canonical identity repair CLI", () => {
  test("rename plus metadata/tag update reconciles identity without changing channel state", () => {
    const created = runCli(["channel", "create", "platform-sample", "--from", "alice", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);
    const createdChannel = JSON.parse(created.stdout);

    expect(runCli(["channel", "join", "platform-sample", "--from", "bob"]).exitCode).toBe(0);
    expect(runCli([
      "channel",
      "send",
      "platform-sample",
      "identity migration evidence",
      "--from",
      "alice",
      "--json",
    ]).exitCode).toBe(0);
    const archived = runCli(["channel", "archive", "platform-sample", "--json"]);
    expect(archived.exitCode, archived.stderr).toBe(0);
    const archivedAt = JSON.parse(archived.stdout).archived_at as string;
    expect(archivedAt).toBeTruthy();

    const staleMetadata = {
      owner: "coordination",
      channel_schema: {
        class: "product",
        canonical_slug: "platform-sample",
        github: {
          full_name: "hasnastudio/platform-sample",
          owner: "hasnastudio",
          repo: "platform-sample",
        },
        repo_labels: ["platform-sample", "hasnastudio/platform-sample"],
      },
    };
    const staleTags = [
      "platform-sample",
      "hasnastudio",
      "repo:hasnastudio/platform-sample",
      "keep:coordination",
    ];
    const db = new Database(TEST_DB);
    db.prepare("UPDATE channels SET metadata = ?, tags = ? WHERE name = ?").run(
      JSON.stringify(staleMetadata),
      JSON.stringify(staleTags),
      "platform-sample",
    );
    db.close();

    const renamed = runCli(["channel", "rename", "platform-sample", "sample", "--json"]);
    expect(renamed.exitCode, renamed.stderr).toBe(0);
    expect(JSON.parse(renamed.stdout)).toMatchObject({
      id: createdChannel.id,
      name: "sample",
      archived_at: archivedAt,
      metadata: staleMetadata,
      tags: staleTags,
    });

    const currentMetadata = {
      owner: "coordination",
      channel_schema: {
        class: "product",
        canonical_slug: "sample",
        github: {
          full_name: "hasna/sample",
          owner: "hasna",
          repo: "sample",
        },
        repo_labels: ["sample", "hasna/sample"],
      },
    };
    const currentTags = ["sample", "hasna", "repo:hasna/sample", "keep:coordination"];
    const repaired = runCli([
      "channel",
      "update",
      "sample",
      "--description",
      "Current canonical sample channel",
      "--metadata",
      JSON.stringify(currentMetadata),
      "--tags",
      JSON.stringify(currentTags),
      "--json",
    ]);
    expect(repaired.exitCode, repaired.stderr).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({
      id: createdChannel.id,
      name: "sample",
      description: "Current canonical sample channel",
      archived_at: archivedAt,
      metadata: currentMetadata,
      tags: currentTags,
    });

    const human = runCli([
      "channel",
      "update",
      "sample",
      "--topic",
      "Current identity",
      "--metadata",
      JSON.stringify(currentMetadata),
      "--tags",
      JSON.stringify(currentTags),
    ]);
    expect(human.exitCode, human.stderr).toBe(0);
    expect(human.stdout).toContain("Channel #sample updated.");

    const listed = runCli(["channel", "list", "--archived", "--json"]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout)).toContainEqual(expect.objectContaining({
      id: createdChannel.id,
      name: "sample",
      archived_at: archivedAt,
      metadata: currentMetadata,
      tags: currentTags,
      member_count: 2,
      message_count: 1,
    }));

    const members = runCli(["channel", "members", "sample", "--json"]);
    expect(members.exitCode, members.stderr).toBe(0);
    expect(JSON.parse(members.stdout).map((member: { agent: string }) => member.agent).sort())
      .toEqual(["alice", "bob"]);

    const messages = runCli(["channel", "read", "sample", "--json"]);
    expect(messages.exitCode, messages.stderr).toBe(0);
    expect(JSON.parse(messages.stdout)).toEqual([
      expect.objectContaining({
        channel: "sample",
        session_id: "channel:sample",
        to_agent: "sample",
        content: "identity migration evidence",
      }),
    ]);
  });

  test("rejects malformed metadata and tags without mutating the channel", () => {
    const created = runCli(["channel", "create", "identity-guard", "--from", "alice", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);

    const badMetadata = runCli([
      "channel",
      "update",
      "identity-guard",
      "--metadata",
      "[]",
    ]);
    expect(badMetadata.exitCode).toBe(1);
    expect(badMetadata.stderr).toContain("Invalid --metadata JSON. Expected an object or null.");

    const badTags = runCli([
      "channel",
      "update",
      "identity-guard",
      "--tags",
      JSON.stringify(["valid", 7]),
    ]);
    expect(badTags.exitCode).toBe(1);
    expect(badTags.stderr).toContain("Invalid --tags JSON. Expected an array of strings.");

    const listed = runCli(["channel", "list", "--json"]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout)).toContainEqual(expect.objectContaining({
      name: "identity-guard",
      metadata: null,
      tags: [],
    }));
  });
});
