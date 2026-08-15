import type { OwnedBytes } from "../lib/skill-bundle.js";

export const SERVER_RUN_STATUSES = [
  "queued",
  "waiting_for_approval",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "retrying",
  "expired",
  "refunded",
] as const;

export type ServerRunStatus = (typeof SERVER_RUN_STATUSES)[number];

/**
 * A fenced transition was refused because the run's lease_generation moved on.
 *
 * The worker that throws this is writing against a run it no longer owns: a
 * newer claim took it, or a cancellation fenced it. The run is not missing -
 * that is the null return - it has simply left the writer behind.
 */
export class StaleLeaseGenerationError extends Error {
  readonly runId: string;
  readonly expectedGeneration: number;
  readonly currentGeneration: number;
  readonly status: ServerRunStatus;

  constructor(runId: string, expectedGeneration: number, currentGeneration: number, status: ServerRunStatus) {
    super(
      `late transition rejected for run ${runId}: expected lease_generation ${expectedGeneration}, ` +
        `current ${currentGeneration} (status ${status})`,
    );
    this.name = "StaleLeaseGenerationError";
    this.runId = runId;
    this.expectedGeneration = expectedGeneration;
    this.currentGeneration = currentGeneration;
    this.status = status;
  }
}

export interface ApiPrincipal {
  apiKeyId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  userId: string;
  email: string;
  role: string;
  scopes: string[];
}

