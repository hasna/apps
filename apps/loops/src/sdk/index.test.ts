import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { LoopsClient } from "./index.js";

describe("loops sdk", () => {
  test("runNow records pid and heartbeats so daemon ticks do not duplicate due work", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    const root = mkdtempSync(join(tmpdir(), "loops-sdk-runnow-"));
    const marker = join(root, "marker");
    try {
      const loop = client.create({
        name: "manual-due-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
        leaseMs: 50,
        maxAttempts: 2,
        retryDelayMs: 1,
        overlap: "allow",
      });
      const running = client.runNow(loop.id);
      for (let i = 0; i < 100; i++) {
        const run = store.listRuns({ loopId: loop.id, status: "running", limit: 1 })[0];
        if (run?.pid !== undefined) break;
        await Bun.sleep(10);
      }
      const active = store.listRuns({ loopId: loop.id, status: "running", limit: 1 })[0];
      expect(loop.nextRunAt).toBeDefined();
      expect(active?.scheduledFor).toBe(loop.nextRunAt!);
      expect(active?.pid).toBeDefined();
      await Bun.sleep(120);
      const tickResult = await tick({
        store,
        runnerId: "daemon",
        now: () => new Date(),
      });
      expect(tickResult.completed).toHaveLength(0);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
      const run = await running;
      expect(run.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.status).toBe("stopped");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
