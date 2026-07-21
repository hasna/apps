import { describe, expect, test } from "bun:test";
import { AmbiguousNameError, RunFinalizationConflictError } from "../errors.js";
import { SqliteLoopStorage, createSqliteLoopStorage } from "./sqlite.js";

describe("SqliteLoopStorage", () => {
  test("wraps the existing Store with the async storage contract", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    try {
      expect(storage).toBeInstanceOf(SqliteLoopStorage);
      expect(storage.backend).toBe("sqlite");
      expect(storage.supportsRemoteRunners).toBe(false);

      const loop = await storage.createLoop(
        {
          name: "async-contract-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const first = await storage.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-a");
      const duplicate = await storage.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-b");

      expect(first?.run.status).toBe("running");
      expect(first?.run.claimedBy).toBe("runner-a");
      expect(first?.claimToken).toBeString();
      expect(duplicate).toBeUndefined();
      expect(await storage.heartbeatRunLease(
        first!.run.id,
        "runner-a",
        1_000,
        new Date("2026-01-01T00:00:00.100Z"),
      )).toBeUndefined();
      expect(await storage.heartbeatRunLease(first!.run.id, "runner-a", 1_000, new Date("2026-01-01T00:00:00.100Z"), { claimToken: "wrong" })).toBeUndefined();
      expect(
        await storage.heartbeatRunLease(first!.run.id, "runner-a", 1_000, new Date("2026-01-01T00:00:00.100Z"), {
          claimToken: first!.claimToken,
        }),
      ).toMatchObject({ id: first!.run.id, status: "running" });
      await expect(storage.finalizeRun(
        first!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:00.500Z",
          durationMs: 500,
          stdout: "",
          stderr: "",
        },
        { claimedBy: "runner-a", claimToken: "wrong", now: new Date("2026-01-01T00:00:00.200Z") },
      )).rejects.toMatchObject({
        reason: "stale_claim",
        code: "RUN_FINALIZATION_CONFLICT",
      } satisfies Partial<RunFinalizationConflictError>);
      await expect(storage.finalizeRun(
        first!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:00.500Z",
          durationMs: 500,
          stdout: "",
          stderr: "",
        },
        { claimedBy: "runner-a", now: new Date("2026-01-01T00:00:00.200Z") },
      )).rejects.toMatchObject({
        reason: "stale_claim",
        code: "RUN_FINALIZATION_CONFLICT",
      } satisfies Partial<RunFinalizationConflictError>);
      expect(await storage.getRun(first!.run.id)).toMatchObject({ id: first!.run.id, status: "running" });

      const finalized = await storage.finalizeRun(first!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1000,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }, { claimedBy: "runner-a", claimToken: first!.claimToken, now: new Date("2026-01-01T00:00:00.200Z") });
      expect(finalized?.status).toBe("succeeded");
      expect(await storage.countRuns("succeeded")).toBe(1);
    } finally {
      await storage.close();
    }
  });

  test("same-runner reclaim fences stale and tokenless local work", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    try {
      const claimedAt = new Date("2026-01-01T00:00:00.000Z");
      const reclaimedAt = new Date("2026-01-01T00:00:00.020Z");
      const loop = await storage.createLoop({
        name: "sqlite-same-runner-reclaim",
        schedule: { type: "once", at: claimedAt.toISOString() },
        target: { type: "command", command: "true" },
        leaseMs: 10,
      }, claimedAt);
      const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", claimedAt);
      const second = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", reclaimedAt);
      expect(first?.claimToken).toBeString();
      expect(second?.claimToken).toBeString();
      expect(second?.claimToken).not.toBe(first?.claimToken);

      expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 })).toBeUndefined();
      expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 }, { claimToken: first!.claimToken })).toBeUndefined();
      expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 }, { claimToken: second!.claimToken })).toMatchObject({
        id: second!.run.id,
        pid: 4242,
      });
      expect(await storage.heartbeatRunLease(
        second!.run.id,
        "runner-a",
        1_000,
        new Date("2026-01-01T00:00:00.021Z"),
      )).toBeUndefined();
      expect(await storage.heartbeatRunLease(
        second!.run.id,
        "runner-a",
        1_000,
        new Date("2026-01-01T00:00:00.021Z"),
        { claimToken: first!.claimToken },
      )).toBeUndefined();
      expect(await storage.heartbeatRunLease(
        second!.run.id,
        "runner-a",
        1_000,
        new Date("2026-01-01T00:00:00.021Z"),
        { claimToken: second!.claimToken },
      )).toMatchObject({ id: second!.run.id, status: "running" });

      const patch = {
        status: "succeeded" as const,
        finishedAt: "2026-01-01T00:00:00.030Z",
        durationMs: 10,
        stdout: "",
        stderr: "",
      };
      await expect(storage.finalizeRun(second!.run.id, patch, {
        claimedBy: "runner-a",
        now: new Date("2026-01-01T00:00:00.030Z"),
      })).rejects.toMatchObject({ reason: "stale_claim" });
      await expect(storage.finalizeRun(second!.run.id, patch, {
        claimedBy: "runner-a",
        claimToken: first!.claimToken,
        now: new Date("2026-01-01T00:00:00.030Z"),
      })).rejects.toMatchObject({ reason: "stale_claim" });
      expect(await storage.finalizeRun(second!.run.id, patch, {
        claimedBy: "runner-a",
        claimToken: second!.claimToken,
        now: new Date("2026-01-01T00:00:00.030Z"),
      })).toMatchObject({ status: "succeeded" });
    } finally {
      await storage.close();
    }
  });

  test("recovered lease snapshot excludes concurrent rows inside the ordering bounds", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    try {
      const recoveredRun = async (id: string) => {
        const loop = await storage.createLoop({
          name: `sqlite-recovered-snapshot-${id}`,
          schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
          target: { type: "command", command: "true" },
        });
        return {
        id,
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor: "2026-01-01T00:00:00.000Z",
        attempt: 1,
        status: "abandoned" as const,
        finishedAt: "2026-01-01T00:01:00.000Z",
        error: "run lease expired before completion",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        };
      };
      await storage.upsertMigrationRun(await recoveredRun("a"));
      const middle = await recoveredRun("m");
      await storage.upsertMigrationRun({
        ...middle,
        status: "failed",
        error: "not recovered yet",
      });
      await storage.upsertMigrationRun(await recoveredRun("z"));

      const first = await storage.listRecoveredLeaseRunsPage({ limit: 1 });
      expect(first.runs.map((run) => run.id)).toEqual(["a"]);
      expect(first.snapshot?.map((entry) => entry.id)).toEqual(["a", "z"]);
      expect(first.nextOffset).toBe(1);

      await storage.upsertMigrationRun(middle, { replace: true });
      await storage.upsertMigrationRun(await recoveredRun("n"));
      const second = await storage.listRecoveredLeaseRunsPage({
        limit: 1,
        snapshot: first.snapshot,
        offset: first.nextOffset,
      });
      expect(second.runs.map((run) => run.id)).toEqual(["z"]);
      expect(second.runs.map((run) => run.id)).not.toContain("m");
      expect(second.runs.map((run) => run.id)).not.toContain("n");
      expect(second.nextOffset).toBeUndefined();
    } finally {
      await storage.close();
    }
  });

  test("recovered lease paging advances across a concurrently changed empty slice", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    try {
      const rows = [];
      for (const id of ["a", "m", "z"]) {
        const loop = await storage.createLoop({
          name: `sqlite-recovered-empty-slice-${id}`,
          schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
          target: { type: "command", command: "true" },
        });
        const run = {
          id: `empty-slice-${id}`,
          loopId: loop.id,
          loopName: loop.name,
          scheduledFor: "2026-01-01T00:00:00.000Z",
          attempt: 1,
          status: "abandoned" as const,
          finishedAt: "2026-01-01T00:01:00.000Z",
          error: "run lease expired before completion",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        };
        rows.push(run);
        await storage.upsertMigrationRun(run);
      }

      const first = await storage.listRecoveredLeaseRunsPage({ limit: 1 });
      expect(first.runs.map((run) => run.id)).toEqual(["empty-slice-a"]);
      await storage.upsertMigrationRun({
        ...rows[1]!,
        status: "failed",
        error: "reclaimed by a newer transition",
        updatedAt: "2026-01-01T00:01:00.100Z",
      }, { replace: true });
      const empty = await storage.listRecoveredLeaseRunsPage({
        limit: 1,
        snapshot: first.snapshot,
        offset: first.nextOffset,
      });
      expect(empty.runs).toEqual([]);
      expect(empty.nextOffset).toBe(2);
      const last = await storage.listRecoveredLeaseRunsPage({
        limit: 1,
        snapshot: first.snapshot,
        offset: empty.nextOffset,
      });
      expect(last.runs.map((run) => run.id)).toEqual(["empty-slice-z"]);
      expect(last.nextOffset).toBeUndefined();
    } finally {
      await storage.close();
    }
  });

  test("delegates unique archive resolution without mutating ambiguous rows", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    try {
      const input = {
        name: "sqlite-archive-ambiguous",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
        target: { type: "command", command: "true" } as const,
      };
      const first = await storage.createLoop(input, new Date("2025-12-31T00:00:00Z"));
      const second = await storage.createLoop(input, new Date("2025-12-31T00:00:01Z"));

      await expect(storage.requireUniqueLoop(input.name)).rejects.toBeInstanceOf(AmbiguousNameError);
      await expect(storage.archiveLoop(input.name)).rejects.toBeInstanceOf(AmbiguousNameError);
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();

      expect((await storage.archiveLoop(first.id)).id).toBe(first.id);
      expect((await storage.archiveLoop(input.name)).id).toBe(second.id);
      await expect(storage.unarchiveLoop(input.name)).rejects.toBeInstanceOf(AmbiguousNameError);
      expect((await storage.getLoop(first.id))?.archivedAt).toBeString();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();

      expect((await storage.unarchiveLoop(first.id)).id).toBe(first.id);
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();
      expect((await storage.unarchiveLoop(input.name)).id).toBe(second.id);
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();
    } finally {
      await storage.close();
    }
  });
});
