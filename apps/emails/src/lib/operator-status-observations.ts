import type { InboundBucket } from "./config.js";
import { StatusGaps, statusAvailable, statusUnavailable, type StatusAvailability } from "./status-availability.js";
import type { InboundBucketsStatusBlock, RealtimeStatusBlock } from "./status-types.js";

export type OperatorConfigDocument =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly json: string };

/** Caller-owned raw evidence. Only the reader can establish actual absence. */
export interface OperatorStatusConfigReader {
  read(): OperatorConfigDocument;
  readonly defaultRegion: string | undefined;
}

export interface OperatorStatusObservations {
  inboundBuckets: InboundBucketsStatusBlock;
  realtime: RealtimeStatusBlock;
  gaps: Record<string, StatusAvailability>;
}

const SOURCE = "local_config";
const ERROR_PRESENT = "Recorded realtime error (details redacted)";

function unavailable(detail: string, prose: string): StatusAvailability {
  return statusUnavailable("source_unreachable", detail, SOURCE, prose);
}

function refuseBuckets(availability: StatusAvailability, gaps: StatusGaps): InboundBucketsStatusBlock {
  return { availability, items: gaps.mark("inbox.inbound_buckets.items", availability), total: gaps.mark("inbox.inbound_buckets.total", availability) };
}

function refuseRealtime(availability: StatusAvailability, gaps: StatusGaps): RealtimeStatusBlock {
  return {
    availability,
    queue_configured: gaps.mark("inbox.realtime.queue_configured", availability),
    queue_url: gaps.mark("inbox.realtime.queue_url", availability),
    last_poll_at: gaps.mark("inbox.realtime.last_poll_at", availability),
    last_error: gaps.mark("inbox.realtime.last_error", availability),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Display allowlist only: it neither authenticates a queue nor checks reachability. */
function publishableQueue(value: string): boolean {
  const match = /^https:\/\/sqs\.([a-z]{2}(?:-[a-z0-9]+)+-[0-9]+)\.amazonaws\.com\/[0-9]{12}\/([A-Za-z0-9_-]+(?:\.fifo)?)$/.exec(value);
  return match !== null && match[0] === value && match[1]!.length <= 63 && match[2]!.length <= 80;
}

function canonicalPollInstant(value: string): boolean {
  if (!/^(?:[0-9]{4}|[+-][0-9]{6})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function buckets(document: Record<string, unknown>, defaultRegion: unknown, gaps: StatusGaps): InboundBucketsStatusBlock {
  try {
    const list = document["inbound_s3_buckets"];
    if (list !== undefined && !Array.isArray(list)) throw new Error();
    const items: InboundBucket[] = [];
    const seen = new Set<string>();
    for (const entry of list ?? []) {
      if (!object(entry) || !nonblank(entry["bucket"]) || !nonblank(entry["region"])
        || (entry["providerId"] !== undefined && !nonblank(entry["providerId"]))) throw new Error();
      if (seen.has(entry["bucket"])) continue;
      seen.add(entry["bucket"]);
      items.push({ bucket: entry["bucket"], region: entry["region"],
        ...(entry["providerId"] === undefined ? {} : { providerId: entry["providerId"] }) });
    }
    const single = document["inbound_s3_bucket"];
    if (single !== undefined && typeof single !== "string") throw new Error();
    const region = document["inbound_s3_region"] ?? defaultRegion ?? "us-east-1";
    if (!nonblank(region)) throw new Error();
    if (single !== undefined && single !== "" && !nonblank(single)) throw new Error();
    if (nonblank(single) && !seen.has(single)) items.push({ bucket: single, region });
    return { availability: statusAvailable(SOURCE, SOURCE), items, total: items.length };
  } catch {
    return refuseBuckets(unavailable("operator_value_invalid", "The inbound bucket settings are invalid; no bucket inventory is reported."), gaps);
  }
}

function realtime(document: Record<string, unknown>, gaps: StatusGaps): RealtimeStatusBlock {
  const invalid = (path: string): null => gaps.mark(path, unavailable("operator_value_invalid",
    "The recorded operator field has an invalid type or spelling; its value is unavailable and no live-health conclusion is made."));
  const queue = document["inbound_realtime_queue_url"];
  let queueConfigured: boolean | null = false;
  let queueUrl: string | null = null;
  if (queue !== undefined && queue !== null) {
    if (typeof queue !== "string") {
      queueConfigured = invalid("inbox.realtime.queue_configured");
      queueUrl = invalid("inbox.realtime.queue_url");
    } else if (nonblank(queue)) {
      queueConfigured = true;
      queueUrl = publishableQueue(queue) ? queue : gaps.mark("inbox.realtime.queue_url",
        unavailable("operator_value_not_publishable", "The queue setting is present, but its URL identity is withheld because it is not a recognized credential-free SQS URL; no reachability check was performed."));
    }
  }
  const error = document["inbound_realtime_last_error"];
  const lastError = error === undefined || error === null ? null : typeof error !== "string"
    ? invalid("inbox.realtime.last_error") : nonblank(error) ? ERROR_PRESENT : null;
  const poll = document["inbound_realtime_last_poll_at"];
  const lastPoll = poll === undefined || poll === null ? null : typeof poll !== "string"
    ? invalid("inbox.realtime.last_poll_at") : !nonblank(poll) ? null : canonicalPollInstant(poll)
      ? poll : invalid("inbox.realtime.last_poll_at");
  return { availability: statusAvailable(SOURCE, SOURCE), queue_configured: queueConfigured, queue_url: queueUrl,
    last_error: lastError, last_poll_at: lastPoll };
}

/** One raw read; no path selection, filesystem access, cache, provider call or stored-data write. */
export function readOperatorStatusObservations(reader: OperatorStatusConfigReader | null): OperatorStatusObservations {
  const gaps = new StatusGaps();
  const refuse = (availability: StatusAvailability): OperatorStatusObservations => ({
    inboundBuckets: refuseBuckets(availability, gaps), realtime: refuseRealtime(availability, gaps), gaps: gaps.toRecord(),
  });
  if (reader === null) return refuse(statusUnavailable("not_applicable", "operator_config_not_observed", SOURCE,
    "No operator configuration reader was supplied; absence of authority is not an empty configuration."));
  let raw: unknown;
  try { raw = reader.read(); }
  catch { return refuse(unavailable("operator_config_read_failed", "The explicit operator document could not be read; no configuration values are reported.")); }
  let document: Record<string, unknown>;
  try {
    if (!object(raw)) throw new Error();
    const keys = Object.keys(raw);
    if (!Object.hasOwn(raw, "state")) throw new Error();
    if (raw["state"] === "absent" && keys.length === 1) document = {};
    else if (raw["state"] === "present" && keys.length === 2 && Object.hasOwn(raw, "json") && typeof raw["json"] === "string") {
      const parsed: unknown = JSON.parse(raw["json"]);
      if (!object(parsed)) throw new Error();
      document = parsed;
    } else throw new Error();
  } catch { return refuse(unavailable("operator_config_invalid_document", "The explicit operator document is malformed or violates the reader protocol; no configuration values are reported.")); }
  let defaultRegion: unknown;
  try { defaultRegion = reader.defaultRegion; }
  catch { defaultRegion = null; }
  const inboundBuckets = defaultRegion === null
    ? refuseBuckets(unavailable("operator_value_invalid", "The explicit default region is unavailable; no bucket inventory is reported."), gaps)
    : buckets(document, defaultRegion, gaps);
  return { inboundBuckets, realtime: realtime(document, gaps), gaps: gaps.toRecord() };
}
