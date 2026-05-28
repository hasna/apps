import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask, startTask, addDependency } from "../db/tasks.js";
import { addComment } from "../db/comments.js";
import {
  HANDOFF_PACKET_SCHEMA,
  buildHandoffPacket,
  createHandoffPacket,
  formatHandoffPacket,
  exportHandoffPacket,
  getLatestHandoffPacket,
} from "./handoff-packets.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-handoff-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("handoff packets", () => {
  it("builds packet with project context and active tasks", () => {
    const project = createProject({ name: "handoff-proj", path: "/tmp/ho" });
    const task = createTask({ title: "Active work", project_id: project.id });
    startTask(task.id, "agent-a");

    const packet = buildHandoffPacket({ agent_id: "agent-a", project_id: project.id });
    expect(packet.schema_version).toBe(HANDOFF_PACKET_SCHEMA);
    expect(packet.context.project?.name).toBe("handoff-proj");
    expect(packet.active_tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it("includes blockers and next suggested action", () => {
    const project = createProject({ name: "blocked-proj", path: "/tmp/bp" });
    const blocker = createTask({ title: "Blocker", project_id: project.id });
    const blocked = createTask({ title: "Waiting", project_id: project.id });
    addDependency(blocked.id, blocker.id);

    const packet = buildHandoffPacket({ project_id: project.id });
    expect(packet.blocked_tasks.length).toBeGreaterThan(0);
    expect(packet.next_suggested_action).toBeTruthy();
  });

  it("includes recent comments", () => {
    const task = createTask({ title: "Commented" });
    addComment({ task_id: task.id, content: "Progress update here" });

    const packet = buildHandoffPacket({ task_id: task.id });
    expect(packet.recent_comments.some((c) => c.content.includes("Progress"))).toBe(true);
  });

  it("creates and retrieves stored handoff packet", () => {
    const project = createProject({ name: "store", path: "/tmp/store" });
    createTask({ title: "T", project_id: project.id, status: "pending" });

    const created = createHandoffPacket({ agent_id: "agent-b", project_id: project.id });
    expect(created.id).toBeTruthy();

    const latest = getLatestHandoffPacket("agent-b", project.id);
    expect(latest?.agent_id).toBe("agent-b");
  });

  it("formats markdown handoff", () => {
    const packet = buildHandoffPacket({ agent_id: "agent-c" });
    const md = formatHandoffPacket(packet, "markdown");
    expect(md).toContain("# Agent Handoff Packet");
    expect(md).toContain("agent-c");
  });

  it("exports packet to file", () => {
    const path = join(tempDir, "handoff.json");
    exportHandoffPacket({ agent_id: "agent-d" }, path);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.schema_version).toBe(HANDOFF_PACKET_SCHEMA);
  });
});
