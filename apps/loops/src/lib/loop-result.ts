import type { ExecutorResult, Loop, LoopRun } from "../types.js";

export const CONFIGURED_LOOP_SKIP_EXIT_CODE = 75;

export type FinalizableLoopResult = Omit<ExecutorResult, "status"> & {
  status: LoopRun["status"];
};

export function supportsConfiguredLoopSkip(loop: Loop, exitCode: number | undefined): boolean {
  return (
    loop.target.type !== "workflow" &&
    loop.overlap === "skip" &&
    exitCode === CONFIGURED_LOOP_SKIP_EXIT_CODE
  );
}

export function isConfiguredLoopSkip(
  loop: Loop,
  result: Pick<FinalizableLoopResult, "status" | "exitCode">,
): boolean {
  return result.status === "failed" && supportsConfiguredLoopSkip(loop, result.exitCode);
}

/**
 * Interpret the top-level loop decline protocol at the persistence boundary.
 *
 * Generic targets and workflow steps keep ordinary exit-code semantics. Only a
 * non-workflow loop configured with overlap=skip may turn exit 75 into the
 * neutral terminal LoopRun status. Output is deliberately ignored because the
 * protocol is the exit code; live callers emit both stdout and stderr variants.
 */
export function classifyLoopExecutionResult(
  loop: Loop,
  result: FinalizableLoopResult,
): FinalizableLoopResult {
  if (isConfiguredLoopSkip(loop, result)) {
    return { ...result, status: "skipped" };
  }
  return result;
}
