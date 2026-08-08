import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { buildGraph, getRelated, getAgentNetwork, getGraphStats } from "./graph";
import { sendMessage } from "./messages";
import { createChannel, joinChannel } from "./channels";
import { createProject } from "./projects";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-graph-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
});

describe("buildGraph", () => {
  test("creates edges from DM conversations", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    sendMessage({ from: "alice", to: "bob", content: "hi again" });
    sendMessage({ from: "bob", to: "alice", content: "hey" });
    const result = buildGraph();
    expect(result.edges_created).toBeGreaterThan(0);
  });

  test("creates edges from channel posts", () => {
    createChannel("dev", "alice");
    sendMessage({ from: "alice", to: "dev", content: "hello channel", channel: "dev" });
    sendMessage({ from: "bob", to: "dev", content: "hello too", channel: "dev" });
    const result = buildGraph();
    expect(result.edges_created).toBeGreaterThan(0);
  });

  test("creates membership edges", () => {
    createChannel("team", "alice");
    joinChannel("team", "bob");
    const result = buildGraph();
    expect(result.edges_created).toBeGreaterThan(0);
    const related = getRelated("agent", "bob");
    expect(related.some((r) => r.relation === "member_of" && r.id === "team")).toBe(true);
  });

  test("creates channel-project edges", () => {
    const proj = createProject({ name: "myproj", created_by: "alice" });
    createChannel("proj-channel", "alice", { project_id: proj.id });
    buildGraph();
    const related = getRelated("channel", "proj-channel");
    expect(related.some((r) => r.relation === "belongs_to" && r.type === "project")).toBe(true);
  });

  test("is idempotent — re-running updates weights", () => {
    sendMessage({ from: "alice", to: "bob", content: "msg1" });
    const first = buildGraph();
    sendMessage({ from: "alice", to: "bob", content: "msg2" });
    const second = buildGraph();
    expect(second.edges_updated).toBeGreaterThan(0);
  });
});

describe("getRelated", () => {
  test("returns empty for unknown entity", () => {
    expect(getRelated("agent", "unknown")).toEqual([]);
  });

  test("returns outgoing and incoming edges", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    sendMessage({ from: "bob", to: "alice", content: "hi back" });
    buildGraph();
    const related = getRelated("agent", "alice");
    expect(related.length).toBeGreaterThan(0);
  });
});

describe("getAgentNetwork", () => {
  test("returns agent communication network", () => {
    sendMessage({ from: "alice", to: "bob", content: "msg1" });
    sendMessage({ from: "alice", to: "charlie", content: "msg2" });
    createChannel("team", "alice");
    joinChannel("team", "alice");
    sendMessage({ from: "alice", to: "team", content: "channel msg", channel: "team" });
    buildGraph();

    const network = getAgentNetwork("alice");
    expect(network.agent).toBe("alice");
    expect(network.communicates_with.length).toBeGreaterThan(0);
    expect(network.channels.length).toBeGreaterThan(0);
  });

  test("returns empty network for unknown agent", () => {
    const network = getAgentNetwork("unknown");
    expect(network.communicates_with).toEqual([]);
    expect(network.channels).toEqual([]);
  });
});

describe("getGraphStats", () => {
  test("returns stats for empty graph", () => {
    const stats = getGraphStats();
    expect(stats.total_edges).toBe(0);
    expect(stats.by_relation).toEqual({});
  });

  test("returns correct stats after build", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    createChannel("team", "alice");
    joinChannel("team", "bob");
    sendMessage({ from: "alice", to: "team", content: "hey team", channel: "team" });
    buildGraph();

    const stats = getGraphStats();
    expect(stats.total_edges).toBeGreaterThan(0);
    expect(Object.keys(stats.by_relation).length).toBeGreaterThan(0);
  });
});
