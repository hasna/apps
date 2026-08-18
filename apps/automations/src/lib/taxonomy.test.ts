import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationsStatus, QueuedAction } from "../types.js";
import type { TypedActionWorkerRunStatus } from "../worker/index.js";
import type { ServerAutomationsStore } from "../server/store.js";
import {
  AutomationsStore,
  exampleAutomationSpec,
} from "./store.js";
import {
  QUEUE_ENTRY_STATUSES,
  QUEUE_ENTRY_TERMINAL_STATUSES,
} from "./action-queue.js";

/**
 * Taxonomy lane (contracts-alignment-r2): the daemon/queue status vocabulary
 * must be the fleet taxonomy — admitted/leased/running and terminal states,
 * lease generation, fencing token, distinguishable attempt identity, and
 * terminal receipts — per global-hasna-daemon-worker-taxonomy. These tests
 * pin the taxonomy names on the PUBLIC surfaces (types, store verbs, worker
 * receipts, server adapter, daemon observation surface, persisted schema).
 */

const hasTaxonomyLeaseVerb: "leaseNextAction" extends keyof ServerAutomationsStore ? true : false = true;
const hasLegacyClaimVerb: "claimNextAction" extends keyof ServerAutomationsStore ? true : false = false;
const hasTaxonomyAdmitVerb: "admitAction" extends keyof ServerAutomationsStore ? true : false = true;
const hasLegacyEnqueueVerb: "enqueueAction" extends keyof ServerAutomationsStore ? true : false = false;
const hasLegacyRequeueVerb: "requeueDeadAction" extends keyof ServerAutomationsStore ? true : false = false;
const hasTaxonomyReadmitVerb: "readmitDeadAction" extends keyof ServerAutomationsStore ? true : false = true;
const workerRunStatusAdmitted: "admitted" extends TypedActionWorkerRunStatus ? true : false = true;
const workerRunStatusEnqueued: "enqueued" extends TypedActionWorkerRunStatus ? true : false = false;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempStore(): AutomationsStore {
  const directory = mkdtempSync(join(tmpdir(), "hasna-automations-taxonomy-"));
  temporaryDirectories.push(directory);
  return new AutomationsStore({ dbPath: join(directory, "automations.db") });
}

function seedRun(store: AutomationsStore): { runId: string } {
  const spec = store.createAutomation(exampleAutomationSpec());
  const run = store.createRun({
    automationId: spec.id,
    trigger: { kind: "event", source: "open-events", type: "ticket.created" },
    triggerEventId: "evt_taxonomy_1",
  });
  return { runId: run.id };
}

