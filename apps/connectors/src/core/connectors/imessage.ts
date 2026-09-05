import pkg from "../../../package.json" with { type: "json" };
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import {
  getConnectorConfigDir,
  getConnectorConfigReadDirs,
} from "../../lib/connector-resolver.js";
import {
  defineConnector,
  type ConnectorCommandDescriptor,
  type ConnectorCommandResult,
  type ConnectorContextFactoryArgs,
} from "../connector.js";

type OutputFormat = "json" | "pretty";

interface IMessageProfileConfig {
  bridgeUrl?: string;
  apiKey?: string;
  deviceId?: string;
}

interface IMessageResolvedContext {
  configDir: string;
  profileName: string;
  profileConfig: IMessageProfileConfig;
  bridgeUrl?: string;
  apiKey?: string;
  deviceId?: string;
}

interface ParsedGlobalArgs {
  remaining: string[];
  format: OutputFormat;
  profile?: string;
  bridgeUrl?: string;
  apiKey?: string;
  deviceId?: string;
}

interface ParsedOptions {
  positionals: string[];
  options: Record<string, string | boolean>;
}

interface RunContext {
  format: OutputFormat;
  profile?: string;
  bridgeUrl?: string;
  apiKey?: string;
  deviceId?: string;
}

interface CommandSpec {
  name: string;
  description: string;
  subcommands?: string[];
}

interface NormalizedHealth {
  status: string;
  bridgeVersion?: string;
  defaultDeviceId?: string;
  connected?: boolean;
}

interface NormalizedConversation {
  id: string;
  title?: string;
  participants: string[];
  unreadCount?: number;
  lastMessageText?: string;
  lastMessageAt?: string;
}

interface NormalizedMessage {
  id: string;
  conversationId?: string;
  text: string;
  from?: string;
  to?: string;
  direction?: "inbound" | "outbound" | "unknown";
  sentAt?: string;
  status?: string;
  replyToMessageId?: string;
}

interface NormalizedListResult<T> {
  items: T[];
  nextCursor?: string;
}

const CONNECTOR_NAME = "imessage";

const COMMAND_SPECS: CommandSpec[] = [
  {
    name: "profile",
    description: "Manage configuration profiles",
    subcommands: [
      "list",
      "use <name>",
      "create <name>",
      "delete <name>",
      "show [name]",
    ],
  },
  {
    name: "config",
    description: "Manage bridge configuration",
    subcommands: [
      "set-bridge <url>",
      "set-key <apiKey>",
      "set-device <deviceId>",
      "show",
      "clear",
    ],
  },
  {
    name: "health",
    description: "Check iMessage bridge health",
    subcommands: ["check"],
  },
  {
    name: "conversation",
    description: "List and inspect conversations",
    subcommands: ["list", "get <id>"],
  },
  {
    name: "message",
    description: "List, send, and reply to messages",
    subcommands: [
      "list --conversation <id>",
      "send --to <handle> --text <text>",
      "reply --conversation <id> --text <text>",
    ],
  },
];

function buildRootHelp(specs: CommandSpec[]): string {
  const lines = [
    "Usage: connect-imessage [options] [command]",
    "",
    "iMessage bridge connector CLI",
    "",
    "Options:",
    "  -V, --version                output the version number",
    "  -u, --bridge-url <url>      Bridge base URL (overrides config)",
    "  -k, --api-key <key>         Bridge API key (overrides config)",
    "  -d, --device <deviceId>     Preferred bridge device identifier",
    '  -f, --format <format>       Output format (json, pretty) (default: "pretty")',
    "  -p, --profile <profile>     Use a specific profile",
    "  -h, --help                  display help for command",
    "",
    "Commands:",
  ];

  for (const spec of specs) {
    lines.push(`  ${spec.name.padEnd(28)}${spec.description}`);
  }

  lines.push("  help [command]               display help for command");
  return lines.join("\n");
}

function buildCommandHelp(spec: CommandSpec): string {
  const lines = [
    `Usage: connect-imessage ${spec.name}${spec.subcommands ? " [options] [command]" : " [options]"}`,
    "",
    spec.description,
    "",
    "Options:",
    "  -h, --help  display help for command",
  ];

  if (spec.subcommands?.length) {
    lines.push("", "Commands:");
    for (const subcommand of spec.subcommands) {
      lines.push(`  ${subcommand}`);
    }
    lines.push("  help [command]");
  }

  return lines.join("\n");
}

