import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/client.js";
import {
  MonitorService,
  type ControlResult,
  type DefineResult,
  type ErrorResult,
  type SlugStatus,
} from "../service.js";
import { MonitorStore } from "./store.js";
import { definitionDigest, validateDefinition } from "./definition.js";

/**
 * MON-V2-05 remediation regression suite (PR #492 cycle 1).
 *
 * Covers the P1 blocker classes from the adversarial review:
 *   slug identity binding, create-only semantics, idempotency scoping,
 *   restart epoch fencing, drain proof, observed-vs-desired status,
 *   canonical digests, cron validation, env-shell bypass, bulk cancel.
 */

function makeDefinition(
  name: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name,
    description: "monitor-v2 unit fixture",
    tags: ["fixture"],
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

let db: Database;
let store: MonitorStore;
let svc: MonitorService;

function defineOk(name: string, overrides: Record<string, unknown> = {}): DefineResult {
  const r = svc.define(name, makeDefinition(name, overrides));
  if (r.accepted !== true) throw new Error(`define failed: ${JSON.stringify(r)}`);
  return r;
}

function controlOk(r: ControlResult | ErrorResult): ControlResult {
  if (r.accepted !== true) throw new Error(`control failed: ${JSON.stringify(r)}`);
  return r;
}

beforeAll(() => {
  db = new Database(":memory:");
  runMigrations(db);
  store = new MonitorStore(db);
  svc = new MonitorService(db);
});

afterAll(() => {
  db.close();
});

describe("slug identity is validated and bound to the definition", () => {
  it("define rejects a slug name that does not match the slug pattern", () => {
    const r = svc.define("Bad Name", makeDefinition("bad-name"));
    expect(r.accepted).toBe(false);
    expect((r as ErrorResult).error).toMatch(/invalid slug name/i);
  });

  it("define rejects a definition whose name does not match the slug", () => {
    const r = svc.define("heartbeat-check", makeDefinition("other-slug"));
    expect(r.accepted).toBe(false);
    expect((r as ErrorResult).error).toMatch(/does not match slug/i);
  });

  it("define accepts a definition whose name matches the slug", () => {
    const r = svc.define("heartbeat-check", makeDefinition("heartbeat-check"));
    expect(r.accepted).toBe(true);
  });
});

describe("slug create is create-only", () => {
  it("create (createOnly) fails when the slug already exists", () => {
    const existing = defineOk("create-only-slug");
    expect(existing.code).toBe("defined");
    const again = svc.define("create-only-slug", makeDefinition("create-only-slug"), {
      createOnly: true,
    });
    expect(again.accepted).toBe(false);
    expect((again as ErrorResult).error).toMatch(/already exists/i);
  });

  it("define without createOnly still updates an existing slug", () => {
    const changed = svc.define(
      "create-only-slug",
      makeDefinition("create-only-slug", { description: "changed" })
    );
    expect(changed.accepted).toBe(true);
    expect((changed as DefineResult).code).toBe("updated");
  });
});

describe("idempotency keys are scoped by operation and request", () => {
  it("a key used for start does not replay for stop", () => {
    const key = "scoped-key-1";
    const started = controlOk(svc.start("heartbeat-check", { idempotencyKey: key }));
    expect(started.code).not.toBe("idempotent_replay");

    const stopped = controlOk(svc.stop("heartbeat-check", { idempotencyKey: key }));
    expect(stopped.code).not.toBe("idempotent_replay");
    expect(stopped.state).toBe("draining");

    const stoppedAgain = controlOk(svc.stop("heartbeat-check", { idempotencyKey: key }));
    expect(stoppedAgain.code).toBe("idempotent_replay");
    expect(stoppedAgain.state).toBe("draining");
  });

  it("reusing a key for a different request of the same operation is rejected", () => {
    const key = "scoped-key-2";
    const first = controlOk(svc.start("heartbeat-check", { idempotencyKey: key }));
    expect(first.code).not.toBe("idempotent_replay");

    const conflict = svc.start("heartbeat-check", {
      idempotencyKey: key,
      nextCadence: true,
    });
    expect(conflict.accepted).toBe(false);
    expect((conflict as ErrorResult).error).toMatch(/different start request/i);
  });
});

describe("restart fences the running execution epoch", () => {
  it("restart while running returns restarted and bumps the epoch", () => {
    defineOk("restart-fence-slug");
    const before = controlOk(svc.start("restart-fence-slug", {}));
    expect(before.code).toBe("started");
    const epochBefore = svc.describe("restart-fence-slug")?.execution_epoch ?? 0;

    const restarted = controlOk(svc.restart("restart-fence-slug", {}));
    expect(restarted.code).toBe("restarted");
    expect(restarted.state).toBe("running");

    const epochAfter = svc.describe("restart-fence-slug")?.execution_epoch ?? 0;
    expect(epochAfter).toBe(epochBefore + 1);
  });

  it("restart honors --cancel while running (queued work is cancelled)", () => {
    const slug = store.getSlugByName("restart-fence-slug")!;
    const rev = store.getActiveRevision(slug.id)!;
    store.insertRun(
      slug.id,
      rev.id,
      "restart-cancel-admit",
      slug.execution_epoch,
      Math.floor(Date.now() / 1000)
    );
    const restarted = controlOk(svc.restart("restart-fence-slug", { cancel: true }));
    expect(restarted.code).toBe("restarted");
    expect(store.countNonTerminalRuns(slug.id)).toBe(0);
  });

  it("restart --wait times out with drain_pending instead of claiming a restart", () => {
    const slug = store.getSlugByName("restart-fence-slug")!;
    const rev = store.getActiveRevision(slug.id)!;
    store.insertRun(
      slug.id,
      rev.id,
      "restart-wait-admit",
      slug.execution_epoch,
      Math.floor(Date.now() / 1000)
    );
    const r = controlOk(svc.restart("restart-fence-slug", { wait: true, timeoutMs: 300 }));
    expect(r.code).toBe("drain_pending");
    expect(r.execution_proven).toBe(false);
    expect(r.pending_runs).toBeGreaterThan(0);
  });
});

describe("drain claims execution proof only on an observed terminal receipt", () => {
  it("stop --wait with zero pending and no receipt returns drained with execution_proven:false", () => {
    // start a fresh slug; nothing has ever executed (no receipts)
    defineOk("drain-proof-slug");
    const start = controlOk(svc.start("drain-proof-slug", {}));
    expect(start.code).toBe("started");

    const drained = controlOk(
      svc.stop("drain-proof-slug", { wait: true, timeoutMs: 2000 })
    );
    expect(drained.code).toBe("drained");
    expect(drained.execution_proven).toBe(false);
    expect(drained.pending_runs).toBe(0);
  });
});

describe("status reports observed execution state, not desired control state", () => {
  it("right after start with no runs, observed_state is idle, not running", () => {
    defineOk("status-slug");
    const started = controlOk(svc.start("status-slug", {}));
    expect(started.code).toBe("started");
    const st = svc.status("status-slug");
    expect(st?.desired_state).toBe("running");
    expect(st?.observed_state).toBe("idle");
    expect(st?.execution_proven).toBe(false);
  });

  it("queued work makes observed_state queued", () => {
    const slug = store.getSlugByName("status-slug");
    const rev = store.getActiveRevision(slug!.id)!;
    store.insertRun(
      slug!.id,
      rev.id,
      "status-queued-admit",
      slug!.execution_epoch,
      Math.floor(Date.now() / 1000)
    );
    const st = svc.status("status-slug") as SlugStatus;
    expect(st.observed_state).toBe("queued");
  });
});

describe("definition digests are canonical", () => {
  it("key reordering does not change the digest", () => {
    const ordered = makeDefinition("canonical-slug");
    const reordered = {
      schemaVersion: 2,
      checks: ordered.checks,
      name: "canonical-slug",
      tags: ordered.tags,
      description: ordered.description,
      cadence: ordered.cadence,
      execution: ordered.execution,
    };
    const v1 = validateDefinition(ordered);
    const v2 = validateDefinition(reordered);
    expect(v1.valid).toBe(true);
    expect(v2.valid).toBe(true);
    expect(definitionDigest(ordered)).toBe(definitionDigest(reordered));
  });

  it("define with a reordered equivalent definition reports unchanged", () => {
    const first = defineOk("canonical-slug");
    expect(first.code).toBe("defined");
    const slug = store.getSlugByName("canonical-slug");
    const rev = store.getActiveRevision(slug!.id)!;
    const stored = JSON.parse(rev.definition_json) as Record<string, unknown>;
    const reordered = {
      execution: stored.execution,
      schemaVersion: 2,
      description: stored.description,
      checks: stored.checks,
      name: "canonical-slug",
      cadence: stored.cadence,
      tags: stored.tags,
    };
    const again = svc.define("canonical-slug", reordered);
    expect(again.accepted).toBe(true);
    expect((again as DefineResult).code).toBe("unchanged");
  });
});

describe("cron cadence validation", () => {
  it("validate rejects an invalid cron expression", () => {
    const r = validateDefinition(
      makeDefinition("cron-slug", {
        cadence: { type: "cron", expression: "not a cron", timezone: "UTC" },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("; ")).toMatch(/cron/i);
  });

  it("validate rejects an invalid timezone", () => {
    const r = validateDefinition(
      makeDefinition("cron-slug", {
        cadence: { type: "cron", expression: "*/5 * * * *", timezone: "Not/AZone" },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("; ")).toMatch(/cron|timezone|tz/i);
  });

  it("validate accepts a valid cron cadence", () => {
    const r = validateDefinition(
      makeDefinition("cron-slug", {
        cadence: { type: "cron", expression: "*/5 * * * *", timezone: "UTC" },
      })
    );
    expect(r.valid).toBe(true);
  });

  it("define rejects a definition with an invalid cron cadence", () => {
    const r = svc.define(
      "cron-slug",
      makeDefinition("cron-slug", {
        cadence: { type: "cron", expression: "not a cron", timezone: "UTC" },
      })
    );
    expect(r.accepted).toBe(false);
  });
});

describe("shell execution cannot bypass validation through env", () => {
  it("rejects env bash -c", () => {
    const r = validateDefinition(
      makeDefinition("env-slug", {
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["bash", "-c", "echo hi"],
              timeoutSeconds: 10,
            },
          },
        ],
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("; ")).toMatch(/shell/i);
  });

  it("rejects env with assignments resolving to a shell", () => {
    const r = validateDefinition(
      makeDefinition("env-slug", {
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["FOO=1", "sh", "-c", "echo hi"],
              timeoutSeconds: 10,
            },
          },
        ],
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("; ")).toMatch(/shell/i);
  });

  it("rejects env -S split-string mode", () => {
    const r = validateDefinition(
      makeDefinition("env-slug", {
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["-S", "bash -c 'echo hi'"],
              timeoutSeconds: 10,
            },
          },
        ],
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("; ")).toMatch(/shell/i);
  });

  it("accepts env with assignments and a non-shell command", () => {
    const r = validateDefinition(
      makeDefinition("env-slug", {
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["FOO=1", "/bin/true"],
              timeoutSeconds: 10,
            },
          },
        ],
      })
    );
    expect(r.valid).toBe(true);
  });
});

describe("stop --cancel drains every queued run, not just the first page", () => {
  it("cancels more than MAX_PAGE_LIMIT queued runs", () => {
    defineOk("bulk-cancel-slug");
    const row = store.getSlugByName("bulk-cancel-slug")!;
    const rev = store.getActiveRevision(row.id)!;
    for (let i = 0; i < 1005; i++) {
      store.insertRun(
        row.id,
        rev.id,
        `bulk-admit-${i}`,
        row.execution_epoch,
        Math.floor(Date.now() / 1000)
      );
    }
    const cancelled = controlOk(svc.stop("bulk-cancel-slug", { cancel: true }));
    expect(cancelled.code).toBe("cancelled");
    expect(cancelled.pending_runs).toBe(1005);
    expect(store.countNonTerminalRuns(row.id)).toBe(0);
  });
});
