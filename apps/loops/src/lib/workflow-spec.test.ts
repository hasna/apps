import { describe, expect, test } from "bun:test";
import { workflowBodyFromJson } from "./workflow-spec.js";

describe("workflow goal spec validation", () => {
  test("accepts workflow and step goals during JSON normalization", () => {
    const workflow = workflowBodyFromJson({
      name: "goal-workflow",
      goal: { objective: "complete the whole workflow", tokenBudget: 100, maxTurns: 3 },
      steps: [
        {
          id: "step-one",
          goal: { objective: "complete this step", model: "openai/gpt-4o-mini" },
          target: { type: "command", command: "true" },
        },
      ],
    });

    expect(workflow.goal?.objective).toBe("complete the whole workflow");
    expect(workflow.steps[0]?.goal?.objective).toBe("complete this step");
  });

  test("rejects empty and overlong goals", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "empty-goal",
        goal: { objective: " " },
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
      }),
    ).toThrow("goal.objective");

    expect(() =>
      workflowBodyFromJson({
        name: "long-goal",
        goal: { objective: "x".repeat(4001) },
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
      }),
    ).toThrow("4000");
  });
});