const ROOT_HELP = buildRootHelp(COMMAND_SPECS);
const COMMAND_HELP = Object.fromEntries(
  COMMAND_SPECS.map((spec) => [spec.name, buildCommandHelp(spec)])
) as Record<string, string>;
const COMMAND_DESCRIPTORS: ConnectorCommandDescriptor[] = COMMAND_SPECS.map(
  ({ name, description }) => ({
    name,
    summary: description,
    helpText: COMMAND_HELP[name],
  })
);

const IMESSAGE_DOCS = `# CLAUDE.md

## Project Overview

connect-imessage is the bridge-first iMessage connector for the one-product connectors runtime. It intentionally targets a normalized HTTP bridge contract instead of native macOS automation so the same connector definition can run locally today and back future hosted channel adapters without rewriting the API surface.

The connector exposes profile/config management plus normalized health, conversation, and message operations. Inbound message consumption and outbound send/reply are all routed through the same internal connector definition and command runtime.

## Authentication

API Key authentication is optional and depends on the bridge deployment. A bridge base URL is always required. When the bridge enforces auth, provide an API key and the connector will send it as both \`Authorization: Bearer <token>\` and \`X-API-Key: <token>\` headers for compatibility with lightweight bridge services.

## CLI Commands

- \`profile\` manages local bridge profiles
- \`config\` stores bridge URL, API key, and preferred device
- \`health\` checks bridge availability
- \`conversation\` lists or fetches normalized conversations
- \`message\` lists, sends, and replies to messages

## Environment Variables

| Variable | Description |
| --- | --- |
| \`IMESSAGE_BRIDGE_URL\` | Base URL for the iMessage bridge service |
| \`IMESSAGE_API_KEY\` | Optional API key for authenticated bridge deployments |
| \`IMESSAGE_DEVICE_ID\` | Optional preferred device identifier when the bridge supports multiple devices |

## Data Storage

Connector state is stored in the connectors data root's \`imessage/\` subdirectory. Profiles are read from both \`profiles/<name>.json\` and \`profiles/<name>/config.json\` so the connector stays compatible with the shared auth helpers while remaining fully internal to the one-product repo.
`;

const commandInputSchema = z.object({
  args: z.array(z.string()).default([]),
  format: z.enum(["json", "pretty"]).default("pretty"),
  profile: z.string().optional(),
  bridgeUrl: z.string().optional(),
  apiKey: z.string().optional(),
  deviceId: z.string().optional(),
});

const conversationListInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().optional(),
  unreadOnly: z.boolean().optional(),
});

const conversationGetInputSchema = z.object({
  id: z.string().min(1),
});

const messageListInputSchema = z.object({
  conversationId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().optional(),
});

const messageSendInputSchema = z.object({
  to: z.string().min(1),
  text: z.string().min(1),
  conversationId: z.string().optional(),
  deviceId: z.string().optional(),
});

const messageReplyInputSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
  replyToMessageId: z.string().optional(),
  deviceId: z.string().optional(),
});

function getConfigDir(): string {
  return getConnectorConfigDir(CONNECTOR_NAME);
}

function getConfigReadDirs(): string[] {
  return getConnectorConfigReadDirs(CONNECTOR_NAME);
}

function getProfilesDir(): string {
  return join(getConfigDir(), "profiles");
}

function getCurrentProfile(): string {
  for (const configDir of getConfigReadDirs()) {
    const currentProfileFile = join(configDir, "current_profile");
    if (!existsSync(currentProfileFile)) continue;

    try {
      return readFileSync(currentProfileFile, "utf-8").trim() || "default";
    } catch {
      return "default";
    }
  }

  return "default";
}

function setCurrentProfile(profile: string): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "current_profile"), profile);
}

function getFlatProfilePath(profile: string): string {
  return join(getProfilesDir(), `${profile}.json`);
}

function getDirectoryProfilePath(profile: string): string {
  return join(getProfilesDir(), profile, "config.json");
}

function getFlatProfileReadPaths(profile: string): string[] {
  return getConfigReadDirs().map((dir) => join(dir, "profiles", `${profile}.json`));
}

function getDirectoryProfileReadPaths(profile: string): string[] {
  return getConfigReadDirs().map((dir) => join(dir, "profiles", profile, "config.json"));
}

function loadJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeProfileConfig(
  config: Record<string, unknown>
): IMessageProfileConfig {
  const bridgeUrl = asString(config.bridgeUrl);
  const apiKey = asString(config.apiKey);
  const deviceId = asString(config.deviceId);

  return {
    bridgeUrl,
    apiKey,
    deviceId,
  };
}

