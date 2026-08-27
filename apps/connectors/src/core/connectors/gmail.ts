import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { connectorsHome } from "../../lib/paths.js";
import { z } from "zod";
import { defineConnector } from "../connector.js";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_GMAIL_RETRIES = 5;

interface OAuth2Tokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

interface OAuthCredentials {
  clientId?: string;
  clientSecret?: string;
}

interface GmailContext {
  profile: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
  raw?: string;
}

const listMessagesSchema = z.object({
  max: z.coerce.number().int().positive().max(500).optional(),
  maxResults: z.coerce.number().int().positive().max(500).optional(),
  pageToken: z.string().optional(),
  query: z.string().optional(),
  q: z.string().optional(),
  label: z.string().optional(),
  labelIds: z.union([z.string(), z.array(z.string())]).optional(),
  includeSpamTrash: z.boolean().optional(),
});

const messageIdSchema = z.object({
  args: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  messageId: z.string().optional(),
});

const readMessageSchema = messageIdSchema.extend({
  body: z.boolean().optional(),
  html: z.boolean().optional(),
  format: z.enum(["full", "metadata", "minimal", "raw"]).optional(),
});

const attachmentListSchema = messageIdSchema;

const attachmentDownloadSchema = messageIdSchema.extend({
  attachmentId: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  dir: z.string().optional(),
  outputDir: z.string().optional(),
});

const historyListSchema = z.object({
  startHistoryId: z.string(),
  historyTypes: z.union([z.string(), z.array(z.string())]).optional(),
  labelId: z.string().optional(),
  maxResults: z.coerce.number().int().positive().max(500).optional(),
  pageToken: z.string().optional(),
});

const replySchema = messageIdSchema.extend({
  body: z.string(),
  html: z.boolean().optional(),
  isHtml: z.boolean().optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
});