describe("queue entry lifecycle status vocabulary (taxonomy)", () => {
  test("QUEUE_ENTRY_STATUSES exposes admitted and leased, never queued/claimed/retrying", () => {
    expect(QUEUE_ENTRY_STATUSES).toContain("admitted");
    expect(QUEUE_ENTRY_STATUSES).toContain("leased");
    expect(QUEUE_ENTRY_STATUSES).not.toContain("queued");
    expect(QUEUE_ENTRY_STATUSES).not.toContain("claimed");
    expect(QUEUE_ENTRY_STATUSES).not.toContain("retrying");
  });

  test("QUEUE_ENTRY_TERMINAL_STATUSES is a subset of the lifecycle vocabulary", () => {
    for (const terminal of QUEUE_ENTRY_TERMINAL_STATUSES) {
      expect(QUEUE_ENTRY_STATUSES).toContain(terminal);
    }
    expect(QUEUE_ENTRY_TERMINAL_STATUSES).toEqual(expect.arrayContaining(["succeeded", "failed", "dead", "cancelled"]));
  });

  test("admission persists the entry as admitted", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      const entry = store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_1", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
      });
      expect(entry.status).toBe("admitted");
    } finally {
      store.close();
    }
  });

  test("lease acquisition transitions an admitted entry to leased with generation and fencing token", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_2", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const leased = store.leaseNextAction({ runnerId: "runner-taxonomy" });
      expect(leased).toBeDefined();
      expect(leased!.status).toBe("leased");
      expect(leased!.leasedBy).toBe("runner-taxonomy");
      expect(leased!.leasedAt).toBeDefined();
      expect(leased!.leaseExpiresAt).toBeDefined();
      expect(leased!.leaseGeneration).toBe(1);
      expect(leased!.fencingToken).toBe(1);
    } finally {
      store.close();
    }
  });

  test("lease generation increments when a lease is re-acquired after expiry", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_3", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const first = store.leaseNextAction({ runnerId: "runner-taxonomy", now: "2026-06-28T00:00:00.000Z" })!;
      expect(first.leaseGeneration).toBe(1);
      // Let the first lease expire and lease again: the entry must carry a NEW generation.
      const second = store.leaseNextAction({ runnerId: "runner-taxonomy-2", now: "2026-06-28T00:01:00.000Z" });
      expect(second).toBeDefined();
      expect(second!.leaseGeneration).toBe(2);
    } finally {
      store.close();
    }
  });

  test("a stale fencing token is rejected on fenced completion", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_4", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const leased = store.leaseNextAction({ runnerId: "runner-taxonomy", now: "2026-06-28T00:00:00.000Z" })!;
      expect(() => store.completeActionFenced({
        actionId: leased.id,
        runnerId: "runner-taxonomy",
        fencingToken: leased.fencingToken! + 1,
        now: "2026-06-28T00:00:00.500Z",
        result: { summary: "ok" },
      })).toThrow();
      const completed = store.completeActionFenced({
        actionId: leased.id,
        runnerId: "runner-taxonomy",
        fencingToken: leased.fencingToken!,
        now: "2026-06-28T00:00:00.500Z",
        result: { summary: "ok" },
      });
      expect(completed.status).toBe("succeeded");
    } finally {
      store.close();
    }
  });

  test("retries re-admit the entry with a distinguishable attempt identity", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      const entry = store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        maxAttempts: 3,
        invocation: { id: "inv_tax_5", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const leased = store.leaseNextAction({ runnerId: "runner-taxonomy", now: "2026-06-28T00:00:00.000Z" })!;
      const retried = store.failAction({
        actionId: leased.id,
        runnerId: "runner-taxonomy",
        fencingToken: leased.fencingToken,
        now: "2026-06-28T00:00:00.500Z",
        error: { code: "TYPED_ACTION_FAILED", message: "transient", retryable: true },
      });
      // Entry identity is preserved; the attempt identity advances; the lifecycle
      // state returns to admitted (there is no non-taxonomy "retrying" state).
      expect(retried.id).toBe(entry.id);
      expect(retried.attempt).toBe(1);
      expect(retried.status).toBe("admitted");
    } finally {
      store.close();
    }
  });

  test("exhausted attempts settle as a dead-letter terminal receipt", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      const entry = store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        maxAttempts: 1,
        invocation: { id: "inv_tax_6", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const leased = store.leaseNextAction({ runnerId: "runner-taxonomy", now: "2026-06-28T00:00:00.000Z" })!;
      const dead = store.failAction({
        actionId: leased.id,
        runnerId: "runner-taxonomy",
        fencingToken: leased.fencingToken,
        now: "2026-06-28T00:00:00.500Z",
        error: { code: "TYPED_ACTION_FAILED", message: "exhausted", retryable: true },
      });
      expect(dead.status).toBe("dead");
      expect(dead.id).toBe(entry.id);
      expect(dead.deadLetter).toBeDefined();
      expect(dead.deadLetter!.attempts).toBe(1);
      expect(dead.deadLetter!.replayable).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("daemon observation surface (taxonomy)", () => {
  test("status reports queue depth, admitted/leased/terminal counts and dead-letter count", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_7", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const status = store.status(new Date("2026-06-28T00:00:00.000Z")) as AutomationsStatus & {
        counts: { queueDepth: number; admitted: number; leased: number; terminal: number; deadLetter: number };
      };
      expect(status.counts.queueDepth).toBe(1);
      expect(status.counts.admitted).toBe(1);
      expect(status.counts.leased).toBe(0);
      expect(status.counts.terminal).toBe(0);
      expect(status.counts.deadLetter).toBe(0);
      expect(status.counts).not.toHaveProperty("queuedActions");
    } finally {
      store.close();
    }
  });

  test("a leased entry exposes per-entry lease health on the observation surface", () => {
    const store = tempStore();
    try {
      const { runId } = seedRun(store);
      const entry = store.admitAction({
        automationRunId: runId,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: { id: "inv_tax_8", actionId: "todos.create", manifestVersion: "1.0.0", input: {} },
        availableAt: "2026-06-28T00:00:00.000Z",
      });
      const leased = store.leaseNextAction({ runnerId: "runner-taxonomy", now: "2026-06-28T00:00:00.000Z" })!;
      expect(leased.id).toBe(entry.id);
      expect(leased.leasedBy).toBe("runner-taxonomy");
      expect(leased.leasedAt).toBe("2026-06-28T00:00:00.000Z");
      expect(leased.leaseExpiresAt).toBeDefined();
      expect(leased.leaseGeneration).toBe(1);
      const row = store.requireQueueEntry(entry.id) as QueuedAction;
      expect(row.leasedBy).toBe("runner-taxonomy");
      expect(row.leaseGeneration).toBe(1);
    } finally {
      store.close();
    }
  });
});

