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
