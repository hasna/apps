import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, posix, relative, resolve } from "node:path";
import {
  observeProjectContextSessionGuard,
  removeProjectContextCoordinatedFile,
  withProjectContextSessionGuard,
  writeProjectContextCoordinatedFile,
  type ProjectContextWriteCoordination,
} from "./project-context.js";
import {
  getSessionRenderSnapshotDir,
  sessionRenderSnapshotWorkspaceRoot,
} from "./session-render-state.js";
import {
  SESSION_RENDER_MANAGED_MARKER,
  SESSION_RENDER_SCHEMA,
  SESSION_RENDERER_OWNER_ID,
  type SessionRenderFile,
  type SessionRenderFileRole,
  type SessionRenderManifest,
  type SessionRenderPlan,
  type SessionSkippedSource,
  type SessionLegacyReplacementSource,
  type SessionLegacyRetirementProvenance,
} from "./session-render.js";
import {
  detectCursorAuthorityConflicts,
  observeCursorGlobalAuthorityAtPath,
} from "./cursor-authority.js";
import {
  detectClaudeAuthorityConflicts,
  type ClaudeOwnedAuthority,
} from "./session-authority.js";
import { sessionRenderOwnsPath } from "./session-render-ownership.js";

export type SessionApplyAction = "create" | "update" | "delete" | "unchanged" | "conflict";

export interface SessionApplyFileResult {
  path: string;
  relativePath: string;
  role: SessionRenderFileRole;
  action: SessionApplyAction;
  changed: boolean;
  previousSha256: string | null;
  newSha256: string;
  reason: string | null;
}

export interface SessionDriftEntry {
  path: string;
  relativePath: string;
  expectedSha256: string;
  actualSha256: string | null;
  reason: "missing" | "hash_mismatch";
}

export interface SessionDriftCheck {
  checked: boolean;
  clean: boolean;
  manifestPath: string;
  checkedAt: string;
  missing: SessionDriftEntry[];
  drifted: SessionDriftEntry[];
}

export interface SessionApplyResult {
  dryRun: boolean;
  applied: boolean;
  targetHome: string;
  manifestPath: string;
  snapshotPath: string | null;
  rollback: SessionRollbackReceipt;
  env: Record<string, string>;
  warnings: string[];
  skippedSources: SessionSkippedSource[];
  files: SessionApplyFileResult[];
  conflicts: SessionApplyFileResult[];
  drift: SessionDriftCheck;
  /** Verified preimages selected for adoption; only applied=true proves adoption. */
  adoptions: SessionFileAdoptionReceipt[];
  /** Verified drifted preimages selected for reconciliation; qualified by applied. */
  reconciliations: SessionFileReconciliationReceipt[];
  /** Exact reviewed obsolete managed files removed by this transaction. */
  retirements: SessionFileRetirementReceipt[];
  /** Explicit legacy retirement; never implies previous managed ownership. */
  legacyRetirements: SessionLegacyFileRetirementReceipt[];
}

export interface SessionFileAdoption {
  relativePath: string;
  /** SHA-256 of the exact, previously reviewed file bytes. */
  sha256: string;
}

export interface SessionFileAdoptionReceipt {
  path: string;
  relativePath: string;
  preimageSha256: string;
  renderedSha256: string;
  sourceIds: string[];
}

export interface SessionFileReconciliationReceipt extends SessionFileAdoptionReceipt {
  previousManagedSha256: string;
}

export interface SessionFileRetirementReceipt {
  path: string;
  relativePath: string;
  preimageSha256: string;
  previousManagedSha256: string;
  sourceIds: string[];
}

export interface SessionLegacyFileRetirement extends SessionFileAdoption {
  coverageReviewSha256: string;
  replacementSources: SessionLegacyReplacementSource[];
}

export interface SessionLegacyFileRetirementReceipt extends SessionLegacyRetirementProvenance {
  path: string;
}

export interface SessionRollbackReceipt {
  schema: "hasna.configs.session-render-rollback/v1";
  status: "available" | "not-required" | "unsupported" | "blocked";
  snapshotPath: string | null;
  reason:
    | "snapshot-created"
    | "dry-run-does-not-write"
    | "conflicts-prevented-apply"
    | "new-root-snapshot-not-supported-for-adapter";
}

export interface SessionApplyOptions {
  dryRun?: boolean;
  force?: boolean;
  adoptFiles?: SessionFileAdoption[];
  /** Exact reviewed drift on owned outputs; requires expectedManifestSha256. */
  reconcileFiles?: SessionFileAdoption[];
  /** Exact reviewed obsolete owned outputs; requires the manifest preimage. */
  retireFiles?: SessionFileAdoption[];
  /** Reviewed obsolete native prompt carriers outside the previous manifest.
   * Requires hosted compiled replacements, coverage evidence and manifest CAS. */
  retireLegacyFiles?: SessionLegacyFileRetirement[];
  /** Compare-and-swap precondition captured before resolving hosted sources. */
  expectedManifestSha256?: string;
  /**
   * Registered Instructions configs that own a Claude-home AGENTS.md (see
   * ClaudeOwnedAuthority). Passed to the apply-time authority recheck so an
   * owned, consistent AGENTS.md does not read as "changed after planning".
   */
  ownedClaudeAuthorities?: ClaudeOwnedAuthority[];
  test_hooks?: {
    before_apply_writes?: (context: {
      plan: SessionRenderPlan;
      results: SessionApplyFileResult[];
    }) => void;
    force_portable_file_ops?: boolean;
  };
}

export interface SessionRestoreOptions {
  dryRun?: boolean;
  test_hooks?: {
    force_portable_file_ops?: boolean;
  };
}

export interface SessionRestoreConflict {
  path: string;
  relativePath: string;
  expectedSha256: string | null;
  actualSha256: string | null;
}

export interface SessionRestoreFileResult {
  path: string;
  relativePath: string;
  action: "create" | "update" | "delete" | "unchanged";
  previousSha256: string | null;
  restoredSha256: string | null;
}

export interface SessionRestoreResult {
  dryRun: boolean;
  restored: boolean;
  snapshotPath: string;
  targetHome: string;
  conflicts: SessionRestoreConflict[];
  files: SessionRestoreFileResult[];
}

type SessionSnapshotAction = "create" | "update" | "delete" | "unchanged";
type SessionSnapshotSchema =
  | "hasna.configs.session-render-snapshot/v1"
  | "hasna.configs.session-render-snapshot/v2";

interface SessionRenderSnapshotAfterFileV1 {
  path: string;
  relativePath: string;
  role: SessionRenderFileRole;
  action: SessionSnapshotAction;
  sha256: string | null;
}

interface SessionRenderSnapshot {
  schema: SessionSnapshotSchema;
  createdAt: string;
  tool: SessionRenderPlan["tool"];
  profile: string;
  targetHome: string;
  targetKind: SessionRenderPlan["targetKind"];
  manifestPath: string;
  previousManifest: SessionRenderManifest | null;
  files: Array<{
    path: string;
    relativePath: string;
    role: SessionRenderFileRole;
    sha256: string;
    content: string;
    /** Preserved permissions for explicitly retired legacy files. */
    mode?: number;
  }>;
  afterFiles: SessionRenderSnapshotAfterFileV1[];
  adoptions?: SessionFileAdoptionReceipt[];
  reconciliations?: SessionFileReconciliationReceipt[];
  retirements?: SessionFileRetirementReceipt[];
  legacyRetirements?: SessionLegacyFileRetirementReceipt[];
}

interface StoredSessionRenderSnapshot extends Omit<SessionRenderSnapshot, "targetKind" | "afterFiles"> {
  targetKind?: SessionRenderPlan["targetKind"];
  afterFiles?: Array<Omit<SessionRenderSnapshotAfterFileV1, "action"> & {
    action?: SessionSnapshotAction;
  }>;
}

export class SessionApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionApplyError";
  }
}

export function applySessionRender(
  plan: SessionRenderPlan,
  options: SessionApplyOptions = {},
): SessionApplyResult {
  return withProjectContextSessionGuard(
    plan.projectContextGuard,
    (coordination) => applySessionRenderUnlocked(plan, options, coordination),
    { dry_run: options.dryRun },
  );
}

