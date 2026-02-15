import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers, isChannelMember } from "./channels";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-ch-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("createChannel", () => {
  test("creates channel and returns it", () => {
    const ch = createChannel("general", "alice", "General chat");
    expect(ch.name).toBe("general");
    expect(ch.description).toBe("General chat");
    expect(ch.created_by).toBe("alice");
    expect(ch.created_at).toBeTruthy();
  });

  test("auto-joins creator", () => {
    createChannel("general", "alice");
    expect(isChannelMember("general", "alice")).toBe(true);
  });

  test("creates without description", () => {
    const ch = createChannel("test", "alice");
    expect(ch.description).toBeNull();
  });

  test("throws on duplicate name", () => {
    createChannel("general", "alice");
    expect(() => createChannel("general", "bob")).toThrow();
  });
});

describe("listChannels", () => {
  test("returns empty when no channels", () => {
    expect(listChannels()).toEqual([]);
  });

  test("returns channels with counts", () => {
    createChannel("general", "alice", "General");
    joinChannel("general", "bob");
    sendMessage({ from: "alice", to: "general", content: "hi", channel: "general" });

    const channels = listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("general");
    expect(channels[0].member_count).toBe(2);
    expect(channels[0].message_count).toBe(1);
  });

  test("orders alphabetically", () => {
    createChannel("beta", "alice");
    createChannel("alpha", "alice");
    const channels = listChannels();
    expect(channels[0].name).toBe("alpha");
    expect(channels[1].name).toBe("beta");
  });
});

describe("getChannel", () => {
  test("returns null for nonexistent channel", () => {
    expect(getChannel("nonexistent")).toBeNull();
  });

  test("returns channel info", () => {
    createChannel("general", "alice", "General chat");
    const ch = getChannel("general");
    expect(ch).toBeTruthy();
    expect(ch!.name).toBe("general");
    expect(ch!.description).toBe("General chat");
    expect(ch!.member_count).toBe(1);
  });
});

describe("joinChannel", () => {
  test("joins existing channel", () => {
    createChannel("general", "alice");
    const ok = joinChannel("general", "bob");
    expect(ok).toBe(true);
    expect(isChannelMember("general", "bob")).toBe(true);
  });

  test("returns false for nonexistent channel", () => {
    expect(joinChannel("nonexistent", "bob")).toBe(false);
  });

  test("is idempotent (no error on double join)", () => {
    createChannel("general", "alice");
    joinChannel("general", "bob");
    joinChannel("general", "bob"); // Should not throw
    expect(getChannelMembers("general")).toHaveLength(2);
  });
});

describe("leaveChannel", () => {
  test("leaves channel", () => {
    createChannel("general", "alice");
    joinChannel("general", "bob");
    const ok = leaveChannel("general", "bob");
    expect(ok).toBe(true);
    expect(isChannelMember("general", "bob")).toBe(false);
  });

  test("returns false if not a member", () => {
    createChannel("general", "alice");
    expect(leaveChannel("general", "bob")).toBe(false);
  });
});

describe("getChannelMembers", () => {
  test("returns empty for no members", () => {
    // No channel exists, so no members
    expect(getChannelMembers("nonexistent")).toEqual([]);
  });

  test("returns members in join order", () => {
    createChannel("general", "alice");
    joinChannel("general", "bob");
    joinChannel("general", "charlie");
    const members = getChannelMembers("general");
    expect(members).toHaveLength(3);
    expect(members[0].agent).toBe("alice");
    expect(members[1].agent).toBe("bob");
  });
});

describe("isChannelMember", () => {
  test("returns true for member", () => {
    createChannel("general", "alice");
    expect(isChannelMember("general", "alice")).toBe(true);
  });

  test("returns false for non-member", () => {
    createChannel("general", "alice");
    expect(isChannelMember("general", "bob")).toBe(false);
  });
});