export interface ServerRunRecord {
  id: string;
  orgId: string;
  userId: string;
  skill: string;
  requestedSlug: string;
  status: ServerRunStatus;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
  correlationId: string;
  costCents: number;
  /**
   * The cancellation fence. Bumped by every claim and by every cancellation; a
   * worker that transitions a run while carrying an older generation is writing
   * against a run it no longer owns and is rejected (see transitionRun).
   */
  leaseGeneration: number;
  outputType?: string;
  outputPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ServerRunLog {
  runId: string;
  sequence: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface ServerArtifact {
  id: string;
  runId: string;
  orgId: string;
  fileName: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageKind: "db" | "s3";
  storageKey?: string;
  bodyText?: string;
  /**
   * Output visibility. Runs' outputs are PRIVATE by default: the value is set at
   * write time from the governance default and persisted, never inferred at read
   * time. "public" is the explicit opt-in for artifacts the tenant intends to
   * share; it is not a default on any path.
   */
  visibility: "private" | "public";
  /**
   * Finite retention, set at write time as createdAt + configured TTL. Absent
   * only when the writing path opted out explicitly; the expiry sweep deletes
   * artifacts whose expiresAt is in the past and records a deletion receipt.
   */
  expiresAt?: string;
  createdAt: string;
}

/** Where bytes actually live. Same vocabulary as ServerArtifact, same meaning. */
export type BlobStorageKind = "db" | "s3";

/**
 * A skill published to this instance by one organization.
 *
 * Distinct from `SkillMeta` (src/lib/registry-types.ts), which describes a skill the CLI
 * knows about from any source. This is the row: it always belongs to an org, and it
 * always carries the provenance of who put it there.
 */
export interface ServerSkillRecord {
  orgId: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  kind: "executable" | "instruction";
  version?: string;
  /** The agent-facing document, served verbatim by GET /skills/:slug/skill.md. */
  skillMd?: string;
  /** Digest of the stored bundle. Absent for a metadata-only publish. */
  bundleSha256?: string;
  bundleByteSize?: number;
  publishedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bundle bytes, addressed by their own digest.
 *
 * `bytes` is present only when the bundle is stored in the database (`storageKind: "db"`).
 * For S3 the row is a pointer and SkillBundleStorage.read() fetches the object - the same
 * split ServerArtifact makes between `bodyText` and `storageKey`, except that a bundle is
 * a gzipped tar and so cannot be a string at any layer.
 */
export interface ServerSkillBundle {
  orgId: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  storageKind: BlobStorageKind;
  storageKey?: string;
  bytes?: OwnedBytes;
  createdAt: string;
}

export interface PublishSkillInput {
  principal: ApiPrincipal;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  kind: ServerSkillRecord["kind"];
  version?: string;
  skillMd?: string;
  /** Omitted for a metadata-only publish or update. */
  bundle?: Omit<ServerSkillBundle, "orgId" | "createdAt">;
}

/** Metadata-only patch. Never touches the bundle; republish to change bytes. */
export type UpdateSkillPatch = Partial<
  Pick<ServerSkillRecord, "displayName" | "description" | "category" | "tags" | "version" | "kind" | "skillMd">
>;

export interface CreateRunInput {
  principal: ApiPrincipal;
  slug: string;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
}

export interface ClaimRunInput {
  workerId: string;
}

/**
 * Fields a fenced transition may write, plus the lease_generation the fence
 * itself bumps on cancellation. Everything updateRun can write plus the
 * generation counter; the worker never patches the generation, the cancel
 * service does.
 */
export type RunTransitionPatch = Partial<
  Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt" | "leaseGeneration">
>;

/**
 * What a store is, in the only two dimensions the server needs at boot: which backend
 * it is (for logs and diagnostics) and whether it survives a restart.
 *
 * `durable` exists because the server used to boot onto an in-process Map, report
 * `ok: true` at /health, and lose every run on restart with no warning at any point. A
 * store that knows it is non-durable can now say so, and startSkillsServer() refuses it
 * unless the operator explicitly opted in.
 */
export interface StoreBackendInfo {
  /**
   * The three bundled backends are named for autocomplete; the open `string` arm is
   * deliberate. This interface is a published seam, and a third-party store must be able
   * to declare what it is - "mysql", "dynamodb" - without either a type error or having
   * to misreport itself as one of ours. A closed union would make the seam implementable
   * only by us, which is the test R3 sets for it.
   */
  kind: "postgres" | "sqlite" | "memory" | (string & {});
  /** False when the data does not survive process exit. */
  durable: boolean;
  /** Credential-free description, safe to put in logs and error messages. */
  label: string;
}

export interface SkillsProductStore {
  /**
   * Optional so a third-party store implementing this seam keeps compiling. An
   * undeclared backend is treated as durable: we can refuse what a store tells us is
   * ephemeral, and cannot infer it about somebody else's implementation. The hazard
   * actually being closed is our own default, which is now SQLite on disk.
   */
  readonly backend?: StoreBackendInfo;
  /** Release connections and file handles. Optional; not every backend holds any. */
  close?(): Promise<void>;
  /**
   * Prove the backend is actually reachable, throwing if it is not.
   *
   * Called once at startup. Bun's SQL client connects lazily, so without this a
   * Postgres URL pointing at a dead host produced a server that started happily and
   * then 500ed on the first request.
   */
  verifyConnectivity?(): Promise<void>;
  authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null>;
  ensureBootstrapApiKey?(token: string, principal?: Partial<ApiPrincipal>): Promise<void>;
  createRun(input: CreateRunInput): Promise<ServerRunRecord>;
  listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]>;
  getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
  claimNextRun(input: ClaimRunInput): Promise<ServerRunRecord | null>;
  updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null>;
  /**
   * Generation-fenced transition, the cancellation gate.
   *
   * Optional so a third-party store implementing this seam keeps compiling; the
   * cancel service requires it and refuses to run without it (FENCING_UNSUPPORTED)
   * rather than cancelling unfenced. When present it is the ONLY transition the
   * worker paths use: the UPDATE re-asserts `lease_generation = <expected>` and
   * reports zero rows when the generation moved on (a newer claim, or a
   * cancellation), so a late write from a stale worker never lands.
   *
   * Returns null when the run does not exist; throws StaleLeaseGenerationError
   * when the generation no longer matches. The distinction matters: "nothing
   * there" and "you lost the fence" are different facts.
   */
  transitionRun?(runId: string, patch: RunTransitionPatch, expectedGeneration: number): Promise<ServerRunRecord | null>;
  appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog>;
  listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]>;
  addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact>;
  listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]>;
  getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null>;

  /*
   * Published skills.
   *
   * Required rather than optional, unlike the lifecycle hooks above. A store that
   * silently cannot persist a skill would give `skills push` a 2xx and lose the upload,
   * and there is no safe default behaviour to fall back to. Every read here takes a
   * principal and is scoped to its org, exactly as the run reads are: a private team
   * skill visible to another tenant is the failure this whole surface has to not have.
   */
  publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord>;
  listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]>;
  getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null>;
  updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch): Promise<ServerSkillRecord | null>;
  /** False when the org has no skill by that slug. Also drops a bundle nothing else references. */
  deleteSkill(principal: ApiPrincipal, slug: string): Promise<boolean>;
  getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null>;
}
