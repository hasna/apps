import { createHash } from "node:crypto";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { nextSkillSessionGeneration, readSkillSessionSnapshot, replaceSkillSession, selectionKey, skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, type SelectionCacheOptions, type SkillSessionReceipt } from "./selection-cache.js";

export interface SessionReconciliationInput {
  sessionId: string;
  fromProfile: string;
  fromRevision: string;
  receiptSha256: string;
  selectionProfile: string;
  profileRevision: string;
  apply?: boolean;
  planDigest?: string;
  planIssuedAt?: string;
  planExpiresAt?: string;
}
export interface SessionReconciliationOptions extends SelectionCacheOptions { client?: ProfileClient }
export const SESSION_RECONCILIATION_PLAN_TTL_MS = 5 * 60 * 1000;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function exactTimestamp(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "The reviewed plan must include its exact canonical issuedAt and expiresAt timestamps.");
  }
  return parsed;
}
function assertPlanWindow(issuedAt: string, expiresAt: string, now: number): void {
  const issued = exactTimestamp(issuedAt), expires = exactTimestamp(expiresAt);
  if (expires - issued !== SESSION_RECONCILIATION_PLAN_TTL_MS) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "A session reconciliation approval is valid for exactly five minutes and cannot be extended by the caller.");
  }
  if (now < issued || now >= expires) {
    throw new SkillSelectionError("SESSION_PLAN_EXPIRED", "The reviewed session reconciliation plan is not currently valid; inspect the receipt and prepare a new plan.");
  }
}

/** Metadata only: inspection never displays skill payloads or resolves credentials. */
export function inspectSkillSession(sessionId: string, options: SelectionCacheOptions = {}) {
  const snapshot = readSkillSessionSnapshot(sessionId, options), { receipt } = snapshot;
  return {
    sessionId, path: snapshot.path, receiptSha256: snapshot.sha256, generation: snapshot.generation, verifiedAt: receipt.verifiedAt,
    authority: receipt.profile.authority, workspaceId: receipt.profile.workspaceId,
    profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision,
    selectionCount: receipt.profile.selections.length, loadedCount: receipt.loaded.length,
  };
}

/** Explicit opt-in only. Ordinary loads and hooks retain their immutable session pins. */
export async function reconcileSkillSession(input: SessionReconciliationInput, options: SessionReconciliationOptions = {}) {
  if (![input.fromProfile, input.fromRevision, input.selectionProfile, input.profileRevision].every(value => typeof value === "string" && value.trim())
      || !/^[a-f0-9]{64}$/.test(input.receiptSha256)) {
    throw new SkillSelectionError("INVALID_SESSION_RECONCILIATION", "Name the exact old receipt SHA256, old profile/revision and intended target profile/revision.");
  }
  if (input.apply && (!input.planDigest || !input.planIssuedAt || !input.planExpiresAt)) {
    throw new SkillSelectionError("SESSION_PLAN_REQUIRED", "Review the session reconciliation plan and provide its exact digest, issuedAt and expiresAt before applying it.");
  }
  if (!input.apply && (input.planDigest !== undefined || input.planIssuedAt !== undefined || input.planExpiresAt !== undefined)) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "Plan timestamps are minted by the planner and may only be replayed with --apply.");
  }
  const now = (options.now ?? Date.now)();
  const issuedAt = input.apply ? input.planIssuedAt! : new Date(now).toISOString();
  const expiresAt = input.apply ? input.planExpiresAt! : new Date(now + SESSION_RECONCILIATION_PLAN_TTL_MS).toISOString();
  if (input.apply) assertPlanWindow(issuedAt, expiresAt, now);
  const snapshot = readSkillSessionSnapshot(input.sessionId, options), old = snapshot.receipt;
  if (snapshot.sha256 !== input.receiptSha256 || old.profile.profileId !== input.fromProfile || old.profile.profileRevision !== input.fromRevision) {
    throw new SkillSelectionError("SESSION_RECEIPT_CHANGED", "The current session receipt does not match the reviewed old bytes, profile and revision.");
  }
  const client = options.client ?? await createProfileClient();
  const target = structuredClone(await client.resolveProfile(input.selectionProfile));
  validateResolvedProfile(target, client.authority);
  if (target.profileId !== input.selectionProfile || target.profileRevision !== input.profileRevision) {
    throw new SkillSelectionError("SESSION_TARGET_CHANGED", "The API selection profile does not match the intended target revision; review the current selection before proceeding.");
  }
  if (old.profile.authority !== target.authority || old.profile.workspaceId !== target.workspaceId) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "A session reconciliation cannot change its Skills authority or workspace.");
  }
  const targetKeys = new Set(target.selections.map(selectionKey));
  const loaded = old.loaded.filter(key => targetKeys.has(key));
  const replacementGeneration = nextSkillSessionGeneration(snapshot.generation);
  const plan = {
    schemaVersion: 1, issuedAt, expiresAt, sessionId: input.sessionId, sessionPath: snapshot.path,
    before: { receiptSha256: snapshot.sha256, generation: snapshot.generation, profileId: old.profile.profileId, profileRevision: old.profile.profileRevision, selectionCount: old.profile.selections.length },
    target: { authority: target.authority, workspaceId: target.workspaceId, profileId: target.profileId, profileRevision: target.profileRevision, profileSha256: digest(target), selectionCount: target.selections.length },
    replacementGeneration, retainedLoadedCount: loaded.length, retiredLoadedCount: old.loaded.length - loaded.length,
    scope: "Only this receipt; existing child sessions, project locks, shared profiles, hooks and running processes are unchanged.",
  };
  const planDigest = digest(plan);
  if (input.planDigest !== undefined && input.planDigest !== planDigest) throw new SkillSelectionError("SESSION_PLAN_CHANGED", "The session reconciliation plan differs from the reviewed plan.");
  if (!input.apply) return { applied: false as const, plan, planDigest, archivePath: undefined, receiptPath: undefined, beforeSha256: snapshot.sha256, afterSha256: undefined };
  assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)());
  const replacement: SkillSessionReceipt = {
    ...old, generation: replacementGeneration, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile: target, loaded,
  };
  const result = replaceSkillSession(skillSessionSnapshotBinding(snapshot), replacement, { ...plan, planDigest }, options,
    () => assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)()));
  return { applied: true as const, plan, planDigest, ...result };
}
