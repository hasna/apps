import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ensureParentDir, getNotificationsPath } from "../paths.js";
import type { NotificationChannel, NotificationConfig, NotificationTestResult } from "../types.js";

const notificationChannelSchema = z.object({
  id: z.string(),
  type: z.enum(["email", "webhook", "command"]),
  target: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
});

const notificationConfigSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().optional(),
  channels: z.array(notificationChannelSchema),
});

function sortChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return [...channels].sort((left, right) => left.id.localeCompare(right.id));
}

export function getDefaultNotificationConfig(): NotificationConfig {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    channels: [],
  };
}

export function readNotificationConfig(path = getNotificationsPath()): NotificationConfig {
  if (!existsSync(path)) {
    return getDefaultNotificationConfig();
  }

  return notificationConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeNotificationConfig(config: NotificationConfig, path = getNotificationsPath()): NotificationConfig {
  ensureParentDir(path);
  const nextConfig: NotificationConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    channels: sortChannels(config.channels),
  };
  writeFileSync(path, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return nextConfig;
}

export function listNotificationChannels(): NotificationConfig {
  return readNotificationConfig();
}

export function addNotificationChannel(channel: NotificationChannel): NotificationConfig {
  const config = readNotificationConfig();
  const channels = config.channels.filter((entry) => entry.id !== channel.id);
  channels.push({
    ...channel,
    events: [...new Set(channel.events)],
  });
  return writeNotificationConfig({ ...config, channels });
}

export function removeNotificationChannel(channelId: string): NotificationConfig {
  const config = readNotificationConfig();
  return writeNotificationConfig({
    ...config,
    channels: config.channels.filter((channel) => channel.id !== channelId),
  });
}

function buildNotificationPreview(channel: NotificationChannel, event: string, message: string): string {
  if (channel.type === "email") {
    return `send email to ${channel.target}: [${event}] ${message}`;
  }

  if (channel.type === "webhook") {
    return `POST ${channel.target} with payload {"event":"${event}","message":"${message}"}`;
  }

  return `${channel.target} --event ${event} --message ${JSON.stringify(message)}`;
}

export function testNotificationChannel(
  channelId: string,
  event = "manual.test",
  message = "machines notification test",
  options: { apply?: boolean; yes?: boolean } = {}
): NotificationTestResult {
  const channel = readNotificationConfig().channels.find((entry) => entry.id === channelId);
  if (!channel) {
    throw new Error(`Notification channel not found: ${channelId}`);
  }

  const preview = buildNotificationPreview(channel, event, message);
  if (!options.apply) {
    return {
      channelId,
      mode: "plan",
      delivered: false,
      preview,
    };
  }

  if (!options.yes) {
    throw new Error("Notification test execution requires --yes.");
  }

  if (channel.type === "command") {
    const result = Bun.spawnSync(["bash", "-lc", preview], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Notification command failed (${channel.id}): ${result.stderr.toString().trim()}`);
    }
  }

  return {
    channelId,
    mode: "apply",
    delivered: channel.enabled,
    preview,
  };
}