function loadProfile(profile = getCurrentProfile()): IMessageProfileConfig {
  const flatConfig = getFlatProfileReadPaths(profile).reverse().reduce(
    (config, path) => ({ ...config, ...(existsSync(path) ? loadJsonFile(path) : {}) }),
    {} as Record<string, unknown>,
  );
  const directoryConfig = getDirectoryProfileReadPaths(profile).reverse().reduce(
    (config, path) => ({ ...config, ...(existsSync(path) ? loadJsonFile(path) : {}) }),
    {} as Record<string, unknown>,
  );

  return sanitizeProfileConfig({
    ...flatConfig,
    ...directoryConfig,
  });
}

function writeProfile(profile: string, config: IMessageProfileConfig): void {
  const profilesDir = getProfilesDir();
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(
    getFlatProfilePath(profile),
    JSON.stringify(config, null, 2) + "\n"
  );
}

function profileExists(profile: string): boolean {
  if (profile === "default") {
    return true;
  }

  return (
    getFlatProfileReadPaths(profile).some((path) => existsSync(path)) ||
    getConfigReadDirs().some((dir) => existsSync(join(dir, "profiles", profile)))
  );
}

function listProfiles(): string[] {
  const seen = new Set<string>(["default"]);

  for (const configDir of getConfigReadDirs()) {
    const profilesDir = join(configDir, "profiles");
    if (!existsSync(profilesDir)) continue;

    try {
      for (const entry of readdirSync(profilesDir)) {
        const fullPath = join(profilesDir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          seen.add(entry);
        } else if (entry.endsWith(".json")) {
          seen.add(entry.replace(/\.json$/, ""));
        }
      }
    } catch {
      // Ignore profile listing failures and return whatever we have.
    }
  }

  return [...seen].sort();
}

function createProfile(profile: string, config: IMessageProfileConfig = {}): boolean {
  if (profileExists(profile)) {
    return false;
  }

  writeProfile(profile, config);
  setCurrentProfile(profile);
  return true;
}

function clearProfile(profile = getCurrentProfile()): void {
  const flatPath = getFlatProfilePath(profile);
  const directoryPath = join(getProfilesDir(), profile);

  if (existsSync(flatPath)) {
    rmSync(flatPath);
  }

  if (existsSync(directoryPath)) {
    rmSync(directoryPath, { recursive: true, force: true });
  }
}

function deleteProfile(profile: string): boolean {
  if (profile === "default") {
    return false;
  }

  const existed = profileExists(profile);
  if (!existed) {
    return false;
  }

  clearProfile(profile);

  if (getCurrentProfile() === profile) {
    setCurrentProfile("default");
  }

  return true;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function maskSecret(secret?: string): string | undefined {
  if (!secret) {
    return undefined;
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***${secret.slice(-1)}`;
  }

  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function extractCredentialString(
  credentials: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return credentials ? asString(credentials[key]) : undefined;
}

function resolveContext(
  overrides: {
    profile?: string;
    bridgeUrl?: string;
    apiKey?: string;
    deviceId?: string;
  } = {}
): IMessageResolvedContext {
  const profileName = overrides.profile ?? getCurrentProfile();
  const profileConfig = loadProfile(profileName);

  return {
    configDir: getConfigDir(),
    profileName,
    profileConfig,
    bridgeUrl:
      asString(overrides.bridgeUrl) ??
      asString(process.env.IMESSAGE_BRIDGE_URL) ??
      profileConfig.bridgeUrl,
    apiKey:
      asString(overrides.apiKey) ??
      asString(process.env.IMESSAGE_API_KEY) ??
      profileConfig.apiKey,
    deviceId:
      asString(overrides.deviceId) ??
      asString(process.env.IMESSAGE_DEVICE_ID) ??
      profileConfig.deviceId,
  };
}

function ensureBridgeUrl(context: IMessageResolvedContext): string {
  if (!context.bridgeUrl) {
    throw new Error(
      'iMessage bridge URL is not configured. Set IMESSAGE_BRIDGE_URL or run "config set-bridge <url>".'
    );
  }

  return context.bridgeUrl.endsWith("/")
    ? context.bridgeUrl
    : `${context.bridgeUrl}/`;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function extractGlobalArgs(args: string[]): ParsedGlobalArgs {
  const remaining: string[] = [];
  let format: OutputFormat = "pretty";
  let profile: string | undefined;
  let bridgeUrl: string | undefined;
  let apiKey: string | undefined;
  let deviceId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split("=", 2);

    const consumeValue = () => {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) {
        index += 1;
      }
      return value;
    };

    if (flag === "--format" || flag === "-f") {
      const value = consumeValue();
      if (value === "json" || value === "pretty") {
        format = value;
      }
      continue;
    }

    if (flag === "--profile" || flag === "-p") {
      profile = consumeValue();
      continue;
    }

    if (flag === "--bridge-url" || flag === "-u") {
      bridgeUrl = consumeValue();
      continue;
    }

    if (flag === "--api-key" || flag === "-k") {
      apiKey = consumeValue();
      continue;
    }

    if (flag === "--device" || flag === "--device-id" || flag === "-d") {
      deviceId = consumeValue();
      continue;
    }

    remaining.push(arg);
  }

  return {
    remaining,
    format,
    profile,
    bridgeUrl,
    apiKey,
    deviceId,
  };
}

function parseOptions(args: string[]): ParsedOptions {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const [flag, inlineValue] = raw.split("=", 2);
    const key = toCamelCase(flag);
    const next = args[index + 1];

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = true;
  }

  return { positionals, options };
}

function parsePositiveInteger(
  value: string | boolean | undefined,
  label: string
): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function bridgeRequest<T>(
  context: IMessageResolvedContext,
  path: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {}
): Promise<T> {
  const baseUrl = ensureBridgeUrl(context);
  const url = new URL(path.replace(/^\//, ""), baseUrl);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers({ Accept: "application/json" });
  if (context.apiKey) {
    headers.set("Authorization", `Bearer ${context.apiKey}`);
    headers.set("X-API-Key", context.apiKey);
  }
  if (context.deviceId) {
    headers.set("X-Device-Id", context.deviceId);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const parsed = text ? parseJsonSafely(text) : {};

  if (!response.ok) {
    const detail = isRecord(parsed)
      ? asString(parsed.error) ?? asString(parsed.message)
      : typeof parsed === "string"
        ? parsed
        : undefined;
    throw new Error(
      `iMessage bridge request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  return parsed as T;
}

function extractItems(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key] as unknown[];
    }
  }

  return [];
}

