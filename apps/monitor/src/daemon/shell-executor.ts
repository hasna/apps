/**
 * Check executor for the daemon bin.
 *
 * Executes the slug's configured check commands as structured argv only
 * (MON-V2-01 CommandSpec: `{ executable, args }`) through Bun.spawn with an
 * argv array — never through a shell. Shell strings, `sh -c` mode, and shell
 * interpolation are not part of the v2 definition schema; a stored command
 * that is not a valid CommandSpec is refused with a check failure rather than
 * executed (the definition validation at registration is the primary gate;
 * this refusal is the defensive gate for revisions stored before the schema
 * applied).
 *
 * Output is size-bounded and reduced to a digest by the worker; full outputs
 * belong to the output-spool lane (MON-V2-13). Exit 0 is success, non-zero is
 * failure — the pass/fail predicates over outputs are the slug-schema lane's
 * concern.
 */

import type { Database } from "bun:sqlite";
import { getRevision, getRun } from "./core.js";
import type { ExecContext, ExecResult } from "./worker.js";
import { CommandSpecSchema, type CommandSpec } from "./definition-schema.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function truncate(s: string): string {
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes <= MAX_OUTPUT_BYTES) return s;
  const sliced = Buffer.from(s, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${sliced}\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
}

interface CheckDef {
  id?: string;
  command?: unknown;
}

export class CommandCheckExecutor {
  constructor(
    private readonly db: Database,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  /** Reads the run's immutable revision and runs its checks sequentially. */
  async execute(ctx: ExecContext): Promise<ExecResult> {
    const run = getRun(this.db, ctx.runId);
    const revision = run ? getRevision(this.db, run.revision_id) : null;
    let checks: CheckDef[] = [];
    if (revision) {
      try {
        const def = JSON.parse(revision.definition_json) as { checks?: CheckDef[] };
        checks = Array.isArray(def.checks) ? def.checks : [];
      } catch {
        checks = [];
      }
    }
    if (checks.length === 0) {
      return { exitCode: 0, stdout: "(no checks)" };
    }

    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let overallExit = 0;
    for (const check of checks) {
      const label = check.id ?? "check";
      const parsed = CommandSpecSchema.safeParse(check.command);
      if (!parsed.success) {
        // Never shell a stored command. A command that is not a CommandSpec
        // (a shell string, sh -c mode, interpolation) is refused.
        const reason = parsed.error.issues.map((i) => i.message).join("; ");
        stderrParts.push(
          `[${label}] refused: command is not a valid CommandSpec (shell strings, sh -c, and shell interpolation are not part of the v2 definition schema): ${reason}`
        );
        if (overallExit === 0) overallExit = 2;
        continue;
      }
      const result = await this.runOne(parsed.data);
      stdoutParts.push(`[${label} exit=${result.exitCode}]`);
      if (result.stdout) stdoutParts.push(result.stdout);
      if (result.stderr) stderrParts.push(`[${label}] ${result.stderr}`);
      if (result.exitCode !== 0 && overallExit === 0) overallExit = result.exitCode;
    }
    return {
      exitCode: overallExit,
      stdout: truncate(stdoutParts.join("\n")),
      stderr: truncate(stderrParts.join("\n")),
    };
  }

  /** Spawn one CommandSpec via argv with a bounded capture and per-command timeout. */
  private async runOne(command: CommandSpec): Promise<ExecResult> {
    const timeoutMs =
      typeof command.timeoutSeconds === "number"
        ? Math.max(1, command.timeoutSeconds) * 1000
        : this.timeoutMs;
    const proc = Bun.spawn([command.executable, ...command.args], {
      ...(command.cwd ? { cwd: command.cwd } : {}),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const killer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }, timeoutMs);
    let exitCode: number;
    try {
      exitCode = await proc.exited;
    } finally {
      clearTimeout(killer);
    }
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stdout: truncate(stdout), stderr: truncate(stderr) };
  }
}
