/**
 * Background queue for session memory job processing.
 * Polls for pending jobs every 5 seconds, processes one at a time (concurrency=1).
 * Fire-and-forget: enqueueSessionJob() returns immediately, processing happens async.
 */

import { getDatabase } from "../db/database.js";
import { getNextPendingJob, recoverStaleProcessingJobs } from "../db/session-jobs.js";
import { processSessionJob } from "./session-processor.js";
import { isApiMode, apiJson } from "../db/api-mode.js";
import { isServerContext } from "../storage.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

// ============================================================================
// Internal state
// ============================================================================

/** IDs of jobs currently queued but not yet picked up by the worker */
const _pendingQueue = new Set<string>();
let _isProcessing = false;
let _workerStarted = false;

// ============================================================================
// Exported functions
// ============================================================================

/**
 * Enqueue a job ID for processing. Fire-and-forget.
 * The background worker will pick it up within the next polling interval.
 */
export function enqueueSessionJob(jobId: string): void {
  // Hosted transport: the queue lives on the server. POST /v1/sessions/ingest
  // already enqueued this job there, and a client has no store to poll — the
  // in-process worker below would only try to open local SQLite. Do nothing
  // rather than start a doomed local drain.
  if (!isServerContext() && isApiMode()) return;
  _pendingQueue.add(jobId);
  // If worker is not running, kick off immediate processing
  if (!_isProcessing) {
    void _processNext();
  }
}

/**
 * Get in-memory queue stats.
 * Note: pending/completed/failed counts come from DB when a full scan is needed;
 * this returns a lightweight in-memory snapshot.
 */
export function getSessionQueueStats(): SessionQueueStats {
  if (!isServerContext() && isApiMode()) {
    const { data } = apiJson<SessionQueueStats>("GET", "/sessions/queue/stats");
    return {
      pending: data?.pending ?? 0,
      processing: data?.processing ?? 0,
      completed: data?.completed ?? 0,
      failed: data?.failed ?? 0,
    };
  }
  try {
    const db = getDatabase();
    const rows = db
      .query(
        "SELECT status, COUNT(*) as count FROM session_memory_jobs GROUP BY status"
      )
      .all() as { status: string; count: number }[];
    const stats: SessionQueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of rows) {
      if (row.status === "pending") stats.pending = row.count;
      else if (row.status === "processing") stats.processing = row.count;
      else if (row.status === "completed") stats.completed = row.count;
      else if (row.status === "failed") stats.failed = row.count;
    }
    return stats;
  } catch {
    return {
      pending: _pendingQueue.size,
      processing: _isProcessing ? 1 : 0,
      completed: 0,
      failed: 0,
    };
  }
}

/**
 * Start the background polling worker.
 * Idempotent — safe to call multiple times (only starts once).
 */
export function startSessionQueueWorker(): void {
  if (_workerStarted) return;
  // The worker drains jobs straight out of the store; only the server process
  // holds one. A client under a hosted credential must never start it (the
  // poll would hit the fail-closed getDatabase() guard every 5 seconds).
  if (!isServerContext() && isApiMode()) return;
  _workerStarted = true;

  // Poll for pending jobs every 5 seconds
  setInterval(() => {
    // Requeue jobs stranded in `processing` by a crashed processor (claimed
    // more than 30 minutes ago) so they re-enter the queue. Best-effort: a
    // recovery failure must never stop the poll.
    try {
      recoverStaleProcessingJobs(30 * 60 * 1000);
    } catch {
      // Non-fatal
    }
    void _processNext();
  }, 5000);
}

// ============================================================================
// Internal processing
// ============================================================================

async function _processNext(): Promise<void> {
  if (_isProcessing) return;

  // Try in-memory queue first, then DB
  let jobId: string | undefined;

  if (_pendingQueue.size > 0) {
    jobId = [..._pendingQueue][0]!;
    _pendingQueue.delete(jobId);
  } else {
    // Fall back to DB query for any pending job (e.g. after restart)
    try {
      const job = getNextPendingJob();
      if (job) jobId = job.id;
    } catch {
      return;
    }
  }

  if (!jobId) return;

  _isProcessing = true;
  try {
    await processSessionJob(jobId);
  } catch {
    // processSessionJob never throws — this is a safety net
  } finally {
    _isProcessing = false;
    // Check if there are more jobs to process
    if (_pendingQueue.size > 0) {
      void _processNext();
    }
  }
}
