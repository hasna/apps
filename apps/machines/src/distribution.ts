// ---------------------------------------------------------------------------
// Vendored type mirrors for the Hasna distribution apps plan.
//
// These constants and types are dependency-free structural mirrors of:
//   - `@hasna/contracts` branch `feat/distribution-schemas`
//     (`hasna.rollout_record.v1`, shared AppId slug primitive)
//   - `@hasna/events` branch `feat/distribution-event-catalog`
//     (`DISTRIBUTION_EVENT_TYPES`, `RolloutData`)
//
// Neither foundation package version is published yet, so `@hasna/machines`
// vendors this minimal mirror instead of taking a file: dependency. Once the
// foundation packages ship, these imports can be swapped for
// `@hasna/events/catalog` and `@hasna/contracts/schemas` without changing the
// emitted shapes.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";

/** Mirror of `DISTRIBUTION_EVENT_TYPES` from `@hasna/events/catalog`. */
export const DISTRIBUTION_EVENT_TYPES = {
  releasePublished: "release.published",
  rolloutStarted: "release.rollout.started",
  rolloutCompleted: "release.rollout.completed",
  rolloutFailed: "release.rollout.failed",
  appInstalled: "app.installed",
  announcementSent: "announcement.sent",
  feedbackCreated: "feedback.created",
  feedbackTriaged: "feedback.triaged",
} as const;

export const ROLLOUT_RECORD_SCHEMA_ID = "hasna.rollout_record.v1";

export type RolloutAction = "install" | "update" | "rollback" | "freeze-blocked";

/** Mirror of the contracts ContractStatus enum used by rollout_record.result. */
export type RolloutResult =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked"
  | "skipped"
  | "unknown";

export interface RolloutVerification {
  cliVersion?: string;
  mcpHealth?: "ok" | "degraded" | "unavailable" | "not_checked";
}

export interface EvidencePointer {
  id: string;
  kind?: string;
  uri?: string;
  sha256?: string;
  summary?: string;
}

/** Mirror of `RolloutData` from `@hasna/events/catalog` (open payload, extra keys allowed). */
export interface RolloutData {
  appId: string;
  package: string;
  version: string;
  machine: string;
  action?: RolloutAction;
  result?: string;
  error?: string;
  [key: string]: unknown;
}

/** Mirror of `ReleasePublishedData` from `@hasna/events/catalog`. */
export interface ReleasePublishedData {
  appId: string;
  package: string;
  version: string;
  gitSha?: string;
  publishedAt?: string;
  publishPath?: "skill" | "ci" | "backfilled";
  changelogRef?: string;
  [key: string]: unknown;
}

/** Structural mirror of a `hasna.rollout_record.v1` contract document. */
export interface RolloutRecordDoc {
  schema: typeof ROLLOUT_RECORD_SCHEMA_ID;
  id: string;
  createdAt: string;
  appId: string;
  package: string;
  version: string;
  machine: string;
  action: RolloutAction;
  result: RolloutResult;
  verifiedBy?: RolloutVerification;
  at: string;
  evidenceRefs: EvidencePointer[];
}

const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidAppId(value: string): boolean {
  return APP_ID_PATTERN.test(value);
}

/**
 * Derive the distribution appId (hasna.app.v1 join key) for an npm package.
 * `@hasna/todos` maps to the `open-todos` repo folder convention; other names
 * are slugified. An explicit `appId` in the manifest always wins.
 */
export function defaultAppIdForPackage(packageName: string): string {
  const scoped = packageName.match(/^@([^/]+)\/(.+)$/);
  const base = scoped ? scoped[2]! : packageName;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (scoped && scoped[1] === "hasna" && !slug.startsWith("open-")) {
    return `open-${slug}`;
  }
  return slug || "unknown";
}

export interface BuildRolloutRecordInput {
  appId?: string;
  package: string;
  version: string;
  machine: string;
  action: RolloutAction;
  result: RolloutResult;
  verifiedBy?: RolloutVerification;
  at?: string;
  evidenceRefs?: EvidencePointer[];
  id?: string;
}

/**
 * Build a `hasna.rollout_record.v1`-shaped document, enforcing the contract
 * coupling rules locally:
 * - action `freeze-blocked` requires result `blocked` or `skipped`
 * - result `succeeded` on install/update requires `verifiedBy`
 */
export function buildRolloutRecord(input: BuildRolloutRecordInput): RolloutRecordDoc {
  if (input.action === "freeze-blocked" && input.result !== "blocked" && input.result !== "skipped") {
    throw new Error(`freeze-blocked rollout records must report result blocked or skipped (got "${input.result}")`);
  }
  if ((input.action === "install" || input.action === "update") && input.result === "succeeded" && !input.verifiedBy) {
    throw new Error("Succeeded install/update rollout records require verifiedBy");
  }
  if (!input.machine.trim()) {
    throw new Error("rollout records require a machine id");
  }
  const at = input.at ?? new Date().toISOString();
  return {
    schema: ROLLOUT_RECORD_SCHEMA_ID,
    id: input.id ?? randomUUID(),
    createdAt: at,
    appId: input.appId ?? defaultAppIdForPackage(input.package),
    package: input.package,
    version: input.version,
    machine: input.machine,
    action: input.action,
    result: input.result,
    verifiedBy: input.verifiedBy,
    at,
    evidenceRefs: input.evidenceRefs ?? [],
  };
}

/** Event data payload for a rollout record, matching `RolloutData` from the events catalog. */
export function rolloutRecordToEventData(record: RolloutRecordDoc): RolloutData {
  return {
    appId: record.appId,
    package: record.package,
    version: record.version,
    machine: record.machine,
    action: record.action,
    result: record.result,
  };
}
