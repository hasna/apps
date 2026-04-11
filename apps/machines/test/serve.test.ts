import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { addNotificationChannel } from "../src/commands/notifications.js";
import { getServeInfo, renderDashboardHtml, startDashboardServer } from "../src/commands/serve.js";

describe("serve", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

  test("returns default serve info", () => {
    const info = getServeInfo();
    expect(info.host).toBe("0.0.0.0");
    expect(info.port).toBe(7676);
    expect(info.routes).toContain("/api/status");
    expect(info.routes).toContain("/api/doctor");
  });

  test("renders dashboard html", () => {
    const html = renderDashboardHtml();
    expect(html).toContain("<title>Machines Dashboard</title>");
    expect(html).toContain("<h1>Machines Dashboard</h1>");
    expect(html).toContain("Doctor");
    expect(html).toContain("Self Test");
  });

  test("serves new JSON endpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      apps: [{ name: "shell", manager: "custom", packageName: "sh" }],
    });
    addNotificationChannel({
      id: "local",
      type: "command",
      target: "printf ok",
      events: ["manual.test"],
      enabled: true,
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;

    const doctor = await fetch(`${base}/api/doctor`).then((response) => response.json());
    const selfTest = await fetch(`${base}/api/self-test`).then((response) => response.json());
    const apps = await fetch(`${base}/api/apps/status`).then((response) => response.json());
    const dispatch = await fetch(`${base}/api/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: "local" }),
    }).then((response) => response.json());

    server.stop(true);

    expect(Array.isArray(doctor.checks)).toBe(true);
    expect(Array.isArray(selfTest.checks)).toBe(true);
    expect(Array.isArray(apps.apps)).toBe(true);
    expect(dispatch.channelId).toBe("local");
  });
});
