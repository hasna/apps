import { createHash } from "node:crypto";
import type { EventEnvelope } from "@hasna/events";

/** Deep field extraction over Hasna event envelopes and todos task records. */

export function eventData(event: EventEnvelope): Record<string, unknown> {
  const data = event.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  return {};
}

export function eventMetadata(event: EventEnvelope): Record<string, unknown> {
  const metadata = (event as { metadata?: unknown }).metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata as Record<string, unknown>;
  return {};
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function slugSegment(value: string, fallback = "event"): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || fallback;
}

export function stableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function stableHash(parts: unknown[]): string {
  return createHash("sha256").update(parts.map((part) => JSON.stringify(part)).join("\n")).digest("hex").slice(0, 16);
}

export function taskEventField(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = stringField(data[key]);
    if (direct) return direct;
  }
  const task = data.task;
  if (task && typeof task === "object" && !Array.isArray(task)) {
    for (const key of keys) {
      const direct = stringField((task as Record<string, unknown>)[key]);
      if (direct) return direct;
    }
  }
  const payload = data.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const key of keys) {
      const direct = stringField((payload as Record<string, unknown>)[key]);
      if (direct) return direct;
    }
    const payloadTask = (payload as Record<string, unknown>).task;
    if (payloadTask && typeof payloadTask === "object" && !Array.isArray(payloadTask)) {
      for (const key of keys) {
        const direct = stringField((payloadTask as Record<string, unknown>)[key]);
        if (direct) return direct;
      }
    }
  }
  return undefined;
}

export function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nestedObject(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return objectField(input[key]);
}

export function taskEventRecords(data: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [data];
  const dataTask = nestedObject(data, "task");
  if (dataTask) {
    records.push(dataTask);
    const dataTaskMetadata = nestedObject(dataTask, "metadata");
    if (dataTaskMetadata) records.push(dataTaskMetadata);
  }
  const dataPayload = nestedObject(data, "payload");
  if (dataPayload) {
    records.push(dataPayload);
    const payloadMetadata = nestedObject(dataPayload, "metadata");
    if (payloadMetadata) records.push(payloadMetadata);
    const payloadTask = nestedObject(dataPayload, "task");
    if (payloadTask) {
      records.push(payloadTask);
      const payloadTaskMetadata = nestedObject(payloadTask, "metadata");
      if (payloadTaskMetadata) records.push(payloadTaskMetadata);
    }
  }
  const dataMetadata = nestedObject(data, "metadata");
  if (dataMetadata) records.push(dataMetadata);
  records.push(metadata);
  const metadataTask = nestedObject(metadata, "task");
  if (metadataTask) {
    records.push(metadataTask);
    const metadataTaskMetadata = nestedObject(metadataTask, "metadata");
    if (metadataTaskMetadata) records.push(metadataTaskMetadata);
  }
  const metadataAutomation = nestedObject(metadata, "automation");
  if (metadataAutomation) records.push(metadataAutomation);
  return records;
}

export function booleanLike(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

export function hasTruthyField(records: Record<string, unknown>[], keys: string[]): boolean {
  return records.some((record) => keys.some((key) => booleanLike(record[key])));
}

export function firstTruthyField(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      if (booleanLike(record[key])) return key;
    }
  }
  return undefined;
}

export function automationRecords(data: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const dataAutomation = nestedObject(data, "automation");
  if (dataAutomation) records.push(dataAutomation);
  const dataTask = nestedObject(data, "task");
  const dataTaskAutomation = dataTask ? nestedObject(dataTask, "automation") : undefined;
  if (dataTaskAutomation) records.push(dataTaskAutomation);
  const dataTaskMetadata = dataTask ? nestedObject(dataTask, "metadata") : undefined;
  const dataTaskMetadataAutomation = dataTaskMetadata ? nestedObject(dataTaskMetadata, "automation") : undefined;
  if (dataTaskMetadataAutomation) records.push(dataTaskMetadataAutomation);
  const dataPayload = nestedObject(data, "payload");
  const payloadAutomation = dataPayload ? nestedObject(dataPayload, "automation") : undefined;
  if (payloadAutomation) records.push(payloadAutomation);
  const payloadMetadata = dataPayload ? nestedObject(dataPayload, "metadata") : undefined;
  const payloadMetadataAutomation = payloadMetadata ? nestedObject(payloadMetadata, "automation") : undefined;
  if (payloadMetadataAutomation) records.push(payloadMetadataAutomation);
  const payloadTask = dataPayload ? nestedObject(dataPayload, "task") : undefined;
  const payloadTaskAutomation = payloadTask ? nestedObject(payloadTask, "automation") : undefined;
  if (payloadTaskAutomation) records.push(payloadTaskAutomation);
  const payloadTaskMetadata = payloadTask ? nestedObject(payloadTask, "metadata") : undefined;
  const payloadTaskMetadataAutomation = payloadTaskMetadata ? nestedObject(payloadTaskMetadata, "automation") : undefined;
  if (payloadTaskMetadataAutomation) records.push(payloadTaskMetadataAutomation);
  const dataMetadata = nestedObject(data, "metadata");
  const dataMetadataAutomation = dataMetadata ? nestedObject(dataMetadata, "automation") : undefined;
  if (dataMetadataAutomation) records.push(dataMetadataAutomation);
  const metadataAutomation = nestedObject(metadata, "automation");
  if (metadataAutomation) records.push(metadataAutomation);
  const metadataTask = nestedObject(metadata, "task");
  const metadataTaskAutomation = metadataTask ? nestedObject(metadataTask, "automation") : undefined;
  if (metadataTaskAutomation) records.push(metadataTaskAutomation);
  const metadataTaskMetadata = metadataTask ? nestedObject(metadataTask, "metadata") : undefined;
  const metadataTaskMetadataAutomation = metadataTaskMetadata ? nestedObject(metadataTaskMetadata, "automation") : undefined;
  if (metadataTaskMetadataAutomation) records.push(metadataTaskMetadataAutomation);
  return records;
}

