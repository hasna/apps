/**
 * codex lane adapter — @openai/codex-sdk.
 *
 * `new Codex({ config, env })` -> `thread.run(prompt)` -> `Turn` whose
 * `finalResponse` is the completed agent output. CLI fallback: `codex exec`.
 */
import {
  type LaneAdapter,
  type LaneJob,
  type LaneResult,
  LaneAdapterShapeError,
  LaneDependencyMissingError,
  withTimeout,
  spawnCli,
  DEFAULT_LANE_TIMEOUT_MS,
} from "./types.js";

export interface CodexAdapterDeps {
  sdkLoader?: () => Promise<unknown>;
  cliPath?: string;
}

interface CodexLike {
  startThread?: (options?: unknown) => { run: (input: unknown, opts?: unknown) => Promise<{ finalResponse?: string }> };
}

export function createCodexAdapter(deps: CodexAdapterDeps = {}): LaneAdapter {
  return {
    kind: "codex",
    async run(job: LaneJob): Promise<LaneResult> {
      if (!job.prompt) {
        return { ok: false, exitCode: 2, output: "", durationMs: 0, error: "codex lane requires a prompt" };
      }
      const started = Date.now();
      const timeoutMs = job.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
      const loader = deps.sdkLoader ?? (async () => (await import("@openai/codex-sdk")) as unknown);
      let sdk: unknown;
      try {
        sdk = await loader();
      } catch {
        return runCodexCli(job, deps.cliPath ?? "codex", started, timeoutMs);
      }
      const CodexClass = (sdk as Record<string, unknown>).Codex;
      if (typeof CodexClass !== "function") {
        throw new LaneAdapterShapeError("@openai/codex-sdk exports no Codex class");
      }
      try {
        const client = await withTimeout(
          Promise.resolve(
            new (CodexClass as new (options?: unknown) => CodexLike)({
              config: { model: job.model },
              env: job.env,
            }),
          ),
          timeoutMs,
          `codex lane (${job.prompt.slice(0, 60)})`,
        );
        const thread = client.startThread?.();
        if (!thread || typeof thread.run !== "function") {
          throw new LaneAdapterShapeError("@openai/codex-sdk Codex.startThread() returned no run()");
        }
        const turn = await withTimeout(thread.run(job.prompt), timeoutMs, `codex lane (${job.prompt.slice(0, 60)})`);
        const output = turn?.finalResponse ?? "";
        const durationMs = Date.now() - started;
        return { ok: true, exitCode: 0, output, durationMs };
      } catch (err) {
        const durationMs = Date.now() - started;
        return { ok: false, exitCode: 1, output: "", durationMs, error: String(err instanceof Error ? err.message : err) };
      }
    },
  };
}

function runCodexCli(job: LaneJob, cliPath: string, started: number, timeoutMs: number): LaneResult {
  try {
    const result = spawnCli([cliPath, "exec", "--", job.prompt!], {
      binaryName: cliPath,
      packageHint: "@openai/codex-sdk or the codex CLI",
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