function applySessionRenderUnlocked(
  plan: SessionRenderPlan,
  options: SessionApplyOptions,
  coordination: ProjectContextWriteCoordination | null,
): SessionApplyResult {
  if (plan.blocked || !plan.writable) {
    throw new SessionApplyError(`Session render plan is blocked: ${plan.blockers.join("; ")}`);
  }
  const installerAssets = plan.assetPlan?.assets.filter((asset) => asset.action === "install") ?? [];
  if (!(options.dryRun ?? false) && installerAssets.length > 0) {
    throw new SessionApplyError(
      `Asset installer execution is not available in this release; plan only: ${installerAssets.map((asset) => asset.assetKey).join(", ")}`,
    );
  }
  assertCursorAuthorityUnchanged(plan);

  const targetHome = assertSafeTargetHome(plan.targetHome);
  assertClaudeAuthorityStillClear(plan, targetHome, options.ownedClaudeAuthorities);
  const payloadFiles = [...plan.files, ...(plan.assetFiles ?? [])];
  const manifestPath = resolvePlannedFilePath(plan, plan.manifestFile, targetHome);
  assertManifestPrecondition(manifestPath, targetHome, options.expectedManifestSha256);
  const previousManifest = readPreviousManifest(manifestPath);
  if (plan.manifest.claudeProjectImport || previousManifest?.claudeProjectImport) {
    if (options.force) throw new SessionApplyError("CLAUDE_PROJECT_IMPORT_FORCE: shared project ownership cannot be forced.");
    if (previousManifest && (previousManifest.tool !== plan.tool || previousManifest.profile !== plan.profile
      || previousManifest.targetKind !== "project-root" || previousManifest.targetHome !== targetHome
      || previousManifest.targetOwner?.writer?.id !== SESSION_RENDERER_OWNER_ID)) {
      throw new SessionApplyError("CLAUDE_PROJECT_IMPORT_OWNER: existing manifest belongs to another target or profile.");
    }
    if (previousManifest && !options.expectedManifestSha256) {
      throw new SessionApplyError("CLAUDE_PROJECT_IMPORT_CAS: changing a managed shared project requires its exact manifest preimage.");
    }
    if (previousManifest?.claudeProjectImport && !plan.manifest.claudeProjectImport) {
      throw new SessionApplyError("CLAUDE_PROJECT_IMPORT_RETIREMENT: removing a shared consumer requires an explicit reviewed migration; automatic removal is unsupported.");
    }
    if (plan.manifest.claudeProjectImport && !previousManifest?.claudeProjectImport
      && existsSync(join(targetHome, "CLAUDE.md"))) {
      throw new SessionApplyError("CLAUDE_PROJECT_IMPORT_CONFLICT: existing unmanaged CLAUDE.md cannot be adopted as an import companion.");
    }
  }
  const previousHashes = previousManifest
    ? new Map(previousManifest.files.map((file) => [file.relativePath, file.sha256]))
    : new Map<string, string>();
  const adoptions = validateFileAdoptions(plan, targetHome, previousHashes, options);
  const adoptedHashes = new Map(adoptions.map((entry) => [entry.relativePath, entry.preimageSha256]));
  const reconciliations = validateFileReconciliations(plan, targetHome, previousManifest, options);
  const reconciledHashes = new Map(reconciliations.map((entry) => [entry.relativePath, entry.preimageSha256]));
  const retirements = validateFileRetirements(plan, targetHome, previousManifest, options);
  const retiredHashes = new Map(retirements.map((entry) => [entry.relativePath, entry.preimageSha256]));
  const legacyRetirements = validateLegacyFileRetirements(plan, targetHome, previousManifest, options);
  const manifestFile = manifestWithFileProvenance(plan, previousManifest, adoptions, reconciliations, retirements, legacyRetirements);
  const files = [...payloadFiles, manifestFile];
  const currentRelativePaths = new Set(files.map((file) => file.relativePath));
  const drift = checkSessionRenderDrift(targetHome, manifestPath);

  const results = [
    ...files.map((file) => planFileResult(plan, file, targetHome, previousHashes, previousManifest, options, adoptedHashes, reconciledHashes)),
    ...planStaleFileResults(plan, targetHome, previousManifest, currentRelativePaths, options, retiredHashes),
    ...legacyRetirements.map((entry): SessionApplyFileResult => ({
      path: entry.path, relativePath: entry.relativePath, role: "rule", action: "delete", changed: true,
      previousSha256: entry.preimageSha256, newSha256: "", reason: "exact reviewed legacy instruction retired",
    })),
  ];
  assertNotSilentManagedWipeout(plan, results);
  const conflicts = results.filter((result) => result.action === "conflict");
  if (conflicts.length > 0) {
    return {
      dryRun: options.dryRun ?? false,
      applied: false,
      targetHome,
      manifestPath,
      snapshotPath: null,
      rollback: {
        schema: "hasna.configs.session-render-rollback/v1",
        status: "blocked",
        snapshotPath: null,
        reason: "conflicts-prevented-apply",
      },
      env: plan.env,
      warnings: plan.warnings,
      skippedSources: plan.manifest.skippedSources,
      files: results,
      conflicts,
      drift,
      adoptions,
      reconciliations,
      retirements,
      legacyRetirements,
    };
  }

  let snapshotPath: string | null = null;
  let rollback: SessionRollbackReceipt = {
    schema: "hasna.configs.session-render-rollback/v1",
    status: "not-required",
    snapshotPath: null,
    reason: "dry-run-does-not-write",
  };
  if (!options.dryRun) {
    const allowPortableFallback = coordination === null;
    const forcePortableFileOps = options.test_hooks?.force_portable_file_ops ?? false;
    assertManifestPrecondition(manifestPath, targetHome, options.expectedManifestSha256);
    ensureSessionTargetHome(targetHome);
    rollback = writeSessionSnapshot(
      plan,
      targetHome,
      manifestPath,
      results,
      previousManifest,
      coordination,
      allowPortableFallback,
      forcePortableFileOps,
      adoptions,
      reconciliations,
      retirements,
      legacyRetirements,
    );
    snapshotPath = rollback.snapshotPath;
    options.test_hooks?.before_apply_writes?.({ plan, results });
    assertManifestPrecondition(manifestPath, targetHome, options.expectedManifestSha256);
    // Check the entire transaction before its first payload write. Per-file
    // checks below still protect races that occur during the write sequence.
    for (const result of results) {
      assertExpectedSessionFileHash(result.path, targetHome, result.previousSha256);
      coordination?.assert_held();
    }
    const resultsByPath = new Map(results.map((result) => [result.path, result]));
    for (const file of payloadFiles) {
      applyPlannedFile(
        plan,
        file,
        targetHome,
        resultsByPath,
        coordination,
        allowPortableFallback,
        forcePortableFileOps,
      );
    }
    for (const result of results) {
      if (result.action !== "delete") continue;
      coordination?.assert_held();
      assertExpectedSessionFileHash(result.path, targetHome, result.previousSha256);
      removeProjectContextCoordinatedFile({
        path: result.path,
        workspace_root: targetHome,
        expected_hash: requiredPreviousHash(result),
        max_observed_bytes: null,
        allow_portable_removal: allowPortableFallback,
        force_portable_file_ops: forcePortableFileOps,
      });
      coordination?.assert_held();
    }
    applyPlannedFile(
      plan,
      manifestFile,
      targetHome,
      resultsByPath,
      coordination,
      allowPortableFallback,
      forcePortableFileOps,
    );
  }

  return {
    dryRun: options.dryRun ?? false,
    applied: !(options.dryRun ?? false),
    targetHome,
    manifestPath,
    snapshotPath,
    rollback,
    env: plan.env,
    warnings: plan.warnings,
    skippedSources: plan.manifest.skippedSources,
    files: results,
    conflicts,
    drift,
    adoptions,
    reconciliations,
    retirements,
    legacyRetirements,
  };
}

function assertManifestPrecondition(path: string, targetHome: string, expected: string | undefined): void {
  if (expected === undefined) return;
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new SessionApplyError("Expected session manifest SHA-256 must contain 64 lowercase hexadecimal characters.");
  }
  if (currentSessionFileHash(path, targetHome) !== expected) {
    throw new SessionApplyError("Session manifest SHA-256 precondition failed; reload the manifest and resolve a new plan.");
  }
}

function validateFileAdoptions(
  plan: SessionRenderPlan,
  targetHome: string,
  previousHashes: Map<string, string>,
  options: SessionApplyOptions,
): SessionFileAdoptionReceipt[] {
  const requests = options.adoptFiles ?? [];
  if (!Array.isArray(requests)) throw new SessionApplyError("Session file adoptions must be an array.");
  if (requests.length > 0 && options.force) {
    throw new SessionApplyError("Exact file adoption cannot be combined with force.");
  }
  const seen = new Set<string>();
  return requests.map((request) => {
    if (
      !request || typeof request.relativePath !== "string" || typeof request.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(request.sha256)
    ) {
      throw new SessionApplyError("Each file adoption requires a plan-relative path and a 64-character lowercase SHA-256.");
    }
    if (seen.has(request.relativePath)) {
      throw new SessionApplyError(`Duplicate file adoption target: ${request.relativePath}`);
    }
    seen.add(request.relativePath);
    // Include explicitly supported emitted custom-agent definitions, but never
    // generic executable assets, the manifest, stale outputs, or other paths.
    const candidates = exactPreimageCandidates(plan).filter((file) => file.relativePath === request.relativePath);
    if (candidates.length !== 1 || candidates[0]!.role === "manifest") {
      throw new SessionApplyError(`File adoption target is not a unique planned instruction output: ${request.relativePath}`);
    }
    const file = candidates[0]!;
    const path = resolvePlannedFilePath(plan, file, targetHome);
    if (previousHashes.has(file.relativePath) || sessionRenderOwnsPath(path)) {
      throw new SessionApplyError(`File adoption target is already managed: ${request.relativePath}`);
    }
    const observedSha256 = readExactFilePreimage(path, targetHome, request, "adoption");
    return {
      path,
      relativePath: file.relativePath,
      preimageSha256: observedSha256,
      renderedSha256: file.sha256,
      sourceIds: [...file.sourceIds],
    };
  });
}

function exactPreimageCandidates(plan: SessionRenderPlan): SessionRenderFile[] {
  const customAgentPaths = new Set((plan.assetPlan?.assets ?? [])
    .filter((asset) => asset.kind === "custom-agent" && asset.support === "supported"
      && asset.action === "write" && asset.destination.strategy === "emit-file")
    .map((asset) => posix.normalize(asset.destination.relativePath)));
  return [...plan.files, ...(plan.assetFiles ?? []).filter((file) => customAgentPaths.has(file.relativePath))];
}

function readExactFilePreimage(
  path: string,
  targetHome: string,
  request: SessionFileAdoption,
  operation: "adoption" | "reconciliation" | "retirement",
): string {
  if (currentSessionFileHash(path, targetHome) === null) {
    throw new SessionApplyError(`File ${operation} target does not exist: ${request.relativePath}`);
  }
  const bytes = readFileSync(path);
  if (!bytes.equals(Buffer.from(bytes.toString("utf8"), "utf8"))) {
    throw new SessionApplyError(`File ${operation} target must contain losslessly restorable UTF-8: ${request.relativePath}`);
  }
  const observedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (observedSha256 !== request.sha256) {
    throw new SessionApplyError(`File ${operation} SHA-256 precondition failed: ${request.relativePath}`);
  }
  return observedSha256;
}

