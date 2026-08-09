import type { Database } from "bun:sqlite";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  createWorkspace,
  getWorkspace,
  mutateProjectResourceLinksForRegistration,
  readProjectResourceLinks,
  rollbackProjectResourceLinks,
  workspaceSlugify,
} from "../db/workspaces.js";
import { getDatabase, now } from "../db/database.js";
import type {
  CreateWorkspaceInput,
  EventSource,
  JsonObject,
  ProjectResourceLink,
  ProjectResourceLinkInput,
  Workspace,
  WorkspaceIntegrations,
  WorkspaceKind,
} from "../types/workspace.js";
import {
  canonicalJson,
  responseControl,
  sha256,
} from "./guarded-project-mutation.js";
import { deriveProjectChannel } from "./project-channel.js";
import {
  PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
  normalizeProjectResourceLinks,
  projectResourceLinkConversationsChannelLocatorKind,
  projectResourceLinkId,
} from "./project-resource-links.js";
import { normalizeProjectMetadata } from "./project-management.js";
import { assertProjectWorkspaceId } from "./project-store-paths.js";
import {
  cleanupWorkspaceCreation,
  executeWorkspaceCreation,
  planWorkspaceCreation,
} from "./workspace-plan.js";
import {
  buildWorkspaceMarker,
  PROJECT_MARKER_FILENAME,
} from "./workspace-runtime.js";
import type { ProjectStore } from "../store/project-store.js";

export const PROJECT_REGISTRATION_ROUTE = "projects.full-registration.v1";
export const PROJECT_REGISTRATION_GOALS_FILENAME = "GOALS.md";
const PROJECT_REGISTRATION_PROVENANCE_KEY = "_hasna_projects_full_registration";
export const PROJECT_REGISTRATION_MAX_RECEIPTS = 32;

export const PROJECT_REGISTRATION_DEPENDENCY_TASKS = {
  todos: "317026ea-dc10-422e-af51-206a4ec885f9",
  mementos: "7e6a213c-ae3d-420c-a512-94abd1164df8",
  conversations: "983c734e-6602-4286-98c5-9c2e6f6d741a",
} as const;

/**
 * These are retirement predicates, not naming templates. New registration
 * derives its name from the project slug; it never manufactures either prefix.
 */
export const RETIRED_PROJECT_REGISTRATION_PREFIXES = [
  "internal-iproj-",
  "iproj-",
] as const;

export type ProjectRegistrationAuthorityName = keyof typeof PROJECT_REGISTRATION_DEPENDENCY_TASKS;
export type ProjectRegistrationResourceKind =
  | "project"
  | "task_list"
  | "channel";
export type ProjectRegistrationDirection = "forward" | "inverse";
export type ProjectRegistrationOutcome =
  | "accepted"
  | "duplicate_of_accepted"
  | "terminal_nonacceptance";

export interface ProjectRegistrationBounds {
  response_byte_limit: number;
  time_budget_ms: number;
}

export interface ProjectRegistrationResponseControl extends ProjectRegistrationBounds {
  response_bytes: number;
  elapsed_ms: number;
  complete: boolean;
  truncated: boolean;
}

/**
 * A path-bearing registration request stays inside this package-owned handle.
 * It is never serialized into a manifest, receipt, result, argv, or env field.
 */
export class ProjectRegistrationPathHandle {
  readonly #absolutePath: string;
  readonly #pathDigest: string;

  private constructor(path: string) {
    this.#absolutePath = resolve(path);
    this.#pathDigest = sha256(this.#absolutePath);
  }

  static fromPath(path: string): ProjectRegistrationPathHandle {
    if (!path?.trim()) throw new Error("project registration requires a non-empty target path");
    return new ProjectRegistrationPathHandle(path);
  }

  get digest(): string {
    return this.#pathDigest;
  }

  withOwnedPath<T>(consumer: (absolutePath: string) => T): T {
    return consumer(this.#absolutePath);
  }
}

export interface ProjectRegistrationAuthorityCapability {
  authority: ProjectRegistrationAuthorityName;
  route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  supported_resources: ProjectRegistrationResourceKind[];
  conditional_create: boolean;
  immutable_receipts: boolean;
  exact_terminal_lookup: boolean;
  exact_readback: boolean;
  conditional_inverse: boolean;
  ambiguous_outcome_reconciliation: boolean;
}

export interface ProjectRegistrationAuthorityReceipt {
  receipt_id: string;
  authority: ProjectRegistrationAuthorityName;
  route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  resource_kind: ProjectRegistrationResourceKind;
  direction: ProjectRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: ProjectRegistrationOutcome;
  reason: string | null;
  target_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  created_at: string;
}

export interface ProjectRegistrationAuthorityRecord {
  target_id: string;
  revision: string;
  digest: string;
}

export interface ProjectRegistrationAuthorityRequest extends ProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: ProjectRegistrationResourceKind;
  direction: ProjectRegistrationDirection;
  authority_route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  target_selector: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  desired: JsonObject;
  target: ProjectRegistrationPathHandle;
  accepted_receipt?: ProjectRegistrationAuthorityReceipt;
}

export interface ProjectRegistrationAuthorityLookupRequest extends ProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: ProjectRegistrationResourceKind;
  direction: ProjectRegistrationDirection;
  authority: ProjectRegistrationAuthorityName;
  authority_route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  target_selector: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  target_id?: string;
  max_items: 1;
}

export interface ProjectRegistrationAuthorityLookupResult {
  receipt: ProjectRegistrationAuthorityReceipt;
  response_control: ProjectRegistrationResponseControl;
}

export interface ProjectRegistrationAuthorityInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: true;
  digest: string;
}

