/**
 * Memory ratings — usefulness feedback for memories.
 *
 * `memory_rate` fed the usefulness signal every agent is instructed to produce
 * into a per-station SQLite table, so it never reached the shared store and the
 * ratio a station reported was its own keystrokes. The hosted arms below route
 * the write and the read to `/v1/memories/{id}/ratings`.
 */

import { SqliteAdapter as Database } from "../storage.js";
import { getDatabase, uuid, now } from "./database.js";
import { isApiMode, apiJson } from "./api-mode.js";

// ============================================================================
// Types
// ============================================================================

export interface MemoryRating {
  id: string;
  memory_id: string;
  agent_id: string | null;
  useful: boolean;
  context: string | null;
  created_at: string;
}

export interface RatingsSummary {
  memory_id: string;
  total: number;
  useful_count: number;
  not_useful_count: number;
  usefulness_ratio: number;
}

// ============================================================================
// Create
// ============================================================================

export function rateMemory(
  memoryId: string,
  useful: boolean,
  agentId?: string,
  context?: string,
  db?: Database
): MemoryRating {
  if (!db && isApiMode()) {
    const { data } = apiJson<{ rating: MemoryRating }>(
      "POST",
      `/memories/${encodeURIComponent(memoryId)}/ratings`,
      { useful, agent_id: agentId, context },
    );
    if (!data?.rating) {
      // Feedback that was not recorded must never read as recorded: a
      // success-shaped object with no rating would let the CLI print "Rated"
      // while the store holds nothing.
      throw new Error(
        `mementos cloud POST /memories/${memoryId}/ratings returned a malformed 2xx response (no rating) — the feedback was not recorded`,
      );
    }
    return data.rating;
  }
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO memory_ratings (id, memory_id, agent_id, useful, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, memoryId, agentId || null, useful ? 1 : 0, context || null, timestamp]
  );

  return {
    id,
    memory_id: memoryId,
    agent_id: agentId || null,
    useful,
    context: context || null,
    created_at: timestamp,
  };
}

// ============================================================================
// Read
// ============================================================================

export function listRatingsForMemory(
  memoryId: string,
  db?: Database
): MemoryRating[] {
  if (!db && isApiMode()) {
    const { data } = apiJson<{ ratings: MemoryRating[] }>(
      "GET",
      `/memories/${encodeURIComponent(memoryId)}/ratings`,
    );
    return data?.ratings ?? [];
  }
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM memory_ratings WHERE memory_id = ? ORDER BY created_at DESC")
    .all(memoryId) as Record<string, unknown>[];

  return rows.map(parseRatingRow);
}

export function getRatingsSummary(
  memoryId: string,
  db?: Database
): RatingsSummary {
  if (!db && isApiMode()) {
    const { data } = apiJson<{ summary: RatingsSummary }>(
      "GET",
      `/memories/${encodeURIComponent(memoryId)}/ratings`,
    );
    return (
      data?.summary ?? {
        memory_id: memoryId,
        total: 0,
        useful_count: 0,
        not_useful_count: 0,
        usefulness_ratio: 0,
      }
    );
  }
  const d = db || getDatabase();
  const rows = d
    .query("SELECT useful, COUNT(*) as cnt FROM memory_ratings WHERE memory_id = ? GROUP BY useful")
    .all(memoryId) as { useful: number; cnt: number }[];

  let usefulCount = 0;
  let notUsefulCount = 0;
  for (const row of rows) {
    if (row.useful) usefulCount = row.cnt;
    else notUsefulCount = row.cnt;
  }
  const total = usefulCount + notUsefulCount;

  return {
    memory_id: memoryId,
    total,
    useful_count: usefulCount,
    not_useful_count: notUsefulCount,
    usefulness_ratio: total > 0 ? usefulCount / total : 0,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function parseRatingRow(row: Record<string, unknown>): MemoryRating {
  return {
    id: row["id"] as string,
    memory_id: row["memory_id"] as string,
    agent_id: (row["agent_id"] as string) || null,
    useful: !!(row["useful"] as number),
    context: (row["context"] as string) || null,
    created_at: row["created_at"] as string,
  };
}