export const gmailConnector = defineConnector<GmailContext>({
  meta: {
    name: "gmail",
    displayName: "Gmail",
    description: "Profile-aware Gmail mailbox operations for sync, labels, attachments, history, and replies.",
    category: "communication",
    tags: ["google", "gmail", "email", "mailbox"],
  },
  auth: {
    type: "oauth2",
    supportsProfiles: true,
    fields: [
      { key: "clientId", env: "GMAIL_CLIENT_ID", label: "OAuth client ID" },
      { key: "clientSecret", env: "GMAIL_CLIENT_SECRET", label: "OAuth client secret", secret: true },
    ],
  },
  createContext: ({ profile }) => ({ profile: profile || "default" }),
  operations: {
    "profiles.list": {
      summary: "List configured Gmail profiles.",
      execute: () => ({ profiles: listProfiles() }),
    },
    "profile.get": {
      summary: "Get the authenticated Gmail profile.",
      execute: async ({ context }) => requestJson(context.profile, "/users/me/profile", {}),
    },
    "messages.list": {
      summary: "List Gmail messages.",
      inputSchema: listMessagesSchema,
      execute: async ({ context }, input) => {
        const labelIds = normalizeStringArray(input.labelIds ?? input.label);
        return requestJson(context.profile, "/users/me/messages", {
          maxResults: input.maxResults ?? input.max ?? 50,
          pageToken: input.pageToken,
          q: input.q ?? input.query,
          labelIds: labelIds.length > 0 ? labelIds.join(",") : undefined,
          includeSpamTrash: input.includeSpamTrash,
        });
      },
    },
    "messages.read": {
      summary: "Read a Gmail message with optional extracted body.",
      inputSchema: readMessageSchema,
      execute: async ({ context }, input) => {
        const messageId = getMessageId(input);
        const message = await requestJson<GmailMessage>(
          context.profile,
          `/users/me/messages/${encodeURIComponent(messageId)}`,
          { format: input.format ?? "full" },
        );
        const headers = headersToObject(message.payload?.headers ?? []);
        return {
          ...message,
          from: headers.From ?? headers.from ?? "",
          to: headers.To ?? headers.to ?? "",
          cc: headers.Cc ?? headers.cc ?? "",
          subject: headers.Subject ?? headers.subject ?? "",
          date: headers.Date ?? headers.date ?? "",
          body: input.body ? extractBody(message, Boolean(input.html)) : undefined,
          size: message.sizeEstimate,
        };
      },
    },
    "messages.getRaw": {
      summary: "Read raw base64url Gmail message content.",
      inputSchema: messageIdSchema,
      execute: async ({ context }, input) => {
        const messageId = getMessageId(input);
        return requestJson<GmailMessage>(
          context.profile,
          `/users/me/messages/${encodeURIComponent(messageId)}`,
          { format: "raw" },
        );
      },
    },
    "messages.mark-read": {
      summary: "Mark a message as read.",
      inputSchema: messageIdSchema,
      execute: async ({ context }, input) => modifyMessage(context.profile, getMessageId(input), undefined, ["UNREAD"]),
    },
    "messages.mark-unread": {
      summary: "Mark a message as unread.",
      inputSchema: messageIdSchema,
      execute: async ({ context }, input) => modifyMessage(context.profile, getMessageId(input), ["UNREAD"], undefined),
    },
    "messages.archive": {
      summary: "Archive a message by removing the INBOX label.",
      inputSchema: messageIdSchema,
      execute: async ({ context }, input) => modifyMessage(context.profile, getMessageId(input), undefined, ["INBOX"]),
    },
    "messages.star": {
      summary: "Star a message.",
      inputSchema: messageIdSchema,
      execute: async ({ context }, input) => modifyMessage(context.profile, getMessageId(input), ["STARRED"], undefined),
    },
    "messages.reply": {
      summary: "Reply to a Gmail message in the same thread.",
      inputSchema: replySchema,
      execute: async ({ context }, input) => replyToMessage(context.profile, getMessageId(input), input),
    },
    "attachments.list": {
      summary: "List Gmail message attachments.",
      inputSchema: attachmentListSchema,
      execute: async ({ context }, input) => {
        const message = await requestJson<GmailMessage>(
          context.profile,
          `/users/me/messages/${encodeURIComponent(getMessageId(input))}`,
          { format: "full" },
        );
        return collectAttachments(message.payload);
      },
    },
    "attachments.download": {
      summary: "Download one or all Gmail message attachments to disk.",
      inputSchema: attachmentDownloadSchema,
      execute: async ({ context }, input) => downloadAttachments(context.profile, input),
    },
    "labels.list": {
      summary: "List Gmail labels.",
      execute: async ({ context }) => requestJson(context.profile, "/users/me/labels", {}),
    },
    "history.list": {
      summary: "List Gmail mailbox history from a history id.",
      inputSchema: historyListSchema,
      execute: async ({ context }, input) => requestJson(context.profile, "/users/me/history", {
        startHistoryId: input.startHistoryId,
        historyTypes: normalizeStringArray(input.historyTypes).join(",") || undefined,
        labelId: input.labelId,
        maxResults: input.maxResults,
        pageToken: input.pageToken,
      }),
    },
  },
});

async function modifyMessage(profile: string, messageId: string, addLabelIds?: string[], removeLabelIds?: string[]) {
  return requestJson(profile, `/users/me/messages/${encodeURIComponent(messageId)}/modify`, {}, {
    method: "POST",
    body: {
      addLabelIds: addLabelIds ?? [],
      removeLabelIds: removeLabelIds ?? [],
    },
  });
}

async function replyToMessage(profile: string, messageId: string, input: z.infer<typeof replySchema>) {
  const original = await requestJson<GmailMessage>(
    profile,
    `/users/me/messages/${encodeURIComponent(messageId)}`,
    { format: "full" },
  );
  const headers = headersToObject(original.payload?.headers ?? []);
  const subject = normalizeReplySubject(headers.Subject ?? headers.subject ?? "");
  const to = headers.From ?? headers.from ?? "";
  const messageIdHeader = headers["Message-ID"] ?? headers["Message-Id"] ?? headers["message-id"] ?? "";
  const references = [headers.References ?? headers.references, messageIdHeader].filter(Boolean).join(" ");
  const raw = buildRawEmail({
    to,
    cc: normalizeStringArray(input.cc),
    bcc: normalizeStringArray(input.bcc),
    subject,
    body: input.body,
    isHtml: Boolean(input.html ?? input.isHtml),
    inReplyTo: messageIdHeader,
    references,
  });
  return requestJson(profile, "/users/me/messages/send", {}, {
    method: "POST",
    body: {
      raw: Buffer.from(raw).toString("base64url"),
      threadId: original.threadId,
    },
  });
}

