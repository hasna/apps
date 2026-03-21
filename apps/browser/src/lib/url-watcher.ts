/**
 * browser_watch_url — poll a URL for content changes, store diffs.
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { getDatabase } from "../db/schema.js";

function ensureWatchTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_jobs (
      id         TEXT PRIMARY KEY,
      name       TEXT,
      url        TEXT NOT NULL,
      schedule   TEXT NOT NULL,
      selector   TEXT,
      extract_schema TEXT,
      last_hash  TEXT,
      last_content TEXT,
      last_check TEXT,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS watch_events (
      id         TEXT PRIMARY KEY,
      watch_id   TEXT NOT NULL REFERENCES watch_jobs(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL,
      changed    INTEGER NOT NULL DEFAULT 0,
      old_content TEXT,
      new_content TEXT,
      diff_summary TEXT
    );
  `);
}

export interface WatchJob {
  id: string;
  name?: string;
  url: string;
  schedule: string;
  selector?: string;
  last_check?: string;
  enabled: boolean;
  created_at: string;
}

export interface WatchEvent {
  id: string;
  watch_id: string;
  checked_at: string;
  changed: boolean;
  old_content?: string;
  new_content?: string;
  diff_summary?: string;
}

const activeWatchHandles = new Map<string, { stop: () => void }>();

export function createWatchJob(
  url: string,
  schedule: string,
  opts?: { name?: string; selector?: string; extractSchema?: Record<string, string> }
): WatchJob {
  ensureWatchTables();
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO watch_jobs (id, name, url, schedule, selector, extract_schema, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(id, opts?.name ?? null, url, schedule, opts?.selector ?? null,
         opts?.extractSchema ? JSON.stringify(opts.extractSchema) : null);

  const job = getWatchJob(id)!;
  registerWatchJob(job);
  return job;
}

export function getWatchJob(id: string): WatchJob | null {
  ensureWatchTables();
  const db = getDatabase();
  const row = db.query<any, string>("SELECT * FROM watch_jobs WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, enabled: row.enabled === 1 };
}

export function listWatchJobs(): WatchJob[] {
  ensureWatchTables();
  const db = getDatabase();
  return db.query<any, []>("SELECT * FROM watch_jobs ORDER BY created_at DESC").all()
    .map(r => ({ ...r, enabled: r.enabled === 1 }));
}

export function deleteWatchJob(id: string): boolean {
  ensureWatchTables();
  const db = getDatabase();
  unregisterWatchJob(id);
  return db.prepare("DELETE FROM watch_jobs WHERE id = ?").run(id).changes > 0;
}

export function getWatchEvents(watchId: string, limit = 20): WatchEvent[] {
  ensureWatchTables();
  const db = getDatabase();
  return db.query<any, [string, number]>(
    "SELECT * FROM watch_events WHERE watch_id = ? ORDER BY checked_at DESC LIMIT ?"
  ).all(watchId, limit).map(r => ({ ...r, changed: r.changed === 1 }));
}

async function checkWatchJob(job: WatchJob): Promise<WatchEvent> {
  ensureWatchTables();
  const db = getDatabase();
  const eventId = randomUUID();
  const checkedAt = new Date().toISOString();

  let newContent = "";
  try {
    const { createSession, closeSession } = await import("./session.js");
    const { session, page } = await createSession({ engine: "auto", headless: true, startUrl: job.url });

    await new Promise(r => setTimeout(r, 1000)); // let page load

    if (job.selector) {
      newContent = await page.evaluate(
        `document.querySelector(${JSON.stringify(job.selector)})?.textContent?.trim() ?? ""`
      ) as string;
    } else {
      newContent = await page.evaluate("document.body.innerText.slice(0, 5000)") as string;
    }
    await closeSession(session.id);
  } catch (err) {
    newContent = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }

  const newHash = createHash("md5").update(newContent).digest("hex");
  const oldRow = db.query<any, string>("SELECT last_hash, last_content FROM watch_jobs WHERE id = ?").get(job.id);
  const oldHash = oldRow?.last_hash;
  const oldContent = oldRow?.last_content ?? "";
  const changed = !!oldHash && oldHash !== newHash;

  // Update job state
  db.prepare("UPDATE watch_jobs SET last_hash = ?, last_content = ?, last_check = ? WHERE id = ?")
    .run(newHash, newContent.slice(0, 2000), checkedAt, job.id);

  // Create event
  const diffSummary = changed
    ? `Content changed at ${checkedAt}`
    : "No change";

  db.prepare(`
    INSERT INTO watch_events (id, watch_id, checked_at, changed, old_content, new_content, diff_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, job.id, checkedAt, changed ? 1 : 0,
         changed ? oldContent.slice(0, 500) : null,
         changed ? newContent.slice(0, 500) : null,
         diffSummary);

  return { id: eventId, watch_id: job.id, checked_at: checkedAt, changed, old_content: oldContent, new_content: newContent, diff_summary: diffSummary };
}

function registerWatchJob(job: WatchJob): void {
  if (!job.enabled) return;
  const BunCron = (globalThis as any).Bun?.cron;
  if (!BunCron) return;

  try {
    unregisterWatchJob(job.id);
    const handle = BunCron(job.schedule, async () => {
      await checkWatchJob(job).catch(console.error);
    });
    if (handle?.stop) activeWatchHandles.set(job.id, handle);
  } catch {}
}

function unregisterWatchJob(id: string): void {
  const handle = activeWatchHandles.get(id);
  if (handle) { try { handle.stop(); } catch {} activeWatchHandles.delete(id); }
}

export function loadWatchJobsOnStartup(): void {
  try {
    const jobs = listWatchJobs();
    for (const job of jobs) { if (job.enabled) registerWatchJob(job); }
  } catch {}
}
