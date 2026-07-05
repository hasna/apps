import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describeFeedbackStoreRuntime, LocalFeedbackStore } from "../storage.js";
import type { FeedbackInput, FeedbackItem, FeedbackListFilter, FeedbackStats, FeedbackStatus, FeedbackStore } from "../types.js";
import { buildFeedbackMcpTools } from "./tools.js";

function textFromResult(result: Awaited<ReturnType<ReturnType<typeof buildFeedbackMcpTools>[number]["run"]>>): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

describe("feedback MCP tools", () => {
  test("registers tool definitions and submits feedback", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-mcp-")) });
    const tools = buildFeedbackMcpTools(store);
    expect(tools.map((tool) => tool.name)).toContain("feedback_diagnostics");
    expect(tools.map((tool) => tool.name)).toContain("submit_feedback");

    const diagnostics = tools.find((tool) => tool.name === "feedback_diagnostics");
    expect(diagnostics).toBeDefined();
    expect(JSON.parse(textFromResult(await diagnostics!.run({})))).toMatchObject({
      mode: "local",
      activeStore: "local-jsonl",
      ok: true,
    });

    const submit = tools.find((tool) => tool.name === "submit_feedback");
    expect(submit).toBeDefined();
    const result = await submit!.run({
      app_id: "mcp-app",
      message: "Agent feedback",
      kind: "idea",
    });
    expect(JSON.parse(textFromResult(result))).toMatchObject({
      appId: "mcp-app",
      source: "mcp",
    });
    expect(await store.listFeedback({ appId: "mcp-app" })).toHaveLength(1);

    const exportTool = tools.find((tool) => tool.name === "export_feedback");
    expect(exportTool).toBeDefined();
    const exported = await exportTool!.run({ app_id: "mcp-app", search: "Agent", format: "jsonl" });
    expect(textFromResult(exported)).toContain("Agent feedback");
  });

  test("redacts MCP input before passing it to an injected store", async () => {
    const captured: FeedbackInput[] = [];
    const store = recordingStore(captured);
    const submit = buildFeedbackMcpTools(store).find((tool) => tool.name === "submit_feedback");
    expect(submit).toBeDefined();

    await submit!.run({
      app_id: "mcp-app",
      message: `token sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456 leaked`,
      url: "https://example.test/path?token=plain-value",
      metadata: {
        apiToken: "do-not-store",
      },
      context: {
        Authorization: "Bearer synthetic-value",
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toContain("[redacted]");
    expect(captured[0]?.url).toBe("https://example.test/path?token=[redacted]");
    expect(captured[0]?.metadata?.apiToken).toBe("[redacted]");
    expect(captured[0]?.context?.Authorization).toBe("[redacted]");
  });

  test("returns MCP diagnostics when cloud storage has no adapter", async () => {
    const tools = buildFeedbackMcpTools({
      runtime: describeFeedbackStoreRuntime({ env: { FEEDBACK_STORE: "cloud" } }),
    });
    const diagnostics = tools.find((tool) => tool.name === "feedback_diagnostics");
    expect(diagnostics).toBeDefined();
    expect(JSON.parse(textFromResult(await diagnostics!.run({})))).toMatchObject({
      mode: "cloud",
      activeStore: "unavailable",
      ok: false,
    });

    const submit = tools.find((tool) => tool.name === "submit_feedback");
    expect(submit).toBeDefined();
    const result = await submit!.run({ app_id: "mcp-app", message: "Cloud mode without adapter" });
    expect(result.isError).toBe(true);
    expect(textFromResult(result)).toContain("host-provided FeedbackStore adapter");
  });
});

function recordingStore(captured: FeedbackInput[]): FeedbackStore {
  return {
    async createFeedback(input: FeedbackInput): Promise<FeedbackItem> {
      captured.push(input);
      const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
      return {
        ...input,
        id: "feedback_1",
        createdAt: now,
        updatedAt: now,
        status: "new",
        source: "mcp",
        kind: input.kind ?? "other",
        tags: input.tags ?? [],
      };
    },
    async listFeedback(_filter?: FeedbackListFilter): Promise<FeedbackItem[]> {
      return [];
    },
    async getFeedback(_id: string): Promise<FeedbackItem | null> {
      return null;
    },
    async updateFeedbackStatus(_id: string, _status: FeedbackStatus): Promise<FeedbackItem | null> {
      return null;
    },
    async stats(): Promise<FeedbackStats> {
      return {
        total: 0,
        byApp: {},
        byKind: { bug: 0, idea: 0, question: 0, praise: 0, other: 0 },
        byStatus: { new: 0, triaged: 0, closed: 0 },
        bySeverity: {},
      };
    },
    async exportJsonl(_filter?: FeedbackListFilter): Promise<string> {
      return "";
    },
  };
}
