import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";

export interface BurndownData {
  total: number;
  completed: number;
  remaining: number;
  days: { date: string; completed_cumulative: number; ideal: number }[];
  chart: string; // ASCII art
}

export function getBurndown(opts: { plan_id?: string; project_id?: string; task_list_id?: string }, db?: Database): BurndownData {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.plan_id) { conditions.push("plan_id = ?"); params.push(opts.plan_id); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  if (opts.task_list_id) { conditions.push("task_list_id = ?"); params.push(opts.task_list_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (d.query(`SELECT COUNT(*) as c FROM tasks ${where}`).get(...params) as any).c;
  const completed = (d.query(`SELECT COUNT(*) as c FROM tasks ${where}${where ? " AND" : " WHERE"} status = 'completed'`).get(...params) as any).c;

  // Get completion dates
  const completions = d.query(
    `SELECT DATE(completed_at) as date, COUNT(*) as count FROM tasks ${where}${where ? " AND" : " WHERE"} status = 'completed' AND completed_at IS NOT NULL GROUP BY DATE(completed_at) ORDER BY date`
  ).all(...params) as { date: string; count: number }[];

  // Get date range
  const firstTask = d.query(`SELECT MIN(created_at) as min_date FROM tasks ${where}`).get(...params) as any;
  const startDate = firstTask?.min_date ? new Date(firstTask.min_date) : new Date();
  const endDate = new Date();

  // Build daily data
  const days: BurndownData["days"] = [];
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  let cumulative = 0;
  const completionMap = new Map(completions.map(c => [c.date, c.count]));

  const current = new Date(startDate);
  for (let i = 0; i <= totalDays; i++) {
    const dateStr = current.toISOString().slice(0, 10);
    cumulative += completionMap.get(dateStr) || 0;
    days.push({
      date: dateStr,
      completed_cumulative: cumulative,
      ideal: Math.round((total / totalDays) * i),
    });
    current.setDate(current.getDate() + 1);
  }

  // ASCII chart
  const chart = renderBurndownChart(total, days);

  return { total, completed, remaining: total - completed, days, chart };
}

function renderBurndownChart(total: number, days: BurndownData["days"]): string {
  const height = 12;
  const width = Math.min(60, days.length);
  const step = Math.max(1, Math.floor(days.length / width));

  // Sample days to fit width
  const sampled = days.filter((_, i) => i % step === 0 || i === days.length - 1).slice(0, width);

  const lines: string[] = [];
  lines.push(`  ${total} ┤`);

  for (let row = height - 1; row >= 0; row--) {
    const threshold = Math.round((total / height) * row);
    let line = "";
    for (const day of sampled) {
      const remaining = total - day.completed_cumulative;
      const idealRemaining = total - day.ideal;
      if (remaining >= threshold && remaining > threshold - Math.round(total / height)) {
        line += "█";
      } else if (idealRemaining >= threshold && idealRemaining > threshold - Math.round(total / height)) {
        line += "·";
      } else {
        line += " ";
      }
    }
    const label = String(threshold).padStart(4);
    lines.push(`${label} ┤${line}`);
  }

  lines.push(`   0 ┤${"─".repeat(sampled.length)}`);
  lines.push(`     └${"─".repeat(sampled.length)}`);

  // Date labels
  if (sampled.length > 0) {
    const first = sampled[0]!.date.slice(5);
    const last = sampled[sampled.length - 1]!.date.slice(5);
    const pad = sampled.length - first.length - last.length;
    lines.push(`      ${first}${" ".repeat(Math.max(1, pad))}${last}`);
  }

  lines.push("");
  lines.push(`  █ actual remaining  · ideal burndown`);

  return lines.join("\n");
}
