import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { z } from "zod";
import { ensureParentDir, getNotificationsPath } from "../paths.js";
import { assertMutationApproved } from "./mutation-approval.js";
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
  commandArgs: z.array(z.string()).optional(),
  events: z.array(z.string()),
  enabled: z.boolean(),
});

const notificationConfigSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().optional(),
  channels: z.array(notificationChannelSchema),
});

const trustedNotificationApproval = Symbol("trustedNotificationApproval");

export type TrustedNotificationApproval = {
  readonly [trustedNotificationApproval]: true;
};

export function createTrustedNotificationApproval(): TrustedNotificationApproval {
  return { [trustedNotificationApproval]: true };
}

function isTrustedNotificationApproval(approval: TrustedNotificationApproval | undefined): boolean {
  return approval?.[trustedNotificationApproval] === true;
}

function sortChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return [...channels].sort((left, right) => left.id.localeCompare(right.id));
}

function hasCommand(binary: string): boolean {
  return Boolean(resolveExecutable(binary));
}

function resolveExecutable(binary: string): string | null {
  const trimmed = binary.trim();
  if (!trimmed) return null;
  const candidates = isAbsolute(trimmed)
    ? [trimmed]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, trimmed));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function buildNotificationPreview(channel: NotificationChannel, event: string, message: string): string {
  if (channel.type === "email") {
    return `send email to ${channel.target}: [${event}] ${message}`;
  }

  if (channel.type === "webhook") {
    return `POST ${channel.target} with payload {\"event\":\"${event}\",\"message\":\"${message}\"}`;
  }

  const args = channel.commandArgs?.length ? ` ${channel.commandArgs.join(" ")}` : "";
  return `${channel.target}${args} with HASNA_MACHINES_NOTIFICATION_* environment`;
}

async function dispatchEmail(channel: NotificationChannel, event: string, message: string): Promise<NotificationDispatchResult> {
  const subject = `[${event}] machines notification`;
  const body = `To: ${channel.target}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${message}\n`;

  if (hasCommand("sendmail")) {
    const result = Bun.spawnSync(["sendmail", "-t"], {
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
    const result = Bun.spawnSync(["mail", "-s", subject, channel.target], {
      stdin: new TextEncoder().encode(`${message}\n`),
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

async function dispatchCommand(
  channel: NotificationChannel,
  event: string,
  message: string,
  options: { approvalToken?: string; trustedApproval?: TrustedNotificationApproval } = {}
): Promise<NotificationDispatchResult> {
  if (!isTrustedNotificationApproval(options.trustedApproval)) {
    assertMutationApproved({
      surface: "notifications",
      operation: "dispatch_command",
      resourceId: channel.id,
      approvalToken: options.approvalToken,
    });
  }

  const executable = resolveExecutable(channel.target);
  if (!executable) {
    throw new Error(`Command executable not found or not executable: ${channel.target}`);
  }

  const result = Bun.spawnSync([executable, ...(channel.commandArgs ?? [])], {
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

async function dispatchChannel(
  channel: NotificationChannel,
  event: string,
  message: string,
  options: { approvalToken?: string; trustedApproval?: TrustedNotificationApproval } = {}
): Promise<NotificationDispatchResult> {
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

  return dispatchCommand(channel, event, message, options);
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

export function addNotificationChannel(
  channel: NotificationChannel,
  options: { approvalToken?: string; trustedApproval?: TrustedNotificationApproval } = {},
): NotificationConfig {
  if (channel.type === "command" && !isTrustedNotificationApproval(options.trustedApproval)) {
    assertMutationApproved({
      surface: "notifications",
      operation: "add_command_channel",
      resourceId: channel.id,
      approvalToken: options.approvalToken,
    });
  }

  const config = readNotificationConfig();
  const channels = config.channels.filter((entry) => entry.id !== channel.id);
  channels.push({
    ...channel,
    commandArgs: channel.commandArgs?.map(String),
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
  options: { channelId?: string; approvalToken?: string; trustedApproval?: TrustedNotificationApproval } = {}
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
      deliveries.push(await dispatchChannel(channel, event, message, { approvalToken: options.approvalToken, trustedApproval: options.trustedApproval }));
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
  options: { apply?: boolean; yes?: boolean; approvalToken?: string; trustedApproval?: TrustedNotificationApproval } = {}
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

  const delivery = await dispatchChannel(channel, event, message, { approvalToken: options.approvalToken, trustedApproval: options.trustedApproval });
  return {
    channelId,
    mode: "apply",
    delivered: delivery.delivered,
    preview,
    detail: delivery.detail,
  };
}