export interface ProjectRegistrationAuthorityAdapter {
  readonly authority: ProjectRegistrationAuthorityName;
  capability(): Promise<ProjectRegistrationAuthorityCapability>;
  create(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt>;
  readExact(request: {
    resource_kind: ProjectRegistrationResourceKind;
    target_id: string;
    target: ProjectRegistrationPathHandle;
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<ProjectRegistrationAuthorityRecord>;
  lookupReceipt(request: ProjectRegistrationAuthorityLookupRequest): Promise<ProjectRegistrationAuthorityLookupResult>;
  validateExistingAdoption?(
    request: ProjectRegistrationAuthorityRequest,
    receipt: ProjectRegistrationAuthorityReceipt,
  ): Promise<boolean>;
  compensate(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt>;
  verifyInverse(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityInverseVerification>;
}

export interface ProjectRegistrationAuthorities {
  todos: ProjectRegistrationAuthorityAdapter;
  mementos: ProjectRegistrationAuthorityAdapter;
  conversations: ProjectRegistrationAuthorityAdapter;
}

export interface ProjectRegistrationCapabilityBlocker {
  authority: ProjectRegistrationAuthorityName;
  dependency_task_id: string;
  route: string;
  package_version: string;
  missing: string[];
}

export interface ProjectRegistrationCapabilityReport {
  ok: boolean;
  capabilities: ProjectRegistrationAuthorityCapability[];
  blockers: ProjectRegistrationCapabilityBlocker[];
}

export interface FullProjectRegistrationProjectInput {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  kind?: WorkspaceKind;
  root_id?: string;
  recipe_id?: string;
  git_remote?: string;
  s3_bucket?: string;
  s3_prefix?: string;
  tags?: string[];
  metadata?: JsonObject;
  agent_id?: string;
  source?: EventSource;
  prompt?: string;
  command?: string;
}

export interface FullProjectRegistrationInput extends ProjectRegistrationBounds {
  operation_id: string;
  mode?: "create" | "retrofit";
  expected_project_revision?: string;
  project: FullProjectRegistrationProjectInput;
  target: ProjectRegistrationPathHandle;
  goals_markdown: string;
}

export interface ProjectRegistrationArtifact {
  kind: string;
  authority: string;
  target_id: string;
  revision?: string;
  digest?: string;
}

export interface ProjectRegistrationReceipt {
  receipt_id: string;
  operation_id: string;
  sequence: number;
  step_id: string;
  authority: string;
  resource_kind: string;
  direction: ProjectRegistrationDirection;
  idempotency_key: string;
  target_id: string | null;
  request_digest: string;
  precondition_digest: string;
  outcome: ProjectRegistrationOutcome;
  reason: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  authority_receipt: ProjectRegistrationAuthorityReceipt | null;
  artifacts: JsonObject[];
  preconditions: JsonObject[];
  rollback: JsonObject[];
  created_at: string;
}

export interface ProjectRegistrationReceiptLookupInput extends ProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  direction: ProjectRegistrationDirection;
  idempotency_key: string;
  max_items: 1;
}

export interface ProjectRegistrationReceiptLookupResult {
  receipt: ProjectRegistrationReceipt;
  response_control: ProjectRegistrationResponseControl;
}

export interface FullProjectRegistrationResult {
  ok: boolean;
  outcome: "no_go" | "accepted" | "duplicate_of_accepted" | "rolled_back" | "split_state";
  operation_id: string;
  project_id: string;
  project_slug: string;
  failed_step: string | null;
  reason_code: string | null;
  dependencies: ProjectRegistrationCapabilityBlocker[];
  artifacts: ProjectRegistrationArtifact[];
  receipts: ProjectRegistrationReceipt[];
  rollback: JsonObject[];
  response_control: ProjectRegistrationResponseControl;
}

interface ProjectRegistrationManifestRow {
  operation_id: string;
  route: string;
  request_digest: string;
  project_id: string;
  project_slug: string;
  plan_json: string;
  created_at: string;
}

interface ProjectRegistrationReceiptRow {
  receipt_id: string;
  operation_id: string;
  sequence: number;
  step_id: string;
  authority: string;
  resource_kind: string;
  direction: string;
  idempotency_key: string;
  target_id: string | null;
  request_digest: string;
  precondition_digest: string;
  outcome: string;
  reason: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  authority_receipt_json: string | null;
  artifacts_json: string;
  preconditions_json: string;
  rollback_json: string;
  created_at: string;
}

interface AppendReceiptInput {
  operation_id: string;
  step_id: string;
  authority: string;
  resource_kind: string;
  direction: ProjectRegistrationDirection;
  idempotency_key: string;
  target_id?: string | null;
  request_digest: string;
  precondition_digest: string;
  outcome: ProjectRegistrationOutcome;
  reason?: string | null;
  result_revision?: string | null;
  result_digest?: string | null;
  duplicate_of_receipt_id?: string | null;
  authority_receipt?: ProjectRegistrationAuthorityReceipt | null;
  artifacts?: JsonObject[];
  preconditions?: JsonObject[];
  rollback?: JsonObject[];
}

interface AcceptedExternalStep {
  adapter: ProjectRegistrationAuthorityAdapter;
  capability: ProjectRegistrationAuthorityCapability;
  receipt: ProjectRegistrationAuthorityReceipt;
  request: ProjectRegistrationAuthorityRequest;
  local_receipt: ProjectRegistrationReceipt | null;
}

interface ExistingAuthorityAdoption {
  integration_key: keyof WorkspaceIntegrations;
  integration_value: string;
  expected_target_id?: string;
}

interface AcceptedFileStep {
  filename: string;
  digest: string;
  local_receipt: ProjectRegistrationReceipt;
  created_by_operation: boolean;
}

interface OwnedDirectoryIdentity {
  dev: string;
  ino: string;
}

class ProjectRegistrationStepError extends Error {
  constructor(
    readonly stepId: string,
    readonly code: string,
    readonly splitState = false,
  ) {
    super(`${stepId}:${code}`);
    this.name = "ProjectRegistrationStepError";
  }
}

function controlledResult<T extends Record<string, unknown>>(
  payload: T,
  bounds: ProjectRegistrationBounds,
  startedAtMs: number,
): T & { response_control: ProjectRegistrationResponseControl } {
  const envelope = {
    ...payload,
    response_control: {
      response_byte_limit: bounds.response_byte_limit,
      time_budget_ms: bounds.time_budget_ms,
      response_bytes: 0,
      elapsed_ms: 0,
      complete: true,
      truncated: false,
    },
  };
  envelope.response_control = responseControl(
    envelope,
    bounds,
    startedAtMs,
    "project registration",
  );
  envelope.response_control = responseControl(
    envelope,
    bounds,
    startedAtMs,
    "project registration",
  );
  return envelope;
}

function assertRegistrationTimeBudget(
  bounds: ProjectRegistrationBounds,
  startedAtMs: number,
  stepId: string,
): void {
  if (Date.now() - startedAtMs > bounds.time_budget_ms) {
    throw new ProjectRegistrationStepError(stepId, "time_budget_exceeded");
  }
}

function parseJsonObjectArray(raw: string): JsonObject[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("project registration receipt array is malformed");
  return parsed as JsonObject[];
}

function parseAuthorityReceipt(raw: string | null): ProjectRegistrationAuthorityReceipt | null {
  return raw ? JSON.parse(raw) as ProjectRegistrationAuthorityReceipt : null;
}

function rowToReceipt(row: ProjectRegistrationReceiptRow): ProjectRegistrationReceipt {
  return {
    receipt_id: row.receipt_id,
    operation_id: row.operation_id,
    sequence: row.sequence,
    step_id: row.step_id,
    authority: row.authority,
    resource_kind: row.resource_kind,
    direction: row.direction as ProjectRegistrationDirection,
    idempotency_key: row.idempotency_key,
    target_id: row.target_id,
    request_digest: row.request_digest,
    precondition_digest: row.precondition_digest,
    outcome: row.outcome as ProjectRegistrationOutcome,
    reason: row.reason,
    result_revision: row.result_revision,
    result_digest: row.result_digest,
    duplicate_of_receipt_id: row.duplicate_of_receipt_id,
    authority_receipt: parseAuthorityReceipt(row.authority_receipt_json),
    artifacts: parseJsonObjectArray(row.artifacts_json),
    preconditions: parseJsonObjectArray(row.preconditions_json),
    rollback: parseJsonObjectArray(row.rollback_json),
    created_at: row.created_at,
  };
}

function safeAuthorityReceipt(receipt: ProjectRegistrationAuthorityReceipt): ProjectRegistrationAuthorityReceipt {
  return {
    receipt_id: receipt.receipt_id,
    authority: receipt.authority,
    route: receipt.route,
    package_version: receipt.package_version,
    authority_id: receipt.authority_id,
    tenant_id: receipt.tenant_id,
    corpus_id: receipt.corpus_id,
    operation_id: receipt.operation_id,
    step_id: receipt.step_id,
    resource_kind: receipt.resource_kind,
    direction: receipt.direction,
    idempotency_key: receipt.idempotency_key,
    request_digest: receipt.request_digest,
    precondition_digest: receipt.precondition_digest,
    outcome: receipt.outcome,
    reason: receipt.reason,
    target_id: receipt.target_id,
    result_revision: receipt.result_revision,
    result_digest: receipt.result_digest,
    duplicate_of_receipt_id: receipt.duplicate_of_receipt_id,
    accepted_receipt_id: receipt.accepted_receipt_id,
    created_by_operation: receipt.created_by_operation,
    created_at: receipt.created_at,
  };
}

function receiptLogicalPayload(input: AppendReceiptInput): JsonObject {
  return {
    operation_id: input.operation_id,
    step_id: input.step_id,
    authority: input.authority,
    resource_kind: input.resource_kind,
    direction: input.direction,
    idempotency_key: input.idempotency_key,
    target_id: input.target_id ?? null,
    request_digest: input.request_digest,
    precondition_digest: input.precondition_digest,
    outcome: input.outcome,
    reason: input.reason ?? null,
    result_revision: input.result_revision ?? null,
    result_digest: input.result_digest ?? null,
    duplicate_of_receipt_id: input.duplicate_of_receipt_id ?? null,
    authority_receipt: input.authority_receipt ? safeAuthorityReceipt(input.authority_receipt) : null,
    artifacts: input.artifacts ?? [],
    preconditions: input.preconditions ?? [],
    rollback: input.rollback ?? [],
  };
}

function buildReceiptId(input: AppendReceiptInput): string {
  return `prr_${sha256(canonicalJson(receiptLogicalPayload(input))).slice(0, 36)}`;
}

export function deriveProjectRegistrationIdempotencyKey(input: {
  operation_id: string;
  step_id: string;
  direction: ProjectRegistrationDirection;
  target_selector: string;
  request_digest: string;
  precondition_digest: string;
}): string {
  return `prk_${sha256(canonicalJson({
    route: PROJECT_REGISTRATION_ROUTE,
    ...input,
  })).slice(0, 48)}`;
}

function appendRegistrationReceiptInTransaction(input: AppendReceiptInput, db: Database): ProjectRegistrationReceipt {
  const receiptId = buildReceiptId(input);
  const existing = db.query(
    "SELECT * FROM project_registration_receipts WHERE receipt_id = ?",
  ).get(receiptId) as ProjectRegistrationReceiptRow | null;
  if (existing) return rowToReceipt(existing);

  if (input.outcome === "accepted") {
    const prior = db.query(
      `SELECT * FROM project_registration_receipts
       WHERE operation_id = ? AND step_id = ? AND authority = ? AND resource_kind = ?
         AND direction = ? AND outcome = 'accepted'
       ORDER BY sequence ASC LIMIT 1`,
    ).get(
      input.operation_id,
      input.step_id,
      input.authority,
      input.resource_kind,
      input.direction,
    ) as ProjectRegistrationReceiptRow | null;
    if (prior && prior.idempotency_key !== input.idempotency_key) {
      throw new Error(`project registration step already accepted with different semantics: ${input.step_id}`);
    }
  }

  const sequenceRow = db.query(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM project_registration_receipts WHERE operation_id = ?",
  ).get(input.operation_id) as { next_sequence: number };
  const sequence = Number(sequenceRow.next_sequence);
  const logical = receiptLogicalPayload(input);
  db.run(
    `INSERT INTO project_registration_receipts (
      receipt_id, operation_id, sequence, step_id, authority, resource_kind,
      direction, idempotency_key, target_id, request_digest,
      precondition_digest, outcome, reason, result_revision, result_digest,
      duplicate_of_receipt_id, authority_receipt_json, artifacts_json,
      preconditions_json, rollback_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receiptId,
      input.operation_id,
      sequence,
      input.step_id,
      input.authority,
      input.resource_kind,
      input.direction,
      input.idempotency_key,
      input.target_id ?? null,
      input.request_digest,
      input.precondition_digest,
      input.outcome,
      input.reason ?? null,
      input.result_revision ?? null,
      input.result_digest ?? null,
      input.duplicate_of_receipt_id ?? null,
      input.authority_receipt ? canonicalJson(safeAuthorityReceipt(input.authority_receipt)) : null,
      canonicalJson(logical.artifacts ?? []),
      canonicalJson(logical.preconditions ?? []),
      canonicalJson(logical.rollback ?? []),
      now(),
    ],
  );
  return rowToReceipt(db.query(
    "SELECT * FROM project_registration_receipts WHERE receipt_id = ?",
  ).get(receiptId) as ProjectRegistrationReceiptRow);
}

function appendRegistrationReceipt(input: AppendReceiptInput, db: Database): ProjectRegistrationReceipt {
  return db.transaction(() => appendRegistrationReceiptInTransaction(input, db))();
}

export function lookupProjectRegistrationReceipt(
  input: ProjectRegistrationReceiptLookupInput,
  db?: Database,
): ProjectRegistrationReceiptLookupResult {
  const d = db ?? getDatabase();
  const startedAt = Date.now();
  if (input.max_items !== 1) throw new Error("project registration receipt lookup max_items must be exactly 1");
  const rows = d.query(
    `SELECT * FROM project_registration_receipts
     WHERE operation_id = ? AND step_id = ? AND direction = ? AND idempotency_key = ?
     ORDER BY sequence ASC LIMIT 2`,
  ).all(
    input.operation_id,
    input.step_id,
    input.direction,
    input.idempotency_key,
  ) as ProjectRegistrationReceiptRow[];
  if (rows.length === 0) {
    throw new Error("project registration receipt lookup expected exactly one terminal receipt, found 0");
  }
  const receipts = rows.map(rowToReceipt);
  const accepted = receipts.find((receipt) => receipt.outcome === "accepted");
  const duplicates = receipts.filter((receipt) => receipt.outcome === "duplicate_of_accepted");
  if (receipts.length > 1) {
    if (
      !accepted
      || duplicates.length !== receipts.length - 1
      || duplicates.some((receipt) => receipt.duplicate_of_receipt_id !== accepted.receipt_id)
    ) {
      throw new Error(`project registration receipt lookup expected exactly one terminal result, found ${receipts.length}`);
    }
  }
  const receipt = duplicates.at(-1) ?? accepted ?? receipts[0]!;
  return controlledResult({ receipt }, input, startedAt);
}

export function listProjectRegistrationReceipts(operationId: string, db?: Database): ProjectRegistrationReceipt[] {
  const d = db ?? getDatabase();
  const rows = d.query(
    `SELECT * FROM project_registration_receipts
     WHERE operation_id = ? ORDER BY sequence ASC LIMIT ?`,
  ).all(operationId, PROJECT_REGISTRATION_MAX_RECEIPTS + 1) as ProjectRegistrationReceiptRow[];
  if (rows.length > PROJECT_REGISTRATION_MAX_RECEIPTS) {
    throw new Error(`project registration receipt population exceeds ${PROJECT_REGISTRATION_MAX_RECEIPTS}`);
  }
  return rows.map(rowToReceipt);
}

function projectStateDigest(project: Workspace): string {
  return sha256(canonicalJson({
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    kind: project.kind,
    status: project.status,
    root_id: project.root_id,
    recipe_id: project.recipe_id,
    canonical_machine: project.canonical_machine,
    primary_path_digest: project.primary_path ? sha256(resolve(project.primary_path)) : null,
    git_remote: project.git_remote,
    s3_bucket: project.s3_bucket,
    s3_prefix: project.s3_prefix,
    tags: project.tags,
    integrations: project.integrations,
    metadata: project.metadata,
    last_opened_at: project.last_opened_at,
    created_at: project.created_at,
    updated_at: project.updated_at,
    synced_at: project.synced_at,
  }));
}

function registrationProvenance(operationId: string, inputRequestDigest: string): JsonObject {
  return {
    route: PROJECT_REGISTRATION_ROUTE,
    operation_id: operationId,
    input_request_digest: inputRequestDigest,
  };
}

function hasRegistrationProvenance(
  project: Workspace,
  operationId: string,
  inputRequestDigest: string,
): boolean {
  const value = project.metadata[PROJECT_REGISTRATION_PROVENANCE_KEY];
  return canonicalJson(value ?? null) === canonicalJson(
    registrationProvenance(operationId, inputRequestDigest),
  );
}

function nextRevisionAfter(revision: string): string {
  const candidate = new Date().toISOString();
  if (candidate !== revision) return candidate;
  return new Date(Date.now() + 1).toISOString();
}

function assertRegistrationOperationId(operationId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) {
    throw new Error("project registration operation_id must be 8-128 stable identifier characters");
  }
}

export function assertCurrentProjectRegistrationSlug(slug: string): void {
  for (const prefix of RETIRED_PROJECT_REGISTRATION_PREFIXES) {
    if (slug.startsWith(prefix)) {
      throw new Error(`project registration refuses retired leading project prefix: ${prefix}`);
    }
  }
}

function deriveRegistrationProjectId(operationId: string, slug: string): string {
  return `wks_${sha256(canonicalJson({ operation_id: operationId, slug })).slice(0, 20)}`;
}

function validateInput(input: FullProjectRegistrationInput): {
  project_id: string;
  project_slug: string;
  project_metadata: JsonObject;
  request_digest: string;
} {
  assertRegistrationOperationId(input.operation_id);
  const mode = input.mode ?? "create";
  if (mode !== "create" && mode !== "retrofit") {
    throw new Error("project registration mode must be create or retrofit");
  }
  if (mode === "retrofit") {
    if (!input.project.id) throw new Error("project retrofit requires project.id");
    if (!input.expected_project_revision?.trim()) {
      throw new Error("project retrofit requires expected_project_revision");
    }
  } else if (input.expected_project_revision !== undefined) {
    throw new Error("expected_project_revision is valid only in retrofit mode");
  }
  if (!input.project.name?.trim()) throw new Error("project registration requires a project name");
  if (input.project.metadata && PROJECT_REGISTRATION_PROVENANCE_KEY in input.project.metadata) {
    throw new Error(`${PROJECT_REGISTRATION_PROVENANCE_KEY} is reserved for registration provenance`);
  }
  const projectMetadata = normalizeProjectMetadata(input.project.metadata);
  if (!input.goals_markdown?.trim()) throw new Error("project registration requires non-empty GOALS.md content");
  if (!Number.isInteger(input.response_byte_limit) || input.response_byte_limit < 64 * 1024) {
    throw new Error("response_byte_limit must be an integer of at least 65536");
  }
  if (!Number.isInteger(input.time_budget_ms) || input.time_budget_ms < 1_000) {
    throw new Error("time_budget_ms must be an integer of at least 1000");
  }
  const projectSlug = workspaceSlugify(input.project.slug ?? input.project.name);
  assertCurrentProjectRegistrationSlug(projectSlug);
  const projectId = assertProjectWorkspaceId(
    input.project.id ?? deriveRegistrationProjectId(input.operation_id, projectSlug),
  );
  const requestDigest = sha256(canonicalJson({
    route: PROJECT_REGISTRATION_ROUTE,
    operation_id: input.operation_id,
    mode,
    expected_project_revision: input.expected_project_revision ?? null,
    project: {
      id: projectId,
      slug: projectSlug,
      name: input.project.name,
      description: input.project.description ?? null,
      kind: input.project.kind ?? "generic",
      root_id: input.project.root_id ?? null,
      recipe_id: input.project.recipe_id ?? null,
      git_remote: input.project.git_remote ?? null,
      s3_bucket: input.project.s3_bucket ?? null,
      s3_prefix: input.project.s3_prefix ?? null,
      tags: input.project.tags ?? [],
      metadata_digest: sha256(canonicalJson(projectMetadata)),
      target_path_digest: input.target.digest,
      goals_digest: sha256(input.goals_markdown),
    },
  }));
  return {
    project_id: projectId,
    project_slug: projectSlug,
    project_metadata: projectMetadata,
    request_digest: requestDigest,
  };
}

async function readRegistrationProject(
  projectId: string,
  db: Database,
  store?: ProjectStore,
): Promise<Workspace | null> {
  return store ? store.getProject(projectId) : getWorkspace(projectId, db);
}

async function validateRetrofitProject(
  input: FullProjectRegistrationInput,
  validated: { project_id: string; project_slug: string },
  db: Database,
  store: ProjectStore | undefined,
  checkRevision: boolean,
): Promise<Workspace | null> {
  if ((input.mode ?? "create") !== "retrofit") return null;
  const project = await readRegistrationProject(validated.project_id, db, store);
  if (!project) throw new ProjectRegistrationStepError("projects_project", "retrofit_project_missing");
  if (
    project.id !== validated.project_id
    || project.slug !== validated.project_slug
    || project.name !== input.project.name
    || project.kind !== (input.project.kind ?? "generic")
  ) {
    throw new ProjectRegistrationStepError("projects_project", "retrofit_project_identity_mismatch");
  }
  if (checkRevision && project.updated_at !== input.expected_project_revision) {
    throw new ProjectRegistrationStepError("projects_project", "retrofit_project_revision_mismatch");
  }
  const ownsTarget = input.target.withOwnedPath((path) =>
    project.primary_path !== null && resolve(project.primary_path) === path
  );
  if (!ownsTarget) {
    throw new ProjectRegistrationStepError("projects_project", "retrofit_primary_path_unclaimed");
  }
  input.target.withOwnedPath((path) => {
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (!stat.isDirectory()) {
      throw new ProjectRegistrationStepError("projects_directory", "retrofit_target_is_not_directory");
    }
  });
  return project;
}

const REQUIRED_CAPABILITIES = [
  "conditional_create",
  "immutable_receipts",
  "exact_terminal_lookup",
  "exact_readback",
  "conditional_inverse",
  "ambiguous_outcome_reconciliation",
] as const;

const REQUIRED_RESOURCES: Record<ProjectRegistrationAuthorityName, ProjectRegistrationResourceKind[]> = {
  todos: ["project", "task_list"],
  mementos: ["project"],
  conversations: ["channel"],
};

export async function preflightProjectRegistrationAuthorities(
  authorities: ProjectRegistrationAuthorities,
): Promise<ProjectRegistrationCapabilityReport> {
  const capabilities: ProjectRegistrationAuthorityCapability[] = [];
  const blockers: ProjectRegistrationCapabilityBlocker[] = [];

  for (const authority of ["todos", "mementos", "conversations"] as const) {
    const adapter = authorities[authority];
    const missing: string[] = [];
    let capability: ProjectRegistrationAuthorityCapability;
    try {
      capability = await adapter.capability();
    } catch {
      capability = {
        authority,
        route: "unavailable",
        package_version: "unavailable",
        authority_id: "unavailable",
        tenant_id: "unavailable",
        corpus_id: "unavailable",
        supported_resources: [],
        conditional_create: false,
        immutable_receipts: false,
        exact_terminal_lookup: false,
        exact_readback: false,
        conditional_inverse: false,
        ambiguous_outcome_reconciliation: false,
      };
      missing.push("capability_probe");
    }
    if (adapter.authority !== authority || capability.authority !== authority) {
      missing.push("authority_identity");
    }
    for (const field of ["route", "package_version", "authority_id", "tenant_id", "corpus_id"] as const) {
      if (!capability[field]?.trim()) missing.push(field);
    }
    for (const field of REQUIRED_CAPABILITIES) {
      if (!capability[field]) missing.push(field);
    }
    for (const resource of REQUIRED_RESOURCES[authority]) {
      if (!capability.supported_resources.includes(resource)) missing.push(`resource:${resource}`);
    }
    capabilities.push(capability);
    if (missing.length > 0) {
      blockers.push({
        authority,
        dependency_task_id: PROJECT_REGISTRATION_DEPENDENCY_TASKS[authority],
        route: capability.route,
        package_version: capability.package_version,
        missing: [...new Set(missing)],
      });
    }
  }
  return { ok: blockers.length === 0, capabilities, blockers };
}

function unavailableAuthority(
  authority: ProjectRegistrationAuthorityName,
): ProjectRegistrationAuthorityAdapter {
  const unsupported = async (): Promise<never> => {
    throw new Error(`project registration authority unavailable: ${authority}`);
  };
  return {
    authority,
    async capability() {
      return {
        authority,
        route: "unavailable",
        package_version: "installed-api-missing-contract",
        authority_id: authority,
        tenant_id: "unresolved",
        corpus_id: "unresolved",
        supported_resources: [],
        conditional_create: false,
        immutable_receipts: false,
        exact_terminal_lookup: false,
        exact_readback: false,
        conditional_inverse: false,
        ambiguous_outcome_reconciliation: false,
      };
    },
    create: unsupported,
    readExact: unsupported,
    lookupReceipt: unsupported,
    compensate: unsupported,
    verifyInverse: unsupported,
  };
}

export function unavailableProjectRegistrationAuthorities(): ProjectRegistrationAuthorities {
  return {
    todos: unavailableAuthority("todos"),
    mementos: unavailableAuthority("mementos"),
    conversations: unavailableAuthority("conversations"),
  };
}

function manifestPlan(input: {
  project_id: string;
  project_slug: string;
  project_kind: WorkspaceKind;
  target_path_digest: string;
  capabilities: ProjectRegistrationAuthorityCapability[];
}): JsonObject {
  const channel = deriveProjectChannel({
    slug: input.project_slug,
    kind: input.project_kind,
    integrations: {},
  }).channel;
  return {
    route: PROJECT_REGISTRATION_ROUTE,
    project_id: input.project_id,
    project_slug: input.project_slug,
    target_path_digest: input.target_path_digest,
    authorities: input.capabilities
      .slice()
      .sort((a, b) => a.authority.localeCompare(b.authority))
      .map((capability) => ({
        authority: capability.authority,
        route: capability.route,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        supported_resources: capability.supported_resources.slice().sort(),
        conditional_create: capability.conditional_create,
        immutable_receipts: capability.immutable_receipts,
        exact_terminal_lookup: capability.exact_terminal_lookup,
        exact_readback: capability.exact_readback,
        conditional_inverse: capability.conditional_inverse,
        ambiguous_outcome_reconciliation: capability.ambiguous_outcome_reconciliation,
      })),
    steps: [
      {
        step_id: "projects_project",
        authority: "projects",
        resource_kind: "project",
        target_selector: input.project_id,
        depends_on: [],
        inverse_step_id: "projects_project:inverse",
      },
      {
        step_id: "projects_directory",
        authority: "projects-files",
        resource_kind: "directory",
        target_selector: input.target_path_digest,
        depends_on: ["projects_project"],
        inverse_step_id: "projects_directory:inverse",
      },
      {
        step_id: "conversations_channel",
        authority: "conversations",
        resource_kind: "channel",
        target_selector: channel,
        depends_on: ["projects_directory"],
        inverse_step_id: "conversations_channel:inverse",
        inverse_readback_step_id: "conversations_channel:readback",
      },
      {
        step_id: "conversations_channel:readback",
        authority: "conversations",
        resource_kind: "channel_readback",
        target_selector: channel,
        depends_on: ["conversations_channel"],
      },
      {
        step_id: "todos_project",
        authority: "todos",
        resource_kind: "project",
        target_selector: input.project_id,
        depends_on: ["conversations_channel:readback"],
        inverse_step_id: "todos_project:inverse",
        inverse_readback_step_id: "todos_project:readback",
      },
      {
        step_id: "todos_project:readback",
        authority: "todos",
        resource_kind: "project_readback",
        target_selector: input.project_id,
        depends_on: ["todos_project"],
      },
      {
        step_id: "todos_task_list",
        authority: "todos",
        resource_kind: "task_list",
        target_selector: "accepted:todos_project/default",
        depends_on: ["todos_project:readback"],
        inverse_step_id: "todos_task_list:inverse",
        inverse_readback_step_id: "todos_task_list:readback",
      },
      {
        step_id: "todos_task_list:readback",
        authority: "todos",
        resource_kind: "task_list_readback",
        target_selector: "accepted:todos_task_list",
        depends_on: ["todos_task_list"],
      },
      {
        step_id: "mementos_project",
        authority: "mementos",
        resource_kind: "project",
        target_selector: input.project_id,
        depends_on: ["todos_task_list:readback"],
        inverse_step_id: "mementos_project:inverse",
        inverse_readback_step_id: "mementos_project:readback",
      },
      {
        step_id: "mementos_project:readback",
        authority: "mementos",
        resource_kind: "project_readback",
        target_selector: input.project_id,
        depends_on: ["mementos_project"],
      },
      {
        step_id: "projects_integrations",
        authority: "projects",
        resource_kind: "integrations",
        target_selector: input.project_id,
        depends_on: ["mementos_project:readback"],
        inverse_step_id: "projects_integrations:inverse",
      },
      {
        step_id: "projects_goals",
        authority: "projects-files",
        resource_kind: "file",
        target_selector: `${input.project_id}:${PROJECT_REGISTRATION_GOALS_FILENAME}`,
        depends_on: ["projects_integrations"],
        inverse_step_id: "projects_goals:inverse",
      },
      {
        step_id: "projects_marker",
        authority: "projects-files",
        resource_kind: "file",
        target_selector: `${input.project_id}:${PROJECT_MARKER_FILENAME}`,
        depends_on: ["projects_goals"],
        inverse_step_id: "projects_marker:inverse",
      },
      {
        step_id: "registration_terminal",
        authority: "projects",
        resource_kind: "registration",
        target_selector: input.project_id,
        depends_on: ["projects_marker"],
      },
    ],
    dependencies: PROJECT_REGISTRATION_DEPENDENCY_TASKS,
  };
}

function createOrReadManifest(input: {
  operation_id: string;
  request_digest: string;
  project_id: string;
  project_slug: string;
  plan: JsonObject;
}, db: Database): { manifest: ProjectRegistrationManifestRow; created: boolean } {
  const planJson = canonicalJson(input.plan);
  return db.transaction(() => {
    const inserted = db.run(
      `INSERT OR IGNORE INTO project_registration_manifests (
        operation_id, route, request_digest, project_id, project_slug, plan_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.operation_id,
        PROJECT_REGISTRATION_ROUTE,
        input.request_digest,
        input.project_id,
        input.project_slug,
        planJson,
        now(),
      ],
    );
    const existing = db.query(
      "SELECT * FROM project_registration_manifests WHERE operation_id = ?",
    ).get(input.operation_id) as ProjectRegistrationManifestRow | null;
    if (!existing) {
      throw new ProjectRegistrationStepError("registration_manifest", "manifest_insert_missing");
    }
    if (
      existing.route !== PROJECT_REGISTRATION_ROUTE
      || existing.request_digest !== input.request_digest
      || existing.project_id !== input.project_id
      || existing.project_slug !== input.project_slug
      || existing.plan_json !== planJson
    ) {
      throw new ProjectRegistrationStepError("registration_manifest", "operation_semantics_conflict");
    }
    return { manifest: existing, created: inserted.changes === 1 };
  })();
}

function validateAuthorityReceipt(
  receipt: ProjectRegistrationAuthorityReceipt,
  request: ProjectRegistrationAuthorityRequest,
  capability: ProjectRegistrationAuthorityCapability,
): void {
  const mismatch = (
    receipt.authority !== capability.authority
    || receipt.route !== capability.route
    || receipt.package_version !== capability.package_version
    || receipt.authority_id !== capability.authority_id
    || receipt.tenant_id !== capability.tenant_id
    || receipt.corpus_id !== capability.corpus_id
    || receipt.operation_id !== request.operation_id
    || receipt.step_id !== request.step_id
    || receipt.resource_kind !== request.resource_kind
    || receipt.direction !== request.direction
    || receipt.idempotency_key !== request.idempotency_key
    || receipt.request_digest !== request.request_digest
    || receipt.precondition_digest !== request.precondition_digest
  );
  if (mismatch) throw new ProjectRegistrationStepError(request.step_id, "authority_receipt_mismatch");
  if (!receipt.receipt_id || !receipt.route || !receipt.package_version) {
    throw new ProjectRegistrationStepError(request.step_id, "authority_receipt_incomplete");
  }
  if (request.direction === "forward") {
    if (receipt.outcome === "terminal_nonacceptance") return;
    if (!receipt.target_id || !receipt.result_revision || !receipt.result_digest) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_receipt_missing_result");
    }
    if (receipt.outcome === "accepted" && !receipt.created_by_operation) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_refused_attempt_ownership");
    }
    if (receipt.outcome === "duplicate_of_accepted" && !receipt.duplicate_of_receipt_id) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_duplicate_missing_link");
    }
  } else {
    if (receipt.outcome === "terminal_nonacceptance") return;
    const accepted = receipt.outcome === "accepted";
    const duplicate = receipt.outcome === "duplicate_of_accepted";
    if (
      (!accepted && !duplicate)
      || !receipt.accepted_receipt_id
      || !receipt.target_id
      || !receipt.result_revision
      || !receipt.result_digest
    ) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_inverse_nonacceptance");
    }
    if (receipt.accepted_receipt_id !== request.accepted_receipt?.receipt_id) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_inverse_receipt_mismatch");
    }
    if (duplicate && !receipt.duplicate_of_receipt_id) {
      throw new ProjectRegistrationStepError(request.step_id, "authority_inverse_duplicate_missing_link");
    }
  }
}

