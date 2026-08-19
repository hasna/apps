import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleAutomationSpec } from "../lib/store.js";
import { SqliteServerAutomationsStore } from "./sqlite-store.js";

let dataDir = "";
let store: SqliteServerAutomationsStore;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-server-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
  store = new SqliteServerAutomationsStore();
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("SqliteServerAutomationsStore.ensureAutomation", () => {
  test("inserts a new automation when the id is absent", async () => {
    const spec = exampleAutomationSpec();
    const installed = await store.ensureAutomation(spec);
    expect(installed.id).toBe(spec.id);
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("is idempotent for identical content and never duplicates the row", async () => {
    const spec = exampleAutomationSpec();
    const first = await store.ensureAutomation(spec);
    const second = await store.ensureAutomation(spec);
    expect(second.id).toBe(first.id);
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("refuses conflicting content without mutating the existing row", async () => {
    const spec = exampleAutomationSpec();
    await store.ensureAutomation(spec);
    const conflicting = exampleAutomationSpec();
    conflicting.version = "2.0.0";
    await expect(store.ensureAutomation(conflicting)).rejects.toThrow(/immutable template installs cannot overwrite/);
    const rows = await store.listAutomations();
    expect(rows.length).toBe(1);
    expect(rows[0].spec.version).toBe("1.0.0");
  });
});

// agent-authored (SOL consult bounded: capacity refusal + wall-time exhaustion)

describe("SqliteServerAutomationsStore webhook route lifecycle", () => {
  test("counts, lists, and resolves routes by id and by path", async () => {
    await store.ensureAutomation(exampleAutomationSpec());
    const route = await store.createWebhookRoute({
      id: "github-main",
      automationId: "tickets.escalate-critical",
      path: "/webhooks/github/main",
      signature: {
        algorithm: "hmac-sha256",
        secretRef: "secret://automations/webhooks/github-main",
      },
      mapping: { source: "github", type: "push" },
    });
    expect(route.id).toBe("github-main");
    expect(await store.countWebhookRoutes()).toBe(1);
    expect((await store.listWebhookRoutes()).map(({ id }) => id)).toEqual(["github-main"]);
    expect((await store.requireWebhookRoute("github-main")).id).toBe("github-main");
    expect((await store.requireWebhookRoute("/webhooks/github/main")).id).toBe("github-main");
    await expect(store.requireWebhookRoute("missing-route")).rejects.toThrow("webhook route not found: missing-route");
  });

  test("setWebhookRouteStatus transitions by id or path and rejects unknown statuses", async () => {
    await store.ensureAutomation(exampleAutomationSpec());
    await store.createWebhookRoute({
      id: "github-main",
      automationId: "tickets.escalate-critical",
      path: "/webhooks/github/main",
      signature: { algorithm: "hmac-sha256", secretRef: "secret://automations/webhooks/github-main" },
      mapping: { source: "github", type: "push" },
    });
    expect((await store.setWebhookRouteStatus("github-main", "disabled")).status).toBe("disabled");
    expect((await store.setWebhookRouteStatus("/webhooks/github/main", "archived")).status).toBe("archived");
    await expect(store.setWebhookRouteStatus("github-main", "broken" as never)).rejects.toThrow(
      "unsupported webhook route status: broken",
    );
  });

  test("rotateWebhookRouteSecret replaces only the secretRef and persists no raw secret", async () => {
    await store.ensureAutomation(exampleAutomationSpec());
    await store.createWebhookRoute({
      id: "github-main",
      automationId: "tickets.escalate-critical",
      path: "/webhooks/github/main",
      signature: { algorithm: "hmac-sha256", secretRef: "secret://automations/webhooks/github-main" },
      mapping: { source: "github", type: "push" },
    });
    const rotated = await store.rotateWebhookRouteSecret(
      "github-main",
      "secret://automations/webhooks/github-main-v2",
    );
    expect(rotated.signature?.secretRef).toBe("secret://automations/webhooks/github-main-v2");
    expect(rotated.signature?.algorithm).toBe("hmac-sha256");
    const again = await store.requireWebhookRoute("github-main");
    expect(again.signature?.secretRef).toBe("secret://automations/webhooks/github-main-v2");
  });

  test("rotateWebhookRouteSecret refuses an empty ref and a route without signature config", async () => {
    await store.ensureAutomation(exampleAutomationSpec());
    await store.createWebhookRoute({
      id: "github-main",
      automationId: "tickets.escalate-critical",
      path: "/webhooks/github/main",
      signature: { algorithm: "hmac-sha256", secretRef: "secret://automations/webhooks/github-main" },
      mapping: { source: "github", type: "push" },
    });
    await store.createWebhookRoute({
      id: "unsigned-route",
      automationId: "tickets.escalate-critical",
      path: "/webhooks/unsigned",
      mapping: { source: "plain", type: "push" },
    });
    await expect(store.rotateWebhookRouteSecret("github-main", "")).rejects.toThrow("webhook route secretRef is required");
    await expect(store.rotateWebhookRouteSecret("unsigned-route", "secret://automations/webhooks/unsigned-v2")).rejects.toThrow(
      "webhook route has no signature config: unsigned-route",
    );
  });
});

describe("SqliteServerAutomationsStore replay requests", () => {
  test("round-trips a replay request against an existing run and refuses unknown ids", async () => {
    await store.ensureAutomation(exampleAutomationSpec());
    const run = await store.createRun({
      id: "run_replay_src",
      automationId: "tickets.escalate-critical",
      trigger: { kind: "manual" },
    });
    const replay = await store.createReplayRequest({
      id: "replay_route_1",
      sourceRunId: run.id,
      mode: "failed-actions",
      reason: "retry after fix",
      requestedBy: "tester",
    });
    expect(replay.mode).toBe("failed-actions");
    expect(replay.sourceRunId).toBe(run.id);
    expect(replay.requestedBy).toBe("tester");
    const fetched = await store.requireReplayRequest("replay_route_1");
    expect(fetched.id).toBe("replay_route_1");
    expect(fetched.reason).toBe("retry after fix");
    await expect(store.requireReplayRequest("missing-replay")).rejects.toThrow("replay request not found: missing-replay");
  });
});

describe("SqliteServerAutomationsStore daemon lease", () => {
  test("heartbeat creates a lease and latestDaemonLease tracks the newest heartbeat", async () => {
    const first = await store.heartbeatDaemon({ now: new Date("2026-08-11T00:00:00.000Z"), ttlMs: 30_000 });
    expect(first.heartbeat_at).toBe("2026-08-11T00:00:00.000Z");
    expect(first.expires_at).toBe("2026-08-11T00:00:30.000Z");
    const second = await store.heartbeatDaemon({
      leaseId: "daemon:other-host:1",
      now: new Date("2026-08-11T00:00:01.000Z"),
      ttlMs: 30_000,
    });
    expect(second.id).toBe("daemon:other-host:1");
    expect((await store.latestDaemonLease())?.id).toBe("daemon:other-host:1");
  });

  test("renewing a lease id extends the same row instead of duplicating it", async () => {
    const first = await store.heartbeatDaemon({ now: new Date("2026-08-11T00:00:00.000Z"), ttlMs: 30_000 });
    const renewed = await store.heartbeatDaemon({
      leaseId: first.id,
      now: new Date("2026-08-11T00:00:10.000Z"),
      ttlMs: 60_000,
    });
    expect(renewed.id).toBe(first.id);
    expect(renewed.heartbeat_at).toBe("2026-08-11T00:00:10.000Z");
    expect(renewed.expires_at).toBe("2026-08-11T00:01:10.000Z");
    const leases = (await store.status(new Date("2026-08-11T00:00:10.000Z"))).daemon;
    expect(leases.active).toBe(true);
  });

  test("status reports the daemon inactive once the latest lease has expired", async () => {
    await store.heartbeatDaemon({ now: new Date("2026-08-11T00:00:00.000Z"), ttlMs: 30_000 });
    const status = await store.status(new Date("2026-08-11T00:00:31.000Z"));
    expect(status.daemon.active).toBe(false);
  });
});
