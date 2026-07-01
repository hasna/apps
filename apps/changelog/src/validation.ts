import { z } from "zod";
import type {
  ChangelogCategory,
  ChangelogEntry,
  ChangelogEntryInput,
  ChangelogEntryUpdate,
  ChangelogKind,
  ChangelogLink,
  JsonObject,
  JsonValue,
  ParsedChangelogEntryInput,
} from "./types.js";

export const changelogKinds = [
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
  "other",
] as const satisfies readonly ChangelogKind[];

export const changelogCategories = changelogKinds satisfies readonly ChangelogCategory[];

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

export const changelogLinkSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2048),
});

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const changelogDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Date must be a real YYYY-MM-DD date");

export const changelogEntryInputSchema = z.object({
  appId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  version: z.string().trim().min(1).max(80).optional().default("Unreleased"),
  kind: z.enum(changelogKinds).optional(),
  category: z.enum(changelogCategories).optional(),
  title: z.string().trim().min(1).max(500),
  message: z.string().trim().max(2_000).optional(),
  details: z.string().trim().max(20_000).optional(),
  body: z.string().trim().max(20_000).optional(),
  date: changelogDateSchema.optional(),
  author: z.string().trim().max(256).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional().default([]),
  links: z.array(changelogLinkSchema).max(50).optional().default([]),
  commits: z.array(z.string().trim().min(1).max(128)).max(100).optional().default([]),
  tasks: z.array(z.string().trim().min(1).max(128)).max(100).optional().default([]),
  metadata: z.record(jsonValueSchema).optional(),
});

export const changelogEntryUpdateSchema = changelogEntryInputSchema.partial();

export const changelogEntrySchema = changelogEntryInputSchema.extend({
  id: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(changelogKinds),
  category: z.enum(changelogCategories),
  title: z.string().min(1),
  date: changelogDateSchema,
  tags: z.array(z.string()),
  links: z.array(changelogLinkSchema),
  commits: z.array(z.string()),
  tasks: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.enum(["api", "cli", "sdk", "mcp", "server"]),
  fingerprint: z.string().min(1).optional(),
});

const sensitiveKeyPattern = /(?:api[_-]?key|authorization|cookie|credential|password|secret|token|refresh[_-]?token|access[_-]?token|private[_-]?key)/i;

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
  return secretPatterns.reduce((next, pattern) => next.replace(pattern, "[redacted]"), value);
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
  return [...new Set(tags.map((tag) => redactSecretsInText(tag).trim().toLowerCase()).filter(Boolean))].sort();
}

export function normalizeRefs(values: string[] = []): string[] {
  return [...new Set(values.map((value) => redactSecretsInText(value).trim()).filter(Boolean))].sort();
}

function dateFromNow(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseChangelogDate(date: unknown, now = new Date()): string {
  return date === undefined ? dateFromNow(now) : changelogDateSchema.parse(date);
}

function redactOptionalText(value: string | undefined): string | undefined {
  return value ? redactSecretsInText(value.trim()) : undefined;
}

function normalizeLinks(links: ChangelogEntryInput["links"] = []): ChangelogLink[] {
  return links.map((link) => ({
    label: redactOptionalText(link.label),
    url: redactSecretsInText(link.url.trim()),
  }));
}

export function parseChangelogEntryInput(input: unknown, now = new Date()): ParsedChangelogEntryInput {
  const parsed = changelogEntryInputSchema.parse(input);
  if (parsed.kind && parsed.category && parsed.kind !== parsed.category) {
    throw new Error("kind and category must match when both are provided");
  }
  const kind = parsed.kind ?? parsed.category ?? "changed";
  const details = redactOptionalText(parsed.details ?? parsed.body);
  const metadata = parsed.metadata ? (redactSensitiveJson(parsed.metadata) as JsonObject) : undefined;
  return {
    ...parsed,
    appId: parsed.appId.trim(),
    version: parsed.version.trim(),
    kind,
    category: kind,
    title: redactSecretsInText(parsed.title.trim()),
    message: redactOptionalText(parsed.message),
    details,
    body: details,
    date: parsed.date ?? dateFromNow(now),
    author: redactOptionalText(parsed.author),
    tags: normalizeTags(parsed.tags),
    links: normalizeLinks(parsed.links),
    commits: normalizeRefs(parsed.commits),
    tasks: normalizeRefs(parsed.tasks),
    metadata,
  };
}

export function parseChangelogEntryUpdate(input: unknown): ChangelogEntryUpdate {
  const parsed = changelogEntryUpdateSchema.parse(input);
  if (parsed.kind && parsed.category && parsed.kind !== parsed.category) {
    throw new Error("kind and category must match when both are provided");
  }
  return {
    ...parsed,
    tags: parsed.tags ? normalizeTags(parsed.tags) : undefined,
    links: parsed.links ? normalizeLinks(parsed.links) : undefined,
    commits: parsed.commits ? normalizeRefs(parsed.commits) : undefined,
    tasks: parsed.tasks ? normalizeRefs(parsed.tasks) : undefined,
    metadata: parsed.metadata ? (redactSensitiveJson(parsed.metadata) as JsonObject) : undefined,
  };
}

export function parseChangelogKind(kind: unknown): ChangelogKind {
  return z.enum(changelogKinds).parse(kind);
}

export function parseStoredChangelogEntry(input: unknown): ChangelogEntry {
  const parsed = changelogEntrySchema.parse(input);
  return {
    ...parsed,
    tags: normalizeTags(parsed.tags),
    links: normalizeLinks(parsed.links),
    commits: normalizeRefs(parsed.commits),
    tasks: normalizeRefs(parsed.tasks),
  };
}

export function validationErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