function validateFileReconciliations(
  plan: SessionRenderPlan,
  targetHome: string,
  previousManifest: SessionRenderManifest | null,
  options: SessionApplyOptions,
): SessionFileReconciliationReceipt[] {
  const requests = options.reconcileFiles ?? [];
  if (!Array.isArray(requests)) throw new SessionApplyError("Session file reconciliations must be an array.");
  if (requests.length === 0) return [];
  if (options.force) throw new SessionApplyError("Exact file reconciliation cannot be combined with force.");
  if (options.expectedManifestSha256 === undefined) {
    throw new SessionApplyError("Exact file reconciliation requires an expected manifest SHA-256 precondition.");
  }
  if (
    !previousManifest || previousManifest.targetOwner?.writer?.id !== SESSION_RENDERER_OWNER_ID
    || previousManifest.tool !== plan.tool || previousManifest.targetHome !== targetHome
  ) {
    throw new SessionApplyError("File reconciliation requires this renderer's manifest for the same tool and target home.");
  }
  const seen = new Set<string>();
  return requests.map((request) => {
    if (
      !request || typeof request.relativePath !== "string" || typeof request.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(request.sha256)
    ) {
      throw new SessionApplyError("Each file reconciliation requires a plan-relative path and a 64-character lowercase SHA-256.");
    }
    if (seen.has(request.relativePath)) {
      throw new SessionApplyError(`Duplicate file reconciliation target: ${request.relativePath}`);
    }
    seen.add(request.relativePath);
    const candidates = exactPreimageCandidates(plan).filter((file) => file.relativePath === request.relativePath);
    if (candidates.length !== 1 || candidates[0]!.role === "manifest") {
      throw new SessionApplyError(`File reconciliation target is not a unique planned instruction output: ${request.relativePath}`);
    }
    const file = candidates[0]!;
    const path = resolvePlannedFilePath(plan, file, targetHome);
    const owned = previousManifest.files.filter((entry) => entry.relativePath === file.relativePath);
    if (
      owned.length !== 1 || owned[0]!.path !== path || owned[0]!.role !== file.role
      || !/^[a-f0-9]{64}$/.test(owned[0]!.sha256)
    ) {
      throw new SessionApplyError(`File reconciliation target is not owned by the observed manifest: ${request.relativePath}`);
    }
    const observedSha256 = readExactFilePreimage(path, targetHome, request, "reconciliation");
    if (observedSha256 === owned[0]!.sha256) {
      throw new SessionApplyError(`File reconciliation target has no managed drift: ${request.relativePath}`);
    }
    if (observedSha256 === file.sha256) {
      throw new SessionApplyError(`File reconciliation target already matches the planned output: ${request.relativePath}`);
    }
    return {
      path,
      relativePath: file.relativePath,
      preimageSha256: observedSha256,
      renderedSha256: file.sha256,
      previousManagedSha256: owned[0]!.sha256,
      sourceIds: [...file.sourceIds],
    };
  });
}

function validateFileRetirements(
  plan: SessionRenderPlan,
  targetHome: string,
  previousManifest: SessionRenderManifest | null,
  options: SessionApplyOptions,
): SessionFileRetirementReceipt[] {
  const requests = options.retireFiles ?? [];
  if (!Array.isArray(requests)) throw new SessionApplyError("Session file retirements must be an array.");
  if (requests.length === 0) return [];
  if (options.force) throw new SessionApplyError("Exact file retirement cannot be combined with force.");
  if (options.expectedManifestSha256 === undefined) {
    throw new SessionApplyError("Exact file retirement requires an expected manifest SHA-256 precondition.");
  }
  if (!previousManifest || previousManifest.targetOwner?.writer?.id !== SESSION_RENDERER_OWNER_ID
    || previousManifest.tool !== plan.tool || previousManifest.targetHome !== targetHome) {
    throw new SessionApplyError("File retirement requires this renderer's manifest for the same tool and target home.");
  }
  const seen = new Set<string>();
  return requests.map((request) => {
    if (!request || typeof request.relativePath !== "string" || typeof request.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(request.sha256)) {
      throw new SessionApplyError("Each file retirement requires a plan-relative path and a 64-character lowercase SHA-256.");
    }
    if (seen.has(request.relativePath)) throw new SessionApplyError(`Duplicate file retirement target: ${request.relativePath}`);
    seen.add(request.relativePath);
    if (plan.allFiles.some((file) => file.relativePath === request.relativePath)) {
      throw new SessionApplyError(`File retirement target is retained by the new plan: ${request.relativePath}`);
    }
    const owned = previousManifest.files.filter((entry) => entry.relativePath === request.relativePath);
    const path = resolveManifestRelativePath(request.relativePath, targetHome);
    if (owned.length !== 1 || owned[0]!.path !== path || !/^[a-f0-9]{64}$/.test(owned[0]!.sha256)
      || !Array.isArray(owned[0]!.sourceIds) || owned[0]!.sourceIds.some((id) => typeof id !== "string")
      || (!isPlanManagedFile(plan, request.relativePath, owned[0]!.role) && owned[0]!.role !== "asset")) {
      throw new SessionApplyError(`File retirement target is not an obsolete managed fragment, rule, or asset: ${request.relativePath}`);
    }
    return {
      path,
      relativePath: request.relativePath,
      preimageSha256: readExactFilePreimage(path, targetHome, request, "retirement"),
      previousManagedSha256: owned[0]!.sha256,
      sourceIds: [...owned[0]!.sourceIds],
    };
  });
}

function legacyRetirementHistory(
  previous: SessionLegacyRetirementProvenance[] | undefined,
  current: SessionLegacyFileRetirementReceipt[],
  targetHome: string,
): SessionLegacyRetirementProvenance[] {
  if (previous !== undefined && !Array.isArray(previous)) {
    throw new SessionApplyError("Previous legacy retirement provenance is invalid.");
  }
  const entries = new Map<string, SessionLegacyRetirementProvenance>();
  for (const entry of [...(previous ?? []), ...current]) {
    validateLegacyRetirementProvenance(entry);
    resolveManifestRelativePath(entry.relativePath, targetHome);
    const canonical = { replacementAuthority: entry.replacementAuthority, replacementProfileId: entry.replacementProfileId,
      relativePath: entry.relativePath, preimageSha256: entry.preimageSha256,
      coverageReviewSha256: entry.coverageReviewSha256,
      replacementSources: entry.replacementSources.map(({ id, configId, configVersion, renderedPayloadSha256 }) =>
        ({ id, configId, configVersion, renderedPayloadSha256 })) };
    entries.set(JSON.stringify(canonical), canonical);
  }
  return [...entries.values()];
}

function validateLegacyRetirementProvenance(entry: SessionLegacyRetirementProvenance): void {
  if (!entry || typeof entry.replacementAuthority !== "string" || !/^https?:\/\//.test(entry.replacementAuthority)
    || typeof entry.replacementProfileId !== "string" || entry.replacementProfileId.length === 0
    || typeof entry.relativePath !== "string" || !/^[a-f0-9]{64}$/.test(entry.preimageSha256)
    || !/^[a-f0-9]{64}$/.test(entry.coverageReviewSha256)
    || !Array.isArray(entry.replacementSources) || entry.replacementSources.length === 0
    || entry.replacementSources.length > 256) {
    throw new SessionApplyError("Legacy retirement requires an exact preimage, reviewed coverage digest and replacement source pins.");
  }
  const ids = new Set<string>();
  for (const source of entry.replacementSources) {
    if (!source || typeof source.id !== "string" || source.id.length === 0
      || typeof source.configId !== "string" || source.configId.length === 0
      || !Number.isSafeInteger(source.configVersion) || source.configVersion < 1
      || !/^[a-f0-9]{64}$/.test(source.renderedPayloadSha256) || ids.has(source.id)) {
      throw new SessionApplyError("Legacy retirement replacement source pins must be exact and unique.");
    }
    ids.add(source.id);
  }
}

