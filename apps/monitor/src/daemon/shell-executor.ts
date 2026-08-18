/**
 * Minimal shell executor for the daemon bin.
 *
 * Executes the slug's configured check commands with a bounded capture and a
 * per-check timeout. Output is size-bounded and reduced to a digest by the
 * worker; full outputs belong to the output-spool lane (MON-V2-13). Exit 0
 * is success, non-zero is failure — the pass/fail predicates over outputs
 * are the slug-schema lane's concern.
 */

import { execFile } from "node:child_process";
import type { Database } from "bun:sqlite";
import { getRevision, getRun } from "./core.js";
import type { ExecContext, ExecResult } from "./worker.js";

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
  command?: string;
}

export class ShellCheckExecutor {
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
      const command = check.command ?? "";
      if (!command) continue;
      const result = await this.runOne(command);
      stdoutParts.push(`[${check.id ?? "check"} exit=${result.exitCode}]`);
      if (result.stdout) stdoutParts.push(result.stdout);
      if (result.stderr) stderrParts.push(`[${check.id ?? "check"}] ${result.stderr}`);
      if (result.exitCode !== 0 && overallExit === 0) overallExit = result.exitCode;
    }
    return {
      exitCode: overallExit,
      stdout: truncate(stdoutParts.join("\n")),
      stderr: truncate(stderrParts.join("\n")),
    };
  }

  private runOne(command: string): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      execFile(
        "/bin/sh",
        ["-c", command],
        { timeout: this.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          const exitCode =
            error === null ? 0 : typeof (error as { code?: number }).code === "number"
              ? (error as { code?: number }).code!
              : 1;
          resolve({ exitCode, stdout: truncate(stdout), stderr: truncate(stderr) });
        }
      );
    });
  }
}
