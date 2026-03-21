import type { Run, Result, Scenario } from "../types/index.js";
import { connectToTodos } from "./todos-connector.js";

// ─── Todos Integration ────────────────────────────────────────────────────────

/**
 * Auto-create a todo task for each failed scenario in a run.
 * Uses the todos DB directly (like todos-connector.ts does).
 * No-op if TODOS_DB_PATH is not set and ~/.todos/todos.db does not exist.
 * Controlled by TESTERS_TODOS_PROJECT_ID env var (which project to create tasks in).
 */
export async function createFailureTasks(
  run: Run,
  failedResults: Result[],
  scenarios: Scenario[],
): Promise<{ created: number; skipped: number }> {
  if (failedResults.length === 0) return { created: 0, skipped: 0 };

  const projectId = process.env["TESTERS_TODOS_PROJECT_ID"];
  if (!projectId) return { created: 0, skipped: 0 };

  let db: ReturnType<typeof connectToTodos> | null = null;
  try {
    db = connectToTodos();
  } catch {
    return { created: 0, skipped: 0 };
  }

  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  let created = 0;
  let skipped = 0;

  try {
    for (const result of failedResults) {
      const scenario = scenarioMap.get(result.scenarioId);
      const title = `BUG: [testers] ${scenario?.name ?? result.scenarioId} failed`;

      // Check for existing open task with same title to avoid duplicates
      const existing = db
        .query("SELECT id FROM tasks WHERE title = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1")
        .get(title) as { id: string } | null;

      if (existing) {
        skipped++;
        continue;
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const description = [
        `Test failure detected by open-testers.`,
        ``,
        `**Run:** ${run.id}`,
        `**URL:** ${run.url}`,
        `**Scenario:** ${scenario?.name ?? result.scenarioId}`,
        `**Status:** ${result.status}`,
        result.error ? `**Error:** ${result.error}` : null,
        result.reasoning ? `**Reasoning:** ${result.reasoning.slice(0, 500)}` : null,
        `**Duration:** ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : "N/A"}`,
        `**Tokens:** ${result.tokensUsed ?? 0}`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        db.query(`
          INSERT INTO tasks (id, short_id, title, description, status, priority, tags, project_id, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', 'high', ?, ?, 1, ?, ?)
        `).run(
          id,
          `BUG-${id.slice(0, 6)}`,
          title,
          description,
          JSON.stringify(["bug", "testers", "auto-created"]),
          projectId,
          now,
          now,
        );
        created++;
      } catch {
        skipped++;
      }
    }
  } finally {
    db.close();
  }

  return { created, skipped };
}

// ─── Conversations Integration ────────────────────────────────────────────────

/**
 * Post a failure notification to a conversations space.
 * Controlled by:
 *   TESTERS_CONVERSATIONS_URL  — base URL of the conversations service
 *   TESTERS_CONVERSATIONS_SPACE — space name/slug to post to
 * No-op if either env var is missing.
 */
export async function notifyFailureToConversations(
  run: Run,
  failedResults: Result[],
  scenarios: Scenario[],
): Promise<void> {
  const baseUrl = process.env["TESTERS_CONVERSATIONS_URL"];
  const space = process.env["TESTERS_CONVERSATIONS_SPACE"];
  if (!baseUrl || !space) return;

  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  const total = run.total;
  const failedCount = failedResults.length;
  const passedCount = run.passed;

  const failureLines = failedResults.slice(0, 5).map((r) => {
    const name = scenarioMap.get(r.scenarioId)?.name ?? r.scenarioId;
    const err = r.error ? ` — ${r.error.slice(0, 120)}` : "";
    return `  ❌ ${name}${err}`;
  });
  const extra = failedResults.length > 5 ? `  … and ${failedResults.length - 5} more` : "";

  const message = [
    `🚨 **Testers run failed** — ${failedCount}/${total} scenarios failed`,
    ``,
    `**URL:** ${run.url}`,
    `**Run ID:** \`${run.id}\``,
    `**Pass rate:** ${passedCount}/${total}`,
    ``,
    `**Failures:**`,
    ...failureLines,
    extra,
  ]
    .filter((l) => l !== "")
    .join("\n");

  try {
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/spaces/${encodeURIComponent(space)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, from: "testers" }),
    });
  } catch {
    // Never throw — notifications are optional
  }
}

// ─── Run Completion Notification ─────────────────────────────────────────────

/**
 * Post a run completion summary to a conversations space.
 * Called for ALL run completions (passed and failed).
 * Controlled by:
 *   TESTERS_CONVERSATIONS_URL   — base URL of the conversations service
 *   TESTERS_CONVERSATIONS_SPACE — space name/slug to post to
 * No-op if either env var is missing.
 */
export async function notifyRunToConversations(
  run: Run,
  results: Result[],
  options?: { spaceId?: string },
): Promise<void> {
  const baseUrl = process.env["TESTERS_CONVERSATIONS_URL"];
  const space = options?.spaceId ?? process.env["TESTERS_CONVERSATIONS_SPACE"];
  if (!baseUrl || !space) return;

  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(0) : "0";
  const statusIcon = run.status === "passed" ? "✅" : run.status === "failed" ? "❌" : "⚠️";
  const durationSec = run.finishedAt && run.startedAt
    ? ((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)
    : null;

  const lines: string[] = [
    `${statusIcon} **Testers run ${run.status.toUpperCase()}** — ${run.passed}/${run.total} scenarios (${passRate}% pass rate)`,
    ``,
    `**URL:** ${run.url}`,
    `**Run ID:** \`${run.id}\``,
    `**Model:** ${run.model}`,
    durationSec ? `**Duration:** ${durationSec}s` : null,
  ].filter((l): l is string => l !== null);

  if (run.status === "failed") {
    const failedResults = results.filter((r) => r.status === "failed" || r.status === "error");
    const failLines = failedResults.slice(0, 5).map((r) => {
      const err = r.error ? ` — ${r.error.slice(0, 100)}` : "";
      return `  ❌ ${r.scenarioId.slice(0, 8)}${err}`;
    });
    if (failLines.length > 0) {
      lines.push(``, `**Failures:**`);
      lines.push(...failLines);
      if (failedResults.length > 5) lines.push(`  … and ${failedResults.length - 5} more`);
    }
  }

  const message = lines.join("\n");

  try {
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/spaces/${encodeURIComponent(space)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, from: "testers" }),
    });
  } catch {
    // Never throw — notifications are optional
  }
}
