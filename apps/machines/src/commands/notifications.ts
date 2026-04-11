import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ensureParentDir, getNotificationsPath } from "../paths.js";
import type {
  NotificationChannel,
  NotificationConfig,
  NotificationDispatchResult,
  NotificationDispatchSummary,
  NotificationTestResult,
} from "../types.js";

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasCommand(binary: string): boolean {
  const result = Bun.spawnSync(["bash", "-lc", `command -v ${binary} >/dev/null 2>&1`], {
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  return result.exitCode === 0;
}

function buildNotificationPreview(channel: NotificationChannel, event: string, message: string): string {
  if (channel.type === "email") {
    return `send email to ${channel.target}: [${event}] ${message}`;
  }

  if (channel.type === "webhook") {
    return `POST ${channel.target} with payload {\"event\":\"${event}\",\"message\":\"${message}\"}`;
  }

  return `${channel.target} --event ${event} --message ${JSON.stringify(message)}`;
}

async function dispatchEmail(channel: NotificationChannel, event: string, message: string): Promise<NotificationDispatchResult> {
  const subject = `[${event}] machines notification`;
  const body = `To: ${channel.target}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${message}\n`;

  if (hasCommand("sendmail")) {
    const result = Bun.spawnSync(["bash", "-lc", "sendmail -t"], {
      stdin: new TextEncoder().encode(body),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim() || `sendmail exited with ${result.exitCode}`);
    }
    return {
      channelId: channel.id,
      event,
      delivered: true,
      transport: channel.type,
      detail: `Delivered via sendmail to ${channel.target}`,
    };
  }

  if (hasCommand("mail")) {
    const command = `printf %s ${shellQuote(message)} | mail -s ${shellQuote(subject)} ${shellQuote(channel.target)}`;
    const result = Bun.spawnSync(["bash", "-lc", command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim() || `mail exited with ${result.exitCode}`);
    }
    return {
      channelId: channel.id,
      event,
      delivered: true,
      transport: channel.type,
      detail: `Delivered via mail to ${channel.target}`,
    };
  }

  throw new Error("No local email transport available. Install sendmail or mail.");
}

async function dispatchWebhook(channel: NotificationChannel, event: string, message: string): Promise<NotificationDispatchResult> {
  const response = await fetch(channel.target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channelId: channel.id,
      event,
      message,
      sentAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook responded ${response.status}: ${text || response.statusText}`);
  }

  return {
    channelId: channel.id,
    event,
    delivered: true,
    transport: channel.type,
    detail: `Webhook accepted with HTTP ${response.status}`,
  };
}

async function dispatchCommand(channel: NotificationChannel, event: string, message: string): Promise<NotificationDispatchResult> {
  const result = Bun.spawnSync(["bash", "-lc", channel.target], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_MACHINES_NOTIFICATION_CHANNEL: channel.id,
      HASNA_MACHINES_NOTIFICATION_EVENT: event,
      HASNA_MACHINES_NOTIFICATION_MESSAGE: message,
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `command exited with ${result.exitCode}`);
  }

  const stdout = result.stdout.toString().trim();
  return {
    channelId: channel.id,
    event,
    delivered: true,
    transport: channel.type,
    detail: stdout || "Command completed successfully",
  };
}

async function dispatchChannel(channel: NotificationChannel, event: string, message: string): Promise<NotificationDispatchResult> {
  if (!channel.enabled) {
    return {
      channelId: channel.id,
      event,
      delivered: false,
      transport: channel.type,
      detail: "Channel is disabled",
    };
  }

  if (channel.type === "email") {
    return dispatchEmail(channel, event, message);
  }

  if (channel.type === "webhook") {
    return dispatchWebhook(channel, event, message);
  }

  return dispatchCommand(channel, event, message);
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

export async function dispatchNotificationEvent(
  event: string,
  message: string,
  options: { channelId?: string } = {}
): Promise<NotificationDispatchSummary> {
  const channels = readNotificationConfig().channels.filter((channel) => {
    if (options.channelId && channel.id !== options.channelId) {
      return false;
    }
    return channel.events.includes(event) || event === "manual.test";
  });

  const deliveries: NotificationDispatchResult[] = [];
  for (const channel of channels) {
    try {
      deliveries.push(await dispatchChannel(channel, event, message));
    } catch (error) {
      deliveries.push({
        channelId: channel.id,
        event,
        delivered: false,
        transport: channel.type,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    event,
    message,
    deliveries,
  };
}

export async function testNotificationChannel(
  channelId: string,
  event = "manual.test",
  message = "machines notification test",
  options: { apply?: boolean; yes?: boolean } = {}
): Promise<NotificationTestResult> {
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
      detail: "Preview only",
    };
  }

  if (!options.yes) {
    throw new Error("Notification test execution requires --yes.");
  }

  const delivery = await dispatchChannel(channel, event, message);
  return {
    channelId,
    mode: "apply",
    delivered: delivery.delivered,
    preview,
    detail: delivery.detail,
  };
}
