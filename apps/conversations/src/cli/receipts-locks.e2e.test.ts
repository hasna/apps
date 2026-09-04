import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-cli-receipts-locks-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

setDefaultTimeout(30_000);

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: agent,
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

describe("receipts + locks CLI (e2e)", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("receipts shows who has and has not read a channel message", () => {
    const create = runCli(["channel", "create", "receipt-ch", "--from", "alice"], "alice");
    expect(create.exitCode).toBe(0);
    runCli(["channel", "join", "receipt-ch", "--from", "bob"], "bob");
    runCli(["channel", "join", "receipt-ch", "--from", "carol"], "carol");

    const send = runCli(["channel", "send", "receipt-ch", "quorum check message", "--from", "alice", "--json"], "alice");
    expect(send.exitCode).toBe(0);
    const messageId = JSON.parse(send.stdout).id as number;

    // bob reads the channel (records a read receipt); carol does not
    const read = runCli(["channel", "read", "receipt-ch", "--from", "bob"], "bob");
    expect(read.exitCode).toBe(0);

    const receipts = runCli(["receipts", String(messageId), "--channel", "receipt-ch", "--json"], "alice");
    expect(receipts.exitCode).toBe(0);
    const status = JSON.parse(receipts.stdout);
    expect(status.message_id).toBe(messageId);
    expect(status.receipts.map((r: { agent: string }) => r.agent)).toContain("bob");
    expect(status.unread_by).toContain("carol");
    expect(status.unread_by).not.toContain("bob");

    // without --channel: receipts only
    const plain = runCli(["receipts", String(messageId), "--json"], "alice");
    expect(plain.exitCode).toBe(0);
    const parsed = JSON.parse(plain.stdout);
    expect(parsed.count).toBeGreaterThanOrEqual(1);
    expect(parsed.receipts.map((r: { agent: string }) => r.agent)).toContain("bob");

    const other = runCli(["channel", "create", "receipt-other-ch", "--from", "alice"], "alice");
    expect(other.exitCode).toBe(0);
    const wrongChannel = runCli(["receipts", String(messageId), "--channel", "receipt-other-ch", "--json"], "alice");
    expect(wrongChannel.exitCode).toBe(1);
    expect(JSON.parse(wrongChannel.stdout).error).toContain("does not belong");
  });

  test("receipts matches mixed-case channel members against normalized read receipts", () => {
    const create = runCli(["channel", "create", "mixed-receipt-ch", "--from", "Admin"], "Admin");
    expect(create.exitCode).toBe(0);
    runCli(["channel", "join", "mixed-receipt-ch", "--from", "Bob"], "Bob");
    runCli(["channel", "join", "mixed-receipt-ch", "--from", "Carol"], "Carol");

    const send = runCli(["channel", "send", "mixed-receipt-ch", "mixed case quorum", "--from", "Admin", "--json"], "Admin");
    expect(send.exitCode).toBe(0);
    const messageId = JSON.parse(send.stdout).id as number;

    const read = runCli(["channel", "read", "mixed-receipt-ch", "--from", "Bob"], "Bob");
    expect(read.exitCode).toBe(0);

    const receipts = runCli(["receipts", String(messageId), "--channel", "mixed-receipt-ch", "--json"], "Admin");
    expect(receipts.exitCode).toBe(0);
    const status = JSON.parse(receipts.stdout);
    expect(status.receipts.map((r: { agent: string }) => r.agent)).toContain("bob");
    expect(status.unread_by).toContain("Admin");
    expect(status.unread_by).toContain("Carol");
    expect(status.unread_by).not.toContain("Bob");
  });

  test("receipts errors on unknown message or channel", () => {
    const missing = runCli(["receipts", "999999", "--json"], "alice");
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout).error).toContain("not found");

    const badId = runCli(["receipts", "not-a-number"], "alice");
    expect(badId.exitCode).toBe(1);
  });

  test("locks acquire/check/release round-trip with exit-code semantics", () => {
    const key = "lock:comms:machine-comms-digest";

    // free before acquire
    const checkFree = runCli(["locks", "check", key, "--json"], "alice");
    expect(checkFree.exitCode).toBe(0);
    expect(JSON.parse(checkFree.stdout).locked).toBe(false);

    const acquire = runCli(["locks", "acquire", key, "--ttl", "60", "--from", "alice", "--json"], "alice");
    expect(acquire.exitCode).toBe(0);
    const acquired = JSON.parse(acquire.stdout);
    expect(acquired.acquired).toBe(true);
    expect(acquired.lock.resource_id).toBe(key);
    expect(acquired.lock.resource_type).toBe("resource");
    expect(acquired.lock.agent_id).toBe("alice");

    // locked now → check exits 2
    const checkHeld = runCli(["locks", "check", key, "--json"], "bob");
    expect(checkHeld.exitCode).toBe(2);
    expect(JSON.parse(checkHeld.stdout).locked).toBe(true);

    // another agent cannot acquire → exit 2 + conflict info + DM to holder
    const conflict = runCli(["locks", "acquire", key, "--ttl", "60", "--from", "bob", "--json"], "bob");
    expect(conflict.exitCode).toBe(2);
    const conflictResult = JSON.parse(conflict.stdout);
    expect(conflictResult.acquired).toBe(false);
    expect(conflictResult.held_by).toBe("alice");
    // The lock-conflict DM is read via the unread surface — the recipient
    // --to verb was removed (staged behind the messages-app v1 release gate).
    const dm = runCli(["read", "--unread", "--json"], "alice");
    expect(dm.stdout).toContain("Lock conflict");

    const exclusiveConflict = runCli(["locks", "acquire", key, "--exclusive", "--ttl", "60", "--from", "bob", "--json", "--no-dm"], "bob");
    expect(exclusiveConflict.exitCode).toBe(2);
    expect(JSON.parse(exclusiveConflict.stdout).held_by).toBe("alice");

    // same agent refresh succeeds
    const refresh = runCli(["locks", "acquire", key, "--ttl", "120", "--from", "alice", "--json"], "alice");
    expect(refresh.exitCode).toBe(0);
    expect(JSON.parse(refresh.stdout).acquired).toBe(true);

    // list shows it
    const list = runCli(["locks", "list", "--json"], "alice");
    expect(list.exitCode).toBe(0);
    const lockRows = JSON.parse(list.stdout).locks;
    expect(lockRows.some((l: { resource_id: string; agent_id: string }) => l.resource_id === key && l.agent_id === "alice")).toBe(true);

    // release by non-holder is a no-op
    const wrongRelease = runCli(["locks", "release", key, "--from", "bob", "--json"], "bob");
    expect(wrongRelease.exitCode).toBe(0);
    expect(JSON.parse(wrongRelease.stdout).released).toBe(false);

    // holder releases
    const release = runCli(["locks", "release", key, "--from", "alice", "--json"], "alice");
    expect(release.exitCode).toBe(0);
    expect(JSON.parse(release.stdout).released).toBe(true);

    const checkAfter = runCli(["locks", "check", key, "--json"], "bob");
    expect(checkAfter.exitCode).toBe(0);
    expect(JSON.parse(checkAfter.stdout).locked).toBe(false);
  });

  test("locks respect --type namespaces and validate --ttl", () => {
    const acquire = runCli(["locks", "acquire", "shared-key", "--type", "comms", "--from", "alice", "--json"], "alice");
    expect(acquire.exitCode).toBe(0);
    expect(JSON.parse(acquire.stdout).lock.resource_type).toBe("comms");

    // same key under the default type is independent
    const other = runCli(["locks", "acquire", "shared-key", "--from", "bob", "--json"], "bob");
    expect(other.exitCode).toBe(0);

    const badTtl = runCli(["locks", "acquire", "ttl-key", "--ttl", "0", "--from", "alice"], "alice");
    expect(badTtl.exitCode).toBe(1);
    expect(badTtl.stderr).toContain("--ttl");

    runCli(["locks", "release", "shared-key", "--type", "comms", "--from", "alice"], "alice");
    runCli(["locks", "release", "shared-key", "--from", "bob"], "bob");
  });

  test("locks clean reports released counts", () => {
    const clean = runCli(["locks", "clean", "--json"], "alice");
    expect(clean.exitCode).toBe(0);
    const result = JSON.parse(clean.stdout);
    expect(typeof result.total).toBe("number");
    expect(result.total).toBe(result.released_expired + result.released_stale_agent);
  });

  test("channel create/update carry class at metadata.channel_schema.class", () => {
    const create = runCli(["channel", "create", "class-ch", "--class", "loop-lane", "--from", "alice", "--json"], "alice");
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.metadata?.channel_schema?.class).toBe("loop-lane");

    const update = runCli(["channel", "update", "class-ch", "--class", "fleet", "--json"], "alice");
    expect(update.exitCode).toBe(0);
    const updated = JSON.parse(update.stdout);
    expect(updated.metadata?.channel_schema?.class).toBe("fleet");

    // clearing with an empty class removes the field entirely
    const cleared = runCli(["channel", "update", "class-ch", "--class", "", "--json"], "alice");
    expect(cleared.exitCode).toBe(0);
    expect(JSON.parse(cleared.stdout).metadata).toBeNull();
  });
});
