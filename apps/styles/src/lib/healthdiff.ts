import { getDb } from "./db.js";
import type { FileViolation } from "./health.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealthDiffResult {
  previous: { score: number; violations: number; runAt: number } | null;
  current: { score: number; violations: number; runAt: number } | null;
  delta: { score: number; violations: number } | null;
  resolved: string[]; // violation messages in prev but not current
  introduced: string[]; // violation messages in current but not prev
  trend: "improving" | "worsening" | "unchanged" | "no-data";
}

interface HealthCheckRow {
  id: string;
  score: number;
  status: string;
  run_at: number;
  violations: string;
}

// ── Helper: make a stable key for a violation ─────────────────────────────────

function violationKey(v: FileViolation): string {
  return `${v.filePath}:${v.rule}`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function getHealthDiff(projectPath: string): HealthDiffResult {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, score, status, run_at, violations
       FROM health_checks
       WHERE project_path = ?
       ORDER BY run_at DESC
       LIMIT 2`
    )
    .all(projectPath) as HealthCheckRow[];

  if (rows.length < 2) {
    return {
      previous: null,
      current: null,
      delta: null,
      resolved: [],
      introduced: [],
      trend: "no-data",
    };
  }

  // rows[0] = newest (current), rows[1] = older (previous)
  const currentRow = rows[0];
  const previousRow = rows[1];

  let currentViolations: FileViolation[] = [];
  let previousViolations: FileViolation[] = [];

  try {
    currentViolations = JSON.parse(currentRow.violations) as FileViolation[];
  } catch {
    currentViolations = [];
  }

  try {
    previousViolations = JSON.parse(previousRow.violations) as FileViolation[];
  } catch {
    previousViolations = [];
  }

  // Build sets of violation keys for comparison
  const currentKeys = new Set(currentViolations.map(violationKey));
  const previousKeys = new Set(previousViolations.map(violationKey));

  // resolved = in previous but NOT in current
  const resolved: string[] = previousViolations
    .filter((v) => !currentKeys.has(violationKey(v)))
    .map((v) => v.message);

  // introduced = in current but NOT in previous
  const introduced: string[] = currentViolations
    .filter((v) => !previousKeys.has(violationKey(v)))
    .map((v) => v.message);

  const scoreDelta = currentRow.score - previousRow.score;
  const violationsDelta = currentViolations.length - previousViolations.length;

  let trend: HealthDiffResult["trend"];
  if (scoreDelta > 0) {
    trend = "improving";
  } else if (scoreDelta < 0) {
    trend = "worsening";
  } else {
    trend = "unchanged";
  }

  return {
    previous: {
      score: previousRow.score,
      violations: previousViolations.length,
      runAt: previousRow.run_at,
    },
    current: {
      score: currentRow.score,
      violations: currentViolations.length,
      runAt: currentRow.run_at,
    },
    delta: {
      score: scoreDelta,
      violations: violationsDelta,
    },
    resolved,
    introduced,
    trend,
  };
}
