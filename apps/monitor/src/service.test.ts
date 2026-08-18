import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "./db/client.js";
import { MonitorService } from "./service.js";
import type { DefineResult, ErrorResult } from "./service.js";

/**
 * MON-V2-05 service-level tests: slug lifecycle state machine, epochs,
 * idempotency, and finite drain semantics.
 */

let dir: string;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

function makeService(): MonitorService {
  dir = mkdtempSync(join(tmpdir(), "monitor-v2-svc-"));
  const db = new Database(join(dir, "monitor.db"), { create: true });
  runMigrations(db);
  return new MonitorService(db);
}

function expectDefine(result: DefineResult | ErrorResult): DefineResult {
  if (!result.accepted) {
    throw new Error(`expected accepted define, got ${JSON.stringify(result)}`);
  }
  return result as DefineResult;
}

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "svc-slug",
    description: "service fixture",
    cadence: { type: "interval", seconds: 60 },
    execution: {
      timeoutSeconds: 30,
      maxConcurrency: 1,
      overlap: "skip",
      maxAttempts: 2,
      retryBackoffSeconds: [5],
      retryOn: ["failed"],
    },
    checks: [
      {
        id: "c1",
        command: { executable: "/bin/true", args: [], timeoutSeconds: 10 },
      },
    ],
    ...overrides,
  };
}

describe("MonitorService slug lifecycle", () => {
  it("define creates revision 1 and an idempotent re-define is a no-op", () => {
    const svc = makeService();
    const first = expectDefine(svc.define("svc-slug", definition()));
    expect(first.revision).toBe(1);
    expect(first.changed).toBe(true);

    const second = expectDefine(svc.define("svc-slug", definition()));
    expect(second.revision).toBe(1);
    expect(second.changed).toBe(false);
  });

  it("define with changed content creates a new revision and keeps history", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    const updated = expectDefine(
      svc.define("svc-slug", definition({ description: "changed description" }))
    );
    expect(updated.revision).toBe(2);

    const described = svc.describe("svc-slug");
    expect(described).not.toBeNull();
    expect(described!.revision).toBe(2);
    const rolls = expectDefine(svc.rollback("svc-slug", 1));
    expect(rolls.revision).toBe(3);
    expect(svc.describe("svc-slug")!.revision).toBe(3);
  });

  it("start transitions stopped -> running and bumps the execution epoch once", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    const started = svc.start("svc-slug", {});
    expect(started.accepted).toBe(true);
    expect(started.code).toBe("started");
    expect(started.state).toBe("running");
    expect(started.execution_proven).toBe(false);
    expect(started.run_id).toBeNull();

    const status = svc.status("svc-slug");
    expect(status).not.toBeNull();
    expect(status!.execution_epoch).toBe(1);
  });

  it("repeated start returns already_running and does not bump the epoch", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", {});
    const again = svc.start("svc-slug", {});
    expect(again.code).toBe("already_running");
    expect(svc.status("svc-slug")!.execution_epoch).toBe(1);
  });

  it("repeating an idempotency key replays the original control result", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    const first = svc.start("svc-slug", { idempotencyKey: "k-1" });
    const replay = svc.start("svc-slug", { idempotencyKey: "k-1" });
    expect(replay.code).toBe("idempotent_replay");
    expect(replay.state).toBe(first.state);
    expect(replay.revision).toBe(first.revision);
  });

  it("stop transitions to draining; repeated stop is already_stopped", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", {});
    const stopped = svc.stop("svc-slug", {});
    expect(stopped.accepted).toBe(true);
    expect(stopped.state).toBe("draining");
    expect(stopped.execution_proven).toBe(false);

    const again = svc.stop("svc-slug", {});
    expect(again.code).toBe("already_stopped");
  });

  it("stop --wait returns drain_pending after a finite timeout when runs cannot drain", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", {});
    svc.start("svc-slug", { nextCadence: true });

    const started = Date.now();
    const result = svc.stop("svc-slug", { wait: true, timeoutMs: 300 });
    const elapsed = Date.now() - started;

    expect(result.code).toBe("drain_pending");
    expect(result.state).toBe("draining");
    expect((result as { pending_runs?: number }).pending_runs).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
  });

  it("restart resumes a draining slug into running without a new slug identity", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", {});
    svc.stop("svc-slug", {});
    const restarted = svc.restart("svc-slug", {});
    expect(restarted.accepted).toBe(true);
    expect(restarted.state).toBe("running");
    expect(restarted.execution_proven).toBe(false);
    expect(restarted.slug).toBe("svc-slug");
    expect(svc.status("svc-slug")!.desired_state).toBe("running");
  });

  it("cancel stops queued runs with terminal receipts and bumps the epoch", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", { nextCadence: true });
    const before = svc.status("svc-slug")!;
    const cancelled = svc.stop("svc-slug", { cancel: true });
    expect(cancelled.accepted).toBe(true);
    expect(cancelled.state).toBe("stopped");
    expect(svc.status("svc-slug")!.execution_epoch).toBe(before.execution_epoch + 1);

    const receipts = svc.receipts("svc-slug", {});
    expect(receipts.entries.length).toBe(1);
    expect(receipts.entries[0]?.reason).toBe("cancelled_before_claim");
  });

  it("admitted runs stay non-terminal without an execution plane and receipts stay empty", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    svc.start("svc-slug", { nextCadence: true });
    const runs = svc.runs("svc-slug", {});
    expect(runs.entries.length).toBe(1);
    expect(runs.entries[0]?.state).toBe("admitted");
    expect(svc.receipts("svc-slug", {}).entries.length).toBe(0);
  });

  it("status reports execution_proven:false until a terminal receipt exists", () => {
    const svc = makeService();
    svc.define("svc-slug", definition());
    const status = svc.status("svc-slug");
    expect(status).not.toBeNull();
    expect(status!.execution_proven).toBe(false);
    expect(typeof status!.queue_depth).toBe("number");
  });

  it("validate rejects invalid names and shell-shaped commands", () => {
    const svc = makeService();
    const badName = svc.validate(definition({ name: "Bad Name" }));
    expect(badName.valid).toBe(false);
    expect(badName.errors.join(" ")).toContain("name");

    const badShell = svc.validate(
      definition({
        checks: [
          {
            id: "c1",
            command: { executable: "sh", args: ["-c", "echo hi"], timeoutSeconds: 10 },
          },
        ],
      })
    );
    expect(badShell.valid).toBe(false);
    expect(badShell.errors.join(" ")).toMatch(/shell/i);
  });
});
