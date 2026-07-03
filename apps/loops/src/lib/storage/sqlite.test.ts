import { describe, expect, test } from "bun:test";
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
      expect(duplicate).toBeUndefined();

      const finalized = await storage.finalizeRun(first!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1000,
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
      expect(finalized?.status).toBe("succeeded");
      expect(await storage.countRuns("succeeded")).toBe(1);
    } finally {
      await storage.close();
    }
  });
});
