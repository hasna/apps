import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { EventsClient } from "@hasna/events";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { addNotificationChannel } from "../src/commands/notifications.js";
import { createMutationApprovalToken, mutationArgsSha256, MUTATION_APPROVAL_FLAG_ENV, MUTATION_APPROVAL_TOKEN_ENV } from "../src/commands/mutation-approval.js";
import { getServeInfo, renderDashboardHtml, startDashboardServer } from "../src/commands/serve.js";
import { upsertHeartbeat } from "../src/db.js";
import { PRIVATE_OUTPUT_DENIED_WARNING } from "../src/redaction.js";

const dashboardMutationSecret = "serve-dashboard-test-secret";

function dashboardResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = parts
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return values ? `${kind}:${values}` : kind;
}

function eventStoreDir(dir: string): string {
  return resolve(join(dir, "events"));
}

function eventStoreResourceId(kind: string, dir: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  return dashboardResourceId(kind, mutationArgsSha256({ event_store_dir: eventStoreDir(dir) }), ...parts);
}

function withEventStoreScope(dir: string, args: Record<string, unknown>): Record<string, unknown> {
  return { event_store_dir: eventStoreDir(dir), ...args };
}

function dashboardToken(operation: string, resourceId: string, args: unknown): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation,
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    resourceId,
    args,
  }, { secret: dashboardMutationSecret });
}

function eventEmitApproval(dir: string, type: string, args: {
  source?: string;
  subject?: string;
  severity?: string;
  message?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
} = {}): string {
  const source = args.source ?? "machines";
  const data = args.data ?? {};
  const metadata = args.metadata ?? {};
  return dashboardToken("machines_events_emit", eventStoreResourceId("event", dir, type, args.subject, args.dedupeKey), withEventStoreScope(dir, {
    event_type: type,
    source,
    subject: args.subject,
    severity: args.severity,
    message: args.message,
    data,
    metadata,
    dedupe_key: args.dedupeKey,
    deliver: true,
    dedupe: true,
  }));
}

function notificationTestApproval(channelId: string, args: {
  event?: string;
  message?: string;
  apply?: boolean;
  yes?: boolean;
} = {}): string {
  const event = args.event ?? "manual.test";
  const message = args.message ?? "machines notification test";
  const apply = args.apply === true;
  const yes = args.yes === true;
  return dashboardToken("machines_notifications_test", dashboardResourceId("notification-test", channelId, event), {
    channel_id: channelId,
    event,
    message,
    apply,
    yes,
  });
}

function webhookTestApproval(dir: string, channelId: string, args: {
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
} = {}): string {
  const type = args.type ?? "events.test";
  const subject = channelId;
  const message = args.message ?? "Hasna events test delivery";
  const data = args.data ?? {};
  return dashboardToken("machines_webhooks_test", eventStoreResourceId("webhook-test", dir, channelId, type), withEventStoreScope(dir, {
    channel_id: channelId,
    event_type: type,
    subject,
    message,
    data,
  }));
}

