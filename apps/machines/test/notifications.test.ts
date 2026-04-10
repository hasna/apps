import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addNotificationChannel,
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

  test("tests channel in plan mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-notify-"));
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");

    addNotificationChannel({
      id: "webhook",
      type: "webhook",
      target: "https://example.com/hook",
      events: ["sync_failed"],
      enabled: true,
    });

    const result = testNotificationChannel("webhook", "sync_failed", "drift detected");
    expect(result.mode).toBe("plan");
    expect(result.preview).toContain("POST https://example.com/hook");
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