function extractNextCursor(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  return (
    asString(payload.nextCursor) ??
    asString(payload.cursor) ??
    asString(payload.next_cursor)
  );
}

function normalizeConversation(payload: unknown): NormalizedConversation {
  const record = isRecord(payload) ? payload : {};
  const rawParticipants = Array.isArray(record.participants)
    ? record.participants
    : Array.isArray(record.handles)
      ? record.handles
      : Array.isArray(record.recipients)
        ? record.recipients
        : [];

  const participants = rawParticipants
    .map((entry) => (isRecord(entry) ? asString(entry.handle) ?? asString(entry.id) : asString(entry)))
    .filter((value): value is string => Boolean(value));

  const rawDirection =
    asString(record.direction) ??
    (record.isFromMe === true ? "outbound" : record.isFromMe === false ? "inbound" : undefined);

  return {
    id:
      asString(record.id) ??
      asString(record.conversationId) ??
      asString(record.guid) ??
      asString(record.chatGuid) ??
      "unknown-conversation",
    title:
      asString(record.title) ??
      asString(record.displayName) ??
      asString(record.name),
    participants,
    unreadCount:
      typeof record.unreadCount === "number"
        ? record.unreadCount
        : typeof record.unread === "number"
          ? record.unread
          : undefined,
    lastMessageText:
      asString(record.lastMessageText) ??
      asString(record.preview) ??
      (isRecord(record.lastMessage) ? asString(record.lastMessage.text) : undefined),
    lastMessageAt:
      asString(record.lastMessageAt) ??
      asString(record.updatedAt) ??
      asString(record.timestamp),
  };
}

function normalizeMessage(
  payload: unknown,
  fallback: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  const record = isRecord(payload) ? payload : {};
  const rawDirection =
    asString(record.direction) ??
    (record.isFromMe === true ? "outbound" : record.isFromMe === false ? "inbound" : undefined) ??
    fallback.direction;

  return {
    id:
      asString(record.id) ??
      asString(record.messageId) ??
      asString(record.guid) ??
      fallback.id ??
      "unknown-message",
    conversationId:
      asString(record.conversationId) ??
      asString(record.chatGuid) ??
      asString(record.chatId) ??
      fallback.conversationId,
    text:
      asString(record.text) ??
      asString(record.body) ??
      asString(record.message) ??
      fallback.text ??
      "",
    from:
      asString(record.from) ??
      asString(record.sender) ??
      asString(record.handle) ??
      fallback.from,
    to:
      asString(record.to) ??
      asString(record.recipient) ??
      fallback.to,
    direction:
      rawDirection === "inbound" || rawDirection === "outbound"
        ? rawDirection
        : "unknown",
    sentAt:
      asString(record.sentAt) ??
      asString(record.createdAt) ??
      asString(record.timestamp) ??
      fallback.sentAt,
    status:
      asString(record.status) ??
      asString(record.deliveryStatus) ??
      fallback.status,
    replyToMessageId:
      asString(record.replyToMessageId) ??
      asString(record.replyTo) ??
      fallback.replyToMessageId,
  };
}

