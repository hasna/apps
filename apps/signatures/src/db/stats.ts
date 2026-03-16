import { getDatabase } from "./database.js";
import type { Stats } from "../types/index.js";

export function getStats(): Stats {
  const db = getDatabase();

  const totalDocs = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM documents")
    .get()?.count ?? 0;

  const byStatus = db
    .query<{ status: string; count: number }, []>(
      "SELECT status, COUNT(*) as count FROM documents GROUP BY status"
    )
    .all()
    .reduce<Record<string, number>>((acc: Record<string, number>, row: { status: string; count: number }) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

  const totalSignatures = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM signatures")
    .get()?.count ?? 0;

  const totalProjects = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM projects")
    .get()?.count ?? 0;

  const totalCollections = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM collections")
    .get()?.count ?? 0;

  const totalTags = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tags")
    .get()?.count ?? 0;

  const totalPlacements = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM signature_placements")
    .get()?.count ?? 0;

  const totalSessions = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM signing_sessions")
    .get()?.count ?? 0;

  return {
    total_documents: totalDocs,
    by_status: byStatus,
    total_signatures: totalSignatures,
    total_projects: totalProjects,
    total_collections: totalCollections,
    total_tags: totalTags,
    total_placements: totalPlacements,
    total_sessions: totalSessions,
  };
}
