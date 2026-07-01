import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFeedbackStore } from "../storage.js";
import { buildFeedbackMcpTools } from "./tools.js";

function textFromResult(result: Awaited<ReturnType<ReturnType<typeof buildFeedbackMcpTools>[number]["run"]>>): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

describe("feedback MCP tools", () => {
  test("registers tool definitions and submits feedback", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-mcp-")) });
    const tools = buildFeedbackMcpTools(store);
    expect(tools.map((tool) => tool.name)).toContain("submit_feedback");

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
  });
});

