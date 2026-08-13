// ---------------------------------------------------------------------------
// Read-only rollout event ingestion hook (STUB).
//
// The catalog is a READ MODEL: install/rollout state is owned by
// machines-agent, which will emit `hasna.rollout_record.v1`-shaped events
// (`release.rollout.*` / `app.installed`) through @hasna/events. This hook
// validates those envelopes today so wiring can land ahead of the writer, but
// it intentionally persists NOTHING — no store handle is accepted, and
// accepted events are only returned to the caller.
// ---------------------------------------------------------------------------

import {
  ROLLOUT_EVENT_TYPES,
  type DistributionEventEnvelope,
  type RolloutEventData,
} from "./contracts.js";

export type RolloutIngestResult =
  | { accepted: true; type: string; data: RolloutEventData; persisted: false; note: string }
  | { accepted: false; reason: string };

const REQUIRED_STRING_FIELDS = ["appId", "package", "version", "machine"] as const;
const RESULT_REQUIRED_TYPES = new Set(["release.rollout.completed", "release.rollout.failed"]);

export interface RolloutIngestionHook {
  /** Event types this hook understands. */
  readonly eventTypes: readonly string[];
  /** Validate a distribution event envelope. Never persists anything. */
  handleEvent(event: DistributionEventEnvelope): RolloutIngestResult;
}

/**
 * Create the read-only ingestion hook for rollout events. Persistence is a
 * follow-up owned by the machines-agent lane; until then this hook only
 * validates and echoes normalized payloads.
 */
export function createRolloutIngestionHook(): RolloutIngestionHook {
  return {
    eventTypes: ROLLOUT_EVENT_TYPES,
    handleEvent(event: DistributionEventEnvelope): RolloutIngestResult {
      if (!event || typeof event.type !== "string") {
        return { accepted: false, reason: "event envelope must have a string type" };
      }
      if (!(ROLLOUT_EVENT_TYPES as readonly string[]).includes(event.type)) {
        return { accepted: false, reason: `unsupported event type: ${event.type}` };
      }
      const data = event.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { accepted: false, reason: "event data payload must be an object" };
      }
      for (const field of REQUIRED_STRING_FIELDS) {
        const value = (data as Record<string, unknown>)[field];
        if (typeof value !== "string" || value.trim().length === 0) {
          return { accepted: false, reason: `event data requires non-empty string field: ${field}` };
        }
      }
      if (RESULT_REQUIRED_TYPES.has(event.type)) {
        const result = (data as Record<string, unknown>)["result"];
        if (typeof result !== "string" || result.trim().length === 0) {
          return { accepted: false, reason: `${event.type} events require a result field` };
        }
      }
      return {
        accepted: true,
        type: event.type,
        data: data as RolloutEventData,
        persisted: false,
        note: "read-model stub: rollout state persistence arrives with machines-agent rollout_record events",
      };
    },
  };
}
