/**
 * cursor lane adapter — @cursor/sdk, LOCAL mode (owner spec 2026-08-25).
 *
 * `new Cursor(...)` -> `Agent` -> `agent.send(prompt, options)` -> `Run`
 * whose `.result` is the final text and `.status` one of
 * finished | error | cancelled. CLI fallback: `cursor-agent`.
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

export interface CursorAdapterDeps {
  sdkLoader?: () => Promise<unknown>;
  cliPath?: string;
}

interface RunLike {
  status?: string;
  result?: string;
}

export function createCursorAdapter(deps: CursorAdapterDeps = {}): LaneAdapter {
  return {
    kind: "cursor",
    async run(job: LaneJob): Promise<LaneResult> {
      if (!job.prompt) {
        return { ok: false, exitCode: 2, output: "", durationMs: 0, error: "cursor lane requires a prompt" };
      }
      const started = Date.now();
      const timeoutMs = job.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
      const loader = deps.sdkLoader ?? (async () => (await import("@cursor/sdk")) as unknown);
      let sdk: unknown;
      try {
        sdk = await loader();
      } catch {
        return runCursorCli(job, deps.cliPath ?? "cursor-agent", started, timeoutMs);
      }
      try {
        const run = await withTimeout(
          runLocalAgent(sdk, job),
          timeoutMs,
          `cursor lane (${job.prompt.slice(0, 60)})`,
        );
        const durationMs = Date.now() - started;
        const status = run?.status ?? "finished";
        const ok = status === "finished";
        return { ok, exitCode: ok ? 0 : 1, output: run?.result ?? "", durationMs };
      } catch (err) {
        const durationMs = Date.now() - started;
        return { ok: false, exitCode: 1, output: "", durationMs, error: String(err instanceof Error ? err.message : err) };
      }
    },
  };
}

/** Drive the cursor SDK's local agent: Agent.send + wait for a terminal run. */
async function runLocalAgent(sdk: unknown, job: LaneJob): Promise<RunLike> {
  const AgentClass = (sdk as Record<string, unknown>).Agent;
  const CursorClass = (sdk as Record<string, unknown>).Cursor;
  if (typeof AgentClass !== "function" && typeof CursorClass !== "function") {
    throw new LaneAdapterShapeError("@cursor/sdk exports no Agent/Cursor class");
  }
  // local mode: construct an Agent directly with no cloud options
  const agent = typeof AgentClass === "function" ? new (AgentClass as new (opts?: unknown) => { send: (m: string, o?: unknown) => Promise<RunLike> })() : undefined;
  if (!agent || typeof agent.send !== "function") {
    throw new LaneAdapterShapeError("@cursor/sdk Agent has no send()");
  }
  const run = await agent.send(job.prompt!, { model: job.model });
  if (!run || typeof run !== "object") {
    throw new LaneAdapterShapeError("@cursor/sdk Agent.send() returned no Run");
  }
  return run;
}

function runCursorCli(job: LaneJob, cliPath: string, started: number, timeoutMs: number): LaneResult {
  try {
    const result = spawnCli([cliPath, "run", job.prompt!], {
      binaryName: cliPath,
      packageHint: "@cursor/sdk (local mode) or the cursor-agent CLI",
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