function validateLegacyFileRetirements(
  plan: SessionRenderPlan,
  targetHome: string,
  previousManifest: SessionRenderManifest | null,
  options: SessionApplyOptions,
): SessionLegacyFileRetirementReceipt[] {
  const requests = options.retireLegacyFiles ?? [];
  if (!Array.isArray(requests) || requests.length > 1024) {
    throw new SessionApplyError("Legacy file retirements must be a bounded array (maximum 1024).");
  }
  if (requests.length === 0) return [];
  if (options.force) throw new SessionApplyError("Legacy file retirement cannot be combined with force.");
  if (options.expectedManifestSha256 === undefined) {
    throw new SessionApplyError("Legacy file retirement requires an expected manifest SHA-256 precondition.");
  }
  if (!previousManifest || previousManifest.targetOwner?.writer?.id !== SESSION_RENDERER_OWNER_ID
    || previousManifest.tool !== plan.tool || previousManifest.targetHome !== targetHome) {
    throw new SessionApplyError("Legacy file retirement requires this renderer's manifest for the same tool and target home.");
  }
  const selector = plan.manifest.refreshSelector;
  if (!selector || selector.schema !== "hasna.instructions.hosted-profile-selector/v1"
    || typeof selector.authority !== "string" || !/^https?:\/\//.test(selector.authority)
    || typeof selector.profileId !== "string" || selector.profileId.length === 0) {
    throw new SessionApplyError("Legacy file retirement requires a compiled hosted replacement profile.");
  }
  const seen = new Set<string>();
  return requests.map((request) => {
    const entry = { ...request, preimageSha256: request?.sha256,
      replacementAuthority: selector.authority, replacementProfileId: selector.profileId };
    validateLegacyRetirementProvenance(entry);
    const rel = request.relativePath;
    // Refuse aliases as well as escapes so two textual paths cannot denote one
    // file. This is not arbitrary cleanup or executable asset retirement.
    if (posix.normalize(rel) !== rel || rel.includes("\\") || isAbsolute(rel)
      || rel.split("/").some((part) => part === "" || part === "." || part === "..")
      || !rel.endsWith(".md")
      || !(rel.startsWith(`${plan.adapter.managedDir}/`)
        || (plan.tool === "claude" && (rel.startsWith("rules/") || (plan.targetKind === "session-home" && rel === "AGENTS.md"))))) {
      throw new SessionApplyError(`Legacy retirement target is not a supported native instruction carrier: ${rel}`);
    }
    if (seen.has(rel)) throw new SessionApplyError(`Duplicate legacy retirement target: ${rel}`);
    seen.add(rel);
    if (plan.allFiles.some((file) => file.relativePath === rel)) {
      throw new SessionApplyError(`Legacy retirement target is retained by the new plan: ${rel}`);
    }
    if (previousManifest.files.some((file) => file.relativePath === rel)) {
      throw new SessionApplyError(`Legacy retirement target is already managed; use exact managed retirement: ${rel}`);
    }
    for (const pin of request.replacementSources) {
      const sources = plan.manifest.sources.filter((source) => source.id === pin.id);
      const source = sources[0];
      const binding = source?.provenance?.profileBinding as Record<string, unknown> | undefined;
      if (sources.length !== 1 || !source || source.renderedPayloadSha256 !== pin.renderedPayloadSha256
        || binding?.configId !== pin.configId || binding?.configVersion !== pin.configVersion
        || !plan.files.some((file) => file.sourceIds.includes(pin.id))) {
        throw new SessionApplyError(`Legacy retirement replacement is not the exact selected rendered source: ${pin.id}`);
      }
    }
    const path = resolveManifestRelativePath(rel, targetHome);
    const preimageSha256 = readExactFilePreimage(path, targetHome, request, "retirement");
    const stat = lstatSync(path);
    if ((stat.mode & 0o7000) !== 0 || stat.nlink !== 1
      || (process.getuid && stat.uid !== process.getuid())) {
      throw new SessionApplyError(`Legacy retirement requires an owner-held ordinary file with one link: ${rel}`);
    }
    return { path, relativePath: rel, preimageSha256, coverageReviewSha256: request.coverageReviewSha256,
      replacementAuthority: selector.authority, replacementProfileId: selector.profileId,
      replacementSources: request.replacementSources.map((pin) => ({ ...pin })) };
  });
}

function manifestWithFileProvenance(
  plan: SessionRenderPlan,
  previousManifest: SessionRenderManifest | null,
  adoptions: SessionFileAdoptionReceipt[],
  reconciliations: SessionFileReconciliationReceipt[],
  retirements: SessionFileRetirementReceipt[],
  legacyRetirements: SessionLegacyFileRetirementReceipt[],
): SessionRenderFile {
  if (
    adoptions.length === 0 && previousManifest?.adoptions === undefined
    && reconciliations.length === 0 && previousManifest?.reconciliations === undefined
    && retirements.length === 0 && previousManifest?.retirements === undefined
    && legacyRetirements.length === 0 && previousManifest?.legacyRetirements === undefined
  ) return plan.manifestFile;
  if (previousManifest?.adoptions !== undefined && !Array.isArray(previousManifest.adoptions)) {
    throw new SessionApplyError("Previous session manifest adoption provenance is invalid.");
  }
  const entries = new Map<string, NonNullable<SessionRenderManifest["adoptions"]>[number]>();
  for (const entry of [
    ...(previousManifest?.adoptions ?? []),
    ...adoptions.map(({ path: _path, ...receipt }) => receipt),
  ]) {
    if (
      !entry || typeof entry.relativePath !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.preimageSha256)
      || !/^[a-f0-9]{64}$/.test(entry.renderedSha256)
      || !Array.isArray(entry.sourceIds) || entry.sourceIds.some((id) => typeof id !== "string")
    ) {
      throw new SessionApplyError("Previous session manifest adoption provenance is invalid.");
    }
    resolveManifestRelativePath(entry.relativePath, plan.targetHome);
    const previous = entries.get(entry.relativePath);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new SessionApplyError(`Conflicting session file adoption provenance: ${entry.relativePath}`);
    }
    entries.set(entry.relativePath, entry);
  }
  if (previousManifest?.reconciliations !== undefined && !Array.isArray(previousManifest.reconciliations)) {
    throw new SessionApplyError("Previous session manifest reconciliation provenance is invalid.");
  }
  const reconciledEntries = new Map<string, NonNullable<SessionRenderManifest["reconciliations"]>[number]>();
  for (const entry of [
    ...(previousManifest?.reconciliations ?? []),
    ...reconciliations.map(({ path: _path, ...receipt }) => receipt),
  ]) {
    if (
      !entry || typeof entry.relativePath !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.preimageSha256)
      || !/^[a-f0-9]{64}$/.test(entry.renderedSha256)
      || !/^[a-f0-9]{64}$/.test(entry.previousManagedSha256)
      || !Array.isArray(entry.sourceIds) || entry.sourceIds.some((id) => typeof id !== "string")
    ) {
      throw new SessionApplyError("Previous session manifest reconciliation provenance is invalid.");
    }
    resolveManifestRelativePath(entry.relativePath, plan.targetHome);
    // A path may be reconciled more than once. Preserve each distinct reviewed
    // transition, including its old owned baseline and drifted before-image.
    const canonical = {
      relativePath: entry.relativePath,
      preimageSha256: entry.preimageSha256,
      renderedSha256: entry.renderedSha256,
      previousManagedSha256: entry.previousManagedSha256,
      sourceIds: [...entry.sourceIds],
    };
    reconciledEntries.set(JSON.stringify(canonical), canonical);
  }
  if (previousManifest?.retirements !== undefined && !Array.isArray(previousManifest.retirements)) {
    throw new SessionApplyError("Previous session manifest retirement provenance is invalid.");
  }
  const retiredEntries = new Map<string, NonNullable<SessionRenderManifest["retirements"]>[number]>();
  for (const entry of [...(previousManifest?.retirements ?? []), ...retirements.map(({ path: _path, ...receipt }) => receipt)]) {
    if (!entry || typeof entry.relativePath !== "string" || !/^[a-f0-9]{64}$/.test(entry.preimageSha256)
      || !/^[a-f0-9]{64}$/.test(entry.previousManagedSha256) || !Array.isArray(entry.sourceIds)
      || entry.sourceIds.some((id) => typeof id !== "string")) {
      throw new SessionApplyError("Previous session manifest retirement provenance is invalid.");
    }
    resolveManifestRelativePath(entry.relativePath, plan.targetHome);
    const canonical = { relativePath: entry.relativePath, preimageSha256: entry.preimageSha256,
      previousManagedSha256: entry.previousManagedSha256, sourceIds: [...entry.sourceIds] };
    retiredEntries.set(JSON.stringify(canonical), canonical);
  }
  const legacyEntries = legacyRetirementHistory(previousManifest?.legacyRetirements, legacyRetirements, plan.targetHome);
  const manifest = {
    ...plan.manifest,
    ...(legacyEntries.length > 0 ? { legacyRetirements: legacyEntries } : {}),
    ...(adoptions.length > 0 || previousManifest?.adoptions !== undefined ? { adoptions: [...entries.values()] } : {}),
    ...(reconciliations.length > 0 || previousManifest?.reconciliations !== undefined
      ? { reconciliations: [...reconciledEntries.values()] } : {}),
    ...(retirements.length > 0 || previousManifest?.retirements !== undefined
      ? { retirements: [...retiredEntries.values()] } : {}),
  };
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  return { ...plan.manifestFile, content, sha256: sha256(content) };
}

function assertCursorAuthorityUnchanged(plan: SessionRenderPlan): void {
  if (plan.tool !== "cursor" || plan.targetKind === "blocked") return;

  const planned = plan.authorityObservations[0];
  if (!planned) {
    throw new SessionApplyError("Cursor session render plan is missing its fixed global-authority observation.");
  }

  const current = observeCursorGlobalAuthorityAtPath(planned.path);
  const conflicts = detectCursorAuthorityConflicts(current);
  if (conflicts.length > 0) {
    throw new SessionApplyError(
      `Cursor fixed global authority changed after planning: ${conflicts.map((conflict) => conflict.reason).join("; ")}`,
    );
  }
  if (JSON.stringify(current) !== JSON.stringify(planned)) {
    throw new SessionApplyError("Cursor fixed global authority changed after planning; refusing to apply a stale render plan.");
  }
}

function assertClaudeAuthorityStillClear(
  plan: SessionRenderPlan,
  targetHome: string,
  ownedClaudeAuthorities: ClaudeOwnedAuthority[] | undefined,
): void {
  if (plan.tool !== "claude" || plan.targetKind === "blocked") return;
  const conflicts = detectClaudeAuthorityConflicts(targetHome, ownedClaudeAuthorities);
  if (conflicts.length === 0) return;
  const summary = conflicts
    .map((conflict) => `${conflict.relativePath}: ${conflict.reason}`)
    .join("; ");
  throw new SessionApplyError(`Claude authority changed after planning; refusing to apply: ${summary}`);
}

function ensureSessionTargetHome(targetHome: string): void {
  if (!existsSync(targetHome)) mkdirSync(targetHome, { recursive: true, mode: 0o700 });
  assertSafeTargetHome(targetHome);
}

