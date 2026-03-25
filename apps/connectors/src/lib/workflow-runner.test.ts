import { describe, test, expect, mock } from "bun:test";
import { EventEmitter } from "events";

// Create a factory for fake child processes
function makeFakeProc(stdout: string, stderr: string, exitCode: number, delay = 5) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = mock(() => {
    proc.emit("close", 124);
  });
  setTimeout(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  }, delay);
  return proc;
}

// Mock child_process.spawn so workflow-runner uses our fake process
const spawnMock = mock((_cmd: string, _args: string[], _opts: any) =>
  makeFakeProc('{"result":"ok"}', "", 0)
);

mock.module("child_process", () => ({
  spawn: spawnMock,
}));

const { runWorkflow } = await import("./workflow-runner.js");

describe("runWorkflow", () => {
  test("returns success with empty steps", async () => {
    const result = await runWorkflow({
      id: "wf-empty",
      name: "empty",
      steps: [],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(0);
    expect(result.final_output).toBe("");
    expect(result.workflow_id).toBe("wf-empty");
    expect(result.workflow_name).toBe("empty");
  });

  test("runs a single step and returns output", async () => {
    spawnMock.mockImplementation(() => makeFakeProc('{"items":[1,2,3]}', "", 0));
    const result = await runWorkflow({
      id: "wf-one",
      name: "one-step",
      steps: [{ connector: "stripe", command: "products", args: ["list"] }],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].step).toBe(1);
    expect(result.steps[0].connector).toBe("stripe");
    expect(result.steps[0].command).toBe("products");
    expect(result.steps[0].exit_code).toBe(0);
    expect(result.final_output).toBeTruthy();
  });

  test("stops on first failing step", async () => {
    let call = 0;
    spawnMock.mockImplementation(() => {
      call++;
      if (call === 1) return makeFakeProc("error output", "", 1);
      return makeFakeProc("should not reach", "", 0);
    });
    const result = await runWorkflow({
      id: "wf-fail",
      name: "fail-pipeline",
      steps: [
        { connector: "stripe", command: "badcmd", args: [] },
        { connector: "github", command: "repos", args: [] },
      ],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1); // stopped after first failure
  });

  test("passes previous step output as --input to next step", async () => {
    const calls: string[][] = [];
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      calls.push(args);
      return makeFakeProc('{"data":"step-output"}', "", 0);
    });
    await runWorkflow({
      id: "wf-chain",
      name: "chained",
      steps: [
        { connector: "stripe", command: "products", args: ["list"] },
        { connector: "github", command: "repos", args: ["list"] },
      ],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    // Second step should include --input flag with first step's output
    expect(calls.length).toBe(2);
    const secondArgs = calls[1];
    expect(secondArgs).toContain("--input");
  });

  test("handles step with no previous output (no --input added)", async () => {
    const calls: string[][] = [];
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      calls.push(args);
      return makeFakeProc("", "", 0); // empty output
    });
    await runWorkflow({
      id: "wf-empty-out",
      name: "empty-output-chain",
      steps: [
        { connector: "stripe", command: "list", args: [] },
        { connector: "github", command: "list", args: [] },
      ],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    // Second step should NOT include --input since first output is empty
    const secondArgs = calls[1];
    expect(secondArgs).not.toContain("--input");
  });

  test("proc error event resolves with exit code 1", async () => {
    spawnMock.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = mock(() => {});
      setTimeout(() => proc.emit("error", new Error("spawn ENOENT")), 5);
      return proc;
    });
    const result = await runWorkflow({
      id: "wf-error",
      name: "proc-error",
      steps: [{ connector: "bad", command: "cmd", args: [] }],
      enabled: true,
      created_at: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].exit_code).toBe(1);
    expect(result.steps[0].output).toContain("Failed to spawn");
  });
});