export function tagsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

export function taskEventTags(records: Record<string, unknown>[]): string[] {
  const tags = new Set<string>();
  for (const record of records) {
    for (const tag of tagsFromValue(record.tags ?? record.task_tags ?? record.taskTags)) tags.add(tag);
  }
  return [...tags];
}

const ROUTE_DISALLOWED_TASK_TAGS = new Set([
  "no-auto",
  "manual",
  "manual-required",
  "approval-required",
  "blocked",
  "completed",
  "done",
  "cancelled",
  "canceled",
  "failed",
  "archived",
]);

const ROUTE_MANUAL_GATE_FIELDS = [
  "no_auto",
  "noAuto",
  "manual",
  "manual_required",
  "manualRequired",
  "requires_approval",
  "requiresApproval",
  "approval_required",
  "approvalRequired",
];

export function taskRouteEligibility(data: Record<string, unknown>, metadata: Record<string, unknown>): { eligible: boolean; reason?: string; tags: string[] } {
  const records = taskEventRecords(data, metadata);
  const automation = automationRecords(data, metadata);
  const tags = taskEventTags(records);
  const hasRouteOptIn =
    // todos hands out `route:enabled` as its opt-in tag; loops historically only
    // honored `auto:route`, so tasks tagged the todos way were silently dropped.
    // Treat the two as equivalent.
    tags.includes("auto:route") ||
    tags.includes("route:enabled") ||
    hasTruthyField(records, ["route_enabled", "routeEnabled", "automation_allowed", "automationAllowed"]) ||
    hasTruthyField(automation, ["allowed"]);
  if (!hasRouteOptIn) return { eligible: false, reason: "missing explicit route opt-in", tags };

  const status = taskEventField(data, ["status", "task_status", "taskStatus"])?.toLowerCase();
  if (status && ["blocked", "completed", "done", "cancelled", "canceled", "failed", "archived"].includes(status)) {
    return { eligible: false, reason: `task status is not routable: ${status}`, tags };
  }

  const disallowedTags = tags.filter((tag) => ROUTE_DISALLOWED_TASK_TAGS.has(tag.toLowerCase()));
  if (disallowedTags.length) return { eligible: false, reason: `task has disallowed tag: ${disallowedTags[0]}`, tags };

  const manualGateField = firstTruthyField([...records, ...automation], ROUTE_MANUAL_GATE_FIELDS);
  if (manualGateField) {
    return { eligible: false, reason: `task metadata requires manual or approval-gated handling: ${manualGateField}`, tags };
  }

  return { eligible: true, tags };
}

export function canonicalRouteField(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function stringValuesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => stringValuesFromUnknown(entry));
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
}

export function recordFieldValues(record: Record<string, unknown>, field: string): string[] {
  const expected = canonicalRouteField(field);
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (canonicalRouteField(key) === expected) values.push(...stringValuesFromUnknown(value));
  }
  return values;
}

export function routeFieldValues(records: Record<string, unknown>[], field: string): string[] {
  if (canonicalRouteField(field) === "tags") return taskEventTags(records);
  return records.flatMap((record) => recordFieldValues(record, field));
}

export function firstRouteField(records: Record<string, unknown>[], fields: string[]): string | undefined {
  for (const field of fields) {
    const value = routeFieldValues(records, field).find(Boolean);
    if (value) return value;
  }
  return undefined;
}

export function routeFieldList(records: Record<string, unknown>[], fields: string[]): string[] | undefined {
  for (const field of fields) {
    const values = routeFieldValues(records, field);
    if (values.length) return values;
  }
  return undefined;
}
