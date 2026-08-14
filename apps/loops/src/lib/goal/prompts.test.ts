import { describe, expect, test } from "bun:test";
import type { ExecutableTarget } from "../../types.js";
import { goalNodeTarget, iterationPrompt } from "./prompts.js";

describe("goal prompts", () => {
  test("iterationPrompt renders a distinct prompt per plan node", () => {
    const goal = { objective: "ship the feature" };
    const a = iterationPrompt(goal, { key: "code", objective: "write the code" });
    const b = iterationPrompt(goal, { key: "tests", objective: "write the tests" });
    expect(a).toContain("ship the feature");
    expect(a).toContain("write the code");
    expect(b).toContain("write the tests");
    expect(a).not.toBe(b);
  });

  test("goalNodeTarget appends node objectives to agent prompts and leaves command targets untouched", () => {
    const agent: ExecutableTarget = { type: "agent", provider: "claude", prompt: "base prompt" };
    const goal = { objective: "ship the feature" };
    const a = goalNodeTarget(agent, goal, { key: "a", objective: "objective A" });
    const b = goalNodeTarget(agent, goal, { key: "b", objective: "objective B" });
    expect(a.type).toBe("agent");
    if (a.type === "agent" && b.type === "agent") {
      expect(a.prompt).toStartWith("base prompt");
      expect(a.prompt).toContain("objective A");
      expect(b.prompt).toContain("objective B");
      expect(a.prompt).not.toBe(b.prompt);
    }
    const command: ExecutableTarget = { type: "command", command: "run-node" };
    expect(goalNodeTarget(command, goal, { key: "a", objective: "objective A" })).toBe(command);
  });
});
