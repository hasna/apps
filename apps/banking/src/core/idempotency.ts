import { createHash } from "node:crypto";
import type { BankingIntent } from "./intents.ts";
import { canonicalIntentPayload } from "./intents.ts";

export interface IdempotencyFingerprint {
  readonly key: string;
  readonly payloadHash: string;
}

export type IdempotencyReplayStatus = "new" | "replay" | "conflict";

export interface IdempotencyReplayDecision {
  readonly status: IdempotencyReplayStatus;
  readonly key: string;
  readonly reason?: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function createIdempotencyFingerprint(namespace: string, value: unknown): IdempotencyFingerprint {
  const payloadHash = hashPayload(value);
  return {
    key: `${namespace}:${payloadHash.slice(0, 32)}`,
    payloadHash,
  };
}

export function createIntentFingerprint(intent: BankingIntent): IdempotencyFingerprint {
  return createIdempotencyFingerprint(`intent:${intent.providerId}:${intent.type}`, canonicalIntentPayload(intent));
}

export function decideIdempotencyReplay(
  incoming: IdempotencyFingerprint,
  existing?: IdempotencyFingerprint,
): IdempotencyReplayDecision {
  if (!existing) {
    return { status: "new", key: incoming.key };
  }
  if (existing.key === incoming.key && existing.payloadHash === incoming.payloadHash) {
    return { status: "replay", key: incoming.key };
  }
  return {
    status: "conflict",
    key: incoming.key,
    reason: "Idempotency key already exists with a different payload.",
  };
}
