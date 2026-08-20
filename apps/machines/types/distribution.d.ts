/** Mirror of `DISTRIBUTION_EVENT_TYPES` from `@hasna/events/catalog`. */
export declare const DISTRIBUTION_EVENT_TYPES: {
    readonly releasePublished: "release.published";
    readonly rolloutStarted: "release.rollout.started";
    readonly rolloutCompleted: "release.rollout.completed";
    readonly rolloutFailed: "release.rollout.failed";
    readonly appInstalled: "app.installed";
    readonly announcementSent: "announcement.sent";
    readonly feedbackCreated: "feedback.created";
    readonly feedbackTriaged: "feedback.triaged";
};
export declare const ROLLOUT_RECORD_SCHEMA_ID = "hasna.rollout_record.v1";
export type RolloutAction = "install" | "update" | "rollback" | "freeze-blocked";
/** Mirror of the contracts ContractStatus enum used by rollout_record.result. */
export type RolloutResult = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "skipped" | "unknown";
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
export declare function isValidAppId(value: string): boolean;
/**
 * Derive the distribution appId (hasna.app.v1 join key) for an npm package.
 * `@hasna/todos` maps to the bare `todos` app id; other names are slugified.
 * An explicit `appId` in the manifest always wins.
 */
export declare function defaultAppIdForPackage(packageName: string): string;
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
export declare function buildRolloutRecord(input: BuildRolloutRecordInput): RolloutRecordDoc;
/** Event data payload for a rollout record, matching `RolloutData` from the events catalog. */
export declare function rolloutRecordToEventData(record: RolloutRecordDoc): RolloutData;
