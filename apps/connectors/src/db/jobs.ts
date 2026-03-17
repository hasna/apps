import type { Database } from "bun:sqlite";
import { getDatabase, now, shortUuid } from "./database.js";

export interface ConnectorJob {
  id: string;
  name: string;
  connector: string;
  command: string;
  args: string[];
  cron: string;
  enabled: boolean;
  strip: boolean;
  created_at: string;
  last_run_at: string | null;
}

export interface ConnectorJobRun {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  raw_output: string | null;
  stripped_output: string | null;
}

interface JobRow {
  id: string; name: string; connector: string; command: string;
  args: string; cron: string; enabled: number; strip: number;
  created_at: string; last_run_at: string | null;
}

function rowToJob(row: JobRow): ConnectorJob {
  return {
    ...row,
    args: JSON.parse(row.args || "[]") as string[],
    enabled: row.enabled === 1,
    strip: row.strip === 1,
  };
}

export function createJob(
  input: { name: string; connector: string; command: string; args?: string[]; cron: string; strip?: boolean },
  db?: Database
): ConnectorJob {
  const d = db ?? getDatabase();
  const id = shortUuid();
  const ts = now();
  d.run(
    "INSERT INTO connector_jobs (id, name, connector, command, args, cron, enabled, strip, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.name, input.connector, input.command, JSON.stringify(input.args ?? []), input.cron, input.strip ? 1 : 0, ts]
  );
  return getJob(id, d)!;
}

export function getJob(id: string, db?: Database): ConnectorJob | null {
  const d = db ?? getDatabase();
  const row = d.query("SELECT * FROM connector_jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
}

export function getJobByName(name: string, db?: Database): ConnectorJob | null {
  const d = db ?? getDatabase();
  const row = d.query("SELECT * FROM connector_jobs WHERE name = ?").get(name) as JobRow | null;
  return row ? rowToJob(row) : null;
}

export function listJobs(db?: Database): ConnectorJob[] {
  const d = db ?? getDatabase();
  return (d.query("SELECT * FROM connector_jobs ORDER BY name").all() as JobRow[]).map(rowToJob);
}

export function listEnabledJobs(db?: Database): ConnectorJob[] {
  const d = db ?? getDatabase();
  return (d.query("SELECT * FROM connector_jobs WHERE enabled = 1").all() as JobRow[]).map(rowToJob);
}

export function updateJob(
  id: string,
  input: Partial<{ name: string; connector: string; command: string; args: string[]; cron: string; enabled: boolean; strip: boolean }>,
  db?: Database
): ConnectorJob {
  const d = db ?? getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.connector !== undefined) { sets.push("connector = ?"); params.push(input.connector); }
  if (input.command !== undefined) { sets.push("command = ?"); params.push(input.command); }
  if (input.args !== undefined) { sets.push("args = ?"); params.push(JSON.stringify(input.args)); }
  if (input.cron !== undefined) { sets.push("cron = ?"); params.push(input.cron); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(input.enabled ? 1 : 0); }
  if (input.strip !== undefined) { sets.push("strip = ?"); params.push(input.strip ? 1 : 0); }
  if (sets.length === 0) return getJob(id, d)!;
  params.push(id);
  d.run(`UPDATE connector_jobs SET ${sets.join(", ")} WHERE id = ?`, params as Parameters<typeof d.run>[1]);
  return getJob(id, d)!;
}

export function deleteJob(id: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM connector_jobs WHERE id = ?", [id]).changes > 0;
}

export function touchJobLastRun(id: string, db?: Database): void {
  const d = db ?? getDatabase();
  d.run("UPDATE connector_jobs SET last_run_at = ? WHERE id = ?", [now(), id]);
}

// ── Job Runs ──────────────────────────────────────────────────────────────────

export function createJobRun(jobId: string, db?: Database): ConnectorJobRun {
  const d = db ?? getDatabase();
  const id = shortUuid();
  const ts = now();
  d.run("INSERT INTO connector_job_runs (id, job_id, started_at) VALUES (?, ?, ?)", [id, jobId, ts]);
  return { id, job_id: jobId, started_at: ts, finished_at: null, exit_code: null, raw_output: null, stripped_output: null };
}

export function finishJobRun(
  id: string,
  result: { exit_code: number; raw_output: string; stripped_output?: string },
  db?: Database
): void {
  const d = db ?? getDatabase();
  d.run(
    "UPDATE connector_job_runs SET finished_at = ?, exit_code = ?, raw_output = ?, stripped_output = ? WHERE id = ?",
    [now(), result.exit_code, result.raw_output, result.stripped_output ?? null, id]
  );
}

export function getLatestRun(jobId: string, db?: Database): ConnectorJobRun | null {
  const d = db ?? getDatabase();
  return d.query("SELECT * FROM connector_job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1").get(jobId) as ConnectorJobRun | null;
}

export function listJobRuns(jobId: string, limit = 20, db?: Database): ConnectorJobRun[] {
  const d = db ?? getDatabase();
  return d.query("SELECT * FROM connector_job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?").all(jobId, limit) as ConnectorJobRun[];
}
