import { describe, expect, test } from "bun:test";
import {
  getWorkflowPrompt,
  listWorkflowPrompts,
  renderWorkflowPrompt,
  renderWorkflowPromptMarkdown,
} from "./workflow-prompts.js";
import { withNoNetwork } from "../test/no-network.js";

describe("workflow prompt catalog", () => {
  test("publishes stable local workflow prompts for common agent actions", () => {
    const prompts = listWorkflowPrompts();
    expect(prompts.map((prompt) => prompt.id)).toEqual([
      "goal_planning",
      "task_claiming",
      "review",
      "verification",
      "handoff",
      "release_prep",
      "import_triage",
      "incident_response",
    ]);
    for (const prompt of prompts) {
      expect(prompt.arguments.map((arg) => arg.name)).toEqual(["objective", "task_id", "agent_id", "context"]);
      expect(prompt.description.length).toBeGreaterThan(20);
    }
  });

  test("renders deterministic prompt messages without network access", async () => {
    await withNoNetwork(async () => {
      const rendered = renderWorkflowPrompt("goal-planning", {
        objective: "Ship todos.md",
        task_id: "abcd1234",
        agent_id: "codex",
      });
      expect(rendered.local_only).toBe(true);
      expect(rendered.messages[0].content.text).toContain("Ship todos.md");
      expect(rendered.messages[0].content.text).toContain("Task ID: abcd1234");
      expect(renderWorkflowPromptMarkdown("verification")).toContain("# Verification workflow");
    });
  });

  test("returns null for unknown prompt ids", () => {
    expect(getWorkflowPrompt("missing")).toBeNull();
    expect(() => renderWorkflowPrompt("missing")).toThrow(/Unknown workflow prompt/);
  });
});