function normalizeHealth(payload: unknown): NormalizedHealth {
  const record = isRecord(payload) ? payload : {};
  return {
    status: asString(record.status) ?? "ok",
    bridgeVersion:
      asString(record.bridgeVersion) ??
      asString(record.version),
    defaultDeviceId:
      asString(record.defaultDeviceId) ??
      asString(record.deviceId),
    connected: asBoolean(record.connected),
  };
}

async function checkBridgeHealth(
  context: IMessageResolvedContext
): Promise<NormalizedHealth> {
  return normalizeHealth(await bridgeRequest(context, "/health"));
}

async function listConversations(
  context: IMessageResolvedContext,
  input: z.infer<typeof conversationListInputSchema>
): Promise<NormalizedListResult<NormalizedConversation>> {
  const payload = await bridgeRequest<unknown>(context, "/conversations", {
    query: {
      limit: input.limit,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
    },
  });

  return {
    items: extractItems(payload, ["items", "conversations", "chats"]).map((entry) =>
      normalizeConversation(entry)
    ),
    nextCursor: extractNextCursor(payload),
  };
}

async function getConversation(
  context: IMessageResolvedContext,
  id: string
): Promise<NormalizedConversation> {
  const payload = await bridgeRequest<unknown>(
    context,
    `/conversations/${encodeURIComponent(id)}`
  );
  return normalizeConversation(
    isRecord(payload) && isRecord(payload.conversation)
      ? payload.conversation
      : payload
  );
}

async function listMessages(
  context: IMessageResolvedContext,
  input: z.infer<typeof messageListInputSchema>
): Promise<NormalizedListResult<NormalizedMessage>> {
  const payload = await bridgeRequest<unknown>(context, "/messages", {
    query: {
      conversationId: input.conversationId,
      limit: input.limit,
      cursor: input.cursor,
    },
  });

  return {
    items: extractItems(payload, ["items", "messages"]).map((entry) =>
      normalizeMessage(entry, {
        conversationId: input.conversationId,
      })
    ),
    nextCursor: extractNextCursor(payload),
  };
}

async function sendMessage(
  context: IMessageResolvedContext,
  input: z.infer<typeof messageSendInputSchema>
): Promise<NormalizedMessage> {
  const payload = await bridgeRequest<unknown>(context, "/messages/send", {
    method: "POST",
    body: {
      to: input.to,
      text: input.text,
      conversationId: input.conversationId,
      deviceId: input.deviceId ?? context.deviceId,
    },
  });

  return normalizeMessage(
    isRecord(payload) && isRecord(payload.message) ? payload.message : payload,
    {
      to: input.to,
      conversationId: input.conversationId,
      text: input.text,
      direction: "outbound",
    }
  );
}

async function replyToMessage(
  context: IMessageResolvedContext,
  input: z.infer<typeof messageReplyInputSchema>
): Promise<NormalizedMessage> {
  const payload = await bridgeRequest<unknown>(context, "/messages/reply", {
    method: "POST",
    body: {
      conversationId: input.conversationId,
      text: input.text,
      replyToMessageId: input.replyToMessageId,
      deviceId: input.deviceId ?? context.deviceId,
    },
  });

  return normalizeMessage(
    isRecord(payload) && isRecord(payload.message) ? payload.message : payload,
    {
      conversationId: input.conversationId,
      text: input.text,
      replyToMessageId: input.replyToMessageId,
      direction: "outbound",
    }
  );
}

function formatValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function successText(stdout: string): ConnectorCommandResult {
  return { stdout, exitCode: 0, success: true };
}

function successOutput(
  value: unknown,
  format: OutputFormat,
  prettyFormatter?: (value: unknown) => string
): ConnectorCommandResult {
  if (format === "json") {
    return successText(formatValue(value));
  }

  return successText(prettyFormatter ? prettyFormatter(value) : formatValue(value));
}

function failure(message: string): ConnectorCommandResult {
  return {
    stdout: "",
    stderr: message,
    exitCode: 1,
    success: false,
  };
}

