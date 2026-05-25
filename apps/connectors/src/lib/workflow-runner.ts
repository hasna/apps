/**
 * Workflow runner — executes sequential connector pipelines.
 *
 * Each step receives the previous step's output as additional context
 * injected into its args as --input <previous_output>.
 */

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "child_process";
import { maybeStrip } from "./strip.js";
import type { ConnectorWorkflow, WorkflowStep } from "../db/workflows.js";

type SpawnFn = typeof nodeSpawn;

let spawnImpl: SpawnFn = nodeSpawn;

/** @internal Test hook for substituting process spawning. */
export function __setSpawnForTests(fn: SpawnFn): void {
  spawnImpl = fn;
}

/** @internal Restore default process spawning after tests. */
export function __resetSpawnForTests(): void {
  spawnImpl = nodeSpawn;
}

export interface WorkflowStepResult {
  step: number;
  connector: string;
  command: string;
  exit_code: number;
  output: string;
}

export interface WorkflowResult {
  workflow_id: string;
  workflow_name: string;
  steps: WorkflowStepResult[];
  success: boolean;
  final_output: string;
}

async function runStep(
  step: WorkflowStep,
  previousOutput?: string
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const args = [...(step.args ?? [])];
    // Inject previous step output as --input if available
    if (previousOutput && previousOutput.trim()) {
      args.push("--input", previousOutput.trim().slice(0, 4096)); // cap at 4KB
    }
    const cmdArgs = ["run", step.connector, step.command, ...args, "--format", "json"];
    const proc = spawnImpl("connectors", cmdArgs, { shell: false }) as ChildProcessWithoutNullStreams;
    let output = "";
    proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
    proc.on("error", () => resolve({ exitCode: 1, output: "Failed to spawn connectors" }));
    setTimeout(() => { proc.kill(); resolve({ exitCode: 124, output: output + "\n[timeout]" }); }, 60_000);
  });
}

export async function runWorkflow(workflow: ConnectorWorkflow): Promise<WorkflowResult> {
  const results: WorkflowStepResult[] = [];
  let previousOutput: string | undefined;
  let success = true;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const { exitCode, output } = await runStep(step, previousOutput);

    const stripped = await maybeStrip(output);
    results.push({ step: i + 1, connector: step.connector, command: step.command, exit_code: exitCode, output: stripped });

    if (exitCode !== 0) { success = false; break; }
    previousOutput = stripped;
  }

  return {
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    steps: results,
    success,
    final_output: results[results.length - 1]?.output ?? "",
  };
}
