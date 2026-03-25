/**
 * Connector job scheduler.
 *
 * Checks enabled jobs against their cron expressions and runs them
 * when due. Runs in-process as part of `connectors serve`.
 *
 * Cron format: minute hour day month weekday (5-field standard)
 * Uses a lightweight cron matcher — no external dep needed.
 */

import { spawn } from "child_process";
import type { Database } from "../db/database.js";
import { listEnabledJobs, createJobRun, finishJobRun, touchJobLastRun, type ConnectorJob } from "../db/jobs.js";
import { maybeStrip } from "./strip.js";

/** Next cron fire time relative to a Date (simplified matcher) */
export function cronMatches(cron: string, d: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;

  function matches(field: string, value: number, min_v: number, max_v: number): boolean {
    if (field === "*") return true;
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2));
      return value % step === 0;
    }
    // ranges like 1-5
    if (field.includes("-")) {
      const [a, b] = field.split("-").map(Number);
      return value >= a && value <= b;
    }
    // lists like 1,3,5
    if (field.includes(",")) {
      return field.split(",").map(Number).includes(value);
    }
    return parseInt(field) === value;
  }

  return (
    matches(min, d.getMinutes(), 0, 59) &&
    matches(hour, d.getHours(), 0, 23) &&
    matches(dom, d.getDate(), 1, 31) &&
    matches(mon, d.getMonth() + 1, 1, 12) &&
    matches(dow, d.getDay(), 0, 6)
  );
}

/** Execute a connector command and return { exitCode, output } */
async function runConnectorCommand(
  connector: string,
  command: string,
  args: string[]
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const cmdArgs = [connector, command, ...args, "--format", "json"];
    const proc = spawn("connectors", ["run", ...cmdArgs], { shell: false });
    let output = "";
    proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
    proc.on("error", () => resolve({ exitCode: 1, output: `Failed to spawn connectors run` }));
    // Timeout after 60s
    setTimeout(() => { proc.kill(); resolve({ exitCode: 124, output: output + "\n[timeout]" }); }, 60_000);
  });
}

async function executeJob(job: ConnectorJob, db: Database): Promise<void> {
  const run = createJobRun(job.id, db);
  try {
    const { exitCode, output } = await runConnectorCommand(job.connector, job.command, job.args);
    const stripped = job.strip ? await maybeStrip(output) : undefined;
    finishJobRun(run.id, { exit_code: exitCode, raw_output: output, stripped_output: stripped }, db);
    touchJobLastRun(job.id, db);
  } catch (e) {
    finishJobRun(run.id, { exit_code: 1, raw_output: String(e) }, db);
  }
}

let _interval: ReturnType<typeof setInterval> | null = null;
// Track last check minute to avoid double-firing within same minute
let _lastCheckedMinute = -1;

/** Start the scheduler. Checks every 30s, fires jobs when cron matches. */
export function startScheduler(db: Database): void {
  if (_interval) return; // already running

  _interval = setInterval(async () => {
    const now = new Date();
    const currentMinute = now.getMinutes() + now.getHours() * 60;
    if (currentMinute === _lastCheckedMinute) return; // already fired this minute
    _lastCheckedMinute = currentMinute;

    const jobs = listEnabledJobs(db);
    for (const job of jobs) {
      if (cronMatches(job.cron, now)) {
        // Fire and forget — don't await (jobs run in background)
        executeJob(job, db).catch(() => {/* errors saved in job run */});
      }
    }
  }, 30_000); // check every 30 seconds
}

export function stopScheduler(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    _lastCheckedMinute = -1;
  }
}

/** Manually trigger a job by ID (for CLI 'connectors jobs run') */
export async function triggerJob(job: ConnectorJob, db: Database): Promise<{ run_id: string; exit_code: number; output: string }> {
  const run = createJobRun(job.id, db);
  const { exitCode, output } = await runConnectorCommand(job.connector, job.command, job.args);
  const stripped = job.strip ? await maybeStrip(output) : undefined;
  finishJobRun(run.id, { exit_code: exitCode, raw_output: output, stripped_output: stripped }, db);
  touchJobLastRun(job.id, db);
  return { run_id: run.id, exit_code: exitCode, output: stripped ?? output };
}