function validateAuthorityLookup(
  lookup: ProjectRegistrationAuthorityLookupResult,
  request: ProjectRegistrationAuthorityLookupRequest,
): void {
  const control = lookup.response_control;
  if (
    control.response_byte_limit !== request.response_byte_limit
    || control.time_budget_ms !== request.time_budget_ms
    || control.response_bytes < 0
    || control.response_bytes > request.response_byte_limit
    || control.elapsed_ms < 0
    || control.elapsed_ms > request.time_budget_ms
    || !control.complete
    || control.truncated
  ) {
    throw new ProjectRegistrationStepError(request.step_id, "authority_receipt_lookup_incomplete");
  }
}

async function resolveAuthorityMutation(input: {
  adapter: ProjectRegistrationAuthorityAdapter;
  capability: ProjectRegistrationAuthorityCapability;
  request: ProjectRegistrationAuthorityRequest;
  mutate: () => Promise<ProjectRegistrationAuthorityReceipt>;
}): Promise<ProjectRegistrationAuthorityReceipt> {
  let directReceipt: ProjectRegistrationAuthorityReceipt | null = null;
  try {
    directReceipt = await input.mutate();
  } catch {
    // A transport failure can happen after the authority commits. The exact,
    // bounded immutable terminal lookup is the only admissible resolution.
  }

  const lookupRequest: ProjectRegistrationAuthorityLookupRequest = {
    operation_id: input.request.operation_id,
    step_id: input.request.step_id,
    resource_kind: input.request.resource_kind,
    direction: input.request.direction,
    authority: input.capability.authority,
    authority_route: input.capability.route,
    package_version: input.capability.package_version,
    authority_id: input.capability.authority_id,
    tenant_id: input.capability.tenant_id,
    corpus_id: input.capability.corpus_id,
    target_selector: input.request.target_selector,
    idempotency_key: input.request.idempotency_key,
    request_digest: input.request.request_digest,
    precondition_digest: input.request.precondition_digest,
    target_id: directReceipt?.target_id ?? undefined,
    max_items: 1,
    response_byte_limit: input.request.response_byte_limit,
    time_budget_ms: input.request.time_budget_ms,
  };
  let lookup: ProjectRegistrationAuthorityLookupResult;
  try {
    lookup = await input.adapter.lookupReceipt(lookupRequest);
    validateAuthorityLookup(lookup, lookupRequest);
    validateAuthorityReceipt(lookup.receipt, input.request, input.capability);
  } catch (err) {
    throw new ProjectRegistrationStepError(
      input.request.step_id,
      "authority_terminal_outcome_unresolved",
      true,
    );
  }
  return lookup.receipt;
}

function appendAuthorityTerminalReceipt(input: {
  adapter: ProjectRegistrationAuthorityAdapter;
  request: ProjectRegistrationAuthorityRequest;
  receipt: ProjectRegistrationAuthorityReceipt;
  db: Database;
}): ProjectRegistrationReceipt {
  const accepted = input.receipt.outcome === "accepted";
  const duplicate = input.receipt.outcome === "duplicate_of_accepted";
  return appendRegistrationReceipt({
    operation_id: input.request.operation_id,
    step_id: input.request.step_id,
    authority: input.adapter.authority,
    resource_kind: input.request.resource_kind,
    direction: input.request.direction,
    idempotency_key: input.request.idempotency_key,
    target_id: input.receipt.target_id,
    request_digest: input.request.request_digest,
    precondition_digest: input.request.precondition_digest,
    outcome: input.receipt.outcome,
    reason: input.receipt.reason,
    result_revision: input.receipt.result_revision,
    result_digest: input.receipt.result_digest,
    duplicate_of_receipt_id: input.receipt.duplicate_of_receipt_id,
    authority_receipt: input.receipt,
    artifacts: accepted || duplicate
      ? [{
          authority: input.adapter.authority,
          resource_kind: input.request.resource_kind,
          target_id: input.receipt.target_id,
          revision: input.receipt.result_revision,
          digest: input.receipt.result_digest,
        }]
      : [],
    preconditions: [{
      predicate: input.request.direction === "forward"
        ? "expected_absent"
        : "accepted_receipt_scoped_inverse",
      digest: input.request.precondition_digest,
      authority_route: input.receipt.route,
      authority_id: input.receipt.authority_id,
      tenant_id: input.receipt.tenant_id,
      corpus_id: input.receipt.corpus_id,
      accepted_receipt_id: input.request.accepted_receipt?.receipt_id ?? null,
    }],
    rollback: input.request.direction === "forward" && (accepted || duplicate)
      ? [{
          action: "conditional_inverse",
          accepted_receipt_id: accepted
            ? input.receipt.receipt_id
            : input.receipt.duplicate_of_receipt_id,
          target_id: input.receipt.target_id,
          expected_revision: input.receipt.result_revision,
          expected_digest: input.receipt.result_digest,
        }]
      : [],
  }, input.db);
}

