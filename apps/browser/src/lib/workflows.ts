/**
 * Saved workflows — reusable browser automation sequences with self-healing.
 * Record a flow once, replay it forever. If selectors change, auto-heal and update.
 */

import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/schema.js";
import type { Page } from "playwright";
import type { RecordingStep } from "../types/index.js";
import { healSelector } from "./self-heal.js";

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  steps: RecordingStep[];
  start_url: string | null;
  last_run: string | null;
  last_heal: string | null;
  heal_count: number;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunResult {
  success: boolean;
  steps_executed: number;
  steps_failed: number;
  steps_healed: number;
  healed_details: Array<{ step: number; original: string; healed_to: string; method: string }>;
  errors: string[];
  duration_ms: number;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function saveWorkflow(data: { name: string; description?: string; steps: RecordingStep[]; startUrl?: string }): Workflow {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    "INSERT OR REPLACE INTO workflows (id, name, description, steps, start_url) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.name, data.description ?? null, JSON.stringify(data.steps), data.startUrl ?? null);
  return getWorkflow(id)!;
}

export function saveWorkflowFromRecording(recordingId: string, name: string, description?: string): Workflow {
  const db = getDatabase();
  const rec = db.query<{ steps: string; start_url: string | null }, string>(
    "SELECT steps, start_url FROM recordings WHERE id = ?"
  ).get(recordingId);
  if (!rec) throw new Error(`Recording not found: ${recordingId}`);
  const steps = JSON.parse(rec.steps) as RecordingStep[];
  return saveWorkflow({ name, description, steps, startUrl: rec.start_url ?? undefined });
}

export function getWorkflow(id: string): Workflow | null {
  const db = getDatabase();
  const row = db.query<any, string>("SELECT * FROM workflows WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, steps: JSON.parse(row.steps) };
}

export function getWorkflowByName(name: string): Workflow | null {
  const db = getDatabase();
  const row = db.query<any, string>("SELECT * FROM workflows WHERE name = ?").get(name);
  if (!row) return null;
  return { ...row, steps: JSON.parse(row.steps) };
}

export function listWorkflows(): Workflow[] {
  const db = getDatabase();
  return db.query<any, []>("SELECT * FROM workflows ORDER BY updated_at DESC").all()
    .map((row: any) => ({ ...row, steps: JSON.parse(row.steps) }));
}

export function deleteWorkflow(name: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM workflows WHERE name = ?").run(name).changes > 0;
}

function updateWorkflowSteps(id: string, steps: RecordingStep[]): void {
  const db = getDatabase();
  db.prepare("UPDATE workflows SET steps = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(steps), id);
}

function recordRun(id: string, healed: boolean): void {
  const db = getDatabase();
  if (healed) {
    db.prepare("UPDATE workflows SET last_run = datetime('now'), last_heal = datetime('now'), heal_count = heal_count + 1, run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE workflows SET last_run = datetime('now'), run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  }
}

// ─── Replay with self-healing ────────────────────────────────────────────────

export async function runWorkflow(workflow: Workflow, page: Page): Promise<WorkflowRunResult> {
  const t0 = Date.now();
  let executed = 0;
  let failed = 0;
  let healed = 0;
  const healedDetails: WorkflowRunResult["healed_details"] = [];
  const errors: string[] = [];
  const updatedSteps = [...workflow.steps];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    try {
      switch (step.type) {
        case "navigate":
          if (step.url) await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          break;
        case "click":
          if (step.selector) {
            try {
              await page.click(step.selector, { timeout: 5000 });
            } catch {
              // Self-heal
              const result = await healSelector(page, step.selector);
              if (result.found && result.locator) {
                await result.locator.click();
                healed++;
                const healedSelector = `[healed:${result.method}]${step.selector}`;
                healedDetails.push({ step: i, original: step.selector, healed_to: healedSelector, method: result.method });
              } else {
                throw new Error(`Click failed: ${step.selector} (self-healing exhausted)`);
              }
            }
          }
          break;
        case "type":
          if (step.selector && step.value) {
            try {
              await page.fill(step.selector, step.value);
            } catch {
              const result = await healSelector(page, step.selector);
              if (result.found && result.locator) {
                await result.locator.fill(step.value);
                healed++;
                healedDetails.push({ step: i, original: step.selector, healed_to: `[healed:${result.method}]`, method: result.method });
              } else {
                throw new Error(`Type failed: ${step.selector} (self-healing exhausted)`);
              }
            }
          }
          break;
        case "scroll":
          if (step.y) await page.mouse.wheel(0, step.y);
          break;
        case "hover":
          if (step.selector) {
            try { await page.hover(step.selector); } catch {}
          }
          break;
        case "select":
          if (step.selector && step.value) {
            try { await page.selectOption(step.selector, step.value); } catch {}
          }
          break;
        case "wait":
          if (step.selector) {
            try { await page.waitForSelector(step.selector, { timeout: 10000 }); } catch {}
          } else {
            await new Promise(r => setTimeout(r, step.timestamp || 1000));
          }
          break;
        case "evaluate":
          if (step.value) await page.evaluate(step.value);
          break;
        default:
          break;
      }
      executed++;
    } catch (err) {
      failed++;
      errors.push(`Step ${i} (${step.type}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Record the run
  recordRun(workflow.id, healed > 0);

  return {
    success: failed === 0,
    steps_executed: executed,
    steps_failed: failed,
    steps_healed: healed,
    healed_details: healedDetails,
    errors,
    duration_ms: Date.now() - t0,
  };
}
