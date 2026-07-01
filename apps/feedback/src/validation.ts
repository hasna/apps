import { z } from "zod";
import type {
  FeedbackInput,
  FeedbackItem,
  FeedbackKind,
  FeedbackSeverity,
  FeedbackStatus,
  JsonObject,
  JsonValue,
} from "./types.js";

export const feedbackKinds = ["bug", "idea", "question", "praise", "other"] as const satisfies readonly FeedbackKind[];
export const feedbackSeverities = ["low", "medium", "high", "critical"] as const satisfies readonly FeedbackSeverity[];
export const feedbackStatuses = ["new", "triaged", "closed"] as const satisfies readonly FeedbackStatus[];

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const feedbackContextSchema = z
  .record(jsonValueSchema.optional())
  .optional()
  .transform((value) => value as FeedbackInput["context"]);

export const feedbackInputSchema = z.object({
  appId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(10_000),
  kind: z.enum(feedbackKinds).optional().default("other"),
  severity: z.enum(feedbackSeverities).optional(),
  userId: z.string().trim().max(256).optional(),
  email: z.string().trim().email().max(320).optional(),
  url: z.string().trim().url().max(2048).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(25).optional().default([]),
  metadata: z.record(jsonValueSchema).optional(),
  context: feedbackContextSchema,
});

export const feedbackStatusSchema = z.enum(feedbackStatuses);

export const feedbackItemSchema = feedbackInputSchema.extend({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: feedbackStatusSchema,
  source: z.enum(["api", "cli", "sdk", "mcp", "server"]),
});

const sensitiveKeyPattern = /(?:api[_-]?key|authorization|cookie|password|secret|token|refresh[_-]?token|access[_-]?token|private[_-]?key)/i;
const sensitiveAssignmentPattern =
  /\b(api[_-]?key|authorization|cookie|password|secret|token|refresh[_-]?token|access[_-]?token|private[_-]?key)=([^&\s]+)/gi;
const sensitiveHeaderPattern =
  /\b(api[_-]?key|authorization|cookie|password|secret|secret[_-]?token|token|refresh[_-]?token|access[_-]?token|private[_-]?key)\s*:\s*([^\n\r,;]+)/gi;
const bearerPattern = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const secretPatterns: RegExp[] = [
  new RegExp(`sk-${"ant"}-[A-Za-z0-9_-]{12,}`, "g"),
  new RegExp(`sk-${"proj"}-[A-Za-z0-9_-]{12,}`, "g"),
  new RegExp(`${"npm"}_[A-Za-z0-9_-]{12,}`, "g"),
  new RegExp(`gh[pousr]_[A-Za-z0-9_]{12,}`, "g"),
  new RegExp(`ctx7${"sk"}-[A-Za-z0-9_-]{12,}`, "g"),
  new RegExp(`x${"ai"}-[A-Za-z0-9_-]{12,}`, "g"),
  new RegExp(`AI${"za"}[A-Za-z0-9_-]{20,}`, "g"),
  new RegExp(`A${"KIA"}[A-Z0-9]{16}`, "g"),
];

export function redactSecretsInText(value: string): string {
  const withoutKnownSecrets = secretPatterns.reduce((next, pattern) => next.replace(pattern, "[redacted]"), value);
  return withoutKnownSecrets
    .replace(sensitiveAssignmentPattern, (_match, key: string) => `${key}=[redacted]`)
    .replace(sensitiveHeaderPattern, (_match, key: string) => `${key}: [redacted]`)
    .replace(bearerPattern, "Bearer [redacted]");
}

export function redactSensitiveJson(value: JsonValue, keyPath: string[] = []): JsonValue {
  const lastKey = keyPath.at(-1);
  if (lastKey && sensitiveKeyPattern.test(lastKey)) return "[redacted]";
  if (typeof value === "string") return redactSecretsInText(value);
  if (Array.isArray(value)) return value.map((item, index) => redactSensitiveJson(item, [...keyPath, String(index)]));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactSensitiveJson(nested, [...keyPath, key])]),
    );
  }
  return value;
}

export function normalizeTags(tags: string[] = []): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

export function parseFeedbackInput(input: unknown): FeedbackInput {
  const parsed = feedbackInputSchema.parse(input);
  const metadata = parsed.metadata ? (redactSensitiveJson(parsed.metadata) as JsonObject) : undefined;
  const context = parsed.context ? (redactSensitiveJson(parsed.context as JsonObject) as FeedbackInput["context"]) : undefined;
  return {
    ...parsed,
    appId: parsed.appId.trim(),
    message: redactSecretsInText(parsed.message.trim()),
    userId: parsed.userId?.trim(),
    url: parsed.url ? redactSecretsInText(parsed.url) : undefined,
    tags: normalizeTags(parsed.tags),
    metadata,
    context,
  };
}

export function parseFeedbackStatus(status: unknown): FeedbackStatus {
  return feedbackStatusSchema.parse(status);
}

export function parseStoredFeedbackItem(input: unknown): FeedbackItem {
  const parsed = feedbackItemSchema.parse(input);
  return {
    ...parsed,
    tags: normalizeTags(parsed.tags),
  };
}

export function validationErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
