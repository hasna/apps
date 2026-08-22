// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { resetDatabase, getDatabase } from "./database.js";
import {
  createSessionJob,
  getSessionJob,
  listSessionJobs,
  updateSessionJob,
  getNextPendingJob,
  claimSessionJob,
  recoverStaleProcessingJobs,
} from "./session-jobs.js";

beforeEach(() => {
  resetDatabase();
  getDatabase(":memory:");
});

// ============================================================================
// getNextPendingJob — lines 201-208
// ============================================================================

describe("getNextPendingJob", () => {
  it("returns null when no pending jobs", () => {
    const result = getNextPendingJob();
    expect(result).toBeNull();
  });

  it("returns oldest pending job first", () => {
    const job1 = createSessionJob({ session_id: "s1", transcript: "first" });
    const job2 = createSessionJob({ session_id: "s2", transcript: "second" });

    const next = getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next!.session_id).toBe("s1");
  });

  it("skips processing/completed/failed jobs", () => {
    const job1 = createSessionJob({ session_id: "s1", transcript: "done" });
    updateSessionJob(job1.id, { status: "completed" });

    const job2 = createSessionJob({ session_id: "s2", transcript: "processing" });
    updateSessionJob(job2.id, { status: "processing" });

    const job3 = createSessionJob({ session_id: "s3", transcript: "fresh" });

    const next = getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next!.session_id).toBe("s3");
  });

  it("returns null when all jobs are non-pending", () => {
    const job = createSessionJob({ session_id: "s1", transcript: "done" });
    updateSessionJob(job.id, { status: "completed" });

    const next = getNextPendingJob();
    expect(next).toBeNull();
  });
});

// ============================================================================
// updateSessionJob edge cases — lines 138-139
// ============================================================================

describe("updateSessionJob - edge cases", () => {
  it("returns existing job when no updates provided", () => {
    const job = createSessionJob({ session_id: "s-edge", transcript: "test" });
    const updated = updateSessionJob(job.id, {});
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(job.id);
    expect(updated!.status).toBe("pending");
  });

  it("updates error field to null", () => {
    const job = createSessionJob({ session_id: "s-err", transcript: "test" });
    updateSessionJob(job.id, { status: "failed", error: "something went wrong" });

    // Now clear the error
    const cleared = updateSessionJob(job.id, { error: null });
    expect(cleared!.error).toBeNull();
  });

  it("updates started_at and completed_at timestamps", () => {
    const job = createSessionJob({ session_id: "s-ts", transcript: "test" });

    const started = "2025-03-01T10:00:00.000Z";
    const completed = "2025-03-01T10:05:00.000Z";

    const updated = updateSessionJob(job.id, {
      started_at: started,
      completed_at: completed,
    });

    expect(updated!.started_at).toBe(started);
    expect(updated!.completed_at).toBe(completed);
  });

  it("filters by session_id in listSessionJobs", () => {
    createSessionJob({ session_id: "sess-aaa", transcript: "t1" });
    createSessionJob({ session_id: "sess-bbb", transcript: "t2" });
    createSessionJob({ session_id: "sess-aaa", transcript: "t3" });

    const results = listSessionJobs({ session_id: "sess-aaa" });
    expect(results.length).toBe(2);
    expect(results.every((j) => j.session_id === "sess-aaa")).toBe(true);
  });

  it("respects offset in listSessionJobs", () => {
    for (let i = 0; i < 5; i++) {
      createSessionJob({ session_id: `s${i}`, transcript: `t${i}` });
    }

    const allJobs = listSessionJobs({ limit: 10 });
    const offsetJobs = listSessionJobs({ limit: 10, offset: 2 });

    expect(offsetJobs.length).toBe(3);
    expect(allJobs[2]!.id).toBe(offsetJobs[0]!.id);
  });
});

// ============================================================================
// claimSessionJob — atomic single-statement CAS claim
// ============================================================================

describe("claimSessionJob", () => {
  it("claims a pending job: returns 1 and marks processing with started_at", () => {
    const job = createSessionJob({ session_id: "s-claim", transcript: "pending" });

    const changes = claimSessionJob(job.id);

    expect(changes).toBe(1);
    const claimed = getSessionJob(job.id);
    expect(claimed!.status).toBe("processing");
    expect(claimed!.started_at).toBeTruthy();
  });

  it("returns 0 when the job is already processing (second concurrent claim)", () => {
    const job = createSessionJob({ session_id: "s-claim2", transcript: "pending" });
    expect(claimSessionJob(job.id)).toBe(1);

    const second = claimSessionJob(job.id);
    expect(second).toBe(0);
  });

  it("returns 0 when the job is completed or failed", () => {
    const done = createSessionJob({ session_id: "s-done", transcript: "done" });
    updateSessionJob(done.id, { status: "completed" });
    expect(claimSessionJob(done.id)).toBe(0);

    const failed = createSessionJob({ session_id: "s-failed", transcript: "failed" });
    updateSessionJob(failed.id, { status: "failed" });
    expect(claimSessionJob(failed.id)).toBe(0);
  });

  it("returns 0 for a nonexistent job", () => {
    expect(claimSessionJob("no-such-job")).toBe(0);
  });
});

// ============================================================================
// recoverStaleProcessingJobs — requeue crashed processors
// ============================================================================

describe("recoverStaleProcessingJobs", () => {
  it("resets a stale processing row to pending", () => {
    const job = createSessionJob({ session_id: "s-stale", transcript: "stale" });
    claimSessionJob(job.id);
    const staleStartedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    updateSessionJob(job.id, { started_at: staleStartedAt });

    const recovered = recoverStaleProcessingJobs(60 * 1000);

    expect(recovered).toBe(1);
    const after = getSessionJob(job.id);
    expect(after!.status).toBe("pending");
    expect(getNextPendingJob()!.id).toBe(job.id);
  });

  it("leaves a fresh processing row alone", () => {
    const job = createSessionJob({ session_id: "s-fresh", transcript: "fresh" });
    claimSessionJob(job.id);

    const recovered = recoverStaleProcessingJobs(60 * 1000);

    expect(recovered).toBe(0);
    expect(getSessionJob(job.id)!.status).toBe("processing");
  });

  it("returns the count of recovered rows only", () => {
    const stale = createSessionJob({ session_id: "s-stale2", transcript: "stale" });
    claimSessionJob(stale.id);
    updateSessionJob(stale.id, {
      started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    const fresh = createSessionJob({ session_id: "s-fresh2", transcript: "fresh" });
    claimSessionJob(fresh.id);

    const recovered = recoverStaleProcessingJobs(60 * 1000);

    expect(recovered).toBe(1);
    expect(getSessionJob(stale.id)!.status).toBe("pending");
    expect(getSessionJob(fresh.id)!.status).toBe("processing");
  });
});
