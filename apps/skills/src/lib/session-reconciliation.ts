import { createHash } from "node:crypto";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { readSkillSessionSnapshot, replaceSkillSession, selectionKey, SkillSelectionError, validateResolvedProfile, type SelectionCacheOptions, type SkillSessionReceipt } from "./selection-cache.js";

export interface SessionReconciliationInput {
  sessionId: string;
  fromProfile: string;
  fromRevision: string;
  receiptSha256: string;
  selectionProfile: string;
  profileRevision: string;
  apply?: boolean;
  planDigest?: string;
}
export interface SessionReconciliationOptions extends SelectionCacheOptions { client?: ProfileClient }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Metadata only: inspection never displays skill payloads or resolves credentials. */
export function inspectSkillSession(sessionId: string, options: SelectionCacheOptions = {}) {
  const snapshot = readSkillSessionSnapshot(sessionId, options), { receipt } = snapshot;
  return {
    sessionId, path: snapshot.path, receiptSha256: snapshot.sha256, verifiedAt: receipt.verifiedAt,
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
  if (input.apply && !input.planDigest) throw new SkillSelectionError("SESSION_PLAN_REQUIRED", "Review the session reconciliation plan and provide its exact --plan-digest before applying it.");
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
  const plan = {
    schemaVersion: 1, sessionId: input.sessionId, sessionPath: snapshot.path,
    before: { receiptSha256: snapshot.sha256, profileId: old.profile.profileId, profileRevision: old.profile.profileRevision, selectionCount: old.profile.selections.length },
    target: { authority: target.authority, workspaceId: target.workspaceId, profileId: target.profileId, profileRevision: target.profileRevision, profileSha256: digest(target), selectionCount: target.selections.length },
    retainedLoadedCount: loaded.length, retiredLoadedCount: old.loaded.length - loaded.length,
    scope: "Only this receipt; existing child sessions, project locks, shared profiles, hooks and running processes are unchanged.",
  };
  const planDigest = digest(plan);
  if (input.planDigest !== undefined && input.planDigest !== planDigest) throw new SkillSelectionError("SESSION_PLAN_CHANGED", "The session reconciliation plan differs from the reviewed plan.");
  if (!input.apply) return { applied: false as const, plan, planDigest, archivePath: undefined, receiptPath: undefined, beforeSha256: snapshot.sha256, afterSha256: undefined };
  const replacement: SkillSessionReceipt = {
    ...old, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile: target, loaded,
  };
  const result = replaceSkillSession(snapshot.sha256, replacement, { ...plan, planDigest }, options);
  return { applied: true as const, plan, planDigest, ...result };
}