describe("serve", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT"];
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];
    delete process.env[MUTATION_APPROVAL_TOKEN_ENV];
    delete process.env["HASNA_EVENTS_DIR"];
  });

  test("returns default serve info", () => {
    const info = getServeInfo();
    expect(info.host).toBe("127.0.0.1");
    expect(info.port).toBe(7676);
    expect(info.routes).toContain("/api/status");
    expect(info.routes).toContain("/api/topology");
    expect(info.routes).toContain("/api/routes");
    expect(info.routes).toContain("/api/daemon/status");
    expect(info.routes).toContain("/api/doctor");
  });

  test("renders dashboard html", () => {
    const html = renderDashboardHtml();
    expect(html).toContain("<title>Machines Dashboard</title>");
    expect(html).toContain("Machines Dashboard");
    expect(html).toContain("Doctor");
    expect(html).toContain("Self Test");
    expect(html).toContain("Apps");
    expect(html).toContain("AI CLIs");
  });

  test("serves new JSON endpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      hostname: "demo-node-01.private.example",
      sshAddress: "operator@demo-node-01.private.example",
      tailscaleName: "demo-node-01.tailnet.example",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{ name: "shell", manager: "custom", packageName: "sh" }],
    });
    upsertHeartbeat("demo-node-01", 42, "online", {
      agentMode: "daemon",
      tailscale: { selfDnsName: "demo-node-01.tailnet.example", selfTailscaleIps: ["100.64.0.7"] },
      storageSyncLastError: "postgres://user:pass@10.0.0.5:5432/machines failed",
      doctorSummary: {
        summary: { ok: 1, warn: 1, fail: 0 },
        blockers: [{ detail: "operator@demo-node-01.private.example 100.64.0.7" }],
      },
      privateMetadata: true,
    });
    process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
    addNotificationChannel({
      id: "local",
      type: "command",
      target: "printf ok",
      events: ["manual.test"],
      enabled: true,
    });
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];
    await new EventsClient().addChannel({
      id: "events-local",
      enabled: true,
      transport: "command",
      command: { command: "printf", args: ["ok"] },
      filters: [{ source: "machines" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;

    const doctor = await fetch(`${base}/api/doctor`).then((response) => response.json());
    const topology = await fetch(`${base}/api/topology?tailscale=false`).then((response) => response.json());
    const deniedPrivateTopology = await fetch(`${base}/api/topology?tailscale=false&privateMetadata=true`).then((response) => response.json());
    const deniedPrivateDaemon = await fetch(`${base}/api/daemon/status?privateMetadata=true`).then((response) => response.json());
    process.env["HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT"] = "1";
    const privateTopology = await fetch(`${base}/api/topology?tailscale=false&privateMetadata=true`).then((response) => response.json());
    const routes = await fetch(`${base}/api/routes?tailscale=false`).then((response) => response.json());
    const daemon = await fetch(`${base}/api/daemon/status`).then((response) => response.json());
    const selfTest = await fetch(`${base}/api/self-test`).then((response) => response.json());
    const apps = await fetch(`${base}/api/apps/status`).then((response) => response.json());
    const webhooks = await fetch(`${base}/api/webhooks`).then((response) => response.json());
    const emitted = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "machines.test",
        data: { ok: true },
        approval_token: eventEmitApproval(dir, "machines.test", { data: { ok: true } }),
      }),
    }).then((response) => response.json());
    const listedEvents = await fetch(`${base}/api/events`).then((response) => response.json());
    const dispatch = await fetch(`${base}/api/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: "local", approval_token: notificationTestApproval("local") }),
    }).then((response) => response.json());

    server.stop(true);

    expect(Array.isArray(doctor.checks)).toBe(true);
    expect(Array.isArray(topology.machines)).toBe(true);
    expect(Array.isArray(routes.routes)).toBe(true);
    expect(Array.isArray(daemon.agents)).toBe(true);
    expect(JSON.stringify(topology)).not.toContain("demo-node-01.tailnet.example");
    expect(JSON.stringify(topology)).not.toContain("100.64.0.7");
    expect(JSON.stringify(routes)).not.toContain("operator@demo-node-01.private.example");
    expect(JSON.stringify(daemon)).not.toContain("postgres://user:pass");
    expect(JSON.stringify(daemon)).not.toContain("100.64.0.7");
    expect(deniedPrivateTopology.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(deniedPrivateTopology)).not.toContain("demo-node-01.tailnet.example");
    expect(deniedPrivateDaemon.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(privateTopology)).toContain("demo-node-01.tailnet.example");
    expect(Array.isArray(selfTest.checks)).toBe(true);
    expect(Array.isArray(apps.apps)).toBe(true);
    expect(webhooks[0].id).toBe("events-local");
    expect(emitted.event.type).toBe("machines.test");
    expect(Array.isArray(listedEvents)).toBe(true);
    expect(dispatch.channelId).toBe("local");
  });

  test("dashboard POST mutation routes require scoped approval tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-security-"));
    const eventProof = join(dir, "event-proof.txt");
    const notificationProof = join(dir, "notification-proof.txt");
    const webhookProof = join(dir, "webhook-proof.txt");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;

    process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
    addNotificationChannel({
      id: "notify-command",
      type: "command",
      target: "/bin/sh",
      commandArgs: ["-c", `printf notify > ${JSON.stringify(notificationProof)}`],
      events: ["manual.test"],
      enabled: true,
    });
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];

    await new EventsClient().addChannel({
      id: "emit-command",
      enabled: true,
      transport: "command",
      command: { command: "sh", args: ["-c", "printf event > \"$1\"", "sh", eventProof] },
      filters: [{ source: "machines", type: "machines.secure" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await new EventsClient().addChannel({
      id: "event-command",
      enabled: true,
      transport: "command",
      command: { command: "sh", args: ["-c", "printf webhook > \"$1\"", "sh", webhookProof] },
      filters: [{ source: "machines", type: "events.test" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const eventWithoutToken = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "blocked" }),
      });
      expect(eventWithoutToken.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      const envFlagOnly = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "blocked" }),
      });
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      expect(envFlagOnly.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const eventToken = eventEmitApproval(dir, "machines.secure", { message: "approved" });
      const tamperedEvent = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "tampered", approval_token: eventToken }),
      });
      expect(tamperedEvent.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const cliSurfaceToken = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_events_emit",
        transport: "cli",
        callerId: "dashboard",
        runId: "dashboard",
        resourceId: eventStoreResourceId("event", dir, "machines.secure", undefined, undefined),
        args: withEventStoreScope(dir, {
          event_type: "machines.secure",
          source: "machines",
          subject: undefined,
          severity: undefined,
          message: "approved",
          data: {},
          metadata: {},
          dedupe_key: undefined,
          deliver: true,
          dedupe: true,
        }),
      }, { secret: dashboardMutationSecret });
      const wrongSurface = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: cliSurfaceToken }),
      });
      expect(wrongSurface.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const wrongStoreToken = eventEmitApproval(join(dir, "other-store-root"), "machines.secure", { message: "approved" });
      const wrongStore = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: wrongStoreToken }),
      });
      expect(wrongStore.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const approvedEvent = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: eventToken }),
      });
      expect(approvedEvent.status).toBe(200);
      expect((await approvedEvent.json()).event.type).toBe("machines.secure");
      expect(readFileSync(eventProof, "utf8")).toBe("event");

      const notificationWithoutToken = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true }),
      });
      expect(notificationWithoutToken.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      const notificationEnvFlagOnly = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true }),
      });
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      expect(notificationEnvFlagOnly.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      const notificationPlanToken = notificationTestApproval("notify-command");
      const tamperedNotification = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true, approval_token: notificationPlanToken }),
      });
      expect(tamperedNotification.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      const notificationToken = notificationTestApproval("notify-command", { apply: true, yes: true });
      const notificationApproved = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true, approval_token: notificationToken }),
      });
      expect(notificationApproved.status).toBe(200);
      expect((await notificationApproved.json()).delivered).toBe(true);
      expect(readFileSync(notificationProof, "utf8")).toBe("notify");

      const webhookWithoutToken = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "blocked" }),
      });
      expect(webhookWithoutToken.status).toBe(403);
      expect(existsSync(webhookProof)).toBe(false);

      const webhookToken = webhookTestApproval(dir, "event-command", { type: "events.test", message: "approved" });
      const tamperedWebhook = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "tampered", approval_token: webhookToken }),
      });
      expect(tamperedWebhook.status).toBe(403);
      expect(existsSync(webhookProof)).toBe(false);

      const webhookApproved = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${webhookToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "approved" }),
      });
      expect(webhookApproved.status).toBe(200);
      expect((await webhookApproved.json()).channelId).toBe("event-command");
      expect(readFileSync(webhookProof, "utf8")).toBe("webhook");
    } finally {
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      server.stop(true);
    }
  });

  test("explicit all-interface bind does not relax dashboard mutation approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-bind-"));
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    const server = startDashboardServer({ host: "0.0.0.0", port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.exposed", message: "blocked" }),
      });
      expect(response.status).toBe(403);
    } finally {
      server.stop(true);
    }
  });
});
