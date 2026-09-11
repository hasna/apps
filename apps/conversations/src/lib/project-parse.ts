// Pure row -> Project decoder shared by the API store and the projects domain
// library. Store-free so client bundles never reach `bun:sqlite` through it.
import type { Project } from "../types.js";

export function parseProject(row: Record<string, unknown>): Project {
  // Columns are JSON text (sqlite + the Postgres TEXT columns), but tolerate an
  // already-parsed value in case a transport hands back native JSON.
  const asObject = (v: unknown): Record<string, unknown> | null => {
    if (v == null) return null;
    if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v !== "string") return null;
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const metadata = asObject(row.metadata);

  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags as string[];
  } else if (typeof row.tags === "string" && row.tags) {
    try {
      const p = JSON.parse(row.tags);
      tags = Array.isArray(p) ? p : [];
    } catch {
      tags = [];
    }
  }

  const settings = asObject(row.settings);

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    path: (row.path as string) || null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    metadata,
    tags,
    status: (row.status as "active" | "archived") || "active",
    repository: (row.repository as string) || null,
    settings,
  };
}
