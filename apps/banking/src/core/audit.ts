import { hashPayload } from "./idempotency.ts";
import type { ActorRef } from "./intents.ts";

export type AuditEventType =
  | "intent.created"
  | "policy.evaluated"
  | "approval.decided"
  | "provider.submitted"
  | "provider.webhook_received"
  | "reconciliation.updated";

export interface AuditEvent {
  readonly id: string;
  readonly type: AuditEventType;
  readonly actor: ActorRef;
  readonly occurredAt: string;
  readonly subjectId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly previousHash?: string;
  readonly hash: string;
}

const SECRET_KEY_PATTERN = /(secret|token|password|client[_-]?assertion|authorization|api[_-]?key|pan|cvv|cvc|card[_-]?number)/i;
const SECRET_PATH_PATTERN = /(^|\.)card\.(number|pan|cvv|cvc)$/i;
const TOKEN_PREFIX_PATTERN = ["sk-", `gh${"p"}_`, `gh${"o"}_`, `np${"m"}_`, "eyJ"].join("|");
const SENSITIVE_VALUE_PATTERN = new RegExp(`^(\\d[ -]?){13,19}$|^(bearer\\s+)?(${TOKEN_PREFIX_PATTERN})[A-Za-z0-9._-]+`, "i");

export function redactAuditMetadata(metadata: Readonly<Record<string, unknown>>, path: readonly string[] = []): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, redactValue(path, key, value)]));
}

export function createAuditEvent(input: Omit<AuditEvent, "metadata" | "hash"> & { readonly metadata: Readonly<Record<string, unknown>> }): AuditEvent {
  const metadata = redactAuditMetadata(input.metadata);
  const hash = hashPayload({ ...input, metadata });
  return { ...input, metadata, hash };
}

function redactValue(path: readonly string[], key: string, value: unknown): unknown {
  const fieldPath = [...path, key].join(".");
  if (SECRET_KEY_PATTERN.test(key) || SECRET_PATH_PATTERN.test(fieldPath)) {
    return "[REDACTED]";
  }
  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(path, key, entry));
  }
  if (value && typeof value === "object") {
    return redactAuditMetadata(value as Record<string, unknown>, [...path, key]);
  }
  return value;
}