function appendAdoptedAuthorityReceipt(input: {
  adapter: ProjectRegistrationAuthorityAdapter;
  request: ProjectRegistrationAuthorityRequest;
  authority_receipt: ProjectRegistrationAuthorityReceipt;
  adoption: ExistingAuthorityAdoption;
  db: Database;
}): ProjectRegistrationReceipt {
  return appendRegistrationReceipt({
    operation_id: input.request.operation_id,
    step_id: input.request.step_id,
    authority: input.adapter.authority,
    resource_kind: input.request.resource_kind,
    direction: input.request.direction,
    idempotency_key: input.request.idempotency_key,
    target_id: input.authority_receipt.target_id,
    request_digest: input.request.request_digest,
    precondition_digest: input.request.precondition_digest,
    outcome: "accepted",
    reason: "adopted_preexisting",
    result_revision: input.authority_receipt.result_revision,
    result_digest: input.authority_receipt.result_digest,
    authority_receipt: input.authority_receipt,
    artifacts: [{
      authority: input.adapter.authority,
      resource_kind: input.request.resource_kind,
      target_id: input.authority_receipt.target_id,
      revision: input.authority_receipt.result_revision,
      digest: input.authority_receipt.result_digest,
      adopted: true,
      created_by_operation: false,
    }],
    preconditions: [{
      predicate: "explicit_project_integration",
      integration_key: input.adoption.integration_key,
      integration_value_digest: sha256(input.adoption.integration_value),
      expected_target_id: input.adoption.expected_target_id ?? null,
      authority_receipt_id: input.authority_receipt.receipt_id,
      exact_readback: true,
    }],
    rollback: [],
  }, input.db);
}

