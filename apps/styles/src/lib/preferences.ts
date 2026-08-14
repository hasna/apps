import { getDb } from "./db.js";

// ── Core preference operations ────────────────────────────────────────────────

/**
 * Get a preference value. Project scope takes precedence over global scope.
 * Returns null if the key does not exist in either scope.
 */
export function getPref(key: string, projectPath?: string): string | null {
  const db = getDb();

  // Project-scoped preference takes priority
  if (projectPath) {
    const row = db
      .prepare(
        "SELECT value FROM preferences WHERE key = ? AND scope = 'project' AND project_path = ?"
      )
      .get(key, projectPath) as { value: string } | null;
    if (row) return row.value;
  }

  // Fall back to global preference
  const global = db
    .prepare(
      "SELECT value FROM preferences WHERE key = ? AND scope = 'global' AND project_path IS NULL"
    )
    .get(key) as { value: string } | null;

  return global?.value ?? null;
}

/**
 * Set a preference. Uses UPSERT — safe to call repeatedly.
 */
export function setPref(
  key: string,
  value: string,
  scope: "global" | "project",
  projectPath?: string
): void {
  const db = getDb();
  const now = Date.now();

  if (scope === "project" && !projectPath) {
    throw new Error("projectPath is required when scope is 'project'");
  }

  db.run(
    `INSERT INTO preferences (id, key, value, scope, project_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key, scope, project_path) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [
      crypto.randomUUID(),
      key,
      value,
      scope,
      scope === "project" ? (projectPath ?? null) : null,
      now,
    ]
  );
}

/**
 * Delete a preference by key and scope.
 */
export function deletePref(
  key: string,
  scope: "global" | "project",
  projectPath?: string
): void {
  const db = getDb();

  if (scope === "project") {
    db.run(
      "DELETE FROM preferences WHERE key = ? AND scope = 'project' AND project_path = ?",
      [key, projectPath ?? null]
    );
  } else {
    db.run(
      "DELETE FROM preferences WHERE key = ? AND scope = 'global' AND project_path IS NULL",
      [key]
    );
  }
}

/**
 * List all preferences visible for a given context.
 * If projectPath is provided, returns both global prefs and project-scoped prefs.
 * Project prefs override global prefs in the result list (deduplicated by key).
 */
export function listPrefs(
  projectPath?: string
): Array<{ key: string; value: string; scope: string }> {
  const db = getDb();

  let rows: Array<{ key: string; value: string; scope: string }>;

  if (projectPath) {
    rows = db
      .prepare(
        `SELECT key, value, scope FROM preferences
         WHERE scope = 'global' AND project_path IS NULL
            OR (scope = 'project' AND project_path = ?)
         ORDER BY scope DESC, key ASC`
      )
      .all(projectPath) as Array<{ key: string; value: string; scope: string }>;
  } else {
    rows = db
      .prepare(
        "SELECT key, value, scope FROM preferences WHERE scope = 'global' AND project_path IS NULL ORDER BY key ASC"
      )
      .all() as Array<{ key: string; value: string; scope: string }>;
  }

  // Deduplicate: project-scope wins over global for same key
  const seen = new Map<string, { key: string; value: string; scope: string }>();
  for (const row of rows) {
    // Since we ordered scope DESC (project > global alphabetically), project comes first
    if (!seen.has(row.key)) {
      seen.set(row.key, row);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Batch-get multiple preference values. Returns a map of key → value (or null).
 */
export function getPrefs(
  keys: string[],
  projectPath?: string
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = getPref(key, projectPath);
  }
  return result;
}