async function downloadAttachments(profile: string, input: z.infer<typeof attachmentDownloadSchema>) {
  const messageId = getMessageId(input);
  const outputDir = input.dir ?? input.outputDir ?? join(configDirs()[0], "attachments", messageId);
  mkdirSync(outputDir, { recursive: true });
  const attachments = input.attachmentId && input.filename
    ? [{
        attachmentId: input.attachmentId,
        filename: input.filename,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: 0,
      }]
    : collectAttachments((await requestJson<GmailMessage>(
        profile,
        `/users/me/messages/${encodeURIComponent(messageId)}`,
        { format: "full" },
      )).payload);
  const downloaded = [];
  for (const attachment of attachments) {
    const data = await requestJson<{ data: string; size?: number }>(
      profile,
      `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
      {},
    );
    const filename = safeFilename(attachment.filename);
    const path = join(outputDir, filename);
    const buffer = Buffer.from(data.data, "base64url");
    writeFileSync(path, buffer);
    downloaded.push({
      filename,
      path,
      size: buffer.length,
      mimeType: attachment.mimeType,
    });
  }
  return downloaded;
}

async function requestJson<T = unknown>(
  profile: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await getValidAccessToken(profile);
  const url = new URL(`${GMAIL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.append(key, String(value));
  }
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= MAX_GMAIL_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_GMAIL_RETRIES) throw error;
      await sleep(gmailBackoffDelayMs(attempt));
      continue;
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) as T : {} as T;
    if (response.ok) return data;

    const error = data as { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } };
    lastError = error.error?.message ?? response.statusText;
    if (!isRetryableGmailResponse(response.status, error) || attempt >= MAX_GMAIL_RETRIES) {
      throw new Error(`Gmail request failed (${response.status}): ${lastError}`);
    }
    await sleep(gmailBackoffDelayMs(attempt, response.headers.get("retry-after")));
  }
  throw new Error(`Gmail request failed: ${lastError ?? "unknown error"}`);
}

function isRetryableGmailResponse(
  status: number,
  error: { error?: { status?: string; errors?: Array<{ reason?: string }> } },
): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  const reasons = error.error?.errors?.map((entry) => entry.reason) ?? [];
  return reasons.some((reason) => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded");
}

function gmailBackoffDelayMs(attempt: number, retryAfter: string | null = null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  const base = Number(process.env.CONNECTORS_GMAIL_RETRY_BASE_MS ?? "1000");
  const baseMs = Number.isFinite(base) && base >= 0 ? base : 1000;
  const jitterMs = Math.floor(Math.random() * 1000);
  return Math.min((2 ** attempt) * baseMs + jitterMs, 64_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getValidAccessToken(profile: string): Promise<string> {
  if (process.env.GMAIL_ACCESS_TOKEN) return process.env.GMAIL_ACCESS_TOKEN;
  const tokens = loadTokens(profile);
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    throw new Error(`Gmail profile "${profile}" is not authenticated. Run: connectors auth gmail`);
  }
  if (tokens.accessToken && (!tokens.expiresAt || Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS)) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken ?? "";
  return (await refreshAccessToken(profile, tokens)).accessToken ?? "";
}

async function refreshAccessToken(profile: string, currentTokens: OAuth2Tokens): Promise<OAuth2Tokens> {
  const credentials = loadCredentials(profile);
  if (!credentials.clientId || !credentials.clientSecret) throw new Error("Gmail OAuth credentials are not configured. Run: connectors auth gmail");
  if (!currentTokens.refreshToken) throw new Error(`Gmail profile "${profile}" has no refresh token. Run: connectors auth gmail`);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; token_type?: string; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(`Gmail token refresh failed: ${data.error_description || data.error || response.statusText}`);
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ?? currentTokens.tokenType,
    scope: data.scope ?? currentTokens.scope,
  };
  saveTokens(profile, tokens);
  return tokens;
}

