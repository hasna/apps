import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addNotificationChannel,
  dispatchNotificationEvent,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../src/commands/notifications.js";

describe("notifications", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
  });

  test("adds and lists channels", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    addNotificationChannel({
      id: "ops",
      type: "email",
      target: "ops@example.com",
      events: ["setup_failed"],
      enabled: true,
    });

    const config = listNotificationChannels();
    expect(config.channels).toHaveLength(1);
    expect(config.channels[0]?.id).toBe("ops");
  });

  test("tests channel in plan mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    addNotificationChannel({
      id: "webhook",
      type: "webhook",
      target: "https://example.com/hook",
      events: ["sync_failed"],
      enabled: true,
    });

    const result = await testNotificationChannel("webhook", "sync_failed", "drift detected");
    expect(result.mode).toBe("plan");
    expect(result.preview).toContain("POST https://example.com/hook");
    expect(result.detail).toBe("Preview only");
  });

  test("dispatches command notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-command-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    addNotificationChannel({
      id: "local",
      type: "command",
      target: "printf 'ok:%s' \"$HASNA_MACHINES_NOTIFICATION_EVENT\"",
      events: ["manual.test"],
      enabled: true,
    });

    const result = await testNotificationChannel("local", "manual.test", "hello", { apply: true, yes: true });
    expect(result.mode).toBe("apply");
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain("ok:manual.test");

    const summary = await dispatchNotificationEvent("manual.test", "hello");
    expect(summary.deliveries).toHaveLength(1);
    expect(summary.deliveries[0]?.delivered).toBe(true);
  });

  test("dispatches webhook notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-webhook-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    let received: Record<string, unknown> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        received = (await request.json()) as Record<string, unknown>;
        return Response.json({ ok: true });
      },
    });

    addNotificationChannel({
      id: "hook",
      type: "webhook",
      target: `http://127.0.0.1:${server.port}/hook`,
      events: ["manual.test"],
      enabled: true,
    });

    const result = await testNotificationChannel("hook", "manual.test", "payload", { apply: true, yes: true });
    server.stop(true);

    expect(result.delivered).toBe(true);
    expect(result.detail).toContain("HTTP 200");
    expect(received?.event).toBe("manual.test");
    expect(received?.message).toBe("payload");
  });

  test("removes channels", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    addNotificationChannel({
      id: "local",
      type: "command",
      target: "echo ok",
      events: ["manual.test"],
      enabled: true,
    });

    const config = removeNotificationChannel("local");
    expect(config.channels).toHaveLength(0);
  });
});