function formatConfigSummary(value: unknown): string {
  const config = value as Record<string, unknown>;
  const lines = [
    `Profile: ${String(config.profile ?? "default")}`,
    `Config Dir: ${String(config.configDir ?? getConfigDir())}`,
    `Bridge URL: ${String(config.bridgeUrl ?? "(not set)")}`,
    `API Key Configured: ${config.apiKeyConfigured ? "yes" : "no"}`,
  ];

  if (typeof config.apiKeyPreview === "string") {
    lines.push(`API Key Preview: ${config.apiKeyPreview}`);
  }

  lines.push(`Device ID: ${String(config.deviceId ?? "(not set)")}`);
  return lines.join("\n");
}

function formatHealthSummary(value: unknown): string {
  const health = value as NormalizedHealth;
  return [
    `Status: ${health.status}`,
    `Bridge Version: ${health.bridgeVersion ?? "(unknown)"}`,
    `Default Device: ${health.defaultDeviceId ?? "(not reported)"}`,
    `Connected: ${
      typeof health.connected === "boolean" ? String(health.connected) : "(unknown)"
    }`,
  ].join("\n");
}

function formatConversationListSummary(value: unknown): string {
  const result = value as NormalizedListResult<NormalizedConversation>;
  if (result.items.length === 0) {
    return "No conversations found.";
  }

  const lines = result.items.map((conversation) => {
    const participants = conversation.participants.length
      ? conversation.participants.join(", ")
      : "(no participants)";
    const suffix = conversation.lastMessageText
      ? ` — ${conversation.lastMessageText}`
      : "";
    return `${conversation.id} [${participants}]${suffix}`;
  });

  if (result.nextCursor) {
    lines.push("", `Next Cursor: ${result.nextCursor}`);
  }

  return lines.join("\n");
}

function formatMessageListSummary(value: unknown): string {
  const result = value as NormalizedListResult<NormalizedMessage>;
  if (result.items.length === 0) {
    return "No messages found.";
  }

  const lines = result.items.map((message) => {
    const direction = message.direction ?? "unknown";
    const sender = message.from ?? message.to ?? "unknown";
    return `${message.id} [${direction}] ${sender}: ${message.text}`;
  });

  if (result.nextCursor) {
    lines.push("", `Next Cursor: ${result.nextCursor}`);
  }

  return lines.join("\n");
}

function getProfileState(profile: string): Record<string, unknown> {
  const config = loadProfile(profile);
  return {
    profile,
    configDir: getConfigDir(),
    bridgeUrl: config.bridgeUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyPreview: maskSecret(config.apiKey),
    deviceId: config.deviceId,
  };
}

async function runProfileCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return successText(COMMAND_HELP.profile);
  }

  const { positionals, options } = parseOptions(args);
  const [subcommand, name] = positionals;

  switch (subcommand) {
    case "list": {
      const current = getCurrentProfile();
      const profiles = listProfiles();
      return successOutput(
        { current, profiles },
        context.format,
        () =>
          profiles
            .map((profile) => `${profile}${profile === current ? " (active)" : ""}`)
            .join("\n")
      );
    }

    case "use": {
      if (!name) {
        return failure('Usage: connect-imessage profile use <name>');
      }
      if (!profileExists(name)) {
        return failure(`Profile "${name}" does not exist`);
      }
      setCurrentProfile(name);
      return successText(`Switched to profile: ${name}`);
    }

    case "create": {
      if (!name) {
        return failure('Usage: connect-imessage profile create <name>');
      }

      const created = createProfile(name, {
        bridgeUrl: asString(options.bridgeUrl),
        apiKey: asString(options.apiKey),
        deviceId:
          asString(options.deviceId) ??
          asString(options.device),
      });

      if (!created) {
        return failure(`Profile "${name}" already exists`);
      }

      return successText(`Profile "${name}" created\nSwitched to profile: ${name}`);
    }

    case "delete": {
      if (!name) {
        return failure('Usage: connect-imessage profile delete <name>');
      }
      if (!deleteProfile(name)) {
        return failure(
          name === "default"
            ? 'Cannot delete the default profile'
            : `Profile "${name}" does not exist`
        );
      }
      return successText(`Deleted profile: ${name}`);
    }

    case "show": {
      const profileName = name ?? context.profile ?? getCurrentProfile();
      if (!profileExists(profileName)) {
        return failure(`Profile "${profileName}" does not exist`);
      }
      return successOutput(
        getProfileState(profileName),
        context.format,
        formatConfigSummary
      );
    }

    default:
      return null;
  }
}

function saveProfileField(
  profile: string,
  key: keyof IMessageProfileConfig,
  value: string
): void {
  const next = {
    ...loadProfile(profile),
    [key]: value,
  };
  writeProfile(profile, next);
}

