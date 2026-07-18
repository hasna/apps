import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createChannel, updateChannel, renameChannel, archiveChannel, unarchiveChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers, isChannelMember } from "./channels";
import { createProject } from "./projects";
import { sendMessage, readMessages, getThreadReplies } from "./messages";
import { closeDb, getDb } from "./db";
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
  delete process.env.CONVERSATIONS_DB_PATH;
});

describe("createChannel", () => {
  test("creates a flat channel and returns it", () => {
    const channel = createChannel("general", "alice", { description: "General chat", topic: "Coordination" });
    expect(channel.name).toBe("general");
    expect(channel.description).toBe("General chat");
    expect(channel.topic).toBe("Coordination");
    expect(channel.created_by).toBe("alice");
    expect(channel.project_id).toBeNull();
    expect(channel.created_at).toBeTruthy();
    expect(channel.metadata).toBeNull();
    expect(channel.tags).toEqual([]);
  });

  test("normalizes names to Slack-like channel identifiers", () => {
    const channel = createChannel("#Platform MCPs!", "alice");
    expect(channel.name).toBe("platform-mcps");
    expect(getChannel("#platform-mcps")?.name).toBe("platform-mcps");
  });

  test("auto-joins creator", () => {
    createChannel("general", "alice");
    expect(isChannelMember("general", "alice")).toBe(true);
  });

  test("creates without description", () => {
    const channel = createChannel("test", "alice");
    expect(channel.description).toBeNull();
  });

  test("throws on duplicate normalized name", () => {
    createChannel("#General", "alice");
    expect(() => createChannel("general", "bob")).toThrow();
  });

  test("creates channel with project_id", () => {
    const project = createProject({ name: "myproject", created_by: "alice" });
    const channel = createChannel("dev", "alice", { project_id: project.id });
    expect(channel.project_id).toBe(project.id);
  });

  test("throws if project does not exist", () => {
    expect(() => createChannel("dev", "alice", { project_id: "nonexistent" })).toThrow("Project not found");
  });

  test("stores metadata and tags", () => {
    const channel = createChannel("ops", "alice", {
      metadata: { import_source: { type: "test" } },
      tags: ["imported", "team:ops"],
    });
    expect(channel.metadata).toEqual({ import_source: { type: "test" } });
    expect(channel.tags).toEqual(["imported", "team:ops"]);
  });
});

