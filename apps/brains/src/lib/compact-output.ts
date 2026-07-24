export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_GATHER_LIMIT = 500;
export const DEFAULT_TEXT_LIMIT = 96;
export const DEFAULT_PREVIEW_TEXT_LIMIT = 160;

export interface LimitedItems<T> {
  items: T[];
  total: number;
  shown: number;
  hidden: number;
  limit: number;
}

export interface CompactMessage {
  role: string;
  content: string;
}

export interface CompactTrainingExample {
  messages: CompactMessage[];
  metadata?: Record<string, string>;
  omitted_messages?: number;
  omitted_metadata_keys?: number;
  truncated: boolean;
}

export function parsePositiveIntegerOption(
  rawValue: string | undefined,
  flagName: string,
  defaultValue?: number
): number | undefined {
  if (rawValue === undefined || rawValue === "") return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName} value: ${rawValue}. Use a positive integer.`);
  }
  return parsed;
}

export function limitItems<T>(items: T[], limit = DEFAULT_LIST_LIMIT): LimitedItems<T> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const limited = items.slice(0, safeLimit);
  return {
    items: limited,
    total: items.length,
    shown: limited.length,
    hidden: Math.max(0, items.length - limited.length),
    limit: safeLimit,
  };
}

export function truncateText(value: unknown, maxLength = DEFAULT_TEXT_LIMIT): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}

export function truncateMiddle(value: unknown, maxLength = DEFAULT_TEXT_LIMIT): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  const keepStart = Math.ceil((maxLength - 1) / 2);
  const keepEnd = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
}

export function formatShortId(id: string, _verbose = false): string {
  return id;
}

export function formatDate(value: number | string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function summarizeTrainingExample(
  example: unknown,
  opts: {
    maxMessages?: number;
    maxMetadataKeys?: number;
    maxTextLength?: number;
  } = {}
): CompactTrainingExample {
  const maxMessages = opts.maxMessages ?? 6;
  const maxMetadataKeys = opts.maxMetadataKeys ?? 6;
  const maxTextLength = opts.maxTextLength ?? DEFAULT_PREVIEW_TEXT_LIMIT;
  const root = isRecord(example) ? example : {};
  const rawMessages = Array.isArray(root.messages) ? root.messages : [];
  let truncated = false;

  const messages = rawMessages.slice(0, maxMessages).map((message, index) => {
    if (!isRecord(message)) {
      return {
        role: `message_${index + 1}`,
        content: truncateText(stringifyCompact(message), maxTextLength),
      };
    }
    const role = typeof message.role === "string" && message.role.trim() ? message.role : `message_${index + 1}`;
    const content = truncateText(stringifyCompact(message.content), maxTextLength);
    if (content !== stringifyCompact(message.content).replace(/\s+/g, " ").trim()) truncated = true;
    return { role, content };
  });

  const omittedMessages = Math.max(0, rawMessages.length - messages.length);
  if (omittedMessages > 0) truncated = true;

  const rawMetadata = isRecord(root.metadata) ? root.metadata : undefined;
  const metadataEntries = rawMetadata ? Object.entries(rawMetadata) : [];
  const metadata = metadataEntries.length > 0
    ? Object.fromEntries(
      metadataEntries
        .slice(0, maxMetadataKeys)
        .map(([key, value]) => [key, truncateText(stringifyCompact(value), Math.min(maxTextLength, 100))])
    )
    : undefined;
  const omittedMetadataKeys = Math.max(0, metadataEntries.length - (metadata ? Object.keys(metadata).length : 0));
  if (omittedMetadataKeys > 0) truncated = true;

  return {
    messages,
    ...(metadata ? { metadata } : {}),
    ...(omittedMessages > 0 ? { omitted_messages: omittedMessages } : {}),
    ...(omittedMetadataKeys > 0 ? { omitted_metadata_keys: omittedMetadataKeys } : {}),
    truncated,
  };
}