function appendAuthorityReadbackReceipt(input: {
  adapter: ProjectRegistrationAuthorityAdapter;
  request: ProjectRegistrationAuthorityRequest;
  authority_receipt: ProjectRegistrationAuthorityReceipt;
  record: ProjectRegistrationAuthorityRecord | ProjectRegistrationAuthorityInverseVerification;
  db: Database;
}): ProjectRegistrationReceipt {
  const stepId = `${input.request.step_id}:readback`;
  const requestDigest = sha256(canonicalJson({
    authority_receipt_id: input.authority_receipt.receipt_id,
    target_id: input.authority_receipt.target_id,
  }));
  const preconditionDigest = sha256(canonicalJson({
    expected_revision: input.authority_receipt.result_revision,
    expected_digest: input.authority_receipt.result_digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.request.operation_id,
    step_id: stepId,
    direction: input.request.direction,
    target_selector: input.request.target_selector,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  return appendRegistrationReceipt({
    operation_id: input.request.operation_id,
    step_id: stepId,
    authority: input.adapter.authority,
    resource_kind: `${input.request.resource_kind}_readback`,
    direction: input.request.direction,
    idempotency_key: idempotencyKey,
    target_id: input.authority_receipt.target_id,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    outcome: "accepted",
    result_revision: input.authority_receipt.result_revision,
    result_digest: input.authority_receipt.result_digest,
    artifacts: [{
      authority: input.adapter.authority,
      resource_kind: input.request.resource_kind,
      target_id: input.authority_receipt.target_id,
      exact_readback: true,
      inverse_absence: input.request.direction === "inverse",
    }],
    preconditions: [{
      authority_receipt_id: input.authority_receipt.receipt_id,
      record_digest: sha256(canonicalJson(input.record)),
      exact_full_id: true,
    }],
    rollback: [],
  }, input.db);
}

async function executeExternalStep(input: {
  adapter: ProjectRegistrationAuthorityAdapter;
  capability: ProjectRegistrationAuthorityCapability;
  operation_id: string;
  step_id: string;
  resource_kind: ProjectRegistrationResourceKind;
  target_selector: string;
  desired: JsonObject;
  project: Workspace;
  target: ProjectRegistrationPathHandle;
  bounds: ProjectRegistrationBounds;
  db: Database;
  accepted_steps: AcceptedExternalStep[];
  adopt_existing?: ExistingAuthorityAdoption;
}): Promise<AcceptedExternalStep> {
  const requestDigest = sha256(canonicalJson(input.desired));
  const preconditionDigest = sha256(canonicalJson({
    target_selector: input.target_selector,
    expected: "absent",
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "forward",
    target_selector: input.target_selector,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  const request: ProjectRegistrationAuthorityRequest = {
    operation_id: input.operation_id,
    step_id: input.step_id,
    resource_kind: input.resource_kind,
    direction: "forward",
    authority_route: input.capability.route,
    package_version: input.capability.package_version,
    authority_id: input.capability.authority_id,
    tenant_id: input.capability.tenant_id,
    corpus_id: input.capability.corpus_id,
    target_selector: input.target_selector,
    idempotency_key: idempotencyKey,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: input.project.id,
    project_slug: input.project.slug,
    project_name: input.project.name,
    desired: input.desired,
    target: input.target,
    ...input.bounds,
  };
  const receipt = await resolveAuthorityMutation({
    adapter: input.adapter,
    capability: input.capability,
    request,
    mutate: () => input.adapter.create(request),
  });
  if (receipt.outcome === "terminal_nonacceptance") {
    const adoption = input.adopt_existing;
    const adoptionReason = receipt.reason === "preexisting_equivalent"
      || receipt.reason === "preexisting_conflict";
    const targetMatches = adoption?.expected_target_id === undefined
      || adoption.expected_target_id === receipt.target_id;
    const authorityAdoptionValidated = receipt.reason === "preexisting_equivalent"
      || adoption?.expected_target_id !== undefined
      || await input.adapter.validateExistingAdoption?.(request, receipt) === true;
    if (
      adoption
      && adoptionReason
      && targetMatches
      && authorityAdoptionValidated
      && receipt.created_by_operation === false
      && receipt.target_id
      && receipt.result_revision
      && receipt.result_digest
    ) {
      const record = await input.adapter.readExact({
        resource_kind: input.resource_kind,
        target_id: receipt.target_id,
        target: input.target,
        ...input.bounds,
      });
      if (
        record.target_id !== receipt.target_id
        || record.revision !== receipt.result_revision
        || record.digest !== receipt.result_digest
      ) {
        throw new ProjectRegistrationStepError(input.step_id, "authority_exact_readback_mismatch");
      }
      const accepted: AcceptedExternalStep = {
        adapter: input.adapter,
        capability: input.capability,
        receipt,
        request,
        local_receipt: appendAdoptedAuthorityReceipt({
          adapter: input.adapter,
          request,
          authority_receipt: receipt,
          adoption,
          db: input.db,
        }),
      };
      input.accepted_steps.push(accepted);
      appendAuthorityReadbackReceipt({
        adapter: input.adapter,
        request,
        authority_receipt: receipt,
        record,
        db: input.db,
      });
      return accepted;
    }
    appendAuthorityTerminalReceipt({
      adapter: input.adapter,
      request,
      receipt,
      db: input.db,
    });
    throw new ProjectRegistrationStepError(
      input.step_id,
      receipt.reason ?? "authority_nonacceptance",
    );
  }
  const accepted: AcceptedExternalStep = {
    adapter: input.adapter,
    capability: input.capability,
    receipt,
    request,
    local_receipt: null,
  };
  input.accepted_steps.push(accepted);
  accepted.local_receipt = appendAuthorityTerminalReceipt({
    adapter: input.adapter,
    request,
    receipt,
    db: input.db,
  });
  const record = await input.adapter.readExact({
    resource_kind: input.resource_kind,
    target_id: receipt.target_id!,
    target: input.target,
    ...input.bounds,
  });
  if (
    record.target_id !== receipt.target_id
    || record.revision !== receipt.result_revision
    || record.digest !== receipt.result_digest
  ) {
    throw new ProjectRegistrationStepError(input.step_id, "authority_exact_readback_mismatch");
  }
  appendAuthorityReadbackReceipt({
    adapter: input.adapter,
    request,
    authority_receipt: receipt,
    record,
    db: input.db,
  });
  return accepted;
}

async function compensateExternalStep(
  accepted: AcceptedExternalStep,
  bounds: ProjectRegistrationBounds,
  db: Database,
): Promise<ProjectRegistrationReceipt | null> {
  if (!accepted.receipt.created_by_operation || accepted.receipt.outcome !== "accepted") return null;
  const desired = {
    accepted_receipt_id: accepted.receipt.receipt_id,
    target_id: accepted.receipt.target_id,
  };
  const requestDigest = sha256(canonicalJson(desired));
  const preconditionDigest = sha256(canonicalJson({
    expected_revision: accepted.receipt.result_revision,
    expected_digest: accepted.receipt.result_digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: accepted.request.operation_id,
    step_id: accepted.request.step_id,
    direction: "inverse",
    target_selector: accepted.receipt.target_id!,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  const request: ProjectRegistrationAuthorityRequest = {
    ...accepted.request,
    direction: "inverse",
    target_selector: accepted.receipt.target_id!,
    idempotency_key: idempotencyKey,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    accepted_receipt: accepted.receipt,
    desired,
    ...bounds,
  };
  const inverse = await resolveAuthorityMutation({
    adapter: accepted.adapter,
    capability: accepted.capability,
    request,
    mutate: () => accepted.adapter.compensate(request),
  });
  const localReceipt = appendAuthorityTerminalReceipt({
    adapter: accepted.adapter,
    request,
    receipt: inverse,
    db,
  });
  if (inverse.outcome === "terminal_nonacceptance") {
    throw new ProjectRegistrationStepError(
      request.step_id,
      inverse.reason ?? "authority_inverse_nonacceptance",
    );
  }
  const verification = await accepted.adapter.verifyInverse(request);
  if (
    verification.target_id !== accepted.receipt.target_id
    || verification.accepted_receipt_id !== accepted.receipt.receipt_id
    || verification.absent !== true
    || verification.digest !== inverse.result_digest
  ) {
    throw new ProjectRegistrationStepError(request.step_id, "authority_inverse_readback_mismatch", true);
  }
  appendAuthorityReadbackReceipt({
    adapter: accepted.adapter,
    request,
    authority_receipt: inverse,
    record: verification,
    db,
  });
  return localReceipt;
}

function atomicWriteOwnedFile(
  input: {
    operation_id: string;
    step_id: string;
    filename: string;
    content: string;
    project: Workspace;
    target: ProjectRegistrationPathHandle;
  },
  db: Database,
): AcceptedFileStep {
  const contentDigest = sha256(input.content);
  const requestDigest = sha256(canonicalJson({
    filename: input.filename,
    content_digest: contentDigest,
  }));
  const preconditionDigest = sha256(canonicalJson({
    filename: input.filename,
    expected: "absent",
    project_id: input.project.id,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "forward",
    target_selector: `${input.project.id}:${input.filename}`,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  return input.target.withOwnedPath((path) => {
    const file = join(path, input.filename);
    let fd: number | null = null;
    let ownedFile: { dev: number; ino: number } | null = null;
    try {
      fd = openSync(file, "wx", 0o600);
      const stat = fstatSync(fd);
      ownedFile = { dev: stat.dev, ino: stat.ino };
      writeFileSync(fd, input.content, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      const readback = readFileSync(file, "utf8");
      if (sha256(readback) !== contentDigest) {
        throw new ProjectRegistrationStepError(input.step_id, "file_exact_readback_mismatch");
      }
      const receipt = appendRegistrationReceipt({
        operation_id: input.operation_id,
        step_id: input.step_id,
        authority: "projects-files",
        resource_kind: "file",
        direction: "forward",
        idempotency_key: idempotencyKey,
        target_id: `${input.project.id}:${input.filename}`,
        request_digest: requestDigest,
        precondition_digest: preconditionDigest,
        outcome: "accepted",
        result_revision: contentDigest,
        result_digest: contentDigest,
        artifacts: [{
          authority: "projects-files",
          kind: input.filename === PROJECT_MARKER_FILENAME ? "project_marker" : "project_goals",
          target_id: `${input.project.id}:${input.filename}`,
          digest: contentDigest,
        }],
        preconditions: [{
          predicate: "expected_absent",
          project_id: input.project.id,
          filename: input.filename,
        }],
        rollback: [{
          action: "unlink_if_digest_matches",
          project_id: input.project.id,
          filename: input.filename,
          expected_digest: contentDigest,
        }],
      }, db);
      return { filename: input.filename, digest: contentDigest, local_receipt: receipt, created_by_operation: true };
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // The original write error remains authoritative.
        }
      }
      if (ownedFile && existsSync(file)) {
        try {
          const current = lstatSync(file);
          if (current.dev === ownedFile.dev && current.ino === ownedFile.ino) unlinkSync(file);
        } catch {
          // If ownership cannot be re-proven, leave the file for reconciliation.
        }
      }
      throw err;
    }
  });
}

function writeOrAdoptOwnedFile(
  input: {
    operation_id: string;
    step_id: string;
    filename: string;
    content: string;
    project: Workspace;
    target: ProjectRegistrationPathHandle;
    compatible_existing?: (existing: string, desired: string) => boolean;
  },
  db: Database,
): AcceptedFileStep {
  const desiredContentDigest = sha256(input.content);
  const exists = input.target.withOwnedPath((path) => existsSync(join(path, input.filename)));
  if (!exists) return atomicWriteOwnedFile(input, db);
  const adopted = input.target.withOwnedPath((path) => {
    const file = join(path, input.filename);
    const stat = lstatSync(file);
    if (!stat.isFile()) return null;
    const existing = readFileSync(file, "utf8");
    const exact = sha256(existing) === desiredContentDigest;
    return exact || input.compatible_existing?.(existing, input.content)
      ? { content: existing, digest: sha256(existing), exact }
      : null;
  });
  if (!adopted) {
    throw new ProjectRegistrationStepError(input.step_id, "retrofit_existing_file_conflict");
  }
  const requestDigest = sha256(canonicalJson({
    filename: input.filename,
    desired_content_digest: desiredContentDigest,
    compatibility: input.compatible_existing ? "registered_compatibility_predicate" : "byte_exact",
  }));
  const preconditionDigest = sha256(canonicalJson({
    filename: input.filename,
    expected: adopted.exact ? "exact_existing_content" : "compatible_existing_content",
    project_id: input.project.id,
    desired_content_digest: desiredContentDigest,
    accepted_content_digest: adopted.digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "forward",
    target_selector: `${input.project.id}:${input.filename}`,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  const receipt = appendRegistrationReceipt({
    operation_id: input.operation_id,
    step_id: input.step_id,
    authority: "projects-files",
    resource_kind: "file",
    direction: "forward",
    idempotency_key: idempotencyKey,
    target_id: `${input.project.id}:${input.filename}`,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    outcome: "accepted",
    result_revision: adopted.digest,
    result_digest: adopted.digest,
    artifacts: [{
      authority: "projects-files",
      kind: input.filename === PROJECT_MARKER_FILENAME ? "project_marker" : "project_goals",
      target_id: `${input.project.id}:${input.filename}`,
      digest: adopted.digest,
      adopted: true,
    }],
    preconditions: [{
      predicate: adopted.exact ? "exact_existing_content" : "compatible_existing_content",
      project_id: input.project.id,
      filename: input.filename,
      desired_digest: desiredContentDigest,
      accepted_digest: adopted.digest,
    }],
    rollback: [],
  }, db);
  return { filename: input.filename, digest: adopted.digest, local_receipt: receipt, created_by_operation: false };
}

function compatibleWorkspaceMarkerContent(existing: string, desired: string): boolean {
  try {
    const existingMarker = JSON.parse(existing) as Record<string, unknown>;
    const desiredMarker = JSON.parse(desired) as Record<string, unknown>;
    if (typeof existingMarker.generated_at !== "string" || typeof desiredMarker.generated_at !== "string") {
      return false;
    }
    const { generated_at: _existingGeneratedAt, ...existingStable } = existingMarker;
    const { generated_at: _desiredGeneratedAt, ...desiredStable } = desiredMarker;
    return canonicalJson(existingStable) === canonicalJson(desiredStable);
  } catch {
    return false;
  }
}

function compensateOwnedFile(
  input: {
    operation_id: string;
    accepted: AcceptedFileStep;
    project_id: string;
    target: ProjectRegistrationPathHandle;
  },
  db: Database,
): ProjectRegistrationReceipt {
  const requestDigest = sha256(canonicalJson({
    accepted_receipt_id: input.accepted.local_receipt.receipt_id,
    filename: input.accepted.filename,
  }));
  const preconditionDigest = sha256(canonicalJson({
    expected_digest: input.accepted.digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.accepted.local_receipt.step_id,
    direction: "inverse",
    target_selector: `${input.project_id}:${input.accepted.filename}`,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  input.target.withOwnedPath((path) => {
    const file = join(path, input.accepted.filename);
    if (!existsSync(file)) return;
    const currentDigest = sha256(readFileSync(file, "utf8"));
    if (currentDigest !== input.accepted.digest) {
      throw new ProjectRegistrationStepError(input.accepted.local_receipt.step_id, "file_drift_refuses_inverse");
    }
    unlinkSync(file);
  });
  return appendRegistrationReceipt({
    operation_id: input.operation_id,
    step_id: input.accepted.local_receipt.step_id,
    authority: "projects-files",
    resource_kind: "file",
    direction: "inverse",
    idempotency_key: idempotencyKey,
    target_id: `${input.project_id}:${input.accepted.filename}`,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    outcome: "accepted",
    result_revision: input.accepted.digest,
    result_digest: input.accepted.digest,
    artifacts: [{
      authority: "projects-files",
      target_id: `${input.project_id}:${input.accepted.filename}`,
      removed: true,
    }],
    preconditions: [{
      accepted_receipt_id: input.accepted.local_receipt.receipt_id,
      expected_digest: input.accepted.digest,
    }],
    rollback: [],
  }, db);
}

function captureOwnedDirectoryIdentity(target: ProjectRegistrationPathHandle): OwnedDirectoryIdentity {
  return target.withOwnedPath((path) => {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) {
      throw new ProjectRegistrationStepError("projects_directory", "created_target_is_not_directory");
    }
    return { dev: String(stat.dev), ino: String(stat.ino) };
  });
}

function assertOwnedDirectorySafeToRemove(
  target: ProjectRegistrationPathHandle,
  owned: OwnedDirectoryIdentity,
): void {
  target.withOwnedPath((path) => {
    if (!existsSync(path)) return;
    const current = lstatSync(path);
    if (
      !current.isDirectory()
      || String(current.dev) !== owned.dev
      || String(current.ino) !== owned.ino
    ) {
      throw new ProjectRegistrationStepError(
        "projects_directory",
        "directory_identity_drift_refuses_cleanup",
        true,
      );
    }
    if (readdirSync(path).length > 0) {
      throw new ProjectRegistrationStepError(
        "projects_directory",
        "directory_content_drift_refuses_cleanup",
        true,
      );
    }
  });
}

function appendLocalAbsenceReceipt(input: {
  operation_id: string;
  step_id: string;
  authority: string;
  resource_kind: string;
  target_id: string;
  accepted_receipt: ProjectRegistrationReceipt;
  absence_digest: string;
  artifacts: JsonObject[];
  db: Database;
}): ProjectRegistrationReceipt {
  const requestDigest = sha256(canonicalJson({
    accepted_receipt_id: input.accepted_receipt.receipt_id,
    target_id: input.target_id,
    desired: "absent",
  }));
  const preconditionDigest = sha256(canonicalJson({
    accepted_receipt_id: input.accepted_receipt.receipt_id,
    expected_revision: input.accepted_receipt.result_revision,
    expected_digest: input.accepted_receipt.result_digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "inverse",
    target_selector: input.target_id,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  return appendRegistrationReceipt({
    operation_id: input.operation_id,
    step_id: input.step_id,
    authority: input.authority,
    resource_kind: input.resource_kind,
    direction: "inverse",
    idempotency_key: idempotencyKey,
    target_id: input.target_id,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    outcome: "accepted",
    result_revision: "absent",
    result_digest: input.absence_digest,
    artifacts: input.artifacts,
    preconditions: [{
      accepted_receipt_id: input.accepted_receipt.receipt_id,
      expected_revision: input.accepted_receipt.result_revision,
      expected_digest: input.accepted_receipt.result_digest,
      exact_absence_readback: true,
    }],
    rollback: [],
  }, input.db);
}

function registrationResourceLink(input: {
  capability: ProjectRegistrationAuthorityCapability;
  receipt: ProjectRegistrationAuthorityReceipt;
  target_kind: ProjectResourceLinkInput["target_kind"];
  scope: ProjectResourceLinkInput["scope"];
  labels?: ProjectResourceLinkInput["labels"];
}): ProjectResourceLinkInput {
  const targetId = input.receipt.target_id;
  if (!targetId) {
    throw new ProjectRegistrationStepError(input.receipt.step_id, "authority_receipt_missing_target");
  }
  const authority = input.capability.authority;
  const serviceInstance = [
    "urn:hasna",
    authority,
    "service",
    encodeURIComponent(input.capability.authority_id),
    "tenant",
    encodeURIComponent(input.capability.tenant_id),
    "corpus",
    encodeURIComponent(input.capability.corpus_id),
  ].join(":");
  if (authority === "conversations") {
    if (input.target_kind !== "channel") {
      throw new ProjectRegistrationStepError(input.receipt.step_id, "authority_target_kind_mismatch");
    }
    const locatorKind = projectResourceLinkConversationsChannelLocatorKind(targetId);
    if (!locatorKind) {
      throw new ProjectRegistrationStepError(input.receipt.step_id, "channel_immutable_uuid_missing");
    }
    return {
      authority,
      service_instance: serviceInstance,
      source_package: "@hasna/conversations",
      target_kind: "channel",
      locator: { kind: locatorKind, value: targetId },
      scope: input.scope,
      labels: input.labels,
    };
  }
  if (authority === "todos") {
    if (input.target_kind !== "project" && input.target_kind !== "task_list") {
      throw new ProjectRegistrationStepError(input.receipt.step_id, "authority_target_kind_mismatch");
    }
    return {
      authority,
      service_instance: serviceInstance,
      source_package: "@hasna/todos",
      target_kind: input.target_kind,
      locator: {
        kind: "canonical_uri",
        value: `urn:hasna:${authority}:${input.target_kind}:${encodeURIComponent(targetId)}`,
      },
      scope: input.scope,
      labels: input.labels,
    };
  }
  if (input.target_kind !== "project") {
    throw new ProjectRegistrationStepError(input.receipt.step_id, "authority_target_kind_mismatch");
  }
  return {
    authority: "mementos",
    service_instance: serviceInstance,
    source_package: "@hasna/mementos",
    target_kind: "project",
    locator: {
      kind: "canonical_uri",
      value: `urn:hasna:mementos:project:${encodeURIComponent(targetId)}`,
    },
    scope: input.scope,
    labels: input.labels,
  };
}

async function updateProjectIntegrations(input: {
  operation_id: string;
  project: Workspace;
  integrations: WorkspaceIntegrations;
  resource_links: ProjectResourceLinkInput[];
  bounds: ProjectRegistrationBounds;
  db: Database;
  store?: ProjectStore;
}): Promise<{ project: Workspace; receipt: ProjectRegistrationReceipt }> {
  const before = input.store
    ? await input.store.readProjectResourceLinks({
      project_id: input.project.id,
      max_items: PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
    })
    : readProjectResourceLinks({
      project_id: input.project.id,
      max_items: PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
    }, input.db);
  if (
    !before.ok
    || !before.complete
    || before.truncated
    || before.current_revision !== input.project.updated_at
  ) {
    throw new ProjectRegistrationStepError(
      "projects_integrations",
      "resource_link_exact_preimage_mismatch",
    );
  }
  const isRegistrationOwnedLink = (link: ProjectResourceLinkInput): boolean =>
    (link.authority === "conversations" && link.target_kind === "channel")
    || (link.authority === "todos" && (link.target_kind === "project" || link.target_kind === "task_list"))
    || (link.authority === "mementos" && link.target_kind === "project");
  const storedInput = (link: ProjectResourceLink): ProjectResourceLinkInput => ({
    authority: link.authority,
    service_instance: link.service_instance,
    source_package: link.source_package,
    target_kind: link.target_kind,
    locator: link.locator,
    scope: link.scope,
    labels: link.labels,
  } as ProjectResourceLinkInput);
  const linksById = new Map<string, ProjectResourceLinkInput>();
  for (const link of before.links) {
    const existing = storedInput(link);
    if (!isRegistrationOwnedLink(existing)) {
      linksById.set(projectResourceLinkId(input.project.id, existing), existing);
    }
  }
  for (const link of input.resource_links) {
    linksById.set(projectResourceLinkId(input.project.id, link), link);
  }
  const resourceLinks = [...linksById.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, link]) => link);
  const integrations: WorkspaceIntegrations = {
    ...before.project.integrations,
    ...input.integrations,
  };
  const requestDigest = sha256(canonicalJson({
    integrations,
    resource_links: resourceLinks,
  }));
  const preconditionDigest = sha256(canonicalJson({
    project_id: input.project.id,
    expected_revision: input.project.updated_at,
    expected_integrations_digest: sha256(canonicalJson(before.project.integrations)),
    expected_resource_link_collection_digest: before.collection_digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: "projects_integrations",
    direction: "forward",
    target_selector: input.project.id,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  const mutate = async () => input.store
    ? input.store.mutateProjectResourceLinks({
      project_id: input.project.id,
      operation_id: input.operation_id,
      step_id: "projects_resource_links",
      mode: "reconcile",
      expected_revision: input.project.updated_at,
      links: resourceLinks,
      integrations,
      max_items: PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
      source: "system",
      command: PROJECT_REGISTRATION_ROUTE,
    })
    : mutateProjectResourceLinksForRegistration({
      project_id: input.project.id,
      operation_id: input.operation_id,
      step_id: "projects_resource_links",
      mode: "reconcile",
      expected_revision: input.project.updated_at,
      links: resourceLinks,
      integrations,
      max_items: PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
      source: "system",
      command: PROJECT_REGISTRATION_ROUTE,
    }, integrations, input.db);
  const run = async () => {
    const linked = await mutate();
    if (!linked.ok || !linked.after || !linked.receipt || linked.receipt.outcome === "terminal_nonacceptance") {
      throw new ProjectRegistrationStepError(
        "projects_integrations",
        linked.receipt?.reason ?? "resource_link_reconcile_refused",
      );
    }
    const after = linked.after.project;
    if (canonicalJson(after.integrations) !== canonicalJson(integrations)) {
      throw new ProjectRegistrationStepError("projects_integrations", "integration_exact_readback_mismatch");
    }
    const expectedLinks = normalizeProjectResourceLinks(resourceLinks).map((link) => ({
      id: projectResourceLinkId(input.project.id, link),
      input: link,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const actualLinks = linked.after.links.map((link) => ({
      id: link.id,
      input: storedInput(link),
    })).sort((left, right) => left.id.localeCompare(right.id));
    if (canonicalJson(actualLinks) !== canonicalJson(expectedLinks)) {
      throw new ProjectRegistrationStepError("projects_integrations", "resource_link_exact_readback_mismatch");
    }
    const resultDigest = sha256(canonicalJson({
      project_id: after.id,
      revision: after.updated_at,
      integrations: after.integrations,
      resource_link_collection_digest: linked.after.collection_digest,
    }));
    const receipt = appendRegistrationReceipt({
      operation_id: input.operation_id,
      step_id: "projects_integrations",
      authority: "projects",
      resource_kind: "integrations",
      direction: "forward",
      idempotency_key: idempotencyKey,
      target_id: after.id,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      outcome: "accepted",
      result_revision: after.updated_at,
      result_digest: resultDigest,
      artifacts: [
        ...Object.entries(after.integrations).map(([key, targetId]) => ({
          authority: "projects",
          integration_key: key,
          target_id: targetId,
        })),
        ...linked.after.links.map((link) => ({
          authority: link.authority,
          source_package: link.source_package,
          target_kind: link.target_kind,
          target_id: link.locator.value,
          resource_link_id: link.id,
          scope: link.scope,
        })),
      ],
      preconditions: [{
        predicate: "exact_project_revision",
        project_id: input.project.id,
        expected_revision: input.project.updated_at,
      }],
      rollback: [{
        action: "restore_resource_links_and_integrations_from_guarded_receipt",
        project_id: input.project.id,
        accepted_revision: after.updated_at,
        accepted_digest: resultDigest,
        guarded_receipt_id: linked.receipt.receipt_id,
        resource_link_collection_digest: linked.after.collection_digest,
      }],
    }, input.db);
    return { project: after, receipt };
  };
  return run();
}

async function rollbackProjectIntegrations(input: {
  operation_id: string;
  accepted: ProjectRegistrationReceipt;
  bounds: ProjectRegistrationBounds;
  db: Database;
  store?: ProjectStore;
}): Promise<{ project: Workspace; receipt: ProjectRegistrationReceipt }> {
  const rollback = input.accepted.rollback[0] as {
    accepted_revision?: string;
    accepted_digest?: string;
    project_id?: string;
    guarded_receipt_id?: string;
    resource_link_collection_digest?: string;
  } | undefined;
  if (
    !rollback?.project_id
    || !rollback.accepted_revision
    || !rollback.accepted_digest
    || !rollback.guarded_receipt_id
    || !rollback.resource_link_collection_digest
  ) {
    throw new ProjectRegistrationStepError("projects_integrations", "integration_rollback_contract_missing");
  }
  const guardedReceiptId = rollback.guarded_receipt_id;
  const current = await readRegistrationProject(rollback.project_id, input.db, input.store);
  if (!current || current.updated_at !== rollback.accepted_revision) {
    throw new ProjectRegistrationStepError("projects_integrations", "integration_drift_refuses_inverse");
  }
  const currentLinks = input.store
    ? await input.store.readProjectResourceLinks({
      project_id: current.id,
      max_items: PROJECT_REGISTRATION_MAX_RECEIPTS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
    })
    : readProjectResourceLinks({
    project_id: current.id,
    max_items: PROJECT_REGISTRATION_MAX_RECEIPTS,
    response_byte_limit: input.bounds.response_byte_limit,
    time_budget_ms: input.bounds.time_budget_ms,
    }, input.db);
  const currentDigest = sha256(canonicalJson({
    project_id: current.id,
    revision: current.updated_at,
    integrations: current.integrations,
    resource_link_collection_digest: currentLinks.collection_digest,
  }));
  if (currentDigest !== rollback.accepted_digest) {
    throw new ProjectRegistrationStepError("projects_integrations", "integration_digest_refuses_inverse");
  }
  const requestDigest = sha256(canonicalJson({
    guarded_receipt_id: rollback.guarded_receipt_id,
    desired: "restore_before_snapshot",
  }));
  const preconditionDigest = sha256(canonicalJson({
    expected_revision: current.updated_at,
    expected_digest: rollback.accepted_digest,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: "projects_integrations",
    direction: "inverse",
    target_selector: current.id,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
  });
  const run = async () => {
    const restored = input.store
      ? await input.store.rollbackProjectResourceLinks({
        project_id: current.id,
        operation_id: input.operation_id,
        step_id: "projects_resource_links:inverse",
        accepted_receipt_id: guardedReceiptId,
        expected_current_revision: current.updated_at,
        max_items: PROJECT_REGISTRATION_MAX_RECEIPTS,
        response_byte_limit: input.bounds.response_byte_limit,
        time_budget_ms: input.bounds.time_budget_ms,
        source: "system",
        command: PROJECT_REGISTRATION_ROUTE,
      })
      : rollbackProjectResourceLinks({
      project_id: current.id,
      operation_id: input.operation_id,
      step_id: "projects_resource_links:inverse",
      accepted_receipt_id: guardedReceiptId,
      expected_current_revision: current.updated_at,
      max_items: PROJECT_REGISTRATION_MAX_RECEIPTS,
      response_byte_limit: input.bounds.response_byte_limit,
      time_budget_ms: input.bounds.time_budget_ms,
      source: "system",
      command: PROJECT_REGISTRATION_ROUTE,
      }, input.db);
    if (!restored.ok || !restored.after || !restored.receipt || restored.receipt.outcome === "terminal_nonacceptance") {
      throw new ProjectRegistrationStepError("projects_integrations", "integration_inverse_lost");
    }
    const after = restored.after.project;
    const receipt = appendRegistrationReceipt({
      operation_id: input.operation_id,
      step_id: "projects_integrations",
      authority: "projects",
      resource_kind: "integrations",
      direction: "inverse",
      idempotency_key: idempotencyKey,
      target_id: current.id,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      outcome: "accepted",
      result_revision: after.updated_at,
      result_digest: sha256(canonicalJson({
        project_id: after.id,
        revision: after.updated_at,
        integrations: after.integrations,
        resource_link_collection_digest: restored.after.collection_digest,
      })),
      artifacts: [{
        authority: "projects",
        target_id: current.id,
        integrations_restored: true,
        resource_links_restored: true,
        guarded_receipt_id: restored.receipt.receipt_id,
      }],
      preconditions: [{
        accepted_receipt_id: input.accepted.receipt_id,
        expected_revision: current.updated_at,
        expected_digest: rollback.accepted_digest,
      }],
      rollback: [],
    }, input.db);
    return { project: after, receipt };
  };
  return run();
}

function projectArtifacts(
  project: Workspace | null,
  external: AcceptedExternalStep[],
  files: AcceptedFileStep[],
  directoryReceipt: ProjectRegistrationReceipt | null,
): ProjectRegistrationArtifact[] {
  const artifacts: ProjectRegistrationArtifact[] = [];
  if (project) {
    artifacts.push({
      kind: "project",
      authority: "projects",
      target_id: project.id,
      revision: project.updated_at,
      digest: projectStateDigest(project),
    });
  }
  if (directoryReceipt) {
    artifacts.push({
      kind: "project_directory",
      authority: "projects-files",
      target_id: directoryReceipt.target_id!,
      revision: directoryReceipt.result_revision ?? undefined,
      digest: directoryReceipt.result_digest ?? undefined,
    });
  }
  for (const item of external) {
    artifacts.push({
      kind: item.request.resource_kind,
      authority: item.adapter.authority,
      target_id: item.receipt.target_id!,
      revision: item.receipt.result_revision!,
      digest: item.receipt.result_digest!,
    });
  }
  for (const item of files) {
    artifacts.push({
      kind: item.filename === PROJECT_MARKER_FILENAME ? "project_marker" : "project_goals",
      authority: "projects-files",
      target_id: item.local_receipt.target_id!,
      revision: item.digest,
      digest: item.digest,
    });
  }
  return artifacts;
}

function buildNoGoResult(input: {
  operation_id: string;
  project_id: string;
  project_slug: string;
  blockers: ProjectRegistrationCapabilityBlocker[];
  bounds: ProjectRegistrationBounds;
  startedAt: number;
  failed_step?: string;
  reason_code?: string;
}): FullProjectRegistrationResult {
  return controlledResult({
    ok: false,
    outcome: "no_go" as const,
    operation_id: input.operation_id,
    project_id: input.project_id,
    project_slug: input.project_slug,
    failed_step: input.failed_step ?? "authority_preflight",
    reason_code: input.reason_code ?? "missing_conditional_authority_contract",
    dependencies: input.blockers,
    artifacts: [],
    receipts: [],
    rollback: [],
  }, input.bounds, input.startedAt);
}

function completedRegistration(
  operationId: string,
  projectId: string,
  projectSlug: string,
  target: ProjectRegistrationPathHandle,
  bounds: ProjectRegistrationBounds,
  startedAt: number,
  db: Database,
  projectReadback?: Workspace | null,
): FullProjectRegistrationResult | null {
  const finalRows = db.query(
    `SELECT * FROM project_registration_receipts
     WHERE operation_id = ? AND step_id = 'registration_terminal'
       AND direction = 'forward' AND outcome = 'accepted'
     ORDER BY sequence ASC LIMIT 2`,
  ).all(operationId) as ProjectRegistrationReceiptRow[];
  if (finalRows.length === 0) return null;
  if (finalRows.length !== 1) {
    throw new ProjectRegistrationStepError("registration_terminal", "ambiguous_terminal_receipts");
  }
  const accepted = rowToReceipt(finalRows[0]!);
  const project = projectReadback === undefined ? getWorkspace(projectId, db) : projectReadback;
  if (!project || project.slug !== projectSlug) {
    throw new ProjectRegistrationStepError("registration_terminal", "completed_project_readback_missing");
  }
  const fileArtifacts = accepted.artifacts.filter((artifact) =>
    ["project_goals", "project_marker"].includes(String(artifact.kind ?? ""))
  );
  target.withOwnedPath((path) => {
    for (const artifact of fileArtifacts) {
      const targetId = String(artifact.target_id ?? "");
      const filename = targetId.split(":").at(-1);
      const digest = String(artifact.digest ?? "");
      if (!filename || !digest) {
        throw new ProjectRegistrationStepError("registration_terminal", "completed_file_receipt_incomplete");
      }
      const file = join(path, filename);
      if (!existsSync(file) || sha256(readFileSync(file, "utf8")) !== digest) {
        throw new ProjectRegistrationStepError("registration_terminal", "completed_file_readback_mismatch");
      }
    }
  });
  const duplicate = appendRegistrationReceipt({
    operation_id: operationId,
    step_id: "registration_terminal",
    authority: "projects",
    resource_kind: "registration",
    direction: "forward",
    idempotency_key: accepted.idempotency_key,
    target_id: projectId,
    request_digest: accepted.request_digest,
    precondition_digest: accepted.precondition_digest,
    outcome: "duplicate_of_accepted",
    result_revision: project.updated_at,
    result_digest: projectStateDigest(project),
    duplicate_of_receipt_id: accepted.receipt_id,
    artifacts: accepted.artifacts,
    preconditions: accepted.preconditions,
    rollback: accepted.rollback,
  }, db);
  return controlledResult({
    ok: true,
    outcome: "duplicate_of_accepted" as const,
    operation_id: operationId,
    project_id: projectId,
    project_slug: projectSlug,
    failed_step: null,
    reason_code: null,
    dependencies: [],
    artifacts: duplicate.artifacts as unknown as ProjectRegistrationArtifact[],
    receipts: listProjectRegistrationReceipts(operationId, db),
    rollback: [],
  }, bounds, startedAt);
}

function terminalReceipt(input: {
  operation_id: string;
  project_id: string;
  request_digest: string;
  outcome: ProjectRegistrationOutcome;
  reason?: string | null;
  project?: Workspace | null;
  artifacts: ProjectRegistrationArtifact[];
  rollback: JsonObject[];
  db: Database;
}): ProjectRegistrationReceipt {
  const preconditionDigest = sha256(canonicalJson({
    exact_project_id: input.project_id,
    artifact_count: input.artifacts.length,
  }));
  const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
    operation_id: input.operation_id,
    step_id: "registration_terminal",
    direction: "forward",
    target_selector: input.project_id,
    request_digest: input.request_digest,
    precondition_digest: preconditionDigest,
  });
  return appendRegistrationReceipt({
    operation_id: input.operation_id,
    step_id: "registration_terminal",
    authority: "projects",
    resource_kind: "registration",
    direction: "forward",
    idempotency_key: idempotencyKey,
    target_id: input.project_id,
    request_digest: input.request_digest,
    precondition_digest: preconditionDigest,
    outcome: input.outcome,
    reason: input.reason ?? null,
    result_revision: input.project?.updated_at ?? null,
    result_digest: input.project ? projectStateDigest(input.project) : null,
    artifacts: input.artifacts as unknown as JsonObject[],
    preconditions: [{
      exact_project_id: input.project_id,
      max_terminal_receipts: 1,
      bounded_lookup: true,
      exact_readback: true,
    }],
    rollback: input.rollback,
  }, input.db);
}

export async function registerFullProject(
  input: FullProjectRegistrationInput,
  options: {
    db?: Database;
    authorities?: ProjectRegistrationAuthorities;
    projectStore?: ProjectStore;
  } = {},
): Promise<FullProjectRegistrationResult> {
  const startedAt = Date.now();
  const authorities = options.authorities ?? unavailableProjectRegistrationAuthorities();
  const validated = validateInput(input);
  const bounds: ProjectRegistrationBounds = {
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  };
  // A local Store is only a facade over this same SQLite authority. Keep the
  // original transactional creation path in local mode; only the API Store is
  // a distinct Projects authority that must replace local project mutations.
  const authorityStore = options.projectStore?.mode === "api" ? options.projectStore : undefined;
  const capability = await preflightProjectRegistrationAuthorities(authorities);
  if (!capability.ok) {
    return buildNoGoResult({
      operation_id: input.operation_id,
      project_id: validated.project_id,
      project_slug: validated.project_slug,
      blockers: capability.blockers,
      bounds,
      startedAt,
    });
  }
  const capabilities = {
    todos: capability.capabilities.find((item) => item.authority === "todos")!,
    mementos: capability.capabilities.find((item) => item.authority === "mementos")!,
    conversations: capability.capabilities.find((item) => item.authority === "conversations")!,
  };
  // Keep the authority capability check ahead of opening the local Projects
  // ledger. A failed preflight must not create even an empty SQLite file.
  const db = options.db ?? getDatabase();
  let retrofitProject: Workspace | null = null;
  try {
    retrofitProject = await validateRetrofitProject(
      input,
      validated,
      db,
      authorityStore,
      true,
    );
  } catch (err) {
    const existingOperation = err instanceof ProjectRegistrationStepError
      && err.code === "retrofit_project_revision_mismatch"
      ? db.query(
        "SELECT 1 AS present FROM project_registration_manifests WHERE operation_id = ?",
      ).get(input.operation_id) as { present: number } | null
      : null;
    // A completed exact retry necessarily presents the revision from before
    // registration updated integrations. Let the immutable manifest and
    // terminal receipt prove that retry later; a new stale request still fails
    // before any manifest, external call, or filesystem mutation.
    if (existingOperation?.present === 1) {
      retrofitProject = await validateRetrofitProject(
        input,
        validated,
        db,
        authorityStore,
        false,
      );
    } else if (err instanceof ProjectRegistrationStepError) {
      return buildNoGoResult({
        operation_id: input.operation_id,
        project_id: validated.project_id,
        project_slug: validated.project_slug,
        blockers: [],
        bounds,
        startedAt,
        failed_step: err.stepId,
        reason_code: err.code,
      });
    } else {
      throw err;
    }
  }
  const immutablePlan = manifestPlan({
    project_id: validated.project_id,
    project_slug: validated.project_slug,
    project_kind: input.project.kind ?? "generic",
    target_path_digest: input.target.digest,
    capabilities: capability.capabilities,
  });
  const operationRequestDigest = sha256(canonicalJson({
    input_request_digest: validated.request_digest,
    immutable_plan: immutablePlan,
  }));

  let manifestCreated = false;
  try {
    const manifest = createOrReadManifest({
      operation_id: input.operation_id,
      request_digest: operationRequestDigest,
      project_id: validated.project_id,
      project_slug: validated.project_slug,
      plan: immutablePlan,
    }, db);
    manifestCreated = manifest.created;
  } catch (err) {
    if (err instanceof ProjectRegistrationStepError) {
      return buildNoGoResult({
        operation_id: input.operation_id,
        project_id: validated.project_id,
        project_slug: validated.project_slug,
        blockers: [],
        bounds,
        startedAt,
        failed_step: err.stepId,
        reason_code: err.code,
      });
    }
    throw err;
  }

  const completed = completedRegistration(
    input.operation_id,
    validated.project_id,
    validated.project_slug,
    input.target,
    bounds,
    startedAt,
    db,
    await readRegistrationProject(validated.project_id, db, authorityStore),
  );
  if (completed) return completed;
  if (retrofitProject) {
    try {
      retrofitProject = await validateRetrofitProject(
        input,
        validated,
        db,
        authorityStore,
        true,
      );
    } catch (err) {
      if (err instanceof ProjectRegistrationStepError) {
        return buildNoGoResult({
          operation_id: input.operation_id,
          project_id: validated.project_id,
          project_slug: validated.project_slug,
          blockers: [],
          bounds,
          startedAt,
          failed_step: err.stepId,
          reason_code: err.code,
        });
      }
      throw err;
    }
  }
  if (!manifestCreated && listProjectRegistrationReceipts(input.operation_id, db).length > 0) {
    return buildNoGoResult({
      operation_id: input.operation_id,
      project_id: validated.project_id,
      project_slug: validated.project_slug,
      blockers: [],
      bounds,
      startedAt,
      failed_step: "registration_manifest",
      reason_code: "incomplete_operation_requires_reconciliation",
    });
  }

  const projectInput: CreateWorkspaceInput = input.target.withOwnedPath((path) => ({
    id: validated.project_id,
    name: input.project.name,
    slug: validated.project_slug,
    require_exact_identity: true,
    description: input.project.description,
    kind: input.project.kind,
    root_id: input.project.root_id,
    recipe_id: input.project.recipe_id,
    primary_path: path,
    git_remote: input.project.git_remote,
    s3_bucket: input.project.s3_bucket,
    s3_prefix: input.project.s3_prefix,
    tags: input.project.tags,
    metadata: validated.project_metadata,
    agent_id: input.project.agent_id,
    source: input.project.source ?? "cli",
    prompt: input.project.prompt,
    command: input.project.command,
  }));
  const authorityProjectInput: CreateWorkspaceInput = authorityStore
    ? {
        ...projectInput,
        metadata: {
          ...(projectInput.metadata ?? {}),
          [PROJECT_REGISTRATION_PROVENANCE_KEY]: registrationProvenance(
            input.operation_id,
            validated.request_digest,
          ),
        },
      }
    : projectInput;
  let creationPlan: ReturnType<typeof planWorkspaceCreation> | null = null;
  try {
    if (!retrofitProject && !authorityStore) {
      creationPlan = planWorkspaceCreation({
        ...projectInput,
        createDirectory: true,
        requireAbsentDirectory: true,
        writeMarker: false,
      }, { db });
    }
  } catch {
    terminalReceipt({
      operation_id: input.operation_id,
      project_id: validated.project_id,
      request_digest: operationRequestDigest,
      outcome: "terminal_nonacceptance",
      reason: "creation_plan_rejected",
      project: null,
      artifacts: [],
      rollback: [],
      db,
    });
    return controlledResult({
      ok: false,
      outcome: "no_go" as const,
      operation_id: input.operation_id,
      project_id: validated.project_id,
      project_slug: validated.project_slug,
      failed_step: "projects_project",
      reason_code: "creation_plan_rejected",
      dependencies: [],
      artifacts: [],
      receipts: listProjectRegistrationReceipts(input.operation_id, db),
      rollback: [],
    }, bounds, startedAt);
  }

  const externalAccepted: AcceptedExternalStep[] = [];
  const fileAccepted: AcceptedFileStep[] = [];
  const rollback: JsonObject[] = [];
  let directoryReceipt: ProjectRegistrationReceipt | null = null;
  let directoryOwnership: OwnedDirectoryIdentity | null = null;
  let directoryCreatedByOperation = false;
  let integrationReceipt: ProjectRegistrationReceipt | null = null;
  let project: Workspace | null = null;
  let createdProject: Workspace | null = null;
  let expectedProjectStateDigest: string | null = null;
  let failedStep = "projects_project";
  let terminalCommitted = false;

  try {
    if (retrofitProject || authorityStore) {
      const adopting = retrofitProject !== null;
      if (retrofitProject) {
        project = retrofitProject;
      } else {
        const existingById = await authorityStore!.getProject(validated.project_id);
        const existingBySlug = await authorityStore!.getProject(validated.project_slug);
        const existing = existingById ?? existingBySlug;
        if (existing) {
          if (
            existing.id !== validated.project_id
            || existing.slug !== validated.project_slug
            || !hasRegistrationProvenance(existing, input.operation_id, validated.request_digest)
          ) {
            throw new ProjectRegistrationStepError("projects_project", "project_identity_exists");
          }
          project = existing;
        } else {
          try {
            project = await authorityStore!.createProject(authorityProjectInput);
          } catch {
            const reconciled = await authorityStore!.getProject(validated.project_id);
            if (
              !reconciled
              || reconciled.slug !== validated.project_slug
              || !hasRegistrationProvenance(reconciled, input.operation_id, validated.request_digest)
            ) {
              throw new ProjectRegistrationStepError(
                "projects_project",
                "project_create_terminal_outcome_unresolved",
                true,
              );
            }
            project = reconciled;
          }
        }
      }
      if (!project || project.id !== validated.project_id || project.slug !== validated.project_slug) {
        throw new ProjectRegistrationStepError("projects_project", "exact_project_readback_mismatch");
      }
      if (!adopting) {
        createdProject = project;
        expectedProjectStateDigest = projectStateDigest(project);
      }
      const projectRequestDigest = sha256(canonicalJson({
        project_id: validated.project_id,
        project_slug: validated.project_slug,
        target_path_digest: input.target.digest,
        project_metadata_digest: sha256(canonicalJson(project.metadata ?? {})),
      }));
      const projectPreconditionDigest = sha256(canonicalJson({
        exact_project_id: validated.project_id,
        exact_project_slug: validated.project_slug,
        expected: adopting ? "exact_existing_revision" : "absent",
        expected_revision: adopting ? input.expected_project_revision : null,
        target_path_digest: input.target.digest,
      }));
      const projectKey = deriveProjectRegistrationIdempotencyKey({
        operation_id: input.operation_id,
        step_id: "projects_project",
        direction: "forward",
        target_selector: validated.project_id,
        request_digest: projectRequestDigest,
        precondition_digest: projectPreconditionDigest,
      });
      appendRegistrationReceipt({
        operation_id: input.operation_id,
        step_id: "projects_project",
        authority: "projects",
        resource_kind: "project",
        direction: "forward",
        idempotency_key: projectKey,
        target_id: project.id,
        request_digest: projectRequestDigest,
        precondition_digest: projectPreconditionDigest,
        outcome: "accepted",
        result_revision: project.updated_at,
        result_digest: projectStateDigest(project),
        artifacts: [{
          authority: "projects",
          resource_kind: "project",
          target_id: project.id,
          revision: project.updated_at,
          digest: projectStateDigest(project),
          adopted: adopting,
        }],
        preconditions: [{
          predicate: adopting ? "exact_existing_revision" : "expected_absent",
          exact_project_id: project.id,
          exact_project_slug: project.slug,
          expected_revision: adopting ? input.expected_project_revision : null,
          target_path_digest: input.target.digest,
        }],
        rollback: adopting ? [] : [{
          action: "delete_store_project_if_state_digest_matches",
          project_id: project.id,
          project_slug: project.slug,
          expected_state_digest: projectStateDigest(project),
        }],
      }, db);
      failedStep = "projects_directory";
      let directoryExisted = false;
      input.target.withOwnedPath((path) => {
        if (existsSync(path)) {
          directoryExisted = true;
          if (!adopting) {
            throw new ProjectRegistrationStepError("projects_directory", "target_directory_exists");
          }
          const stat = lstatSync(path);
          if (!stat.isDirectory()) {
            throw new ProjectRegistrationStepError("projects_directory", "retrofit_target_is_not_directory");
          }
          return;
        }
        mkdirSync(path, { mode: 0o700 });
      });
      directoryCreatedByOperation = !directoryExisted;
      directoryOwnership = captureOwnedDirectoryIdentity(input.target);
      const directoryIdentityDigest = sha256(canonicalJson({
        target_path_digest: input.target.digest,
        ...directoryOwnership,
      }));
      const directoryRequestDigest = sha256(canonicalJson({
        project_id: project.id,
        target_path_digest: input.target.digest,
      }));
      const directoryPreconditionDigest = sha256(canonicalJson({
        expected: directoryExisted ? "exact_existing_directory" : "absent",
        target_path_digest: input.target.digest,
      }));
      const directoryKey = deriveProjectRegistrationIdempotencyKey({
        operation_id: input.operation_id,
        step_id: "projects_directory",
        direction: "forward",
        target_selector: project.id,
        request_digest: directoryRequestDigest,
        precondition_digest: directoryPreconditionDigest,
      });
      directoryReceipt = appendRegistrationReceipt({
        operation_id: input.operation_id,
        step_id: "projects_directory",
        authority: "projects-files",
        resource_kind: "directory",
        direction: "forward",
        idempotency_key: directoryKey,
        target_id: project.id,
        request_digest: directoryRequestDigest,
        precondition_digest: directoryPreconditionDigest,
        outcome: "accepted",
        result_revision: `${directoryOwnership.dev}:${directoryOwnership.ino}`,
        result_digest: directoryIdentityDigest,
        artifacts: [{
          authority: "projects-files",
          kind: "project_directory",
          project_id: project.id,
          target_path_digest: input.target.digest,
          directory_identity_digest: directoryIdentityDigest,
          adopted: directoryExisted,
        }],
        preconditions: [{
          predicate: directoryExisted ? "exact_existing_directory" : "expected_absent",
          target_path_digest: input.target.digest,
        }],
        rollback: directoryExisted ? [] : [{
          action: "remove_empty_directory",
          project_id: project.id,
          target_path_digest: input.target.digest,
          expected_dev: directoryOwnership.dev,
          expected_ino: directoryOwnership.ino,
        }],
      }, db);
    } else {
      const execution = await executeWorkspaceCreation({
      ...projectInput,
      createDirectory: true,
      requireAbsentDirectory: true,
      writeMarker: false,
    }, {
      db,
      ensureChannel: false,
      recordFailureEvent: false,
      recordExecutionEvent: false,
      createProject: async (createInput) => db.transaction(() => {
        const requestDigest = sha256(canonicalJson({
          project_id: validated.project_id,
          project_slug: validated.project_slug,
          target_path_digest: input.target.digest,
          project_metadata_digest: sha256(canonicalJson(createInput.metadata ?? {})),
        }));
        const preconditionDigest = sha256(canonicalJson({
          exact_project_id: validated.project_id,
          exact_project_slug: validated.project_slug,
          expected: "absent",
          target_path_digest: input.target.digest,
        }));
        const idempotencyKey = deriveProjectRegistrationIdempotencyKey({
          operation_id: input.operation_id,
          step_id: "projects_project",
          direction: "forward",
          target_selector: validated.project_id,
          request_digest: requestDigest,
          precondition_digest: preconditionDigest,
        });
        const created = createWorkspace({
          ...createInput,
          id: validated.project_id,
          slug: validated.project_slug,
          require_exact_identity: true,
        }, db);
        appendRegistrationReceipt({
          operation_id: input.operation_id,
          step_id: "projects_project",
          authority: "projects",
          resource_kind: "project",
          direction: "forward",
          idempotency_key: idempotencyKey,
          target_id: created.id,
          request_digest: requestDigest,
          precondition_digest: preconditionDigest,
          outcome: "accepted",
          result_revision: created.updated_at,
          result_digest: projectStateDigest(created),
          artifacts: [{
            authority: "projects",
            resource_kind: "project",
            target_id: created.id,
            revision: created.updated_at,
            digest: projectStateDigest(created),
          }],
          preconditions: [{
            predicate: "expected_absent",
            exact_project_id: created.id,
            exact_project_slug: created.slug,
            target_path_digest: input.target.digest,
          }],
          rollback: [{
            action: "cleanup_creation_plan_if_state_digest_matches",
            project_id: created.id,
            project_slug: created.slug,
            expected_state_digest: projectStateDigest(created),
          }],
        }, db);
        return created;
      })(),
    });
      project = execution.workspace;
      if (!project || project.id !== validated.project_id || project.slug !== validated.project_slug) {
        throw new ProjectRegistrationStepError("projects_project", "exact_project_readback_mismatch");
      }
      createdProject = project;
      expectedProjectStateDigest = projectStateDigest(project);
      failedStep = "projects_directory";
      const directoryAction = execution.prepare.find((action) => action.type === "mkdir");
      if (!directoryAction || directoryAction.status !== "completed") {
        throw new ProjectRegistrationStepError("projects_directory", "directory_not_created_by_attempt");
      }
      directoryOwnership = captureOwnedDirectoryIdentity(input.target);
      const directoryIdentityDigest = sha256(canonicalJson({
        target_path_digest: input.target.digest,
        ...directoryOwnership,
      }));
      const directoryRequestDigest = sha256(canonicalJson({
        project_id: project.id,
        target_path_digest: input.target.digest,
      }));
      const directoryPreconditionDigest = sha256(canonicalJson({
        expected: "absent",
        target_path_digest: input.target.digest,
      }));
      const directoryKey = deriveProjectRegistrationIdempotencyKey({
        operation_id: input.operation_id,
        step_id: "projects_directory",
        direction: "forward",
        target_selector: project.id,
        request_digest: directoryRequestDigest,
        precondition_digest: directoryPreconditionDigest,
      });
      directoryReceipt = appendRegistrationReceipt({
        operation_id: input.operation_id,
        step_id: "projects_directory",
        authority: "projects-files",
        resource_kind: "directory",
        direction: "forward",
        idempotency_key: directoryKey,
        target_id: project.id,
        request_digest: directoryRequestDigest,
        precondition_digest: directoryPreconditionDigest,
        outcome: "accepted",
        result_revision: `${directoryOwnership.dev}:${directoryOwnership.ino}`,
        result_digest: directoryIdentityDigest,
        artifacts: [{
          authority: "projects-files",
          kind: "project_directory",
          project_id: project.id,
          target_path_digest: input.target.digest,
          directory_identity_digest: directoryIdentityDigest,
        }],
        preconditions: [{
          predicate: "expected_absent",
          target_path_digest: input.target.digest,
        }],
        rollback: [{
          action: "remove_empty_directory",
          project_id: project.id,
          target_path_digest: input.target.digest,
          expected_dev: directoryOwnership.dev,
          expected_ino: directoryOwnership.ino,
        }],
      }, db);
      directoryCreatedByOperation = true;
    }

    failedStep = "conversations_channel";
    const channel = deriveProjectChannel(project).channel;
    const existingChannel = retrofitProject?.integrations.conversations_channel;
    const conversations = await executeExternalStep({
      adapter: authorities.conversations,
      capability: capabilities.conversations,
      operation_id: input.operation_id,
      step_id: failedStep,
      resource_kind: "channel",
      target_selector: channel,
      desired: {
        channel,
        project_id: project.id,
        project_slug: project.slug,
        project_kind: project.kind,
      },
      project,
      target: input.target,
      bounds,
      db,
      accepted_steps: externalAccepted,
      adopt_existing: typeof existingChannel === "string" && existingChannel === channel
        ? {
            integration_key: "conversations_channel",
            integration_value: existingChannel,
          }
        : undefined,
    });

    failedStep = "todos_project";
    const existingTodosProjectId = retrofitProject?.integrations.todos_project_id;
    const todosProject = await executeExternalStep({
      adapter: authorities.todos,
      capability: capabilities.todos,
      operation_id: input.operation_id,
      step_id: failedStep,
      resource_kind: "project",
      target_selector: project.id,
      desired: {
        source_project_id: project.id,
        source_project_slug: project.slug,
        name: project.name,
      },
      project,
      target: input.target,
      bounds,
      db,
      accepted_steps: externalAccepted,
      adopt_existing: typeof existingTodosProjectId === "string" && existingTodosProjectId.trim()
        ? {
            integration_key: "todos_project_id",
            integration_value: existingTodosProjectId,
            expected_target_id: existingTodosProjectId,
          }
        : undefined,
    });

    failedStep = "todos_task_list";
    const existingTodosTaskListId = retrofitProject?.integrations.todos_task_list_id;
    const todosTaskList = await executeExternalStep({
      adapter: authorities.todos,
      capability: capabilities.todos,
      operation_id: input.operation_id,
      step_id: failedStep,
      resource_kind: "task_list",
      target_selector: `${todosProject.receipt.target_id}:default`,
      desired: {
        todos_project_id: todosProject.receipt.target_id,
        source_project_id: project.id,
        name: project.name,
      },
      project,
      target: input.target,
      bounds,
      db,
      accepted_steps: externalAccepted,
      adopt_existing: typeof existingTodosTaskListId === "string" && existingTodosTaskListId.trim()
        ? {
            integration_key: "todos_task_list_id",
            integration_value: existingTodosTaskListId,
            expected_target_id: existingTodosTaskListId,
          }
        : undefined,
    });

    failedStep = "mementos_project";
    const existingMementosProjectId = retrofitProject?.integrations.mementos_project_id;
    const mementosProject = await executeExternalStep({
      adapter: authorities.mementos,
      capability: capabilities.mementos,
      operation_id: input.operation_id,
      step_id: failedStep,
      resource_kind: "project",
      target_selector: project.id,
      desired: {
        source_project_id: project.id,
        source_project_slug: project.slug,
        name: project.name,
        target_path_digest: input.target.digest,
      },
      project,
      target: input.target,
      bounds,
      db,
      accepted_steps: externalAccepted,
      adopt_existing: typeof existingMementosProjectId === "string" && existingMementosProjectId.trim()
        ? {
            integration_key: "mementos_project_id",
            integration_value: existingMementosProjectId,
            expected_target_id: existingMementosProjectId,
          }
        : undefined,
    });

    failedStep = "projects_integrations";
    const integrations: WorkspaceIntegrations = {
      conversations_channel: channel,
      todos_project_id: todosProject.receipt.target_id!,
      todos_task_list_id: todosTaskList.receipt.target_id!,
      mementos_project_id: mementosProject.receipt.target_id!,
    };
    const integrated = await updateProjectIntegrations({
      operation_id: input.operation_id,
      project,
      integrations,
      resource_links: [
        registrationResourceLink({
          capability: capabilities.conversations,
          receipt: conversations.receipt,
          target_kind: "channel",
          scope: "collection",
          labels: { channel_name: channel },
        }),
        registrationResourceLink({
          capability: capabilities.todos,
          receipt: todosProject.receipt,
          target_kind: "project",
          scope: "collection",
          labels: { name: project.name },
        }),
        registrationResourceLink({
          capability: capabilities.todos,
          receipt: todosTaskList.receipt,
          target_kind: "task_list",
          scope: "collection",
          labels: { name: project.name },
        }),
        registrationResourceLink({
          capability: capabilities.mementos,
          receipt: mementosProject.receipt,
          target_kind: "project",
          scope: "collection",
          labels: { name: project.name },
        }),
      ],
      bounds,
      db,
      store: authorityStore,
    });
    project = integrated.project;
    integrationReceipt = integrated.receipt;

    failedStep = "projects_goals";
    fileAccepted.push((retrofitProject ? writeOrAdoptOwnedFile : atomicWriteOwnedFile)({
      operation_id: input.operation_id,
      step_id: failedStep,
      filename: PROJECT_REGISTRATION_GOALS_FILENAME,
      content: input.goals_markdown.endsWith("\n") ? input.goals_markdown : `${input.goals_markdown}\n`,
      project,
      target: input.target,
    }, db));

    failedStep = "projects_marker";
    const marker = `${JSON.stringify(buildWorkspaceMarker(project), null, 2)}\n`;
    fileAccepted.push((retrofitProject ? writeOrAdoptOwnedFile : atomicWriteOwnedFile)({
      operation_id: input.operation_id,
      step_id: failedStep,
      filename: PROJECT_MARKER_FILENAME,
      content: marker,
      project,
      target: input.target,
      compatible_existing: compatibleWorkspaceMarkerContent,
    }, db));

    const artifacts = projectArtifacts(project, externalAccepted, fileAccepted, directoryReceipt);
    assertRegistrationTimeBudget(bounds, startedAt, "registration_terminal");
    terminalReceipt({
      operation_id: input.operation_id,
      project_id: project.id,
      request_digest: operationRequestDigest,
      outcome: "accepted",
      project,
      artifacts,
      rollback: [
        { step_id: "projects_marker", action: "unlink_if_digest_matches" },
        { step_id: "projects_goals", action: "unlink_if_digest_matches" },
        { step_id: "projects_integrations", action: "restore_if_revision_matches" },
        ...externalAccepted.slice().reverse().map((item) => ({
          step_id: item.request.step_id,
          authority: item.adapter.authority,
          action: "receipt_scoped_conditional_inverse",
          accepted_receipt_id: item.receipt.receipt_id,
        })),
        { step_id: "projects_directory", action: "remove_if_inode_matches_and_empty" },
        { step_id: "projects_project", action: "cleanup_creation_plan_if_state_digest_matches" },
      ],
      db,
    });
    terminalCommitted = true;
    return controlledResult({
      ok: true,
      outcome: "accepted" as const,
      operation_id: input.operation_id,
      project_id: project.id,
      project_slug: project.slug,
      failed_step: null,
      reason_code: null,
      dependencies: [],
      artifacts,
      receipts: listProjectRegistrationReceipts(input.operation_id, db),
      rollback: [],
    }, bounds, startedAt);
  } catch (err) {
    if (terminalCommitted) throw err;
    const stepError = err instanceof ProjectRegistrationStepError
      ? err
      : new ProjectRegistrationStepError(failedStep, "registration_step_failed");
    const residualExternal = new Set(externalAccepted);
    const residualFiles = new Set(fileAccepted);
    let residualDirectoryReceipt = directoryReceipt;
    if (stepError.splitState) {
      rollback.push({
        step_id: stepError.stepId,
        status: "failed",
        reason_code: stepError.code,
      });
    }

    for (const file of fileAccepted.slice().reverse()) {
      if (!file.created_by_operation) {
        residualFiles.delete(file);
        rollback.push({
          step_id: file.local_receipt.step_id,
          status: "skipped",
          reason_code: "adopted_existing_file",
        });
        continue;
      }
      try {
        compensateOwnedFile({
          operation_id: input.operation_id,
          accepted: file,
          project_id: validated.project_id,
          target: input.target,
        }, db);
        residualFiles.delete(file);
        rollback.push({ step_id: file.local_receipt.step_id, status: "completed" });
      } catch {
        rollback.push({ step_id: file.local_receipt.step_id, status: "failed", reason_code: "file_inverse_failed" });
      }
    }

    if (integrationReceipt) {
      try {
        const restored = await rollbackProjectIntegrations({
          operation_id: input.operation_id,
          accepted: integrationReceipt,
          bounds,
          db,
          store: authorityStore,
        });
        if (createdProject) {
          expectedProjectStateDigest = projectStateDigest({
            ...createdProject,
            updated_at: restored.project.updated_at,
          });
        }
        rollback.push({ step_id: "projects_integrations", status: "completed" });
      } catch {
        rollback.push({ step_id: "projects_integrations", status: "failed", reason_code: "integration_inverse_failed" });
      }
    }

    for (const external of externalAccepted.slice().reverse()) {
      try {
        const inverse = await compensateExternalStep(external, bounds, db);
        if (inverse) residualExternal.delete(external);
        rollback.push({
          step_id: external.request.step_id,
          status: inverse ? "completed" : "skipped",
          reason_code: inverse ? null : "not_attempt_created",
          accepted_receipt_id: external.receipt.receipt_id,
          target_id: external.receipt.target_id,
        });
      } catch {
        rollback.push({
          step_id: external.request.step_id,
          status: "failed",
          reason_code: "authority_inverse_failed",
          accepted_receipt_id: external.receipt.receipt_id,
          target_id: external.receipt.target_id,
        });
      }
    }

    const createdProjectRow = db.query(
      `SELECT * FROM project_registration_receipts
       WHERE operation_id = ? AND step_id = 'projects_project'
         AND direction = 'forward' AND outcome = 'accepted'
       ORDER BY sequence ASC LIMIT 1`,
    ).get(input.operation_id) as ProjectRegistrationReceiptRow | null;
    const createdProjectReceipt = createdProjectRow ? rowToReceipt(createdProjectRow) : null;
    const projectCleanupContract = createdProjectReceipt?.rollback[0] as {
      action?: string;
      expected_state_digest?: string;
    } | undefined;
    if (
      createdProjectReceipt
      && (
        projectCleanupContract?.action === "cleanup_creation_plan_if_state_digest_matches"
        || projectCleanupContract?.action === "delete_store_project_if_state_digest_matches"
      )
    ) {
      const current = await readRegistrationProject(validated.project_id, db, authorityStore);
      if (current && current.slug === validated.project_slug) {
        const expectedStateDigest = expectedProjectStateDigest
          ?? String(createdProjectReceipt.rollback[0]?.expected_state_digest ?? "");
        if (projectStateDigest(current) === expectedStateDigest) {
          try {
            if (directoryOwnership) {
              assertOwnedDirectorySafeToRemove(input.target, directoryOwnership);
            }
            let actionCount = 0;
            let errorCount = 0;
            if (authorityStore) {
              if (directoryOwnership && directoryCreatedByOperation) {
                assertOwnedDirectorySafeToRemove(input.target, directoryOwnership);
                input.target.withOwnedPath((path) => rmdirSync(path));
                actionCount += 1;
              }
              await authorityStore.deleteProject(current.id, { hard: true }, {
                agentId: input.project.agent_id,
                source: input.project.source ?? "cli",
                command: input.project.command,
              });
              actionCount += 1;
            } else {
              if (!creationPlan) {
                throw new ProjectRegistrationStepError("projects_project", "creation_plan_missing", true);
              }
              const cleanup = cleanupWorkspaceCreation(creationPlan, {
                db,
                agentId: input.project.agent_id,
                source: input.project.source ?? "cli",
                command: input.project.command,
                recordDeletionEvent: false,
                recordCleanupEvent: false,
              });
              actionCount = cleanup.actions.length;
              errorCount = cleanup.errors.length;
            }
            const projectAbsent = await readRegistrationProject(validated.project_id, db, authorityStore) === null;
            const directoryAbsent = !directoryOwnership || input.target.withOwnedPath((path) => !existsSync(path));
            if (errorCount > 0 || !projectAbsent || !directoryAbsent) {
              throw new ProjectRegistrationStepError(
                "projects_project",
                "creation_cleanup_exact_readback_failed",
                true,
              );
            }
            residualDirectoryReceipt = null;
            if (directoryReceipt) {
              const directoryAbsenceDigest = sha256(canonicalJson({
                project_id: validated.project_id,
                target_path_digest: input.target.digest,
                accepted_receipt_id: directoryReceipt.receipt_id,
                absent: true,
              }));
              const inverse = appendLocalAbsenceReceipt({
                operation_id: input.operation_id,
                step_id: "projects_directory",
                authority: "projects-files",
                resource_kind: "directory",
                target_id: validated.project_id,
                accepted_receipt: directoryReceipt,
                absence_digest: directoryAbsenceDigest,
                artifacts: [{
                  authority: "projects-files",
                  kind: "project_directory",
                  project_id: validated.project_id,
                  target_path_digest: input.target.digest,
                  removed: true,
                }],
                db,
              });
              rollback.push({
                step_id: "projects_directory",
                status: "completed",
                inverse_receipt_id: inverse.receipt_id,
              });
            }
            const projectAbsenceDigest = sha256(canonicalJson({
              project_id: validated.project_id,
              accepted_receipt_id: createdProjectReceipt.receipt_id,
              absent: true,
            }));
            const inverse = appendLocalAbsenceReceipt({
              operation_id: input.operation_id,
              step_id: "projects_project",
              authority: "projects",
              resource_kind: "project",
              target_id: validated.project_id,
              accepted_receipt: createdProjectReceipt,
              absence_digest: projectAbsenceDigest,
              artifacts: [{
                authority: "projects",
                kind: "project",
                target_id: validated.project_id,
                removed: true,
              }],
              db,
            });
            rollback.push({
              step_id: "projects_project",
              status: "completed",
              action_count: actionCount,
              error_count: errorCount,
              inverse_receipt_id: inverse.receipt_id,
            });
          } catch (cleanupError) {
            const reason = cleanupError instanceof ProjectRegistrationStepError
              ? cleanupError.code
              : "creation_cleanup_failed";
            if (directoryOwnership) {
              rollback.push({
                step_id: "projects_directory",
                status: "failed",
                reason_code: reason,
              });
            }
            rollback.push({
              step_id: "projects_project",
              status: "failed",
              reason_code: reason,
            });
          }
        } else {
          rollback.push({
            step_id: "projects_project",
            status: "failed",
            reason_code: "project_drift_refuses_cleanup",
          });
        }
      } else {
        rollback.push({ step_id: "projects_project", status: "skipped", reason_code: "project_already_absent" });
      }
    } else if (!createdProjectReceipt && createdProject && authorityStore) {
      try {
        const current = await authorityStore.getProject(createdProject.id);
        if (!current || projectStateDigest(current) !== expectedProjectStateDigest) {
          throw new ProjectRegistrationStepError("projects_project", "orphan_store_project_drift", true);
        }
        if (directoryOwnership && directoryCreatedByOperation) {
          assertOwnedDirectorySafeToRemove(input.target, directoryOwnership);
          input.target.withOwnedPath((path) => rmdirSync(path));
          residualDirectoryReceipt = null;
        }
        await authorityStore.deleteProject(current.id, { hard: true }, {
          agentId: input.project.agent_id,
          source: input.project.source ?? "cli",
          command: input.project.command,
        });
        if (await authorityStore.getProject(current.id)) {
          throw new ProjectRegistrationStepError("projects_project", "orphan_store_project_cleanup_failed", true);
        }
        rollback.push({ step_id: "projects_project", status: "completed", action_count: 1, error_count: 0 });
      } catch {
        rollback.push({ step_id: "projects_project", status: "failed", reason_code: "orphan_store_project_cleanup_failed" });
      }
    } else if (directoryReceipt && directoryCreatedByOperation) {
      try {
        if (!directoryOwnership) throw new Error("directory ownership missing");
        assertOwnedDirectorySafeToRemove(input.target, directoryOwnership);
        input.target.withOwnedPath((path) => rmdirSync(path));
        residualDirectoryReceipt = null;
        rollback.push({ step_id: "projects_directory", status: "completed" });
      } catch {
        rollback.push({ step_id: "projects_directory", status: "failed", reason_code: "orphan_directory_cleanup_failed" });
      }
    }

    const rollbackFailed = rollback.some((item) => item.status === "failed");
    const remainingProject = await readRegistrationProject(validated.project_id, db, authorityStore);
    const artifacts = projectArtifacts(
      remainingProject,
      [...residualExternal],
      [...residualFiles],
      residualDirectoryReceipt,
    );
    terminalReceipt({
      operation_id: input.operation_id,
      project_id: validated.project_id,
      request_digest: operationRequestDigest,
      outcome: "terminal_nonacceptance",
      reason: stepError.code,
      project: remainingProject,
      artifacts,
      rollback,
      db,
    });
    return controlledResult({
      ok: false,
      outcome: rollbackFailed ? "split_state" as const : "rolled_back" as const,
      operation_id: input.operation_id,
      project_id: validated.project_id,
      project_slug: validated.project_slug,
      failed_step: stepError.stepId,
      reason_code: stepError.code,
      dependencies: [],
      artifacts,
      receipts: listProjectRegistrationReceipts(input.operation_id, db),
      rollback,
    }, bounds, startedAt);
  }
}
