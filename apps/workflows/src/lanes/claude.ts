/**
 * claude lane adapter — @anthropic-ai/claude-agent-sdk.
 *
 * The SDK's `query({ prompt, options })` returns an async generator of
 * SDKMessage; assistant text blocks are accumulated into the result output.
 * When the SDK package is unavailable, the adapter falls back to the local
 * `claude` CLI in print mode (`claude -p <prompt>`).
 */
import {
  type LaneAdapter,
  type LaneJob,
  type LaneProbe,
  type LaneResult,
  LaneAdapterShapeError,
  LaneDependencyMissingError,
  withTimeout,
  spawnCli,
  binaryOnPath,
  DEFAULT_LANE_TIMEOUT_MS,
} from "./types.js";

export interface ClaudeAdapterDeps {
  /** SDK loader — injectable for tests; defaults to the real package import. */
  sdkLoader?: () => Promise<unknown>;
  /** CLI fallback binary name. Default "claude". */
  cliPath?: string;
}

export function createClaudeAdapter(deps: ClaudeAdapterDeps = {}): LaneAdapter {
  return {
    kind: "claude",
    async probe(): Promise<LaneProbe> {
      const loader = deps.sdkLoader ?? (async () => (await import("@anthropic-ai/claude-agent-sdk")) as unknown);
      try {
        await loader();
        return { kind: "claude", sdk: "@anthropic-ai/claude-agent-sdk", wired: true, via: "sdk" };
      } catch {
        // SDK unavailable -> is the claude CLI on PATH?
        if (binaryOnPath(deps.cliPath ?? "claude")) {
          return { kind: "claude", sdk: "@anthropic-ai/claude-agent-sdk", wired: true, via: "cli" };
        }
        return {
          kind: "claude",
          sdk: "@anthropic-ai/claude-agent-sdk",
          wired: false,
          reason: "neither @anthropic-ai/claude-agent-sdk nor the claude CLI is available on this machine",
        };
      }
    },
    async run(job: LaneJob): Promise<LaneResult> {
      if (!job.prompt) {
        return { ok: false, exitCode: 2, output: "", durationMs: 0, error: "claude lane requires a prompt" };
      }
      const started = Date.now();
      const timeoutMs = job.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
      const loader = deps.sdkLoader ?? (async () => (await import("@anthropic-ai/claude-agent-sdk")) as unknown);
      let sdk: unknown;
      try {
        sdk = await loader();
      } catch (err) {
        // SDK unavailable -> local CLI fallback
        return runClaudeCli(job, deps.cliPath ?? "claude", started, timeoutMs);
      }
      const query = (sdk as Record<string, unknown>).query;
      if (typeof query !== "function") {
        throw new LaneAdapterShapeError("@anthropic-ai/claude-agent-sdk exports no query() function");
      }
      const prompt = job.prompt; // narrowed by the guard above; stable inside the closure
      try {
        // The whole query — generator creation AND stream iteration — runs
        // under one budget. Wrapping only the creation left the for-await
        // unbounded: a stream that stalls after the first chunk hung the run
        // past the declared timeout (measured live 2026-08-25 on a real SDK
        // call). The iteration promise rejects at the budget and the caller
        // sees the timeout error instead of an indefinite hang.
        const { output, isError } = await withTimeout(
          (async () => {
            const generator = await (
              query as (params: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>
            )({
              prompt,
              options: { model: job.model, maxTurns: 32, abortSignal: undefined },
            });
            let output = "";
            let isError = false;
            for await (const message of generator) {
              if (message.type === "assistant") {
                const content = (message as { message?: { content?: unknown[] } }).message?.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block && typeof block === "object" && "text" in block && typeof (block as { text: unknown }).text === "string") {
                      output += (block as { text: string }).text;
                    }
                  }
                }
              }
              if (message.type === "error") isError = true;
            }
            return { output, isError };
          })(),
          timeoutMs,
          `claude lane (${job.prompt.slice(0, 60)})`,
        );
        const durationMs = Date.now() - started;
        return { ok: !isError, exitCode: isError ? 1 : 0, output: output.trim(), durationMs };
      } catch (err) {
        const durationMs = Date.now() - started;
        return { ok: false, exitCode: 1, output: "", durationMs, error: String(err instanceof Error ? err.message : err) };
      }
    },
  };
}

function runClaudeCli(job: LaneJob, cliPath: string, started: number, timeoutMs: number): LaneResult {
  try {
    const result = spawnCli([cliPath, "-p", job.prompt!], {
      binaryName: cliPath,
      packageHint: "@anthropic-ai/claude-agent-sdk or the claude CLI",
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
}
