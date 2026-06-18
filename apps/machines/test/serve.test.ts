import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventsClient } from "@hasna/events";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { addNotificationChannel } from "../src/commands/notifications.js";
import { getServeInfo, renderDashboardHtml, startDashboardServer } from "../src/commands/serve.js";
import { upsertHeartbeat } from "../src/db.js";
import { PRIVATE_OUTPUT_DENIED_WARNING } from "../src/redaction.js";

describe("serve", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT"];
    delete process.env["HASNA_EVENTS_DIR"];
  });

  test("returns default serve info", () => {
    const info = getServeInfo();
    expect(info.host).toBe("0.0.0.0");
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
    addNotificationChannel({
      id: "local",
      type: "command",
      target: "printf ok",
      events: ["manual.test"],
      enabled: true,
    });
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
      body: JSON.stringify({ type: "machines.test", data: { ok: true } }),
    }).then((response) => response.json());
    const listedEvents = await fetch(`${base}/api/events`).then((response) => response.json());
    const dispatch = await fetch(`${base}/api/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: "local" }),
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
});