export function checkSessionRenderDrift(targetHome: string, manifestPath?: string): SessionDriftCheck {
  const safeTargetHome = assertSafeTargetHome(targetHome);
  const resolvedManifestPath = manifestPath
    ? resolveManifestRelativePath(relative(safeTargetHome, resolve(manifestPath)), safeTargetHome)
    : resolve(safeTargetHome, ".hasna", "session-render-manifest.json");
  const checkedAt = new Date().toISOString();
  const previousManifest = readPreviousManifest(resolvedManifestPath);
  if (!previousManifest) {
    return {
      checked: false,
      clean: true,
      manifestPath: resolvedManifestPath,
      checkedAt,
      missing: [],
      drifted: [],
    };
  }

  const missing: SessionDriftEntry[] = [];
  const drifted: SessionDriftEntry[] = [];
  for (const file of previousManifest.files) {
    const target = resolveManifestRelativePath(file.relativePath, safeTargetHome);
    if (!existsSync(target)) {
      missing.push({
        path: target,
        relativePath: file.relativePath,
        expectedSha256: file.sha256,
        actualSha256: null,
        reason: "missing",
      });
      continue;
    }
    const actualSha256 = sha256(readFileSync(target, "utf-8"));
    if (actualSha256 !== file.sha256) {
      drifted.push({
        path: target,
        relativePath: file.relativePath,
        expectedSha256: file.sha256,
        actualSha256,
        reason: "hash_mismatch",
      });
    }
  }

  return {
    checked: true,
    clean: missing.length === 0 && drifted.length === 0,
    manifestPath: resolvedManifestPath,
    checkedAt,
    missing,
    drifted,
  };
}

export function restoreSessionRenderSnapshot(
  snapshotPath: string,
  options: SessionRestoreOptions = {},
): SessionRestoreResult {
  const snapshot = readSessionRenderSnapshot(snapshotPath);
  const targetHome = assertSafeTargetHome(snapshot.targetHome);
  const resolvedSnapshotPath = resolve(snapshotPath);
  const snapshotDir = getSessionRenderSnapshotDir(targetHome);
  const snapshotDirRelative = relative(snapshotDir, resolvedSnapshotPath);
  const insideSnapshotDir =
    snapshotDirRelative !== ".."
    && !snapshotDirRelative.startsWith("../")
    && !isAbsolute(snapshotDirRelative);
  if (!insideSnapshotDir) {
    // A snapshot may also be passed from an explicit in-home location (legacy
    // fixtures, manual restore); keep the old containment for that case. The
    // adopted session-render state dir is a single global location that can
    // legitimately sit outside a nested project-root target home, so it is
    // exempt from the target-home containment above.
    const snapshotRelativePath = relative(targetHome, resolvedSnapshotPath);
    if (
      snapshotRelativePath === ""
      || snapshotRelativePath === ".."
      || snapshotRelativePath.startsWith("../")
      || isAbsolute(snapshotRelativePath)
    ) {
      throw new SessionApplyError("Session snapshot must be stored inside its session-render snapshot location.");
    }
  }
  assertNoSymlinkSegments(sessionRenderSnapshotWorkspaceRoot(targetHome), resolvedSnapshotPath);
  const guard = observeProjectContextSessionGuard({
    tool: snapshot.tool,
    target_home: targetHome,
    project_root: snapshot.targetKind === "project-root" ? targetHome : undefined,
  });
  return withProjectContextSessionGuard(
    guard ?? undefined,
    (coordination) => restoreSessionRenderSnapshotUnlocked(
      snapshot,
      resolvedSnapshotPath,
      targetHome,
      options,
      coordination,
    ),
    { dry_run: options.dryRun },
  );
}

function restoreSessionRenderSnapshotUnlocked(
  snapshot: SessionRenderSnapshot,
  snapshotPath: string,
  targetHome: string,
  options: SessionRestoreOptions,
  coordination: ProjectContextWriteCoordination | null,
): SessionRestoreResult {
  const previousFiles = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const conflicts: SessionRestoreConflict[] = [];
  for (const file of snapshot.afterFiles) {
    const path = resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    const actualSha256 = currentSessionFileHash(path, targetHome);
    if (actualSha256 !== file.sha256) {
      conflicts.push({
        path,
        relativePath: file.relativePath,
        expectedSha256: file.sha256,
        actualSha256,
      });
    }
  }

  const files = snapshot.afterFiles.map((file): SessionRestoreFileResult => {
    const previous = previousFiles.get(file.relativePath);
    const path = resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    const current = currentSessionFileHash(path, targetHome);
    if (file.action === "unchanged") {
      return {
        path,
        relativePath: file.relativePath,
        action: "unchanged",
        previousSha256: current,
        restoredSha256: current,
      };
    }
    if (file.action === "create") {
      return {
        path,
        relativePath: file.relativePath,
        action: current === null ? "unchanged" : "delete",
        previousSha256: current,
        restoredSha256: null,
      };
    }
    if (previous) {
      return {
        path,
        relativePath: file.relativePath,
        action: current === previous.sha256 ? "unchanged" : current === null ? "create" : "update",
        previousSha256: current,
        restoredSha256: previous.sha256,
      };
    }
    throw new SessionApplyError(`Session snapshot is missing a before-image for ${file.action} file: ${file.relativePath}`);
  });

  if (conflicts.length > 0 || options.dryRun) {
    return {
      dryRun: options.dryRun ?? false,
      restored: false,
      snapshotPath,
      targetHome,
      conflicts,
      files,
    };
  }

  const forcePortableFileOps = options.test_hooks?.force_portable_file_ops ?? false;
  const ordered = [...files].sort((left, right) =>
    Number(left.relativePath === ".hasna/session-render-manifest.json")
    - Number(right.relativePath === ".hasna/session-render-manifest.json")
  );
  for (const file of ordered) {
    if (file.action === "unchanged") continue;
    coordination?.assert_held();
    assertExpectedSessionFileHash(file.path, targetHome, file.previousSha256);
    const previous = previousFiles.get(file.relativePath);
    if (file.action === "delete") {
      removeProjectContextCoordinatedFile({
        path: file.path,
        workspace_root: targetHome,
        expected_hash: requiredRestoreHash(file),
        max_observed_bytes: null,
        allow_portable_removal: coordination === null,
        force_portable_file_ops: forcePortableFileOps,
      });
    } else if (previous) {
      writeProjectContextCoordinatedFile({
        path: file.path,
        content: previous.content,
        workspace_root: targetHome,
        default_mode: previous.mode ?? 0o644,
        expected_hash: file.previousSha256,
        max_observed_bytes: null,
        allow_portable_replacement: coordination === null,
        force_portable_file_ops: forcePortableFileOps,
      });
    }
    coordination?.assert_held();
  }

  return {
    dryRun: false,
    restored: true,
    snapshotPath,
    targetHome,
    conflicts: [],
    files,
  };
}

function requiredRestoreHash(file: SessionRestoreFileResult): string {
  if (file.previousSha256 === null) {
    throw new SessionApplyError(`Session restore delete has no current hash: ${file.relativePath}`);
  }
  return file.previousSha256;
}

function readSessionRenderSnapshot(snapshotPath: string): SessionRenderSnapshot {
  const resolved = resolve(snapshotPath);
  if (!existsSync(resolved)) throw new SessionApplyError(`Session snapshot not found: ${snapshotPath}`);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SessionApplyError(`Session snapshot is not a regular file: ${snapshotPath}`);
  }
  if (statSync(resolved).size > 32 * 1024 * 1024) {
    throw new SessionApplyError(`Session snapshot exceeds the 32 MiB restore limit: ${snapshotPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    throw new SessionApplyError(`Session snapshot is not valid JSON: ${snapshotPath}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SessionApplyError(`Session snapshot must contain an object: ${snapshotPath}`);
  }
  const snapshot = parsed as Partial<StoredSessionRenderSnapshot>;
  if (
    snapshot.schema !== "hasna.configs.session-render-snapshot/v1"
    && snapshot.schema !== "hasna.configs.session-render-snapshot/v2"
  ) {
    throw new SessionApplyError(`Unsupported session snapshot schema: ${String(snapshot.schema)}`);
  }
  if (
    typeof snapshot.targetHome !== "string"
    || typeof snapshot.manifestPath !== "string"
    || !Array.isArray(snapshot.files)
    || (
      snapshot.previousManifest !== null
      && (
        !snapshot.previousManifest
        || typeof snapshot.previousManifest !== "object"
        || snapshot.previousManifest.schema !== SESSION_RENDER_SCHEMA
        || !Array.isArray(snapshot.previousManifest.files)
      )
    )
    || typeof snapshot.tool !== "string"
    || typeof snapshot.profile !== "string"
  ) {
    throw new SessionApplyError(`Session snapshot is incomplete: ${snapshotPath}`);
  }
  const isPreRollbackLegacyV1 = (
    snapshot.schema === "hasna.configs.session-render-snapshot/v1"
    && snapshot.targetKind === undefined
    && snapshot.afterFiles === undefined
  );
  if (
    !isPreRollbackLegacyV1
    && (
      !Array.isArray(snapshot.afterFiles)
      || (snapshot.targetKind !== "session-home" && snapshot.targetKind !== "project-root")
    )
  ) {
    throw new SessionApplyError(`Session snapshot is incomplete: ${snapshotPath}`);
  }
  const targetHome = assertSafeTargetHome(snapshot.targetHome);
  const previousManifest = snapshot.previousManifest as SessionRenderManifest | null;
  const previousFiles = new Map<string, SessionRenderSnapshot["files"][number]>();
  for (const file of snapshot.files) {
    if (
      !file
      || typeof file.relativePath !== "string"
      || typeof file.path !== "string"
      || typeof file.sha256 !== "string"
      || typeof file.content !== "string"
      || sha256(file.content) !== file.sha256
      || (file.mode !== undefined && (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777))
    ) {
      throw new SessionApplyError(`Session snapshot previous file metadata is invalid: ${snapshotPath}`);
    }
    resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    if (previousFiles.has(file.relativePath)) {
      throw new SessionApplyError(`Session snapshot has duplicate previous file metadata: ${file.relativePath}`);
    }
    previousFiles.set(file.relativePath, file);
  }
  const previousManifestFiles = indexPreviousManifestFiles(previousManifest, targetHome, snapshotPath);
  const legacyUpgrade = isPreRollbackLegacyV1
    ? reconstructPreRollbackLegacyV1Snapshot(
      {
        ...snapshot,
        targetHome: snapshot.targetHome,
        manifestPath: snapshot.manifestPath,
        tool: snapshot.tool,
        profile: snapshot.profile,
        previousManifest,
      },
      previousFiles,
      previousManifestFiles,
      targetHome,
      snapshotPath,
    )
    : null;
  const targetKind = legacyUpgrade?.targetKind ?? snapshot.targetKind;
  const storedAfterFiles = legacyUpgrade?.afterFiles ?? snapshot.afterFiles;
  if (
    (targetKind !== "session-home" && targetKind !== "project-root")
    || !Array.isArray(storedAfterFiles)
  ) {
    throw new SessionApplyError(`Session snapshot is incomplete: ${snapshotPath}`);
  }
  const afterRelativePaths = new Set<string>();
  const afterFiles: SessionRenderSnapshot["afterFiles"] = [];
  for (const file of storedAfterFiles) {
    if (
      !file
      || typeof file.relativePath !== "string"
      || typeof file.path !== "string"
      || (
        (
          snapshot.schema === "hasna.configs.session-render-snapshot/v2"
          && file.action === undefined
        )
        || (
          file.action !== undefined
          && file.action !== "create"
          && file.action !== "update"
          && file.action !== "delete"
          && file.action !== "unchanged"
        )
      )
      || (typeof file.sha256 !== "string" && file.sha256 !== null)
    ) {
      throw new SessionApplyError(`Session snapshot applied file metadata is invalid: ${snapshotPath}`);
    }
    resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    if (afterRelativePaths.has(file.relativePath)) {
      throw new SessionApplyError(`Session snapshot has duplicate applied file metadata: ${file.relativePath}`);
    }
    afterRelativePaths.add(file.relativePath);
    afterFiles.push({
      ...file,
      action: file.action ?? inferLegacySnapshotAction(
        file,
        previousFiles,
        previousManifestFiles,
        snapshot.previousManifest,
      ),
    });
  }
  return {
    ...snapshot,
    targetKind,
    afterFiles,
  } as SessionRenderSnapshot;
}