async function runConfigCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return successText(COMMAND_HELP.config);
  }

  const { positionals } = parseOptions(args);
  const [subcommand, value] = positionals;
  const profileName = context.profile ?? getCurrentProfile();

  switch (subcommand) {
    case "set-bridge":
      if (!value) {
        return failure('Usage: connect-imessage config set-bridge <url>');
      }
      saveProfileField(profileName, "bridgeUrl", value);
      return successText(`Bridge URL saved to profile: ${profileName}`);

    case "set-key":
      if (!value) {
        return failure('Usage: connect-imessage config set-key <apiKey>');
      }
      saveProfileField(profileName, "apiKey", value);
      return successText(`API key saved to profile: ${profileName}`);

    case "set-device":
      if (!value) {
        return failure('Usage: connect-imessage config set-device <deviceId>');
      }
      saveProfileField(profileName, "deviceId", value);
      return successText(`Device ID saved to profile: ${profileName}`);

    case "show": {
      const resolved = resolveContext(context);
      return successOutput(
        {
          profile: resolved.profileName,
          configDir: resolved.configDir,
          bridgeUrl: resolved.bridgeUrl,
          apiKeyConfigured: Boolean(resolved.apiKey),
          apiKeyPreview: maskSecret(resolved.apiKey),
          deviceId: resolved.deviceId,
        },
        context.format,
        formatConfigSummary
      );
    }

    case "clear":
      clearProfile(profileName);
      return successText(`Configuration cleared for profile: ${profileName}`);

    default:
      return null;
  }
}

async function runHealthCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (args[0] === "--help" || args[0] === "-h") {
    return successText(COMMAND_HELP.health);
  }

  if (args.length > 1 || (args[0] && args[0] !== "check")) {
    return null;
  }

  const health = await checkBridgeHealth(resolveContext(context));
  return successOutput(health, context.format, formatHealthSummary);
}

async function runConversationCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return successText(COMMAND_HELP.conversation);
  }

  const { positionals, options } = parseOptions(args);
  const [subcommand, id] = positionals;
  const resolved = resolveContext(context);

  switch (subcommand) {
    case "list": {
      const result = await listConversations(resolved, {
        limit: parsePositiveInteger(options.limit, "limit"),
        cursor: asString(options.cursor),
        unreadOnly: options.unreadOnly === true,
      });
      return successOutput(result, context.format, formatConversationListSummary);
    }

    case "get":
      if (!id) {
        return failure('Usage: connect-imessage conversation get <id>');
      }
      return successOutput(
        await getConversation(resolved, id),
        context.format,
        formatValue
      );

    default:
      return null;
  }
}

async function runMessageCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return successText(COMMAND_HELP.message);
  }

  const { positionals, options } = parseOptions(args);
  const [subcommand] = positionals;
  const resolved = resolveContext(context);

  switch (subcommand) {
    case "list": {
      const conversationId = asString(options.conversation);
      if (!conversationId) {
        return failure('Usage: connect-imessage message list --conversation <id>');
      }

      const result = await listMessages(resolved, {
        conversationId,
        limit: parsePositiveInteger(options.limit, "limit"),
        cursor: asString(options.cursor),
      });

      return successOutput(result, context.format, formatMessageListSummary);
    }

    case "send": {
      const to = asString(options.to);
      const text = asString(options.text);
      if (!to || !text) {
        return failure(
          'Usage: connect-imessage message send --to <handle> --text <text>'
        );
      }

      return successOutput(
        await sendMessage(resolved, {
          to,
          text,
          conversationId: asString(options.conversation),
          deviceId: asString(options.deviceId) ?? asString(options.device),
        }),
        context.format,
        formatValue
      );
    }

    case "reply": {
      const conversationId = asString(options.conversation);
      const text = asString(options.text);
      if (!conversationId || !text) {
        return failure(
          'Usage: connect-imessage message reply --conversation <id> --text <text>'
        );
      }

      return successOutput(
        await replyToMessage(resolved, {
          conversationId,
          text,
          replyToMessageId: asString(options.replyTo),
          deviceId: asString(options.deviceId) ?? asString(options.device),
        }),
        context.format,
        formatValue
      );
    }

    default:
      return null;
  }
}

function createOperationContext(args: ConnectorContextFactoryArgs): IMessageResolvedContext {
  return resolveContext({
    profile: args.profile,
    bridgeUrl: extractCredentialString(args.credentials, "bridgeUrl"),
    apiKey: extractCredentialString(args.credentials, "apiKey"),
    deviceId: extractCredentialString(args.credentials, "deviceId"),
  });
}