function listProfiles(): string[] {
  const profiles = new Set<string>();
  for (const baseDir of configDirs()) {
    const profilesDir = join(baseDir, "profiles");
    if (!existsSync(profilesDir)) continue;
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) profiles.add(entry.name);
      if (entry.isFile() && entry.name.endsWith(".json")) profiles.add(basename(entry.name, ".json"));
    }
  }
  return Array.from(profiles).sort((a, b) => a.localeCompare(b));
}

function loadCredentials(profile: string): OAuthCredentials {
  const envClientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (envClientId && envClientSecret) return { clientId: envClientId, clientSecret: envClientSecret };
  for (const baseDir of configDirs()) {
    const credentials = {
      ...readJson<OAuthCredentials>(join(baseDir, "credentials.json")),
      ...readJson<OAuthCredentials>(join(baseDir, "profiles", profile, "config.json")),
    };
    if (credentials.clientId || credentials.clientSecret) return credentials;
  }
  return {};
}

function loadTokens(profile: string): OAuth2Tokens | null {
  for (const baseDir of configDirs()) {
    const fromProfile = readJson<OAuth2Tokens>(join(baseDir, "profiles", profile, "tokens.json"));
    if (fromProfile) return fromProfile;
    const flat = readJson<{ tokens?: OAuth2Tokens } & OAuth2Tokens>(join(baseDir, "profiles", `${profile}.json`));
    if (flat) return flat.tokens ?? (flat.accessToken || flat.refreshToken ? flat : null);
  }
  return null;
}

function saveTokens(profile: string, tokens: OAuth2Tokens): void {
  const baseDir = configDirs().find((dir) => existsSync(dir)) ?? configDirs()[0];
  const profileDir = join(baseDir, "profiles", profile);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "tokens.json"), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function configDirs(): string[] {
  const explicit = process.env.HASNA_GMAIL_CONNECTOR_DIR ?? process.env.GMAIL_CONNECTOR_DIR;
  if (explicit) return [explicit];
  const baseDir = connectorsHome();
  return [join(baseDir, "gmail"), join(baseDir, "connect-gmail")];
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function getMessageId(input: z.infer<typeof messageIdSchema>): string {
  const id = input.messageId ?? (input.args?.[0] != null ? String(input.args[0]) : undefined);
  if (!id) throw new Error("Gmail messageId is required");
  return id;
}

function headersToObject(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers) out[header.name] = header.value;
  return out;
}

function extractBody(message: GmailMessage, preferHtml = false): string {
  if (!message.payload) return "";
  const targetType = preferHtml ? "text/html" : "text/plain";
  const parts: Array<{ mimeType: string; data: string }> = [];
  collectTextParts(message.payload, parts);
  return parts.find((part) => part.mimeType === targetType)?.data
    ?? parts.find((part) => part.mimeType.startsWith("text/"))?.data
    ?? "";
}

function collectTextParts(part: GmailMessagePart, results: Array<{ mimeType: string; data: string }>): void {
  const mimeType = (part.mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (part.body?.data && mimeType.startsWith("text/")) {
    results.push({ mimeType, data: Buffer.from(part.body.data, "base64url").toString("utf8") });
  }
  for (const child of part.parts ?? []) collectTextParts(child, results);
}

function collectAttachments(part: GmailMessagePart | undefined, attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number; partId?: string }> = []) {
  if (!part) return attachments;
  if (part.body?.attachmentId && part.filename) {
    attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
      partId: part.partId,
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, attachments);
  return attachments;
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeReplySubject(subject: string): string {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function buildRawEmail(input: {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  isHtml: boolean;
  inReplyTo: string;
  references: string;
}): string {
  const headers = [
    `To: ${input.to}`,
    input.cc.length ? `Cc: ${input.cc.join(", ")}` : "",
    input.bcc.length ? `Bcc: ${input.bcc.join(", ")}` : "",
    `Subject: ${input.subject}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : "",
    input.references ? `References: ${input.references}` : "",
    "MIME-Version: 1.0",
    `Content-Type: ${input.isHtml ? "text/html" : "text/plain"}; charset=UTF-8`,
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

function safeFilename(filename: string): string {
  return basename(filename.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")).replace(/[\/\\]/g, "_");
}
