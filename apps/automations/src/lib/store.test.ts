import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutomationsStore,
  LEASE_CANDIDATE_BUDGET,
  exampleAutomationSpec,
  SQLITE_LEASE_CANDIDATES_SQL,
  validateAutomationSpec,
} from "./store.js";

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-store-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("AutomationsStore", () => {
  test("initializes local SQLite store and reports empty status", () => {
    const store = new AutomationsStore();
    try {
      const status = store.status();
      expect(status).toMatchObject({
        service: "automations",
        schemaVersion: "1.0",
        dataDir,
        counts: {
          automations: 0,
          runs: 0,
          queueDepth: 0,
          admitted: 0,
          leased: 0,
          terminal: 0,
          deadLetter: 0,
          replayRequests: 0,
          webhookRoutes: 0,
        },
        daemon: { active: false },
      });
      expect(status.dbPath).toContain("automations.db");
    } finally {
      store.close();
    }
  });

  test("persists automation specs, materialized runs, queued actions, replay requests, and daemon heartbeat", () => {
    const store = new AutomationsStore();
    try {
      const spec = store.createAutomation(exampleAutomationSpec());
      expect(spec.id).toBe("tickets.escalate-critical");

      const run = store.createRun({
        id: "run_1",
        automationId: spec.id,
        trigger: { kind: "event", source: "open-events", type: "ticket.created" },
        triggerEventId: "evt_1",
        idempotencyKey: "evt_1:tickets.escalate-critical",
      });
      expect(run.status).toBe("materialized");
      const duplicateRun = store.createRun({
        id: "run_duplicate",
        automationId: spec.id,
        trigger: { kind: "event", source: "open-events", type: "ticket.created" },
        triggerEventId: "evt_1",
        idempotencyKey: "evt_1:tickets.escalate-critical",
      });
      expect(duplicateRun.id).toBe(run.id);

      const action = store.admitAction({
        id: "act_1",
        automationRunId: run.id,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        availableAt: "2026-06-28T00:00:00.000Z",
        invocation: {
          id: "inv_1",
          actionId: "todos.create",
          manifestVersion: "1.0.0",
          input: { title: "Escalate critical ticket" },
          requestedAt: "2026-06-28T00:00:00.000Z",
          idempotencyKey: "evt_1:act_1",
        },
      });
      expect(action.status).toBe("admitted");
      expect(action.idempotencyKey).toBe("evt_1:act_1");
      const duplicateAction = store.admitAction({
        id: "act_duplicate",
        automationRunId: run.id,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        invocation: {
          id: "inv_duplicate",
          actionId: "todos.create",
          manifestVersion: "1.0.0",
          input: { title: "Escalate critical ticket duplicate" },
          requestedAt: "2026-06-28T00:00:00.000Z",
        },
      });
      expect(duplicateAction.id).toBe(action.id);

      const replay = store.createReplayRequest({
        id: "replay_1",
        sourceRunId: run.id,
        mode: "failed-actions",
        reason: "manual test",
      });
      expect(replay.mode).toBe("failed-actions");
      expect(() => store.createReplayRequest({
        sourceRunId: "missing_run",
        mode: "entire-run",
      })).toThrow("automation run not found");

      const lease = store.heartbeatDaemon({ leaseId: "daemon:test", now: new Date("2026-06-28T00:00:00.000Z") });
      expect(lease.id).toBe("daemon:test");
      expect((store.db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);

      const claimed = store.leaseNextAction({ runnerId: "tester", now: "2026-06-28T00:00:01.000Z" });
      expect(claimed).toMatchObject({ id: action.id, status: "leased", leasedBy: "tester" });

      const retrying = store.failAction({
        actionId: action.id,
        runnerId: "tester",
        now: "2026-06-28T00:00:02.000Z",
        retryBackoffMs: 0,
        error: { code: "UPSTREAM_500", message: "upstream failed", retryable: true },
      });
      expect(retrying).toMatchObject({ status: "admitted", attempt: 1 });

      const secondClaim = store.leaseNextAction({ runnerId: "tester", now: "2026-06-28T00:00:03.000Z" });
      expect(secondClaim).toMatchObject({ id: action.id, status: "leased" });
      store.failAction({
        actionId: action.id,
        runnerId: "tester",
        now: "2026-06-28T00:00:04.000Z",
        retryBackoffMs: 0,
        error: { code: "UPSTREAM_500", message: "upstream failed", retryable: true },
      });
      const thirdClaim = store.leaseNextAction({ runnerId: "tester", now: "2026-06-28T00:00:05.000Z" });
      expect(thirdClaim).toMatchObject({ id: action.id, status: "leased" });
      const dead = store.failAction({
        actionId: action.id,
        runnerId: "tester",
        now: "2026-06-28T00:00:06.000Z",
        error: { code: "UPSTREAM_500", message: "upstream failed", retryable: true },
      });
      expect(dead).toMatchObject({ status: "dead", attempt: 3, deadLetter: { replayable: true } });
      expect(store.listDeadLetterActions()).toHaveLength(1);

      const requeued = store.readmitDeadAction(action.id, { now: "2026-06-28T00:00:07.000Z", requestedBy: "tester" });
      expect(requeued).toMatchObject({ status: "admitted", attempt: 0 });
      const completedClaim = store.leaseNextAction({ runnerId: "tester", now: "2026-06-28T00:00:08.000Z" });
      expect(completedClaim).toMatchObject({ id: action.id, status: "leased" });
      const completed = store.completeAction({
        actionId: action.id,
        runnerId: "tester",
        now: "2026-06-28T00:00:09.000Z",
        result: { summary: "created task", output: { taskId: "task_1" } },
      });
      expect(completed).toMatchObject({ status: "succeeded", result: { summary: "created task" } });
      expect(() => store.failAction({
        actionId: action.id,
        runnerId: "tester",
        now: "2026-06-28T00:00:10.000Z",
        error: { code: "TOO_LATE", message: "already done" },
      })).toThrow("cannot fail terminal queue entry");

      expect(store.status(new Date("2026-06-28T00:00:01.000Z"))).toMatchObject({
        counts: {
          automations: 1,
          runs: 1,
          queueDepth: 1,
          admitted: 0,
          leased: 0,
          terminal: 1,
          deadLetter: 0,
          replayRequests: 2,
          webhookRoutes: 0,
        },
        daemon: { active: true, leaseId: "daemon:test" },
      });
    } finally {
      store.close();
    }
  });

  test("materializes matching events into idempotent runs and queued actions", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(exampleAutomationSpec());
      const materialized = store.materializeEvent({
        id: "evt_critical",
        dedupeKey: "ticket:critical:1",
        source: "open-events",
        type: "ticket.created",
        time: "2026-06-28T00:00:00.000Z",
        data: { priority: "critical" },
      });
      expect(materialized).toHaveLength(1);
      expect(materialized[0]?.run.idempotencyKey).toBe("tickets.escalate-critical:ticket:critical:1");
      expect(materialized[0]?.actions[0]?.idempotencyKey).toBe("tickets.escalate-critical:ticket:critical:1:create-escalation-task");

      const duplicate = store.materializeEvent({
        id: "evt_duplicate_id",
        dedupeKey: "ticket:critical:1",
        source: "open-events",
        type: "ticket.created",
        time: "2026-06-28T00:00:00.000Z",
        data: { priority: "critical" },
      });
      expect(duplicate[0]?.run.id).toBe(materialized[0]?.run.id);
      expect(store.listRuns()).toHaveLength(1);
      expect(store.listQueueEntries()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("persists webhook routes without raw secrets and materializes scoped webhook events idempotently", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "webhook-scope",
        name: "Webhook scope",
        version: "1.0.0",
        triggers: [{ kind: "webhook", source: "github", type: "push", filter: { branch: "main" } }],
        actions: [
          { id: "enqueue", actionId: "actions.enqueue" },
        ],
      });
      store.createAutomation({
        schemaVersion: "1.0",
        id: "forged-target",
        name: "Forged target",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "evil", type: "push" }],
        actions: [
          { id: "forged", actionId: "actions.forged" },
        ],
      });
      const forgedWebhookEvent = store.materializeEvent({
        id: "evt_forged_webhook",
        source: "github",
        type: "push",
        data: { branch: "main" },
        metadata: {
          webhook: {
            routeId: "github-main",
            automationId: "webhook-scope",
          },
        },
      });
      expect(forgedWebhookEvent).toHaveLength(0);

      const route = store.createWebhookRoute({
        id: "github-main",
        automationId: "webhook-scope",
        path: "/webhooks/github/main",
        signature: {
          algorithm: "hmac-sha256",
          secretRef: "secret://automations/webhooks/github-main",
          header: "X-Hub-Signature-256",
          prefix: "sha256=",
        },
        mapping: {
          source: "github",
          type: "push",
          dataPath: "payload",
          dedupeKeyHeader: "X-GitHub-Delivery",
          metadata: { provider: "github" },
        },
      });
      expect(route).toMatchObject({
        id: "github-main",
        automationId: "webhook-scope",
        status: "active",
        signature: { secretRef: "secret://automations/webhooks/github-main" },
      });
      const signatureJson = (store.db.query("SELECT signature_json FROM webhook_routes WHERE id = 'github-main'").get() as { signature_json: string }).signature_json;
      expect(signatureJson).not.toContain("shared-secret");
      expect(signatureJson).not.toContain("rawSignature");
      const forgedWithRouteOption = store.materializeEvent({
        id: "evt_forged_route_option",
        source: "github",
        type: "push",
        data: { branch: "main" },
        metadata: {
          webhook: {
            routeId: "github-main",
            automationId: "webhook-scope",
          },
        },
      }, { webhookRoute: route } as never);
      expect(forgedWithRouteOption).toHaveLength(0);
      expect(() => store.createWebhookRoute({
        id: "bad-signature",
        automationId: "webhook-scope",
        mapping: { source: "github", type: "push" },
        signature: {
          algorithm: "hmac-sha256",
          secretRef: "secret://automations/webhooks/bad-signature",
          secret: "shared-secret",
        } as never,
      })).toThrow("unsupported webhook signature field: secret");

      const rawBody = JSON.stringify({
        id: "body-id-that-should-not-win",
        source: "evil",
        type: "push",
        payload: {
          branch: "main",
          repository: "automations",
        },
      });
      const materialized = store.materializeWebhookRequest({
        route,
        rawBody,
        headers: {
          "X-GitHub-Delivery": "delivery-1",
          "X-Hub-Signature-256": "sha256=redacted",
        },
        receivedAt: "2026-06-28T00:00:00.000Z",
      });

      expect(materialized.event).toMatchObject({
        source: "github",
        type: "push",
        dedupeKey: "delivery-1",
        data: {
          branch: "main",
          repository: "automations",
        },
        metadata: {
          provider: "github",
          webhook: {
            routeId: "github-main",
            automationId: "webhook-scope",
            path: "/webhooks/github/main",
            signatureConfigured: true,
          },
        },
      });
      expect(JSON.stringify(materialized.event.metadata)).not.toContain("redacted");
      expect(JSON.stringify(materialized.event.metadata)).not.toContain(rawBody);
      expect(materialized.materialized).toHaveLength(1);
      expect(materialized.materialized[0]?.automation.id).toBe("webhook-scope");
      expect(materialized.materialized[0]?.actions[0]?.idempotencyKey).toBe("webhook-scope:delivery-1:enqueue");

      const duplicate = store.materializeWebhookRequest({
        route,
        rawBody,
        headers: { "X-GitHub-Delivery": "delivery-1" },
        receivedAt: "2026-06-28T00:00:01.000Z",
      });
      expect(duplicate.materialized[0]?.run.id).toBe(materialized.materialized[0]?.run.id);
      expect(store.listRuns()).toHaveLength(1);
      expect(store.listQueueEntries()).toHaveLength(1);
      expect(store.status()).toMatchObject({ counts: { webhookRoutes: 1 } });
    } finally {
      store.close();
    }
  });

  test("normalizes webhook requests with deterministic body-hash dedupe and no raw data by default", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "webhook-default-data",
        name: "Webhook default data",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "stripe", type: "invoice.created" }],
        actions: [
          { id: "record", actionId: "actions.record" },
        ],
      });
      const route = store.createWebhookRoute({
        id: "stripe-invoices",
        automationId: "webhook-default-data",
        path: "/webhooks/stripe/invoices",
        mapping: {
          source: "stripe",
          type: "invoice.created",
          idPath: "id",
        },
      });
      const result = store.materializeWebhookRequest({
        route,
        rawBody: JSON.stringify({ id: "evt_invoice_1", amount: 1000 }),
        receivedAt: "2026-06-28T00:00:00.000Z",
      });
      expect(result.event).toMatchObject({
        id: "evt_invoice_1",
        source: "stripe",
        type: "invoice.created",
        data: {},
        dedupeKey: "evt_invoice_1",
      });
      expect(result.event.metadata?.webhook).toMatchObject({
        routeId: "stripe-invoices",
        rawBodySha256: expect.any(String),
      });
    } finally {
      store.close();
    }
  });

  test("respects dependencies and approval gates during claims", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "dependency-test",
        name: "Dependency test",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "open-events", type: "dep.test" }],
        actions: [
          { id: "first", actionId: "actions.first" },
          { id: "second", actionId: "actions.second", dependsOn: ["first"] },
          {
            id: "approved",
            actionId: "actions.approved",
            approval: { mode: "manual", requiresApproval: true },
          },
        ],
      });
      store.materializeEvent({
        id: "evt_dep",
        source: "open-events",
        type: "dep.test",
        time: "2026-06-28T00:00:00.000Z",
        data: {},
      });

      const first = store.leaseNextAction({ runnerId: "dep", now: "2026-06-28T00:00:01.000Z" });
      expect(first?.stepId).toBe("first");
      store.completeAction({
        actionId: first!.id,
        runnerId: "dep",
        now: "2026-06-28T00:00:02.000Z",
      });

      const second = store.leaseNextAction({ runnerId: "dep", now: "2026-06-28T00:00:03.000Z" });
      expect(second?.stepId).toBe("second");
      store.completeAction({
        actionId: second!.id,
        runnerId: "dep",
        now: "2026-06-28T00:00:04.000Z",
      });

      expect(store.leaseNextAction({ runnerId: "dep", now: "2026-06-28T00:00:05.000Z" })).toBeUndefined();
      const approvalAction = store.listQueueEntries().find((action) => action.stepId === "approved");
      expect(approvalAction).toMatchObject({
        status: "waiting_approval",
        approvalGate: {
          blockedUntilApproved: true,
          decision: { status: "pending", requestedAt: "2026-06-28T00:00:00.000Z" },
        },
      });
      store.approveAction(approvalAction!.id, { now: "2026-06-28T00:00:06.000Z", decidedBy: "tester" });
      expect(() => store.approveAction(approvalAction!.id, { now: "2026-06-28T00:00:06.500Z" })).toThrow("approval decision is not pending");
      expect(() => store.rejectAction(approvalAction!.id, { now: "2026-06-28T00:00:06.750Z" })).toThrow("approval decision is not pending");
      const approved = store.leaseNextAction({ runnerId: "dep", now: "2026-06-28T00:00:07.000Z" });
      expect(approved?.stepId).toBe("approved");
      expect(() => store.rejectAction(approved!.id, { now: "2026-06-28T00:00:08.000Z" })).toThrow("leased queue entry");
    } finally {
      store.close();
    }
  });

  test("keeps approval rejections non-replayable and terminal approval transitions guarded", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "approval-rejection-test",
        name: "Approval rejection test",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "open-events", type: "approval.test" }],
        actions: [
          { id: "needs-approval", actionId: "actions.external-write", approval: { mode: "manual", requiresApproval: true } },
        ],
      });
      store.materializeEvent({
        id: "evt_approval_reject",
        source: "open-events",
        type: "approval.test",
        time: "2026-06-28T00:00:00.000Z",
        data: {},
      });

      expect(store.leaseNextAction({ runnerId: "approval", now: "2026-06-28T00:00:01.000Z" })).toBeUndefined();
      const waiting = store.listQueueEntries().find((action) => action.stepId === "needs-approval")!;
      expect(waiting).toMatchObject({ status: "waiting_approval", approvalGate: { decision: { status: "pending" } } });

      const rejected = store.rejectAction(waiting.id, {
        now: "2026-06-28T00:00:02.000Z",
        decidedBy: "tester",
        reason: "not safe",
      });
      expect(rejected).toMatchObject({ status: "dead", deadLetter: { replayable: false } });
      expect(() => store.readmitDeadAction(rejected.id, { now: "2026-06-28T00:00:03.000Z" })).toThrow("not replayable");
      expect(() => store.approveAction(rejected.id, { now: "2026-06-28T00:00:04.000Z" })).toThrow("terminal queue entry");
    } finally {
      store.close();
    }
  });

  test("continues scanning past dependency-blocked actions when claiming", () => {
    const store = new AutomationsStore();
    try {
      const blockedActions = Array.from({ length: LEASE_CANDIDATE_BUDGET + 1 }, (_, index) => ({
        id: `blocked-${String(index).padStart(3, "0")}`,
        actionId: "actions.blocked",
        dependsOn: ["missing-success"],
      }));
      store.createAutomation({
        schemaVersion: "1.0",
        id: "claim-scan-test",
        name: "Claim scan test",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "open-events", type: "claim.scan" }],
        actions: [
          { id: "missing-success", actionId: "actions.missing" },
          ...blockedActions,
          { id: "ready-after-blocked", actionId: "actions.ready" },
        ],
      });
      const run = store.createRun({
        id: "run_claim_scan",
        automationId: "claim-scan-test",
        trigger: { kind: "manual" },
      });
      for (const step of blockedActions) {
        store.admitAction({
          id: step.id,
          automationRunId: run.id,
          stepId: step.id,
          actionId: step.actionId,
          availableAt: "2026-06-28T00:00:00.000Z",
          invocation: {
            id: `inv_${step.id}`,
            actionId: step.actionId,
            manifestVersion: "1.0.0",
            input: {},
            requestedAt: "2026-06-28T00:00:00.000Z",
          },
        });
      }
      store.admitAction({
        id: "ready-after-blocked",
        automationRunId: run.id,
        stepId: "ready-after-blocked",
        actionId: "actions.ready",
        availableAt: "2026-06-28T00:00:00.000Z",
        invocation: {
          id: "inv_ready_after_blocked",
          actionId: "actions.ready",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: "2026-06-28T00:00:00.000Z",
        },
      });

      const claimed = store.leaseNextAction({ runnerId: "scanner", now: "2026-06-28T00:00:01.000Z" });
      expect(claimed).toMatchObject({ id: "ready-after-blocked", stepId: "ready-after-blocked", status: "leased" });
    } finally {
      store.close();
    }
  });

  test("uses both bounded claim indexes and rejects the legacy unindexed order", () => {
    const store = new AutomationsStore({ dbPath: ":memory:" });
    try {
      const plan = store.db.query(`EXPLAIN QUERY PLAN ${SQLITE_LEASE_CANDIDATES_SQL}`).all({
        $now: "2026-08-12T00:00:00.000Z",
        $limit: LEASE_CANDIDATE_BUDGET,
      }) as Array<{ detail: string }>;
      const details = plan.map(({ detail }) => detail);
      expect(details).toContain("MERGE (UNION ALL)");
      expect(details.some((detail) => detail.includes("automation_actions_ready_order_idx"))).toBe(true);
      expect(details.some((detail) => detail.includes("automation_actions_expired_lease_order_idx"))).toBe(true);
      expect(details.some((detail) => detail === "SCAN automation_actions")).toBe(false);
      expect(details.some((detail) => detail.includes("USE TEMP B-TREE"))).toBe(false);

      const legacy = store.db.query(`EXPLAIN QUERY PLAN
        SELECT id FROM automation_actions
        WHERE (
          status = 'admitted'
          OR (status='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $now)
        ) AND available_at <= $now
        ORDER BY available_at,created_at,id LIMIT $limit
      `).all({
        $now: "2026-08-12T00:00:00.000Z",
        $limit: LEASE_CANDIDATE_BUDGET,
      }) as Array<{ detail: string }>;
      expect(legacy.some(({ detail }) => detail.includes("USE TEMP B-TREE"))).toBe(true);
    } finally {
      store.close();
    }
  });

  test("upgrades schema v4 dependency edges and reopens idempotently", () => {
    const dbPath = join(dataDir, "schema-v4.sqlite");
    const first = new AutomationsStore({ dbPath });
    first.createAutomation({
      schemaVersion: "1.0",
      id: "schema-v4",
      name: "schema-v4",
      version: "1.0.0",
      triggers: [{ kind: "event", source: "test", type: "created" }],
      actions: [
        { id: "required", actionId: "actions.required" },
        { id: "dependent", actionId: "actions.dependent", dependsOn: ["required"] },
      ],
    });
    const run = first.createRun({ id: "schema-v4-run", automationId: "schema-v4", trigger: { kind: "manual" } });
    first.admitAction({
      id: "schema-v4-dependent",
      automationRunId: run.id,
      stepId: "dependent",
      actionId: "actions.dependent",
      invocation: { id: "schema-v4-inv", actionId: "actions.dependent", manifestVersion: "1.0.0", input: {}, requestedAt: "2026-08-12T00:00:00.000Z" },
    });
    first.db.exec(`
      DROP TABLE automation_action_dependencies;
      DROP INDEX automation_actions_ready_order_idx;
      DROP INDEX automation_actions_expired_lease_order_idx;
      PRAGMA user_version = 4;
    `);
    first.close();

    for (let reopen = 0; reopen < 2; reopen += 1) {
      const upgraded = new AutomationsStore({ dbPath });
      expect((upgraded.db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);
      expect((upgraded.db.query("SELECT count(*) AS count FROM automation_action_dependencies").get() as { count: number }).count).toBe(1);
      expect(upgraded.leaseNextAction({ runnerId: "upgrade", now: "2026-08-12T00:00:01.000Z" })).toBeUndefined();
      upgraded.close();
    }
  });

  test("settles unmet dependency counters when a prerequisite completes", () => {
    const store = new AutomationsStore({ dbPath: ":memory:" });
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "counter-settlement",
        name: "counter-settlement",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "test", type: "created" }],
        actions: [
          { id: "required", actionId: "actions.required" },
          { id: "dependent", actionId: "actions.dependent", dependsOn: ["required"] },
        ],
      });
      const run = store.createRun({ id: "counter-run", automationId: "counter-settlement", trigger: { kind: "manual" } });
      const dependent = store.admitAction({
        id: "counter-dependent",
        automationRunId: run.id,
        stepId: "dependent",
        actionId: "actions.dependent",
        availableAt: "2026-08-12T00:00:00.000Z",
        invocation: { id: "counter-dependent-invocation", actionId: "actions.dependent", manifestVersion: "1.0.0", input: {}, requestedAt: "2026-08-12T00:00:00.000Z" },
      });
      expect((store.db.query("SELECT unmet_dependencies FROM automation_actions WHERE id=$id").get({ $id: dependent.id }) as { unmet_dependencies: number }).unmet_dependencies).toBe(1);
      expect(store.leaseNextAction({ runnerId: "counter-runner", now: "2026-08-12T00:00:01.000Z" })).toBeUndefined();

      const required = store.admitAction({
        id: "counter-required",
        automationRunId: run.id,
        stepId: "required",
        actionId: "actions.required",
        availableAt: "2026-08-12T00:00:00.000Z",
        invocation: { id: "counter-required-invocation", actionId: "actions.required", manifestVersion: "1.0.0", input: {}, requestedAt: "2026-08-12T00:00:00.000Z" },
      });
      const claimed = store.leaseNextAction({ runnerId: "counter-runner", now: "2026-08-12T00:00:02.000Z" });
      expect(claimed?.id).toBe(required.id);
      store.completeAction({ actionId: required.id, runnerId: "counter-runner", now: "2026-08-12T00:00:03.000Z" });
      expect((store.db.query("SELECT unmet_dependencies FROM automation_actions WHERE id=$id").get({ $id: dependent.id }) as { unmet_dependencies: number }).unmet_dependencies).toBe(0);
      expect(store.leaseNextAction({ runnerId: "counter-runner", now: "2026-08-12T00:00:04.000Z" })?.id).toBe(dependent.id);
    } finally {
      store.close();
    }
  });

  test("does not let stale runners finalize reclaimed actions", () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(exampleAutomationSpec());
      const run = store.createRun({
        id: "run_stale_claim",
        automationId: "tickets.escalate-critical",
        trigger: { kind: "manual" },
      });
      const action = store.admitAction({
        id: "act_stale_claim",
        automationRunId: run.id,
        stepId: "create-escalation-task",
        actionId: "todos.create",
        availableAt: "2026-06-28T00:00:00.000Z",
        invocation: {
          id: "inv_stale_claim",
          actionId: "todos.create",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: "2026-06-28T00:00:00.000Z",
        },
      });
      const claimed = store.leaseNextAction({
        runnerId: "runner-a",
        leaseMs: 30000,
        now: "2026-06-28T00:00:01.000Z",
      });
      expect(claimed).toMatchObject({ id: action.id, status: "leased", leasedBy: "runner-a" });

      const originalRequire = store.requireQueueEntry.bind(store);
      const stealClaimDuringPrecheck = (): void => {
        store.db.query(`
          UPDATE automation_actions
          SET leased_by = 'runner-b',
              leased_at = '2026-06-28T00:00:02.000Z',
              lease_expires_at = '2026-06-28T00:00:32.000Z',
              updated_at = '2026-06-28T00:00:02.000Z'
          WHERE id = $id
        `).run({ $id: action.id });
      };
      const injectClaimSteal = (): void => {
        let injected = false;
        store.requireQueueEntry = ((id: string) => {
          const snapshot = originalRequire(id);
          if (!injected && id === action.id) {
            injected = true;
            stealClaimDuringPrecheck();
          }
          return snapshot;
        }) as AutomationsStore["requireQueueEntry"];
      };

      try {
        injectClaimSteal();
        expect(() => store.completeAction({
          actionId: action.id,
          runnerId: "runner-a",
          now: "2026-06-28T00:00:03.000Z",
        })).toThrow("lease is no longer active");

        store.requireQueueEntry = originalRequire;
        expect(originalRequire(action.id)).toMatchObject({ status: "leased", leasedBy: "runner-a", attempt: 0 });

        injectClaimSteal();
        expect(() => store.failAction({
          actionId: action.id,
          runnerId: "runner-a",
          now: "2026-06-28T00:00:04.000Z",
          error: { code: "STALE", message: "stale runner" },
        })).toThrow("lease is no longer active");
      } finally {
        store.requireQueueEntry = originalRequire;
      }
      expect(store.requireQueueEntry(action.id)).toMatchObject({ status: "leased", leasedBy: "runner-a", attempt: 0 });
    } finally {
      store.close();
    }
  });

  test("validates spec shape before persistence", () => {
    const duplicate = {
      ...exampleAutomationSpec(),
      actions: [
        { id: "same", actionId: "one" },
        { id: "same", actionId: "two" },
      ],
    };
    expect(() => validateAutomationSpec(duplicate)).toThrow("duplicate automation action step id");

    const missingDependency = {
      ...exampleAutomationSpec(),
      actions: [
        { id: "first", actionId: "one", dependsOn: ["missing"] },
      ],
    };
    expect(() => validateAutomationSpec(missingDependency)).toThrow("depends on unknown step");

    const invalidTrigger = {
      ...exampleAutomationSpec(),
      triggers: [{ kind: "invalid" }],
    };
    expect(() => validateAutomationSpec(invalidTrigger as never)).toThrow("unsupported automation trigger kind");

    const staticApprovalDecision = {
      ...exampleAutomationSpec(),
      actions: [
        {
          id: "dangerous",
          actionId: "dangerous.write",
          approvalGate: {
            requirement: { mode: "manual", requiresApproval: true },
            blockedUntilApproved: false,
            decision: {
              id: "preapproved",
              status: "approved",
              requestedAt: "2026-06-28T00:00:00.000Z",
              decidedAt: "2026-06-28T00:00:00.000Z",
            },
          },
        },
      ],
    };
    expect(() => validateAutomationSpec(staticApprovalDecision as never)).toThrow("approval gate templates cannot include decisions");
  });

  test("migrates a populated published-0.2.0 store (schema 3, no claim_version) to schema 7 preserving rows", () => {
    // The published 0.2.0 store (STORE_SCHEMA_VERSION = 3) created the
    // claim-family columns (claimed_by/claimed_at) and NO claim_version.
    // Opening it with this version must backfill claim_version, rename the
    // claim family to the lease family, remap the persisted status vocabulary,
    // and preserve every row — instead of failing on the rename of a column
    // that does not exist.
    const dbPath = join(dataDir, "automations.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        spec_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_json TEXT NOT NULL,
        trigger_event_id TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        metadata_json TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
      );
      CREATE TABLE automation_actions (
        id TEXT PRIMARY KEY,
        automation_run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        invocation_json TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claimed_by TEXT,
        claimed_at TEXT,
        lease_expires_at TEXT,
        approval_gate_json TEXT,
        result_json TEXT,
        error_json TEXT,
        dead_letter_json TEXT,
        metadata_json TEXT,
        FOREIGN KEY (automation_run_id) REFERENCES automation_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE automation_replay_requests (
        id TEXT PRIMARY KEY,
        source_run_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        requested_by TEXT,
        mode TEXT NOT NULL,
        reason TEXT,
        metadata_json TEXT,
        FOREIGN KEY (source_run_id) REFERENCES automation_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE daemon_leases (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE TABLE webhook_routes (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        signature_json TEXT,
        mapping_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
      );
      PRAGMA user_version = 3;
    `);
    legacy.exec(`
      INSERT INTO automations (id, spec_json, status, created_at, updated_at) VALUES
        ('legacy-automation', '{"schemaVersion":"1.0","id":"legacy-automation","name":"legacy","version":"1.0.0","status":"active","triggers":[{"kind":"manual"}],"actions":[]}', 'active', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
      INSERT INTO automation_runs (id, automation_id, status, trigger_json, created_at, updated_at) VALUES
        ('legacy-run', 'legacy-automation', 'pending', '{"kind":"manual"}', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
      INSERT INTO automation_actions (
        id, automation_run_id, step_id, action_id, idempotency_key, status, invocation_json,
        attempt, max_attempts, available_at, created_at, updated_at, claimed_by, claimed_at, lease_expires_at
      ) VALUES
        ('legacy-queued', 'legacy-run', 'queued-step', 'actions.required', 'legacy-queued', 'queued', '{}', 0, 3, '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', NULL, NULL, NULL),
        ('legacy-claimed', 'legacy-run', 'claimed-step', 'actions.required', 'legacy-claimed', 'claimed', '{}', 1, 3, '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', 'worker-a', '2026-07-24T00:00:00.000Z', '2026-07-24T00:10:00.000Z'),
        ('legacy-retrying', 'legacy-run', 'retrying-step', 'actions.required', 'legacy-retrying', 'retrying', '{}', 1, 3, '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', 'worker-b', '2026-07-24T00:00:00.000Z', NULL),
        ('legacy-succeeded', 'legacy-run', 'succeeded-step', 'actions.required', 'legacy-succeeded', 'succeeded', '{}', 2, 3, '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', 'worker-c', '2026-07-24T00:00:00.000Z', NULL)
    `);
    legacy.close();

    const store = new AutomationsStore();
    try {
      const status = store.status();
      expect(status.counts).toMatchObject({
        queueDepth: 4,
        admitted: 2,
        leased: 1,
        terminal: 1,
      });
      const queue = store.listQueueEntries();
      const byId = new Map(queue.map((entry) => [entry.id, entry]));
      // Row preservation and vocabulary translation: queued/retrying -> admitted,
      // claimed -> leased, with the claim-family columns renamed to the lease
      // family and claim_version backfilled as lease_generation 0.
      expect(byId.get("legacy-queued")?.status).toBe("admitted");
      expect(byId.get("legacy-retrying")?.status).toBe("admitted");
      expect(byId.get("legacy-claimed")).toMatchObject({
        status: "leased",
        leasedBy: "worker-a",
        leaseGeneration: 0,
      });
      expect(byId.get("legacy-claimed")?.leasedAt).toBe("2026-07-24T00:00:00.000Z");
      expect(byId.get("legacy-claimed")?.leaseExpiresAt).toBe("2026-07-24T00:10:00.000Z");
      // Terminal statuses are not translated and their rows are preserved.
      expect(byId.get("legacy-succeeded")?.status).toBe("succeeded");
      expect(status.counts.terminal).toBe(1);
    } finally {
      store.close();
    }

    // Reopen is idempotent: the second open must not re-run or fail.
    const reopened = new AutomationsStore();
    try {
      const again = reopened.status();
      expect(again.counts).toMatchObject({ queueDepth: 4, admitted: 2, leased: 1, terminal: 1 });
      const version = new Database(dbPath).query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(7);
    } finally {
      reopened.close();
    }
  });
});
