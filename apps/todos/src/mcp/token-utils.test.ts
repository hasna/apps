import { describe, expect, it } from "bun:test";
import {
  CORE_MCP_TOOLS,
  compactTask,
  shouldRegisterToolForProfile,
  withMcpTokenDiagnostics,
} from "./token-utils.js";
import type { Task } from "../types/index.js";

describe("MCP token utilities", () => {
  it("defaults unknown and empty profiles to the compact core tool group", () => {
    expect(shouldRegisterToolForProfile("claim_next_task", undefined, undefined)).toBe(true);
    expect(shouldRegisterToolForProfile("create_task", undefined, undefined)).toBe(true);
    expect(shouldRegisterToolForProfile("register_agent", "unknown", undefined)).toBe(true);
    expect(shouldRegisterToolForProfile("create_webhook", undefined, undefined)).toBe(false);
  });

  it("supports profile groups and additive tool groups", () => {
    expect(shouldRegisterToolForProfile("task_context", "agent", undefined)).toBe(true);
    expect(shouldRegisterToolForProfile("sync_all", "agent", undefined)).toBe(false);
    expect(shouldRegisterToolForProfile("sync_all", "agent", "cloud")).toBe(false);
    expect(shouldRegisterToolForProfile("create_webhook", "full", undefined)).toBe(true);
  });

  it("keeps the minimal profile small enough for agent startup", () => {
    expect(CORE_MCP_TOOLS.size).toBeLessThanOrEqual(20);
    expect(CORE_MCP_TOOLS.has("create_task")).toBe(true);
    expect(CORE_MCP_TOOLS.has("list_tasks")).toBe(true);
  });

  it("compacts task descriptions", () => {
    const task = {
      id: "12345678-1234-1234-1234-123456789abc",
      short_id: null,
      title: "Token savings",
      description: "x".repeat(80),
      status: "pending",
      priority: "medium",
      assigned_to: null,
      project_id: null,
      due_at: null,
      updated_at: "2026-05-07T00:00:00.000Z",
      tags: ["mcp"],
    } as Task;

    const compact = compactTask(task, 12);
    expect(compact["short_id"]).toBe("12345678");
    expect(compact["description"]).toBe("xxxxxxxxx...");
  });

  it("appends local token diagnostics only when enabled", () => {
    const response = { content: [{ type: "text" as const, text: "hello world" }] };
    expect(withMcpTokenDiagnostics(response, "get_task", false)).toBe(response);

    const instrumented = withMcpTokenDiagnostics(response, "get_task", true) as typeof response;
    expect(instrumented.content[0]!.text).toContain("[mcp-token-diagnostics tool=get_task");
  });
});
