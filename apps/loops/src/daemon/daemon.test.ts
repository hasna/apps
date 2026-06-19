import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";
import { runDaemon } from "./daemon.js";

describe("daemon", () => {
  test("executes workflow loop targets from the daemon tick path", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-"));
    const store = new Store(":memory:");
    let stopped = false;
    try {
      const workflow = store.createWorkflow({
        name: "daemon-workflow",
        steps: [{ id: "step", target: { type: "command", command: "printf daemon-workflow", shell: true } }],
      });
      store.createLoop({
        name: "daemon-workflow-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });

      await runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        sleep: async () => {
          if (store.listWorkflowRuns({ workflowId: workflow.id }).length > 0) stopped = true;
        },
        shouldStop: () => stopped,
        log: () => undefined,
      });

      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      expect(run?.status).toBe("succeeded");
      expect(store.listWorkflowStepRuns(run!.id)[0]?.stdout).toContain("daemon-workflow");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aborts active workflow children on daemon stop", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-stop-"));
    const marker = join(root, "late-write");
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      const workflow = store.createWorkflow({
        name: "daemon-stop-workflow",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      store.createLoop({
        name: "daemon-stop-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        signal: controller.signal,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => controller.signal.aborted,
        log: () => undefined,
      });
      let runId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        if (run && store.getWorkflowStepRun(run.id, "slow")?.status === "running") {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
      expect(runId).toBeDefined();
      controller.abort();
      await daemon;
      await Bun.sleep(1_100);
      expect(store.requireWorkflowRun(runId!).status).toBe("failed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
