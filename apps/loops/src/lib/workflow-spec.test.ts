import { readFileSync } from "node:fs";
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

  test("accepts the transcript feedback workflow fixture", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../docs/workflows/transcript-feedback-to-loops.json", import.meta.url), "utf8"),
    );

    const workflow = workflowBodyFromJson(fixture);
    const firstTarget = workflow.steps[0]!.target;

    expect(workflow.name).toBe("transcript-feedback-to-loops");
    expect(workflow.goal).toBeUndefined();
    expect(workflow.steps.map((step) => step.id)).toEqual([
      "check-transcriber",
      "check-loops",
      "transcribe-media",
      "extract-loop-backlog",
      "author-loop-workflows",
      "validate-loop-workflows",
    ]);
    expect(firstTarget.type).toBe("command");
    if (firstTarget.type !== "command") throw new Error("expected command target");
    expect(firstTarget.shell).toBeUndefined();
    expect(firstTarget.command).toBe("transcriber");
    const transcribeTarget = workflow.steps.find((step) => step.id === "transcribe-media")?.target;
    expect(transcribeTarget?.type).toBe("command");
    if (!transcribeTarget || transcribeTarget.type !== "command") throw new Error("expected transcribe command target");
    expect(transcribeTarget.env?.TRANSCRIBER_SOURCE_URL).toBeUndefined();
    expect(transcribeTarget.env?.TRANSCRIBER_PROVIDER).toBe("openai");
    expect(transcribeTarget.env?.TRANSCRIBER_MODEL).toBeUndefined();
    expect(transcribeTarget.command).toContain("TRANSCRIBER_SOURCE_URL:?set TRANSCRIBER_SOURCE_URL");
    expect(transcribeTarget.command).toContain("latest-transcript.json");
    expect(transcribeTarget.command).not.toContain("https://example.com");
    expect(transcribeTarget.command).not.toContain("--model");
    const validateTarget = workflow.steps.find((step) => step.id === "validate-loop-workflows")?.target;
    expect(validateTarget?.type).toBe("command");
    if (!validateTarget || validateTarget.type !== "command") throw new Error("expected validation command target");
    expect(validateTarget.command).toContain("--preflight");
    expect(validateTarget.command).toContain("no generated workflow specs found");
    expect(validateTarget.command).toContain("exit 0");
  });
});