function reconstructPreRollbackLegacyV1Snapshot(
  snapshot: Partial<StoredSessionRenderSnapshot> & {
    targetHome: string;
    manifestPath: string;
    tool: string;
    profile: string;
    previousManifest: SessionRenderManifest | null;
  },
  previousFiles: Map<string, SessionRenderSnapshot["files"][number]>,
  previousManifestFiles: Map<string, SessionRenderManifest["files"][number]>,
  targetHome: string,
  snapshotPath: string,
): Pick<SessionRenderSnapshot, "targetKind" | "afterFiles"> {
  assertNoNewerSessionSnapshot(snapshotPath, snapshot.createdAt, targetHome);
  const manifestPath = resolve(snapshot.manifestPath);
  const manifestRelativePath = relative(targetHome, manifestPath).replaceAll("\\", "/");
  resolveSnapshotFilePath(manifestRelativePath, snapshot.manifestPath, targetHome);
  const manifestSha256 = currentSessionFileHash(manifestPath, targetHome);
  if (manifestSha256 === null) {
    throw new SessionApplyError(`Cannot restore pre-rollback legacy v1 snapshot without its applied manifest: ${snapshotPath}`);
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new SessionApplyError(`Pre-rollback legacy v1 applied manifest is not valid JSON: ${snapshotPath}`);
  }
  if (!parsedManifest || typeof parsedManifest !== "object" || Array.isArray(parsedManifest)) {
    throw new SessionApplyError(`Pre-rollback legacy v1 applied manifest is invalid: ${snapshotPath}`);
  }
  const appliedManifest = parsedManifest as Partial<SessionRenderManifest>;
  if (
    appliedManifest.schema !== SESSION_RENDER_SCHEMA
    || appliedManifest.tool !== snapshot.tool
    || appliedManifest.profile !== snapshot.profile
    || typeof appliedManifest.targetHome !== "string"
    || resolve(appliedManifest.targetHome) !== targetHome
    || (appliedManifest.targetKind !== "session-home" && appliedManifest.targetKind !== "project-root")
    || !Array.isArray(appliedManifest.files)
  ) {
    throw new SessionApplyError(`Pre-rollback legacy v1 applied manifest does not match its snapshot: ${snapshotPath}`);
  }

  const afterFiles: SessionRenderSnapshot["afterFiles"] = [];
  const appliedRelativePaths = new Set<string>();
  for (const file of appliedManifest.files) {
    if (
      !file
      || typeof file.path !== "string"
      || typeof file.relativePath !== "string"
      || !isSessionRenderFileRole(file.role)
      || file.role === "manifest"
      || typeof file.sha256 !== "string"
    ) {
      throw new SessionApplyError(`Pre-rollback legacy v1 applied manifest file metadata is invalid: ${snapshotPath}`);
    }
    resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    if (appliedRelativePaths.has(file.relativePath)) {
      throw new SessionApplyError(`Pre-rollback legacy v1 applied manifest has duplicate file metadata: ${file.relativePath}`);
    }
    appliedRelativePaths.add(file.relativePath);

    const previousFile = previousFiles.get(file.relativePath);
    const previousManifestFile = previousManifestFiles.get(file.relativePath);
    let action: SessionSnapshotAction;
    if (previousFile) {
      assertMatchingLegacyFileMetadata(file, previousFile, "before-image");
      if (previousFile.sha256 === file.sha256) {
        throw new SessionApplyError(`Pre-rollback legacy v1 update has identical before and after hashes: ${file.relativePath}`);
      }
      action = "update";
    } else if (previousManifestFile) {
      assertMatchingLegacyFileMetadata(file, previousManifestFile, "previous manifest");
      if (previousManifestFile.sha256 === file.sha256) {
        throw new SessionApplyError(
          `Cannot infer pre-rollback legacy v1 unchanged versus recreated file: ${file.relativePath}`,
        );
      }
      action = "create";
    } else {
      action = "create";
    }
    afterFiles.push({
      path: file.path,
      relativePath: file.relativePath,
      role: file.role,
      action,
      sha256: file.sha256,
    });
  }

  for (const [relativePath, previousFile] of previousFiles) {
    if (relativePath === manifestRelativePath || appliedRelativePaths.has(relativePath)) continue;
    const previousManifestFile = previousManifestFiles.get(relativePath);
    if (!previousManifestFile) {
      throw new SessionApplyError(
        `Cannot infer pre-rollback legacy v1 delete without previous manifest metadata: ${relativePath}`,
      );
    }
    assertMatchingLegacyFileMetadata(previousFile, previousManifestFile, "previous manifest");
    afterFiles.push({
      path: previousFile.path,
      relativePath,
      role: previousFile.role,
      action: "delete",
      sha256: null,
    });
  }

  const previousManifestFile = previousFiles.get(manifestRelativePath);
  if (previousManifestFile) {
    if (previousManifestFile.path !== manifestPath || previousManifestFile.role !== "manifest") {
      throw new SessionApplyError(`Pre-rollback legacy v1 manifest before-image metadata is invalid: ${snapshotPath}`);
    }
    if (previousManifestFile.sha256 === manifestSha256) {
      throw new SessionApplyError(`Pre-rollback legacy v1 manifest has identical before and after hashes: ${snapshotPath}`);
    }
  } else if (snapshot.previousManifest) {
    throw new SessionApplyError(`Pre-rollback legacy v1 snapshot is missing its manifest before-image: ${snapshotPath}`);
  }
  afterFiles.push({
    path: manifestPath,
    relativePath: manifestRelativePath,
    role: "manifest",
    action: previousManifestFile ? "update" : "create",
    sha256: manifestSha256,
  });

  return {
    targetKind: appliedManifest.targetKind,
    afterFiles,
  };
}

function assertNoNewerSessionSnapshot(
  snapshotPath: string,
  createdAt: string | undefined,
  targetHome: string,
): void {
  const createdAtMs = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(createdAtMs)) {
    throw new SessionApplyError(`Pre-rollback legacy v1 snapshot has an invalid creation time: ${snapshotPath}`);
  }
  for (const entry of readdirSync(dirname(snapshotPath))) {
    const candidatePath = resolve(dirname(snapshotPath), entry);
    if (candidatePath === resolve(snapshotPath) || !entry.endsWith(".json")) continue;
    const candidateStat = lstatSync(candidatePath);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile() || candidateStat.size > 32 * 1024 * 1024) continue;
    try {
      const candidate = JSON.parse(readFileSync(candidatePath, "utf8")) as {
        schema?: unknown;
        createdAt?: unknown;
        targetHome?: unknown;
      };
      const candidateCreatedAtMs = typeof candidate.createdAt === "string"
        ? Date.parse(candidate.createdAt)
        : Number.NaN;
      if (
        (candidate.schema === "hasna.configs.session-render-snapshot/v1"
          || candidate.schema === "hasna.configs.session-render-snapshot/v2")
        && typeof candidate.targetHome === "string"
        && resolve(candidate.targetHome) === targetHome
        && Number.isFinite(candidateCreatedAtMs)
        && candidateCreatedAtMs >= createdAtMs
      ) {
        throw new SessionApplyError(
          `Cannot restore pre-rollback legacy v1 snapshot after a newer session snapshot exists: ${candidatePath}`,
        );
      }
    } catch (error) {
      if (error instanceof SessionApplyError) throw error;
    }
  }
}

