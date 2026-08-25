/**
 * grok lane adapter — xAI Grok SDK.
 *
 * MEASURED 2026-08-25: no xAI Grok SDK exists on the npm registry under any
 * candidate name (@xai/grok-sdk, @xai/sdk, @grok-ai/sdk, xai-sdk all absent;
 * the only "grok-sdk" row is a squatted 0.0.1-security package and is never
 * used). The adapter therefore drives the local `grok` CLI when present and
 * reports LANE_DEPENDENCY_MISSING (exit 127) naming the missing substrate
 * otherwise — the honest degradation contract, so a workflow fails loudly
 * instead of pretending a lane ran.
 */
import {
  type LaneAdapter,
  type LaneJob,
  type LaneResult,
  LaneDependencyMissingError,
  spawnCli,
  DEFAULT_LANE_TIMEOUT_MS,
} from "./types.js";

export interface GrokAdapterDeps {
  cliPath?: string;
}

export function createGrokAdapter(deps: GrokAdapterDeps = {}): LaneAdapter {
  return {
    kind: "grok",
    async run(job: LaneJob): Promise<LaneResult> {
      if (!job.prompt) {
        return { ok: false, exitCode: 2, output: "", durationMs: 0, error: "grok lane requires a prompt" };
      }
      const started = Date.now();
      const timeoutMs = job.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
      const cliPath = deps.cliPath ?? "grok";
      try {
        const result = spawnCli([cliPath, job.prompt!], {
          binaryName: cliPath,
          packageHint: "the grok CLI (no xAI Grok SDK exists on npm — measured 2026-08-25)",
          timeoutMs,
          env: job.env,
          cwd: job.cwd,
        });
        return { ...result, durationMs: Date.now() - started };
      } catch (err) {
        if (err instanceof LaneDependencyMissingError) {
          return { ok: false, exitCode: 127, output: "", durationMs: Date.now() - started, error: err.message };
        }
        throw err;
      }
    },
  };
}