describe("listChannels", () => {
  test("returns empty when no channels", () => {
    expect(listChannels()).toEqual([]);
  });

  test("returns channels with counts", () => {
    createChannel("general", "alice", { description: "General" });
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
    expect(channels.map((channel) => channel.name)).toEqual(["alpha", "beta"]);
  });

  test("filters by project_id", () => {
    const project = createProject({ name: "myproject", created_by: "alice" });
    createChannel("proj-channel", "alice", { project_id: project.id });
    createChannel("standalone", "alice");

    const filtered = listChannels({ project_id: project.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("proj-channel");
  });

  test("filters by tag", () => {
    createChannel("ops", "alice", { tags: ["team:ops"] });
    createChannel("dev", "alice", { tags: ["team:dev"] });

    const filtered = listChannels({ tag: "team:ops" });
    expect(filtered.map((channel) => channel.name)).toEqual(["ops"]);
  });
});

describe("getChannel", () => {
  test("returns null for nonexistent channel", () => {
    expect(getChannel("nonexistent")).toBeNull();
  });

  test("returns channel info", () => {
    createChannel("general", "alice", { description: "General chat" });
    const channel = getChannel("general");
    expect(channel).toBeTruthy();
    expect(channel!.name).toBe("general");
    expect(channel!.description).toBe("General chat");
    expect(channel!.member_count).toBe(1);
  });
});

describe("membership", () => {
  test("joins existing channel", () => {
    createChannel("general", "alice");
    const ok = joinChannel("general", "bob");
    expect(ok).toBe(true);
    expect(isChannelMember("general", "bob")).toBe(true);
  });

  test("returns false for nonexistent channel", () => {
    expect(joinChannel("nonexistent", "bob")).toBe(false);
  });

  test("is idempotent", () => {
    createChannel("general", "alice");
    joinChannel("general", "bob");
    joinChannel("general", "bob");
    expect(getChannelMembers("general")).toHaveLength(2);
  });

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

describe("updateChannel", () => {
  test("updates description and topic", () => {
    createChannel("general", "alice", { description: "Old desc" });
    const channel = updateChannel("general", { description: "New desc", topic: "Launches" });
    expect(channel.name).toBe("general");
    expect(channel.description).toBe("New desc");
    expect(channel.topic).toBe("Launches");
  });

  test("updates metadata and tags", () => {
    createChannel("general", "alice");
    const channel = updateChannel("general", { metadata: { owner: "ops" }, tags: ["team:ops"] });
    expect(channel.metadata).toEqual({ owner: "ops" });
    expect(channel.tags).toEqual(["team:ops"]);
  });

  test("throws if channel does not exist", () => {
    expect(() => updateChannel("nonexistent", { description: "test" })).toThrow("Channel not found");
  });

  test("updates project_id", () => {
    const project = createProject({ name: "myproject", created_by: "alice" });
    createChannel("general", "alice");
    const channel = updateChannel("general", { project_id: project.id });
    expect(channel.project_id).toBe(project.id);
  });

  test("removes project_id with null", () => {
    const project = createProject({ name: "myproject", created_by: "alice" });
    createChannel("general", "alice", { project_id: project.id });
    const channel = updateChannel("general", { project_id: null });
    expect(channel.project_id).toBeNull();
  });

  test("throws if new project does not exist", () => {
    createChannel("general", "alice");
    expect(() => updateChannel("general", { project_id: "nonexistent" })).toThrow("Project not found");
  });

  test("returns unchanged channel when no updates provided", () => {
    createChannel("general", "alice", { description: "Original" });
    const channel = updateChannel("general", {});
    expect(channel.description).toBe("Original");
  });
});

describe("renameChannel", () => {
  test("renames a channel and returns the new channel", () => {
    createChannel("old-name", "alice", { description: "Desc", topic: "Topic" });
    const channel = renameChannel("old-name", "new-name");
    expect(channel.name).toBe("new-name");
    expect(channel.description).toBe("Desc");
    expect(channel.topic).toBe("Topic");
    expect(getChannel("old-name")).toBeNull();
    expect(getChannel("new-name")?.name).toBe("new-name");
  });

  test("normalizes the new name", () => {
    createChannel("old-name", "alice");
    const channel = renameChannel("old-name", "#New Name!");
    expect(channel.name).toBe("new-name");
    expect(getChannel("new-name")?.name).toBe("new-name");
  });

  test("throws when the source channel does not exist", () => {
    expect(() => renameChannel("nonexistent", "whatever")).toThrow("Channel not found");
  });

  test("throws when the target name already exists", () => {
    createChannel("alpha", "alice");
    createChannel("beta", "alice");
    expect(() => renameChannel("alpha", "beta")).toThrow("already exists");
  });

  test("is a no-op when old and new normalize to the same name", () => {
    createChannel("general", "alice", { description: "Same" });
    const channel = renameChannel("#General", "general");
    expect(channel.name).toBe("general");
    expect(channel.description).toBe("Same");
  });

  test("preserves messages across the rename", () => {
    createChannel("old-name", "alice");
    sendMessage({ from: "alice", to: "old-name", content: "first", channel: "old-name", session_id: "channel:old-name" });
    sendMessage({ from: "bob", to: "old-name", content: "second", channel: "old-name", session_id: "channel:old-name" });

    renameChannel("old-name", "new-name");

    const oldMsgs = readMessages({ channel: "old-name" });
    const newMsgs = readMessages({ channel: "new-name" });
    expect(oldMsgs).toHaveLength(0);
    expect(newMsgs).toHaveLength(2);
    expect(newMsgs.map((m) => m.content).sort()).toEqual(["first", "second"]);
    // Session id and recipient are rewritten to the new channel.
    expect(newMsgs.every((m) => m.session_id === "channel:new-name")).toBe(true);
    expect(newMsgs.every((m) => m.channel === "new-name")).toBe(true);
  });

  test("preserves a threaded reply scope across the rename", () => {
    createChannel("old-name", "alice");
    const parent = sendMessage({ from: "alice", to: "old-name", content: "root", channel: "old-name" });
    const reply = sendMessage({ from: "bob", to: "old-name", content: "reply", channel: "old-name", reply_to: parent.id });

    renameChannel("old-name", "new-name");

    const replies = getThreadReplies(parent.id);
    expect(replies.map((message) => message.id)).toEqual([reply.id]);
    expect(replies[0].channel).toBe("new-name");
    expect(replies[0].session_id).toBe("channel:new-name");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM message_scope_rewrite_guard").get()).toEqual({ n: 0 });
  });

  test("rolls back the internal rewrite guard and keeps generic parent mutation blocked", () => {
    createChannel("old-name", "alice");
    const parent = sendMessage({ from: "alice", to: "old-name", content: "root", channel: "old-name" });
    sendMessage({ from: "bob", to: "old-name", content: "reply", channel: "old-name", reply_to: parent.id });
    const db = getDb();
    db.exec(`
      CREATE TRIGGER fail_test_channel_rename
      BEFORE UPDATE OF channel ON messages
      WHEN NEW.channel = 'failed-rename'
      BEGIN SELECT RAISE(ABORT, 'injected rename failure'); END
    `);

    expect(() => renameChannel("old-name", "failed-rename")).toThrow("injected rename failure");
    expect(getChannel("old-name")?.name).toBe("old-name");
    expect(getChannel("failed-rename")).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM message_scope_rewrite_guard").get()).toEqual({ n: 0 });
    expect(() => db.prepare("UPDATE messages SET project_id = 'other' WHERE id = ?").run(parent.id)).toThrow(
      "reply parent scope is immutable",
    );
  });

  test("preserves members across the rename", () => {
    createChannel("old-name", "alice");
    joinChannel("old-name", "bob");
    joinChannel("old-name", "charlie");

    renameChannel("old-name", "new-name");

    const members = getChannelMembers("new-name").map((m) => m.agent).sort();
    expect(members).toEqual(["alice", "bob", "charlie"]);
    expect(getChannelMembers("old-name")).toHaveLength(0);
    expect(isChannelMember("new-name", "bob")).toBe(true);
  });

  test("keeps the message count on the renamed channel", () => {
    createChannel("old-name", "alice");
    sendMessage({ from: "alice", to: "old-name", content: "hi", channel: "old-name" });
    renameChannel("old-name", "new-name");

    const channels = listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("new-name");
    expect(channels[0].message_count).toBe(1);
    expect(channels[0].member_count).toBe(1);
  });
});

describe("updateChannel rename via --name", () => {
  test("renames when name is provided", () => {
    createChannel("old-name", "alice", { description: "Keep" });
    const channel = updateChannel("old-name", { name: "renamed" });
    expect(channel.name).toBe("renamed");
    expect(channel.description).toBe("Keep");
    expect(getChannel("old-name")).toBeNull();
  });

  test("renames and updates other fields in one call", () => {
    createChannel("old-name", "alice", { description: "Old" });
    const channel = updateChannel("old-name", { name: "renamed", description: "New desc" });
    expect(channel.name).toBe("renamed");
    expect(channel.description).toBe("New desc");
  });

  test("throws when renaming to an existing channel", () => {
    createChannel("alpha", "alice");
    createChannel("beta", "alice");
    expect(() => updateChannel("alpha", { name: "beta" })).toThrow("already exists");
  });

  test("ignores name when it normalizes to the current name", () => {
    createChannel("general", "alice", { description: "Desc" });
    const channel = updateChannel("general", { name: "#General", topic: "New topic" });
    expect(channel.name).toBe("general");
    expect(channel.topic).toBe("New topic");
  });
});

describe("archiveChannel", () => {
  test("archives a channel", () => {
    createChannel("general", "alice");
    const channel = archiveChannel("general");
    expect(channel.name).toBe("general");
    expect(channel.archived_at).toBeTruthy();
  });

  test("throws if channel does not exist", () => {
    expect(() => archiveChannel("nonexistent")).toThrow("Channel not found");
  });

  test("archived channel is excluded from listChannels by default", () => {
    createChannel("active", "alice");
    createChannel("old", "alice");
    archiveChannel("old");

    const channels = listChannels();
    expect(channels.map((channel) => channel.name)).toEqual(["active"]);
  });

  test("archived channel is included when include_archived is true", () => {
    createChannel("active", "alice");
    createChannel("old", "alice");
    archiveChannel("old");

    const channels = listChannels({ include_archived: true });
    expect(channels.map((channel) => channel.name)).toEqual(["active", "old"]);
  });
});

describe("unarchiveChannel", () => {
  test("unarchives a channel", () => {
    createChannel("general", "alice");
    archiveChannel("general");
    const channel = unarchiveChannel("general");
    expect(channel.archived_at).toBeNull();
  });

  test("throws if channel does not exist", () => {
    expect(() => unarchiveChannel("nonexistent")).toThrow("Channel not found");
  });
});