function assertMatchingLegacyFileMetadata(
  appliedFile: Pick<SessionRenderManifest["files"][number], "path" | "role" | "relativePath">,
  previousFile: Pick<SessionRenderSnapshot["files"][number], "path" | "role" | "relativePath">,
  source: string,
): void {
  if (
    appliedFile.path !== previousFile.path
    || appliedFile.role !== previousFile.role
    || appliedFile.relativePath !== previousFile.relativePath
  ) {
    throw new SessionApplyError(
      `Pre-rollback legacy v1 ${source} metadata conflicts for ${appliedFile.relativePath}`,
    );
  }
}

function isSessionRenderFileRole(role: unknown): role is SessionRenderFileRole {
  return role === "index"
    || role === "fragment"
    || role === "rule"
    || role === "config"
    || role === "asset"
    || role === "manifest";
}

function indexPreviousManifestFiles(
  previousManifest: SessionRenderManifest | null | undefined,
  targetHome: string,
  snapshotPath: string,
): Map<string, SessionRenderManifest["files"][number]> {
  const files = new Map<string, SessionRenderManifest["files"][number]>();
  if (!previousManifest) return files;
  for (const file of previousManifest.files) {
    if (
      !file
      || typeof file.relativePath !== "string"
      || typeof file.path !== "string"
      || typeof file.sha256 !== "string"
    ) {
      throw new SessionApplyError(`Session snapshot previous manifest metadata is invalid: ${snapshotPath}`);
    }
    resolveSnapshotFilePath(file.relativePath, file.path, targetHome);
    if (files.has(file.relativePath)) {
      throw new SessionApplyError(`Session snapshot previous manifest has duplicate file metadata: ${file.relativePath}`);
    }
    files.set(file.relativePath, file);
  }
  return files;
}

function inferLegacySnapshotAction(
  file: NonNullable<StoredSessionRenderSnapshot["afterFiles"]>[number],
  previousFiles: Map<string, SessionRenderSnapshot["files"][number]>,
  previousManifestFiles: Map<string, SessionRenderManifest["files"][number]>,
  previousManifest: SessionRenderManifest | null | undefined,
): SessionSnapshotAction {
  const previousFile = previousFiles.get(file.relativePath);
  const previousManifestFile = previousManifestFiles.get(file.relativePath);
  if (file.sha256 === null) {
    if (
      !previousFile
      || !previousManifestFile
      || previousManifestFile.sha256 !== previousFile.sha256
      || previousManifestFile.path !== previousFile.path
      || previousManifestFile.role !== previousFile.role
    ) {
      throw new SessionApplyError(`Cannot infer legacy v1 delete from incomplete previous metadata: ${file.relativePath}`);
    }
    return "delete";
  }
  if (previousFile) {
    if (previousFile.path !== file.path || previousFile.role !== file.role) {
      throw new SessionApplyError(`Cannot infer legacy v1 update from conflicting before-image metadata: ${file.relativePath}`);
    }
    return "update";
  }
  if (previousManifestFile) {
    if (previousManifestFile.path !== file.path || previousManifestFile.role !== file.role) {
      throw new SessionApplyError(`Cannot infer legacy v1 action from conflicting previous manifest metadata: ${file.relativePath}`);
    }
    if (previousManifestFile.sha256 === file.sha256) {
      throw new SessionApplyError(`Cannot infer legacy v1 unchanged versus recreated file: ${file.relativePath}`);
    }
    return "create";
  }
  if (file.role === "manifest" && previousManifest) {
    const previousManifestSha256 = sha256(`${JSON.stringify(previousManifest, null, 2)}\n`);
    if (previousManifestSha256 !== file.sha256) {
      throw new SessionApplyError(`Cannot infer legacy v1 manifest action without a before-image: ${file.relativePath}`);
    }
    return "unchanged";
  }
  return "create";
}

function resolveSnapshotFilePath(relativePath: string, recordedPath: string, targetHome: string): string {
  const path = resolveManifestRelativePath(relativePath, targetHome);
  if (resolve(recordedPath) !== path) {
    throw new SessionApplyError(`Session snapshot file path mismatch for ${relativePath}`);
  }
  return path;
}

function planFileResult(
  plan: SessionRenderPlan,
  file: SessionRenderFile,
  targetHome: string,
  previousHashes: Map<string, string>,
  previousManifest: SessionRenderManifest | null,
  options: SessionApplyOptions,
  adoptedHashes: Map<string, string>,
  reconciledHashes: Map<string, string>,
): SessionApplyFileResult {
  const target = resolvePlannedFilePath(plan, file, targetHome);
  const previousContent = existsSync(target) ? readFileSync(target, "utf-8") : null;
  const previousSha256 = previousContent === null ? null : sha256(previousContent);
  const previouslyManaged = isPreviouslyManaged(file, previousSha256, previousHashes, previousManifest);
  const changed = previousContent !== file.content;
  const exactSha256 = adoptedHashes.get(file.relativePath) ?? reconciledHashes.get(file.relativePath);
  if (exactSha256 !== undefined) {
    const operation = adoptedHashes.has(file.relativePath) ? "adoption" : "reconciliation";
    if (previousSha256 !== exactSha256) {
      throw new SessionApplyError(`File ${operation} SHA-256 precondition failed: ${file.relativePath}`);
    }
    // An identical unmanaged preimage still needs a snapshot and an ownership
    // transition so restore can remove the newly created manifest safely.
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "update",
      changed,
      previousSha256,
      newSha256: file.sha256,
      reason: `exact observed SHA-256 ${operation}`,
    };
  }
  if (previousContent !== null && !options.force && !previouslyManaged) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "conflict",
      changed,
      previousSha256,
      newSha256: file.sha256,
      reason: "existing unmanaged file; pass force to overwrite or adopt",
    };
  }
  if (!changed && options.force && !previouslyManaged) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "update",
      changed: false,
      previousSha256,
      newSha256: file.sha256,
      reason: "force",
    };
  }
  if (!changed) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "unchanged",
      changed: false,
      previousSha256,
      newSha256: file.sha256,
      reason: null,
    };
  }
  if (previousContent === null) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "create",
      changed: true,
      previousSha256,
      newSha256: file.sha256,
      reason: null,
    };
  }
  if (options.force || previouslyManaged) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "update",
      changed: true,
      previousSha256,
      newSha256: file.sha256,
      reason: options.force ? "force" : "previous manifest hash matched",
    };
  }
  return {
    path: target,
    relativePath: file.relativePath,
    role: file.role,
    action: "conflict",
    changed: true,
    previousSha256,
    newSha256: file.sha256,
    reason: "existing unmanaged file differs; pass force to overwrite",
  };
}

/**
 * Guards against d04c7c99: a mode switch (e.g. codewith native-imports ->
 * flattened-markdown) plans to DELETE every previously managed file under the
 * adapter's managed directory while creating or updating none there, and does
 * so silently — `--allow-empty-sources` exists precisely to gate "an explicit
 * empty render", but it was only ever consulted against the composed
 * INSTRUCTION SOURCES at plan-build time (see the `orderedSources.length ===
 * 0` check in planSessionRender). Sources are routinely non-empty even when
 * the resulting WRITES under the managed directory are zero, so that guard
 * never fires for this shape, and neither `drift.clean` nor `conflicts`
 * reports it either — both read healthy right up to the write that empties
 * the directory.
 *
 * This is deliberately scoped to the adapter's OWN managed directory, and
 * deliberately requires retained-writes to be zero rather than merely fewer
 * than deletions: a render that trims some stale fragments while still
 * writing others is ordinary maintenance and must not be blocked by this.
 */
function assertNotSilentManagedWipeout(plan: SessionRenderPlan, results: SessionApplyFileResult[]): void {
  if (plan.allowEmptySources) return;
  const staleDeletions = results.filter(
    (result) => result.action === "delete" && isPlanManagedFile(plan, result.relativePath, result.role),
  );
  if (staleDeletions.length === 0) return;
  const managedRetained = results.some(
    (result) => result.action !== "delete" && isPlanManagedFile(plan, result.relativePath, result.role),
  );
  if (managedRetained) return;
  throw new SessionApplyError(
    `Session render plan for ${plan.tool} (${plan.adapter.mode}) would delete ${staleDeletions.length} `
      + "previously managed file(s) and create or update none: "
      + `${staleDeletions.map((result) => result.relativePath).join(", ")}. `
      + "Pass --allow-empty-sources only for explicit empty renders.",
  );
}

function isPlanManagedFile(
  plan: SessionRenderPlan,
  relativePath: string,
  role: SessionRenderFileRole,
): boolean {
  const managedDir = plan.adapter.managedDir;
  if (relativePath === managedDir || relativePath.startsWith(`${managedDir}/`)) return true;
  return plan.tool === "claude" && role === "rule" && relativePath.startsWith("rules/");
}

function planStaleFileResults(
  plan: SessionRenderPlan,
  targetHome: string,
  previousManifest: SessionRenderManifest | null,
  currentRelativePaths: Set<string>,
  options: SessionApplyOptions,
  retiredHashes: Map<string, string>,
): SessionApplyFileResult[] {
  if (!previousManifest) return [];
  return previousManifest.files
    .filter((file) => !currentRelativePaths.has(file.relativePath))
    .filter((file) => isPlanManagedFile(plan, file.relativePath, file.role) || file.role === "asset" || retiredHashes.has(file.relativePath))
    .map((file) => planStaleFileResult(file, targetHome, options, retiredHashes.get(file.relativePath)))
    .filter((result): result is SessionApplyFileResult => result !== null);
}

