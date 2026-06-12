import type { StatusContext } from "./types";

/**
 * Parse the JSON payload Claude Code pipes to a `statusLine` command.
 * Every field is optional — a partial or empty payload must still
 * produce a usable context.
 */
export function parseClaudeInput(input: Record<string, any>): StatusContext {
  const cwd: string =
    input?.cwd || input?.workspace?.current_dir || process.cwd();
  return {
    provider: "claude",
    cwd,
    projectDir: input?.workspace?.project_dir || undefined,
    model: input?.model
      ? { id: input.model.id || undefined, displayName: input.model.display_name || undefined }
      : undefined,
    cost: input?.cost
      ? {
          totalCostUsd: numberOr(input.cost.total_cost_usd),
          totalDurationMs: numberOr(input.cost.total_duration_ms),
          totalLinesAdded: numberOr(input.cost.total_lines_added),
          totalLinesRemoved: numberOr(input.cost.total_lines_removed),
        }
      : undefined,
    transcriptPath: input?.transcript_path || undefined,
    sessionId: input?.session_id || undefined,
    version: input?.version || undefined,
    outputStyle: input?.output_style?.name || undefined,
  };
}

function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
