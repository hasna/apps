import { basename } from "path";
import { getDb } from "./db.js";
import type { FileViolation } from "./health.js";

export interface CreatedTask {
  taskId: string;
  title: string;
  filePath: string;
  severity: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function severityToPriority(severity: string): string {
  switch (severity) {
    case "critical":
      return "high";
    case "warning":
      return "medium";
    case "info":
    default:
      return "low";
  }
}

async function isTodosAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "todos"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function spawnTodosAdd(
  title: string,
  description: string,
  priority: string
): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["todos", "add", title, "--description", description, "--priority", priority],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    const out = await new Response(proc.stdout).text();

    // Try to extract task ID from output like "Created task: T-123" or "id: abc"
    const idMatch = out.match(/(?:id|task)[\s:]+([A-Za-z0-9_-]+)/i);
    return idMatch ? idMatch[1] : `task-${Date.now()}`;
  } catch {
    return null;
  }
}

// ── Group violations by file ──────────────────────────────────────────────────

interface ViolationGroup {
  filePath: string;
  violations: FileViolation[];
  worstSeverity: "critical" | "warning" | "info";
}

function groupByFile(violations: FileViolation[]): ViolationGroup[] {
  const map = new Map<string, FileViolation[]>();
  for (const v of violations) {
    const existing = map.get(v.filePath) ?? [];
    existing.push(v);
    map.set(v.filePath, existing);
  }

  const groups: ViolationGroup[] = [];
  for (const [filePath, viols] of map.entries()) {
    const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
    const worstSeverity = viols.reduce(
      (worst, v) =>
        severityOrder[v.severity] < severityOrder[worst] ? v.severity : worst,
      "info" as "critical" | "warning" | "info"
    );
    groups.push({ filePath, violations: viols, worstSeverity });
  }

  // Sort: critical first, then warning, then info
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return groups.sort((a, b) => order[a.worstSeverity] - order[b.worstSeverity]);
}

// ── Check if violation already has a task ────────────────────────────────────

function hasExistingTask(
  checkId: string,
  filePath: string,
  rule: string
): boolean {
  const db = getDb();
  const row = db
    .query(
      `SELECT auto_task_id FROM health_violations
       WHERE check_id = ? AND file_path = ? AND rule = ? AND auto_task_id IS NOT NULL`
    )
    .get(checkId, filePath, rule) as { auto_task_id: string } | null;

  return Boolean(row?.auto_task_id);
}

function setTaskIdOnViolation(
  checkId: string,
  filePath: string,
  rule: string,
  taskId: string
): void {
  const db = getDb();
  db.run(
    `UPDATE health_violations SET auto_task_id = ?
     WHERE check_id = ? AND file_path = ? AND rule = ?`,
    [taskId, checkId, filePath, rule]
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function createTasksFromViolations(
  violations: FileViolation[],
  projectPath: string,
  projectId?: string
): Promise<CreatedTask[]> {
  if (violations.length === 0) return [];

  const todosAvailable = await isTodosAvailable();
  const groups = groupByFile(violations);
  const created: CreatedTask[] = [];

  // We need a checkId to look up health_violations.
  // We'll use the most recent health check for this project.
  const db = getDb();
  const latestCheck = db
    .query(
      "SELECT id FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1"
    )
    .get(projectPath) as { id: string } | null;

  const checkId = latestCheck?.id ?? "";

  for (const group of groups) {
    const fileName = basename(group.filePath);
    const priority = severityToPriority(group.worstSeverity);

    // Build a consolidated title and description for all violations in the file
    const ruleNames = [...new Set(group.violations.map((v) => v.rule))].join(
      ", "
    );
    const title = `Fix: style violations in ${fileName} (${ruleNames})`;

    const descLines = [
      `Style violations detected in \`${group.filePath}\`:`,
      "",
      ...group.violations.map(
        (v) =>
          `- [${v.severity.toUpperCase()}] Rule \`${v.rule}\`: ${v.message}`
      ),
      "",
      `Project: ${projectPath}`,
      projectId ? `Project ID: ${projectId}` : "",
    ].filter((l) => l !== null);

    const description = descLines.join("\n");

    // Check if any of the violations already have tasks
    const anyAlreadyTracked = group.violations.some((v) =>
      checkId ? hasExistingTask(checkId, v.filePath, v.rule) : false
    );

    if (anyAlreadyTracked) continue;

    let taskId: string;

    if (todosAvailable) {
      const spawnedId = await spawnTodosAdd(title, description, priority);
      taskId = spawnedId ?? `fallback-${crypto.randomUUID().slice(0, 8)}`;
    } else {
      // No todos CLI: generate a synthetic task ID for tracking purposes
      taskId = `style-task-${crypto.randomUUID().slice(0, 8)}`;
    }

    // Record the task ID on all violations in the group
    if (checkId) {
      for (const v of group.violations) {
        setTaskIdOnViolation(checkId, v.filePath, v.rule, taskId);
      }
    }

    created.push({
      taskId,
      title,
      filePath: group.filePath,
      severity: group.worstSeverity,
    });
  }

  return created;
}