function planStaleFileResult(
  file: SessionRenderManifest["files"][number],
  targetHome: string,
  options: SessionApplyOptions,
  retiredHash?: string,
): SessionApplyFileResult | null {
  const target = resolveManifestRelativePath(file.relativePath, targetHome);
  if (!existsSync(target)) {
    if (file.role !== "asset") return null;
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "conflict",
      changed: true,
      previousSha256: null,
      newSha256: "",
      reason: "obsolete managed asset is missing; preserve manifest ownership until its reviewed preimage is restored and retired exactly",
    };
  }
  const previousContent = readFileSync(target, "utf-8");
  const previousSha256 = sha256(previousContent);
  if (retiredHash !== undefined) {
    if (previousSha256 !== retiredHash) throw new SessionApplyError(`File retirement preimage changed after validation: ${file.relativePath}`);
    return { path: target, relativePath: file.relativePath, role: file.role, action: "delete", changed: true,
      previousSha256, newSha256: "", reason: "exact reviewed obsolete managed file retired" };
  }
  if (file.role === "asset") {
    return { path: target, relativePath: file.relativePath, role: file.role, action: "conflict", changed: true,
      previousSha256, newSha256: "", reason: "obsolete managed asset requires exact retirement; preserve ownership until --retire-file and --expected-manifest-sha256 are supplied" };
  }
  if (!options.force && previousSha256 !== file.sha256) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "conflict",
      changed: true,
      previousSha256,
      newSha256: "",
      reason: "stale managed file changed since previous manifest; pass force to remove",
    };
  }
  if (!options.force && !previousContent.includes(SESSION_RENDER_MANAGED_MARKER)) {
    return {
      path: target,
      relativePath: file.relativePath,
      role: file.role,
      action: "conflict",
      changed: true,
      previousSha256,
      newSha256: "",
      reason: "stale file lacks managed marker; pass force to remove",
    };
  }
  return {
    path: target,
    relativePath: file.relativePath,
    role: file.role,
    action: "delete",
    changed: true,
    previousSha256,
    newSha256: "",
    reason: "stale managed file removed",
  };
}

function isPreviouslyManaged(
  file: SessionRenderFile,
  previousSha256: string | null,
  previousHashes: Map<string, string>,
  previousManifest: SessionRenderManifest | null,
): boolean {
  if (file.role === "manifest") return previousManifest !== null;
  if (!previousSha256) return false;
  return previousHashes.get(file.relativePath) === previousSha256;
}

function resolvePlannedFilePath(
  plan: SessionRenderPlan,
  file: SessionRenderFile,
  targetHome: string,
): string {
  const target = resolve(targetHome, ...file.relativePath.split("/"));
  const rel = relative(targetHome, target);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new SessionApplyError(`Session file escapes target home: ${file.relativePath}`);
  }
  if (resolve(file.path) !== target) {
    throw new SessionApplyError(`Session file path mismatch for ${file.relativePath}: ${file.path}`);
  }
  assertNoSymlinkSegments(targetHome, target);
  return target;
}

function resolveManifestRelativePath(relativePath: string, targetHome: string): string {
  const target = resolve(targetHome, ...relativePath.split(/[\\/]+/));
  const rel = relative(targetHome, target);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new SessionApplyError(`Session manifest file escapes target home: ${relativePath}`);
  }
  assertNoSymlinkSegments(targetHome, target);
  return target;
}

function readPreviousManifest(path: string): SessionRenderManifest | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as SessionRenderManifest;
    if (parsed.schema !== SESSION_RENDER_SCHEMA) return null;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function applyPlannedFile(
  plan: SessionRenderPlan,
  file: SessionRenderFile,
  targetHome: string,
  resultsByPath: Map<string, SessionApplyFileResult>,
  coordination: ProjectContextWriteCoordination | null,
  allowPortableFallback: boolean,
  forcePortableFileOps: boolean,
): void {
  const target = resolvePlannedFilePath(plan, file, targetHome);
  const result = resultsByPath.get(target);
  if (!result) throw new SessionApplyError(`Session apply result is missing for ${file.relativePath}`);
  coordination?.assert_held();
  assertExpectedSessionFileHash(target, targetHome, result.previousSha256);
  if (currentSessionFileHash(target, targetHome) === file.sha256) return;
  writeProjectContextCoordinatedFile({
    path: target,
    content: file.content,
    workspace_root: targetHome,
    default_mode: 0o644,
    expected_hash: result.previousSha256,
    max_observed_bytes: null,
    allow_portable_replacement: allowPortableFallback,
    force_portable_file_ops: forcePortableFileOps,
  });
  coordination?.assert_held();
}

function assertExpectedSessionFileHash(
  path: string,
  targetHome: string,
  expectedHash: string | null,
): void {
  const actualHash = currentSessionFileHash(path, targetHome);
  if (actualHash !== expectedHash) {
    throw new SessionApplyError(`Session apply path changed after planning: ${relative(targetHome, path)}`);
  }
}

function currentSessionFileHash(path: string, targetHome: string): string | null {
  assertNoSymlinkSegments(targetHome, path);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SessionApplyError(`Session apply path is not a regular file: ${path}`);
  }
  return sha256(readFileSync(path, "utf-8"));
}

function requiredPreviousHash(result: SessionApplyFileResult): string {
  if (result.previousSha256 === null) {
    throw new SessionApplyError(`Session delete has no previous hash: ${result.relativePath}`);
  }
  return result.previousSha256;
}

function writeSessionSnapshot(
  plan: SessionRenderPlan,
  targetHome: string,
  manifestPath: string,
  results: SessionApplyFileResult[],
  previousManifest: SessionRenderManifest | null,
  coordination: ProjectContextWriteCoordination | null,
  allowPortableFallback: boolean,
  forcePortableFileOps: boolean,
  adoptions: SessionFileAdoptionReceipt[],
  reconciliations: SessionFileReconciliationReceipt[],
  retirements: SessionFileRetirementReceipt[],
  legacyRetirements: SessionLegacyFileRetirementReceipt[],
): SessionRollbackReceipt {
  const existingFiles = results
    .filter((result) => result.action === "update" || result.action === "delete")
    .map((result) => {
      assertExpectedSessionFileHash(result.path, targetHome, result.previousSha256);
      const content = readFileSync(result.path, "utf-8");
      if (sha256(content) !== result.previousSha256) {
        throw new SessionApplyError(`Session snapshot preimage changed after planning: ${result.relativePath}`);
      }
      return {
        path: result.path,
        relativePath: result.relativePath,
        role: result.role,
        sha256: sha256(content),
        content,
        ...(legacyRetirements.some((entry) => entry.relativePath === result.relativePath)
          ? { mode: lstatSync(result.path).mode & 0o777 } : {}),
      };
    });
  if (!previousManifest && existingFiles.length === 0 && plan.tool !== "codewith" && !plan.manifest.claudeProjectImport) {
    return {
      schema: "hasna.configs.session-render-rollback/v1",
      status: "unsupported",
      snapshotPath: null,
      reason: "new-root-snapshot-not-supported-for-adapter",
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = join(
    getSessionRenderSnapshotDir(targetHome),
    `${timestamp}-${randomUUID()}.json`,
  );
  const afterFiles: SessionRenderSnapshot["afterFiles"] = results.map((result) => {
    if (result.action === "conflict") {
      throw new SessionApplyError(`Cannot snapshot unresolved conflict: ${result.relativePath}`);
    }
    return {
      path: result.path,
      relativePath: result.relativePath,
      role: result.role,
      action: result.action,
      sha256: result.action === "delete" ? null : result.newSha256,
    };
  });
  const snapshot: SessionRenderSnapshot = {
    schema: "hasna.configs.session-render-snapshot/v2",
    createdAt: new Date().toISOString(),
    tool: plan.tool,
    profile: plan.profile,
    targetHome,
    targetKind: plan.targetKind,
    manifestPath,
    previousManifest,
    files: existingFiles,
    afterFiles,
    ...(adoptions.length > 0 ? { adoptions } : {}),
    ...(reconciliations.length > 0 ? { reconciliations } : {}),
    ...(retirements.length > 0 ? { retirements } : {}),
    ...(legacyRetirements.length > 0 ? { legacyRetirements } : {}),
  };
  const snapshotContent = `${JSON.stringify(snapshot, null, 2)}\n`;
  if ((adoptions.length > 0 || reconciliations.length > 0 || retirements.length > 0 || legacyRetirements.length > 0) && Buffer.byteLength(snapshotContent, "utf8") > 32 * 1024 * 1024) {
    throw new SessionApplyError("Exact file preimage snapshot exceeds the 32 MiB restore limit.");
  }
  coordination?.assert_held();
  writeProjectContextCoordinatedFile({
    path: snapshotPath,
    content: snapshotContent,
    workspace_root: sessionRenderSnapshotWorkspaceRoot(targetHome),
    default_mode: 0o600,
    expected_hash: null,
    max_observed_bytes: null,
    allow_portable_replacement: allowPortableFallback,
    force_portable_file_ops: forcePortableFileOps,
  });
  coordination?.assert_held();
  return {
    schema: "hasna.configs.session-render-rollback/v1",
    status: "available",
    snapshotPath,
    reason: "snapshot-created",
  };
}

function assertSafeTargetHome(targetHome: string): string {
  if (!isAbsolute(targetHome)) throw new SessionApplyError(`Session target home must be absolute: ${targetHome}`);
  const normalized = resolve(targetHome);
  if (normalized === parse(normalized).root) {
    throw new SessionApplyError(`Session target home cannot be the filesystem root: ${targetHome}`);
  }
  assertNoSymlinkAncestors(normalized);
  if (existsSync(normalized) && lstatSync(normalized).isSymbolicLink()) {
    throw new SessionApplyError(`Session target home cannot be a symlink: ${normalized}`);
  }
  return normalized;
}

function assertNoSymlinkSegments(root: string, target: string): void {
  assertNoSymlinkAncestors(root);
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new SessionApplyError(`Session apply path uses a symlink: ${current}`);
    }
  }
}

function assertNoSymlinkAncestors(path: string): void {
  const normalized = resolve(path);
  const parsed = parse(normalized);
  let current = parsed.root;
  const rel = relative(parsed.root, normalized);
  for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw new SessionApplyError(`Session apply path uses a symlink ancestor: ${current}`);
    }
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