describe("public adapter and worker surfaces (taxonomy)", () => {
  test("server store exposes taxonomy verbs and no legacy claim/enqueue verbs", () => {
    expect(hasTaxonomyLeaseVerb).toBe(true);
    expect(hasTaxonomyAdmitVerb).toBe(true);
    expect(hasTaxonomyReadmitVerb).toBe(true);
    expect(hasLegacyClaimVerb).toBe(false);
    expect(hasLegacyEnqueueVerb).toBe(false);
    expect(hasLegacyRequeueVerb).toBe(false);
  });

  test("worker run receipt statuses use the taxonomy vocabulary (admitted, not enqueued)", () => {
    expect(workerRunStatusAdmitted).toBe(true);
    expect(workerRunStatusEnqueued).toBe(false);
  });
});

describe("persisted vocabulary migration (taxonomy)", () => {
  test("legacy queued/claimed rows and claim columns migrate to admitted/leased and lease_generation", () => {
    const directory = mkdtempSync(join(tmpdir(), "hasna-automations-taxonomy-legacy-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "automations.db");
    const legacy = new Database(dbPath, { create: true });
    legacy.exec(`
      CREATE TABLE automations (
        id TEXT PRIMARY KEY, spec_json TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, status TEXT NOT NULL,
        trigger_json TEXT NOT NULL, trigger_event_id TEXT, idempotency_key TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT,
        completed_at TEXT, error TEXT, metadata_json TEXT
      );
      CREATE TABLE automation_actions (
        id TEXT PRIMARY KEY, automation_run_id TEXT NOT NULL, step_id TEXT NOT NULL,
        action_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
        invocation_json TEXT NOT NULL, attempt INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        claimed_by TEXT, claimed_at TEXT, lease_expires_at TEXT,
        claim_version INTEGER NOT NULL DEFAULT 0, unmet_dependencies INTEGER NOT NULL DEFAULT 0,
        approval_gate_json TEXT, result_json TEXT, error_json TEXT, dead_letter_json TEXT,
        metadata_json TEXT
      );
      CREATE TABLE automation_replay_requests (
        id TEXT PRIMARY KEY, source_run_id TEXT NOT NULL, requested_at TEXT NOT NULL,
        requested_by TEXT, mode TEXT NOT NULL, reason TEXT, metadata_json TEXT
      );
      CREATE TABLE automation_action_dependencies (
        automation_run_id TEXT NOT NULL, action_step_id TEXT NOT NULL,
        dependency_step_id TEXT NOT NULL,
        PRIMARY KEY (automation_run_id, action_step_id, dependency_step_id)
      );
      CREATE TABLE daemon_leases (
        id TEXT PRIMARY KEY, pid INTEGER NOT NULL, hostname TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT
      );
      CREATE TABLE webhook_routes (
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL, signature_json TEXT, mapping_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT
      );
      PRAGMA user_version = 6;
    `);
    const now = "2026-06-28T00:00:00.000Z";
    legacy.query(`
      INSERT INTO automations (id, spec_json, status, created_at, updated_at)
      VALUES ('legacy-automation', $specJson, 'active', $now, $now)
    `).run({
      $specJson: JSON.stringify({
        schemaVersion: "1.0",
        id: "legacy-automation",
        name: "Legacy automation",
        version: "1.0.0",
        triggers: [{ kind: "manual" }],
        actions: [
          { id: "step-a", actionId: "todos.create" },
          { id: "step-b", actionId: "todos.create" },
        ],
      }),
      $now: now,
    });
    legacy.query(`
      INSERT INTO automation_runs (id, automation_id, status, trigger_json, created_at, updated_at)
      VALUES ('legacy-run', 'legacy-automation', 'running', '{}', $now, $now)
    `).run({ $now: now });
    legacy.query(`
      INSERT INTO automation_actions (
        id, automation_run_id, step_id, action_id, idempotency_key, status, invocation_json,
        attempt, max_attempts, available_at, created_at, updated_at,
        claimed_by, claimed_at, lease_expires_at, claim_version
      )
      VALUES (
        'legacy-queued', 'legacy-run', 'step-a', 'todos.create', 'legacy-run:step-a', 'queued', '{}',
        0, 3, $now, $now, $now, NULL, NULL, NULL, 0
      ),
      (
        'legacy-claimed', 'legacy-run', 'step-b', 'todos.create', 'legacy-run:step-b', 'claimed', '{}',
        1, 3, $now, $now, $now, 'runner-legacy', $now, $now, 4
      )
    `).run({ $now: now });
    legacy.close();

    const store = new AutomationsStore({ dbPath });
    try {
      const queued = store.requireQueueEntry("legacy-queued");
      expect(queued.status).toBe("admitted");
      expect(queued.leaseGeneration).toBe(0);
      const leased = store.requireQueueEntry("legacy-claimed");
      expect(leased.status).toBe("leased");
      expect(leased.leasedBy).toBe("runner-legacy");
      expect(leased.leaseGeneration).toBe(4);
    } finally {
      store.close();
    }
  });
});
