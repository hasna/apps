import { describe, expect, test } from "bun:test";
import {
  compactJobExecutionResult,
  compactWorkflowExecutionResult,
} from "./jobs.js";

describe("MCP job execution output formatting", () => {
  test("compacts job output by default", () => {
    const output = "x".repeat(120);
    const result = compactJobExecutionResult(
      { run_id: "run-1", exit_code: 0, output },
      { maxOutputChars: 24 }
    );

    expect(result.run_id).toBe("run-1");
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("[truncated");
    expect(result.output.length).toBeLessThan(output.length);
    expect(result.outputTruncated).toBe(true);
    expect(result.hint).toContain("verbose");
  });

  test("keeps full job output when verbose", () => {
    const output = "x".repeat(120);
    const result = compactJobExecutionResult(
      { run_id: "run-1", exit_code: 0, output },
      { verbose: true, maxOutputChars: 24 }
    );

    expect(result.output).toBe(output);
    expect(result.outputTruncated).toBe(false);
    expect(result.hint).toBeUndefined();
  });

  test("compacts workflow step and final output by default", () => {
    const output = "workflow-output-".repeat(20);
    const result = compactWorkflowExecutionResult(
      {
        workflow_id: "wf-1",
        workflow_name: "sync",
        success: true,
        steps: [
          {
            step: 1,
            connector: "stripe",
            command: "products",
            exit_code: 0,
            output,
          },
        ],
        final_output: output,
      },
      { maxOutputChars: 32 }
    );

    expect(result.workflow_id).toBe("wf-1");
    expect(result.steps[0].output).toContain("[truncated");
    expect(result.steps[0].outputTruncated).toBe(true);
    expect(result.final_output).toContain("[truncated");
    expect(result.finalOutputTruncated).toBe(true);
    expect(result.truncatedOutputs).toBe(2);
    expect(result.hint).toContain("verbose");
  });

  test("keeps full workflow output when verbose", () => {
    const output = "workflow-output-".repeat(20);
    const result = compactWorkflowExecutionResult(
      {
        workflow_id: "wf-1",
        workflow_name: "sync",
        success: true,
        steps: [
          {
            step: 1,
            connector: "stripe",
            command: "products",
            exit_code: 0,
            output,
          },
        ],
        final_output: output,
      },
      { verbose: true, maxOutputChars: 32 }
    );

    expect(result.steps[0].output).toBe(output);
    expect(result.steps[0].outputTruncated).toBe(false);
    expect(result.final_output).toBe(output);
    expect(result.finalOutputTruncated).toBe(false);
    expect(result.truncatedOutputs).toBe(0);
    expect(result.hint).toBeUndefined();
  });
});