export const imessageConnector = defineConnector({
  meta: {
    name: "imessage",
    displayName: "iMessage",
    description:
      "Bridge-first iMessage conversations and send/reply flows for the internal one-product runtime",
    category: "Communication",
    version: pkg.version,
    tags: ["communication", "messaging", "apple", "bridge", "channels"],
  },
  auth: {
    type: "custom",
    supportsProfiles: true,
    fields: [
      {
        key: "bridgeUrl",
        env: "IMESSAGE_BRIDGE_URL",
        label: "Bridge URL",
        description: "Base URL for the iMessage bridge service",
        required: true,
        secret: false,
      },
      {
        key: "apiKey",
        env: "IMESSAGE_API_KEY",
        label: "API Key",
        description: "Optional API key for authenticated bridge deployments",
        secret: true,
      },
      {
        key: "deviceId",
        env: "IMESSAGE_DEVICE_ID",
        label: "Device ID",
        description: "Optional preferred bridge device identifier",
        secret: false,
      },
    ],
  },
  docsMarkdown: IMESSAGE_DOCS,
  createContext: createOperationContext,
  operations: {
    profile: {
      summary: "Manage iMessage connector profiles",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runProfileCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported iMessage profile subcommand");
        }
        return result;
      },
    },
    config: {
      summary: "Manage iMessage bridge configuration",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runConfigCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported iMessage config subcommand");
        }
        return result;
      },
    },
    health: {
      summary: "Check iMessage bridge health from the command surface",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runHealthCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported iMessage health subcommand");
        }
        return result;
      },
    },
    conversation: {
      summary: "List and inspect conversations from the command surface",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runConversationCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported iMessage conversation subcommand");
        }
        return result;
      },
    },
    message: {
      summary: "List, send, and reply to messages from the command surface",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runMessageCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported iMessage message subcommand");
        }
        return result;
      },
    },
    "health:check": {
      name: "health:check",
      summary: "Check bridge availability through the normalized connector API",
      async execute({ context }) {
        return checkBridgeHealth(context);
      },
    },
    "conversation:list": {
      name: "conversation:list",
      summary: "List normalized conversations from the bridge",
      inputSchema: conversationListInputSchema,
      async execute({ context }, input) {
        return listConversations(context, input);
      },
    },
    "conversation:get": {
      name: "conversation:get",
      summary: "Fetch a single normalized conversation from the bridge",
      inputSchema: conversationGetInputSchema,
      async execute({ context }, input) {
        return getConversation(context, input.id);
      },
    },
    "message:list": {
      name: "message:list",
      summary: "List normalized messages for a conversation",
      inputSchema: messageListInputSchema,
      async execute({ context }, input) {
        return listMessages(context, input);
      },
    },
    "message:send": {
      name: "message:send",
      summary: "Send a normalized outbound message through the bridge",
      inputSchema: messageSendInputSchema,
      async execute({ context }, input) {
        return sendMessage(context, input);
      },
    },
    "message:reply": {
      name: "message:reply",
      summary: "Reply to an existing conversation through the bridge",
      inputSchema: messageReplyInputSchema,
      async execute({ context }, input) {
        return replyToMessage(context, input);
      },
    },
  },
  commandRuntime: {
    helpText: ROOT_HELP,
    commands: COMMAND_DESCRIPTORS,
    getHelp(command) {
      if (!command) {
        return ROOT_HELP;
      }
      return COMMAND_HELP[command] ?? null;
    },
    async run(args) {
      const {
        remaining,
        format,
        profile,
        bridgeUrl,
        apiKey,
        deviceId,
      } = extractGlobalArgs(args);
      const context: RunContext = {
        format,
        profile,
        bridgeUrl,
        apiKey,
        deviceId,
      };
      const command = remaining[0];

      if (!command || command === "--help" || command === "-h") {
        return successText(ROOT_HELP);
      }

      if (command === "--version" || command === "-V") {
        return successText(pkg.version);
      }

      if (command === "help") {
        const requested = remaining[1];
        return successText(requested ? COMMAND_HELP[requested] ?? ROOT_HELP : ROOT_HELP);
      }

      if (remaining[1] === "--help" || remaining[1] === "-h") {
        return successText(COMMAND_HELP[command] ?? ROOT_HELP);
      }

      const commandArgs = remaining.slice(1);

      switch (command) {
        case "profile":
          return runProfileCommand(commandArgs, context);
        case "config":
          return runConfigCommand(commandArgs, context);
        case "health":
          return runHealthCommand(commandArgs, context);
        case "conversation":
          return runConversationCommand(commandArgs, context);
        case "message":
          return runMessageCommand(commandArgs, context);
        default:
          return null;
      }
    },
  },
});
