import { createHash } from "crypto";
import { version as packageVersion } from "../../package.json";
import { normalizeChannelName } from "./channel-names.js";
import { newChannelId } from "./channel-id.js";
import { getDb, type ConversationsDatabase } from "./db.js";

export const PROJECT_CHANNEL_REGISTRATION_ROUTE = "/v1/project-registration/channels";
export const PROJECT_CHANNEL_REGISTRATION_CREATOR = "project-registration";

export type ProjectChannelRegistrationDirection = "forward" | "inverse";
export type ProjectChannelRegistrationAuthorityName =
  | "todos"
  | "mementos"
  | "conversations";
export type ProjectChannelRegistrationResourceKind =
  | "project"
  | "task_list"
  | "channel";
export type ProjectChannelRegistrationOutcome =
  | "accepted"
  | "duplicate_of_accepted"
  | "terminal_nonacceptance";

export type ProjectChannelRegistrationJson =
  | string
  | number
  | boolean
  | null
  | ProjectChannelRegistrationJson[]
  | { [key: string]: ProjectChannelRegistrationJson };

export interface ProjectChannelRegistrationPathHandle {
  readonly digest: string;
  withOwnedPath<T>(consumer: (absolutePath: string) => T): T;
}

export interface ProjectChannelRegistrationBounds {
  response_byte_limit: number;
  time_budget_ms: number;
  call_limit?: 1;
}

export interface ProjectChannelRegistrationResponseControl extends ProjectChannelRegistrationBounds {
  call_limit: 1;
  calls_used: 1;
  max_items: 1;
  items_returned: 1;
  response_bytes: number;
  elapsed_ms: number;
  complete: true;
  truncated: false;
}

export interface ProjectChannelRegistrationCapability {
  authority: "conversations";
  route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  supported_resources: ["channel"];
  conditional_create: true;
  immutable_receipts: true;
  exact_terminal_lookup: true;
  exact_readback: true;
  conditional_inverse: true;
  ambiguous_outcome_reconciliation: true;
}

export interface ProjectChannelRegistrationReceipt {
  receipt_id: string;
  authority: ProjectChannelRegistrationAuthorityName;
  route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  resource_kind: ProjectChannelRegistrationResourceKind;
  direction: ProjectChannelRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: ProjectChannelRegistrationOutcome;
  reason: string | null;
  target_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  created_at: string;
}

export interface ProjectChannelRegistrationRecord {
  target_id: string;
  revision: string;
  digest: string;
}

export interface ProjectChannelRegistrationRequest extends ProjectChannelRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: ProjectChannelRegistrationResourceKind;
  direction: ProjectChannelRegistrationDirection;
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
  desired: { [key: string]: ProjectChannelRegistrationJson };
  target: ProjectChannelRegistrationPathHandle;
  accepted_receipt?: ProjectChannelRegistrationReceipt;
}

export interface ProjectChannelRegistrationReadRequest extends ProjectChannelRegistrationBounds {
  resource_kind: ProjectChannelRegistrationResourceKind;
  target_id: string;
  target_selector?: string;
  target: ProjectChannelRegistrationPathHandle;
}

export interface ProjectChannelRegistrationLookupRequest extends ProjectChannelRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: ProjectChannelRegistrationResourceKind;
  direction: ProjectChannelRegistrationDirection;
  authority: ProjectChannelRegistrationAuthorityName;
  authority_route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  target_selector: string;
  idempotency_key: string;
  target_id?: string;
  max_items: 1;
}

export interface ProjectChannelRegistrationLookupResult {
  receipt: ProjectChannelRegistrationReceipt;
  response_control: ProjectChannelRegistrationResponseControl;
}

export interface ProjectChannelRegistrationInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: true;
  digest: string;
}

export interface ProjectChannelRegistrationAuthorityStore {
  projectChannelRegistrationCapability(): Promise<ProjectChannelRegistrationCapability>;
  registerProjectChannel(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationReceipt>;
  readProjectChannelRegistrationExact(request: ProjectChannelRegistrationReadRequest): Promise<ProjectChannelRegistrationRecord>;
  lookupProjectChannelRegistrationReceipt(request: ProjectChannelRegistrationLookupRequest): Promise<ProjectChannelRegistrationLookupResult>;
  compensateProjectChannelRegistration(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationReceipt>;
  verifyProjectChannelRegistrationInverse(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationInverseVerification>;
}

export interface ProjectChannelRegistrationAuthority {
  readonly authority: "conversations";
  capability(): Promise<ProjectChannelRegistrationCapability>;
  create(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationReceipt>;
  readExact(request: ProjectChannelRegistrationReadRequest): Promise<ProjectChannelRegistrationRecord>;
  lookupReceipt(request: ProjectChannelRegistrationLookupRequest): Promise<ProjectChannelRegistrationLookupResult>;
  compensate(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationReceipt>;
  verifyInverse(request: ProjectChannelRegistrationRequest): Promise<ProjectChannelRegistrationInverseVerification>;
}

export interface ProjectChannelRegistrationFaultOptions {
  faultInjector?: (point: "after_channel_insert" | "after_channel_delete") => void;
}

type ReceiptRow = Omit<ProjectChannelRegistrationReceipt, "created_by_operation"> & {
  created_by_operation: number | boolean;
};

type ChannelRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  metadata: string | null;
  tags: string | null;
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value ?? null;
}

export function projectChannelRegistrationDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.ceil(performance.now() - startedAt));
}

function assertBounds(bounds: ProjectChannelRegistrationBounds): void {
  if (!Number.isInteger(bounds.response_byte_limit) || bounds.response_byte_limit <= 0) {
    throw new Error("response_byte_limit must be a positive integer.");
  }
  if (!Number.isInteger(bounds.time_budget_ms) || bounds.time_budget_ms <= 0) {
    throw new Error("time_budget_ms must be a positive integer.");
  }
  if (bounds.call_limit !== undefined && bounds.call_limit !== 1) {
    throw new Error("call_limit must be exactly 1.");
  }
}

function assertTimeBudget(startedAt: number, budget: number): void {
  const elapsed = elapsedMs(startedAt);
  if (elapsed > budget) {
    throw new Error(`project channel registration exceeded time_budget_ms (${elapsed} > ${budget}).`);
  }
}

export function projectChannelRegistrationResponseControl(
  value: unknown,
  bounds: ProjectChannelRegistrationBounds,
  startedAt: number,
): ProjectChannelRegistrationResponseControl {
  const responseBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  const elapsed = elapsedMs(startedAt);
  if (responseBytes > bounds.response_byte_limit) {
    throw new Error(
      `project channel registration exceeded response_byte_limit (${responseBytes} > ${bounds.response_byte_limit}).`,
    );
  }
  if (elapsed > bounds.time_budget_ms) {
    throw new Error(
      `project channel registration exceeded time_budget_ms (${elapsed} > ${bounds.time_budget_ms}).`,
    );
  }
  return {
    response_byte_limit: bounds.response_byte_limit,
    time_budget_ms: bounds.time_budget_ms,
    call_limit: 1,
    calls_used: 1,
    max_items: 1,
    items_returned: 1,
    response_bytes: responseBytes,
    elapsed_ms: elapsed,
    complete: true,
    truncated: false,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function channelSnapshot(row: ChannelRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    topic: row.topic ?? null,
    project_id: row.project_id ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    archived_at: row.archived_at ?? null,
    metadata: parseJsonObject(row.metadata),
    tags: parseJsonArray(row.tags),
  };
}

export function projectChannelRegistrationChannelRecord(row: ChannelRow): ProjectChannelRegistrationRecord {
  const snapshot = channelSnapshot(row);
  return {
    target_id: row.id,
    revision: projectChannelRegistrationDigest({
      target_id: row.id,
      channel: row.name,
      project_id: row.project_id ?? null,
      created_at: row.created_at,
    }),
    digest: projectChannelRegistrationDigest(snapshot),
  };
}

function parseReceipt(row: ReceiptRow): ProjectChannelRegistrationReceipt {
  return {
    ...row,
    authority: "conversations",
    resource_kind: "channel",
    created_by_operation: row.created_by_operation === true || Number(row.created_by_operation) === 1,
  };
}

function corpusId(db: ConversationsDatabase): string {
  const row = db.prepare(
    "SELECT corpus_id FROM project_channel_registration_identity WHERE singleton = 1",
  ).get() as { corpus_id: string } | null;
  if (!row?.corpus_id) throw new Error("project channel registration corpus identity is missing.");
  return row.corpus_id;
}

export function buildProjectChannelRegistrationCapability(
  identityCorpusId: string,
): ProjectChannelRegistrationCapability {
  return {
    authority: "conversations",
    route: PROJECT_CHANNEL_REGISTRATION_ROUTE,
    package_version: packageVersion,
    authority_id: "conversations",
    tenant_id: "default",
    corpus_id: identityCorpusId,
    supported_resources: ["channel"],
    conditional_create: true,
    immutable_receipts: true,
    exact_terminal_lookup: true,
    exact_readback: true,
    conditional_inverse: true,
    ambiguous_outcome_reconciliation: true,
  };
}

export function getProjectChannelRegistrationCapability(
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationCapability {
  return buildProjectChannelRegistrationCapability(corpusId(db));
}

export function assertProjectChannelRegistrationIdentity(
  request: Pick<
    ProjectChannelRegistrationRequest,
    "authority_route" | "package_version" | "authority_id" | "tenant_id" | "corpus_id"
  >,
  capability: ProjectChannelRegistrationCapability,
): void {
  const matches = request.authority_route === capability.route
    && request.package_version === capability.package_version
    && request.authority_id === capability.authority_id
    && request.tenant_id === capability.tenant_id
    && request.corpus_id === capability.corpus_id;
  if (!matches) throw new Error("project channel registration authority identity mismatch.");
}

function assertRequiredText(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
}

function retiredPrefix(slug: string): boolean {
  return slug.startsWith("iproj-") || slug.startsWith("internal-iproj-");
}

export function validateProjectChannelRegistrationForward(
  request: ProjectChannelRegistrationRequest,
  capability: ProjectChannelRegistrationCapability,
): { channel: string; retired: boolean } {
  assertBounds(request);
  assertProjectChannelRegistrationIdentity(request, capability);
  if (request.resource_kind !== "channel") throw new Error("resource_kind must be channel.");
  if (request.direction !== "forward") throw new Error("direction must be forward.");
  for (const [name, value] of [
    ["operation_id", request.operation_id],
    ["step_id", request.step_id],
    ["idempotency_key", request.idempotency_key],
    ["project_id", request.project_id],
    ["project_slug", request.project_slug],
    ["project_name", request.project_name],
    ["target_selector", request.target_selector],
  ] as const) {
    assertRequiredText(name, value);
  }
  if (!/^wks_[A-Za-z0-9_-]{8,}$/.test(request.project_id)) {
    throw new Error("project_id must be the full immutable Projects workspace id.");
  }
  const channel = normalizeChannelName(request.project_slug);
  if (channel !== request.project_slug) {
    throw new Error("project_slug must already be the canonical prefixless channel slug.");
  }
  if (request.target_selector !== channel) {
    throw new Error("target_selector must equal the exact canonical channel.");
  }
  if (
    request.desired.channel !== channel
    || request.desired.project_id !== request.project_id
    || request.desired.project_slug !== request.project_slug
  ) {
    throw new Error("desired channel identity does not match the request.");
  }
  if (request.request_digest !== projectChannelRegistrationDigest(request.desired)) {
    throw new Error("request_digest does not match desired.");
  }
  const expectedPrecondition = projectChannelRegistrationDigest({
    target_selector: channel,
    expected: "absent",
  });
  if (request.precondition_digest !== expectedPrecondition) {
    throw new Error("precondition_digest does not describe expected-absent.");
  }
  return { channel, retired: retiredPrefix(channel) };
}

function receiptId(input: {
  capability: ProjectChannelRegistrationCapability;
  request: ProjectChannelRegistrationRequest;
  outcome: ProjectChannelRegistrationOutcome;
  reason: string | null;
  targetId: string | null;
  duplicateOf: string | null;
  acceptedReceiptId: string | null;
}): string {
  return `pcr_${projectChannelRegistrationDigest({
    authority: input.capability.authority,
    route: input.capability.route,
    package_version: input.capability.package_version,
    authority_id: input.capability.authority_id,
    tenant_id: input.capability.tenant_id,
    corpus_id: input.capability.corpus_id,
    operation_id: input.request.operation_id,
    step_id: input.request.step_id,
    resource_kind: input.request.resource_kind,
    direction: input.request.direction,
    idempotency_key: input.request.idempotency_key,
    request_digest: input.request.request_digest,
    precondition_digest: input.request.precondition_digest,
    outcome: input.outcome,
    reason: input.reason,
    target_id: input.targetId,
    duplicate_of_receipt_id: input.duplicateOf,
    accepted_receipt_id: input.acceptedReceiptId,
  }).slice(0, 32)}`;
}

export function buildProjectChannelRegistrationReceipt(input: {
  capability: ProjectChannelRegistrationCapability;
  request: ProjectChannelRegistrationRequest;
  outcome: ProjectChannelRegistrationOutcome;
  reason?: string | null;
  targetId?: string | null;
  resultRevision?: string | null;
  resultDigest?: string | null;
  duplicateOf?: string | null;
  acceptedReceiptId?: string | null;
  createdByOperation?: boolean;
}): ProjectChannelRegistrationReceipt {
  const reason = input.reason ?? null;
  const targetId = input.targetId ?? null;
  const duplicateOf = input.duplicateOf ?? null;
  const acceptedReceiptId = input.acceptedReceiptId ?? null;
  return {
    receipt_id: receiptId({
      capability: input.capability,
      request: input.request,
      outcome: input.outcome,
      reason,
      targetId,
      duplicateOf,
      acceptedReceiptId,
    }),
    authority: "conversations",
    route: input.capability.route,
    package_version: input.capability.package_version,
    authority_id: input.capability.authority_id,
    tenant_id: input.capability.tenant_id,
    corpus_id: input.capability.corpus_id,
    operation_id: input.request.operation_id,
    step_id: input.request.step_id,
    resource_kind: "channel",
    direction: input.request.direction,
    idempotency_key: input.request.idempotency_key,
    request_digest: input.request.request_digest,
    precondition_digest: input.request.precondition_digest,
    outcome: input.outcome,
    reason,
    target_id: targetId,
    result_revision: input.resultRevision ?? null,
    result_digest: input.resultDigest ?? null,
    duplicate_of_receipt_id: duplicateOf,
    accepted_receipt_id: acceptedReceiptId,
    created_by_operation: input.createdByOperation ?? false,
    created_at: nowIso(),
  };
}

export function sameProjectChannelRegistrationReceipt(left: ProjectChannelRegistrationReceipt, right: ProjectChannelRegistrationReceipt): boolean {
  const { created_at: _leftCreated, ...leftStable } = left;
  const { created_at: _rightCreated, ...rightStable } = right;
  return projectChannelRegistrationDigest(leftStable) === projectChannelRegistrationDigest(rightStable);
}

function insertReceipt(
  db: ConversationsDatabase,
  receipt: ProjectChannelRegistrationReceipt,
): ProjectChannelRegistrationReceipt {
  const result = db.prepare(`
    INSERT OR IGNORE INTO project_channel_registration_receipts (
      receipt_id, authority, route, package_version, authority_id, tenant_id,
      corpus_id, operation_id, step_id, resource_kind, direction,
      idempotency_key, request_digest, precondition_digest, outcome, reason,
      target_id, result_revision, result_digest, duplicate_of_receipt_id,
      accepted_receipt_id, created_by_operation, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.receipt_id,
    receipt.authority,
    receipt.route,
    receipt.package_version,
    receipt.authority_id,
    receipt.tenant_id,
    receipt.corpus_id,
    receipt.operation_id,
    receipt.step_id,
    receipt.resource_kind,
    receipt.direction,
    receipt.idempotency_key,
    receipt.request_digest,
    receipt.precondition_digest,
    receipt.outcome,
    receipt.reason,
    receipt.target_id,
    receipt.result_revision,
    receipt.result_digest,
    receipt.duplicate_of_receipt_id,
    receipt.accepted_receipt_id,
    receipt.created_by_operation ? 1 : 0,
    receipt.created_at,
  );
  if (result.changes === 1) return receipt;
  const existing = db.prepare(
    "SELECT * FROM project_channel_registration_receipts WHERE receipt_id = ?",
  ).get(receipt.receipt_id) as ReceiptRow | null;
  if (!existing) throw new Error("project channel registration receipt insert was lost.");
  const parsed = parseReceipt(existing);
  if (!sameProjectChannelRegistrationReceipt(parsed, receipt)) {
    throw new Error(`project channel registration receipt id collision: ${receipt.receipt_id}`);
  }
  return parsed;
}

function acceptedForStep(
  db: ConversationsDatabase,
  capability: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
): ProjectChannelRegistrationReceipt | null {
  const rows = db.prepare(`
    SELECT * FROM project_channel_registration_receipts
    WHERE authority = ? AND route = ? AND package_version = ?
      AND authority_id = ? AND tenant_id = ? AND corpus_id = ?
      AND operation_id = ? AND step_id = ? AND resource_kind = 'channel'
      AND direction = ? AND outcome = 'accepted'
    ORDER BY created_at DESC, receipt_id DESC
    LIMIT 2
  `).all(
    capability.authority,
    capability.route,
    capability.package_version,
    capability.authority_id,
    capability.tenant_id,
    capability.corpus_id,
    request.operation_id,
    request.step_id,
    request.direction,
  ) as ReceiptRow[];
  if (rows.length > 1) {
    throw new Error("ambiguous project channel registration: multiple accepted receipts for one step.");
  }
  return rows[0] ? parseReceipt(rows[0]) : null;
}

function duplicateReceipt(
  db: ConversationsDatabase,
  capability: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  accepted: ProjectChannelRegistrationReceipt,
): ProjectChannelRegistrationReceipt {
  return insertReceipt(db, buildProjectChannelRegistrationReceipt({
    capability,
    request,
    outcome: "duplicate_of_accepted",
    reason: "idempotent_replay",
    targetId: accepted.target_id,
    resultRevision: accepted.result_revision,
    resultDigest: accepted.result_digest,
    duplicateOf: accepted.receipt_id,
    acceptedReceiptId: accepted.accepted_receipt_id,
    createdByOperation: accepted.created_by_operation,
  }));
}

function changedStepReceipt(
  db: ConversationsDatabase,
  capability: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  accepted: ProjectChannelRegistrationReceipt,
): ProjectChannelRegistrationReceipt {
  return insertReceipt(db, buildProjectChannelRegistrationReceipt({
    capability,
    request,
    outcome: "terminal_nonacceptance",
    reason: "changed_request_or_precondition_for_step",
    targetId: accepted.target_id,
    resultRevision: accepted.result_revision,
    resultDigest: accepted.result_digest,
    acceptedReceiptId: accepted.accepted_receipt_id,
    createdByOperation: false,
  }));
}

export function exactProjectChannelRegistrationReplay(
  accepted: ProjectChannelRegistrationReceipt,
  request: ProjectChannelRegistrationRequest,
): boolean {
  return accepted.idempotency_key === request.idempotency_key
    && accepted.request_digest === request.request_digest
    && accepted.precondition_digest === request.precondition_digest;
}

function readChannelByName(db: ConversationsDatabase, channel: string): ChannelRow | null {
  return db.prepare("SELECT * FROM channels WHERE name = ?").get(channel) as ChannelRow | null;
}

function readChannelById(db: ConversationsDatabase, targetId: string): ChannelRow | null {
  return db.prepare("SELECT * FROM channels WHERE id = ?").get(targetId) as ChannelRow | null;
}

function preexistingEquivalent(row: ChannelRow, request: ProjectChannelRegistrationRequest): boolean {
  const snapshot = channelSnapshot(row);
  return row.name === request.project_slug
    && (row.project_id === null || row.project_id === request.project_id)
    && snapshot.description === null
    && snapshot.topic === null
    && snapshot.archived_at === null
    && snapshot.metadata === null
    && Array.isArray(snapshot.tags)
    && snapshot.tags.length === 0;
}

export function registerProjectChannel(
  request: ProjectChannelRegistrationRequest,
  options: ProjectChannelRegistrationFaultOptions = {},
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationReceipt {
  const startedAt = performance.now();
  const capability = getProjectChannelRegistrationCapability(db);
  const validated = validateProjectChannelRegistrationForward(request, capability);

  return db.transaction(() => {
    db.prepare(
      "UPDATE project_channel_registration_identity SET corpus_id = corpus_id WHERE singleton = 1",
    ).run();

    const accepted = acceptedForStep(db, capability, request);
    if (accepted) {
      const receipt = exactProjectChannelRegistrationReplay(accepted, request)
        ? duplicateReceipt(db, capability, request, accepted)
        : changedStepReceipt(db, capability, request, accepted);
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }

    if (validated.retired) {
      const receipt = insertReceipt(db, buildProjectChannelRegistrationReceipt({
        capability,
        request,
        outcome: "terminal_nonacceptance",
        reason: "retired_project_prefix",
      }));
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }

    const preexisting = readChannelByName(db, validated.channel);
    if (preexisting) {
      const record = projectChannelRegistrationChannelRecord(preexisting);
      const receipt = insertReceipt(db, buildProjectChannelRegistrationReceipt({
        capability,
        request,
        outcome: "terminal_nonacceptance",
        reason: preexistingEquivalent(preexisting, request)
          ? "preexisting_equivalent"
          : "preexisting_conflict",
        targetId: preexisting.id,
        resultRevision: record.revision,
        resultDigest: record.digest,
        createdByOperation: false,
      }));
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }

    const targetId = newChannelId();
    const row = db.prepare(`
      INSERT INTO channels (
        id, name, description, topic, project_id, created_by, metadata, tags
      ) VALUES (?, ?, NULL, NULL, ?, ?, NULL, NULL)
      RETURNING *
    `).get(
      targetId,
      validated.channel,
      request.project_id,
      PROJECT_CHANNEL_REGISTRATION_CREATOR,
    ) as ChannelRow;
    db.prepare(
      "INSERT INTO channel_members (channel, agent) VALUES (?, ?)",
    ).run(validated.channel, PROJECT_CHANNEL_REGISTRATION_CREATOR);
    options.faultInjector?.("after_channel_insert");

    const record = projectChannelRegistrationChannelRecord(row);
    const receipt = buildProjectChannelRegistrationReceipt({
      capability,
      request,
      outcome: "accepted",
      targetId,
      resultRevision: record.revision,
      resultDigest: record.digest,
      createdByOperation: true,
    });
    assertTimeBudget(startedAt, request.time_budget_ms);
    return insertReceipt(db, receipt);
  });
}

export function readProjectChannelRegistrationExact(
  request: ProjectChannelRegistrationReadRequest,
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationRecord {
  const startedAt = performance.now();
  assertBounds(request);
  if (request.resource_kind !== "channel") throw new Error("resource_kind must be channel.");
  assertRequiredText("target_id", request.target_id);
  const row = readChannelById(db, request.target_id);
  if (!row) throw new Error(`project channel registration target not found: ${request.target_id}`);
  if (request.target_selector !== undefined) {
    assertRequiredText("target_selector", request.target_selector);
    if (row.name !== request.target_selector) {
      throw new Error("project channel registration target id/channel mismatch.");
    }
  }
  const record = projectChannelRegistrationChannelRecord(row);
  projectChannelRegistrationResponseControl(record, request, startedAt);
  return record;
}

export function lookupProjectChannelRegistrationReceipt(
  request: ProjectChannelRegistrationLookupRequest,
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationLookupResult {
  const startedAt = performance.now();
  assertBounds(request);
  if (request.max_items !== 1) throw new Error("max_items must be exactly 1.");
  const capability = getProjectChannelRegistrationCapability(db);
  if (request.authority !== "conversations") {
    throw new Error("project channel registration lookup authority mismatch.");
  }
  assertProjectChannelRegistrationIdentity(request, capability);
  const params: unknown[] = [
    request.authority,
    request.authority_route,
    request.package_version,
    request.authority_id,
    request.tenant_id,
    request.corpus_id,
    request.operation_id,
    request.step_id,
    request.direction,
    request.idempotency_key,
  ];
  const targetClause = request.target_id === undefined ? "" : " AND target_id = ?";
  if (request.target_id !== undefined) params.push(request.target_id);
  const rows = db.prepare(`
    SELECT * FROM project_channel_registration_receipts
    WHERE authority = ? AND route = ? AND package_version = ?
      AND authority_id = ? AND tenant_id = ? AND corpus_id = ?
      AND operation_id = ? AND step_id = ? AND resource_kind = 'channel'
      AND direction = ? AND idempotency_key = ?
      ${targetClause}
    ORDER BY
      CASE outcome
        WHEN 'terminal_nonacceptance' THEN 3
        WHEN 'duplicate_of_accepted' THEN 2
        ELSE 1
      END DESC,
      created_at DESC,
      receipt_id DESC
    LIMIT 4
  `).all(...params) as ReceiptRow[];
  if (rows.length === 0) {
    throw new Error("project channel registration terminal receipt not found.");
  }
  const receipts = rows.map(parseReceipt);
  const accepted = receipts.filter((receipt) => receipt.outcome === "accepted");
  if (accepted.length > 1) {
    throw new Error("ambiguous project channel registration receipt population.");
  }
  for (const duplicate of receipts.filter((receipt) => receipt.outcome === "duplicate_of_accepted")) {
    if (
      accepted.length !== 1
      || duplicate.duplicate_of_receipt_id !== accepted[0].receipt_id
    ) {
      throw new Error("ambiguous project channel registration duplicate linkage.");
    }
  }
  const receipt = receipts[0];
  const result = { receipt } as { receipt: ProjectChannelRegistrationReceipt };
  return {
    receipt,
    response_control: projectChannelRegistrationResponseControl(result, request, startedAt),
  };
}

function sourceAcceptedReceipt(
  db: ConversationsDatabase,
  request: ProjectChannelRegistrationRequest,
): ProjectChannelRegistrationReceipt | null {
  const supplied = request.accepted_receipt;
  if (
    !supplied
    || supplied.outcome !== "accepted"
    || supplied.direction !== "forward"
    || !supplied.created_by_operation
    || !supplied.target_id
    || !supplied.result_revision
    || !supplied.result_digest
  ) {
    return null;
  }
  const row = db.prepare(
    "SELECT * FROM project_channel_registration_receipts WHERE receipt_id = ?",
  ).get(supplied.receipt_id) as ReceiptRow | null;
  if (!row) return null;
  const stored = parseReceipt(row);
  return sameProjectChannelRegistrationReceipt(stored, supplied) ? stored : null;
}

export function validateProjectChannelRegistrationInverse(
  request: ProjectChannelRegistrationRequest,
  capability: ProjectChannelRegistrationCapability,
  accepted: ProjectChannelRegistrationReceipt,
): void {
  assertBounds(request);
  assertProjectChannelRegistrationIdentity(request, capability);
  if (request.resource_kind !== "channel") throw new Error("resource_kind must be channel.");
  if (request.direction !== "inverse") throw new Error("direction must be inverse.");
  if (request.target_selector !== accepted.target_id) {
    throw new Error("inverse target_selector must equal the accepted target id.");
  }
  const desired = {
    accepted_receipt_id: accepted.receipt_id,
    target_id: accepted.target_id,
  };
  if (request.request_digest !== projectChannelRegistrationDigest(desired)) {
    throw new Error("inverse request_digest does not match the accepted receipt.");
  }
  const precondition = {
    target_id: accepted.target_id,
    expected_revision: accepted.result_revision,
    expected_digest: accepted.result_digest,
  };
  if (request.precondition_digest !== projectChannelRegistrationDigest(precondition)) {
    throw new Error("inverse precondition_digest does not match the accepted result.");
  }
}

function hasChannelReferences(db: ConversationsDatabase, row: ChannelRow): boolean {
  const members = db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent",
  ).all(row.name) as Array<{ agent: string }>;
  if (
    members.length !== 1
    || members[0].agent !== PROJECT_CHANNEL_REGISTRATION_CREATOR
  ) {
    return true;
  }
  const checks: Array<[string, unknown[], string | null]> = [
    ["SELECT 1 FROM channel_subscriptions WHERE channel = ? LIMIT 1", [row.name], "channel_subscriptions"],
    ["SELECT 1 FROM messages WHERE channel = ? LIMIT 1", [row.name], "messages"],
    ["SELECT 1 FROM message_mentions WHERE channel = ? LIMIT 1", [row.name], "message_mentions"],
    ["SELECT 1 FROM tasks WHERE channel = ? LIMIT 1", [row.name], "tasks"],
    [
      "SELECT 1 FROM graph_edges WHERE (from_type = 'channel' AND from_id = ?) OR (to_type = 'channel' AND to_id = ?) LIMIT 1",
      [row.name, row.name],
      "graph_edges",
    ],
    [
      "SELECT 1 FROM resource_locks WHERE resource_type = 'channel' AND resource_id = ? LIMIT 1",
      [row.name],
      "resource_locks",
    ],
  ];
  return checks.some(([sql, params, table]) => {
    if (table) {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table);
      if (!exists) return false;
    }
    return db.prepare(sql).get(...params) !== null;
  });
}

function terminalInverseReceipt(
  db: ConversationsDatabase,
  capability: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  reason: string,
  accepted: ProjectChannelRegistrationReceipt | null,
  current?: ProjectChannelRegistrationRecord | null,
): ProjectChannelRegistrationReceipt {
  return insertReceipt(db, buildProjectChannelRegistrationReceipt({
    capability,
    request,
    outcome: "terminal_nonacceptance",
    reason,
    targetId: accepted?.target_id ?? null,
    resultRevision: current?.revision ?? accepted?.result_revision ?? null,
    resultDigest: current?.digest ?? accepted?.result_digest ?? null,
    acceptedReceiptId: accepted?.receipt_id ?? null,
    createdByOperation: false,
  }));
}

export function compensateProjectChannelRegistration(
  request: ProjectChannelRegistrationRequest,
  options: ProjectChannelRegistrationFaultOptions = {},
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationReceipt {
  const startedAt = performance.now();
  assertBounds(request);
  const capability = getProjectChannelRegistrationCapability(db);
  assertProjectChannelRegistrationIdentity(request, capability);

  return db.transaction(() => {
    db.prepare(
      "UPDATE project_channel_registration_identity SET corpus_id = corpus_id WHERE singleton = 1",
    ).run();

    const accepted = sourceAcceptedReceipt(db, request);
    if (!accepted) {
      const receipt = terminalInverseReceipt(
        db,
        capability,
        request,
        "accepted_receipt_required",
        null,
      );
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }
    validateProjectChannelRegistrationInverse(request, capability, accepted);

    const priorInverse = acceptedForStep(db, capability, request);
    if (priorInverse) {
      const receipt = exactProjectChannelRegistrationReplay(priorInverse, request)
        ? duplicateReceipt(db, capability, request, priorInverse)
        : changedStepReceipt(db, capability, request, priorInverse);
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }

    const row = readChannelById(db, accepted.target_id!);
    if (!row) {
      const receipt = terminalInverseReceipt(
        db,
        capability,
        request,
        "target_missing_without_inverse_receipt",
        accepted,
      );
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }
    const current = projectChannelRegistrationChannelRecord(row);
    if (
      current.revision !== accepted.result_revision
      || current.digest !== accepted.result_digest
    ) {
      const receipt = terminalInverseReceipt(
        db,
        capability,
        request,
        "target_drifted",
        accepted,
        current,
      );
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }
    if (hasChannelReferences(db, row)) {
      const receipt = terminalInverseReceipt(
        db,
        capability,
        request,
        "target_referenced",
        accepted,
        current,
      );
      assertTimeBudget(startedAt, request.time_budget_ms);
      return receipt;
    }

    db.prepare(
      "DELETE FROM channel_members WHERE channel = ? AND agent = ?",
    ).run(row.name, PROJECT_CHANNEL_REGISTRATION_CREATOR);
    const deleted = db.prepare(
      "DELETE FROM channels WHERE id = ? AND name = ?",
    ).run(row.id, row.name);
    if (deleted.changes !== 1) {
      throw new Error("project channel registration target changed during inverse.");
    }
    options.faultInjector?.("after_channel_delete");

    const absenceDigest = projectChannelRegistrationDigest({
      target_id: accepted.target_id,
      absent: true,
    });
    const receipt = buildProjectChannelRegistrationReceipt({
      capability,
      request,
      outcome: "accepted",
      targetId: accepted.target_id,
      resultRevision: "absent",
      resultDigest: absenceDigest,
      acceptedReceiptId: accepted.receipt_id,
      createdByOperation: true,
    });
    assertTimeBudget(startedAt, request.time_budget_ms);
    return insertReceipt(db, receipt);
  });
}

export function verifyProjectChannelRegistrationInverse(
  request: ProjectChannelRegistrationRequest,
  db: ConversationsDatabase = getDb(),
): ProjectChannelRegistrationInverseVerification {
  const startedAt = performance.now();
  assertBounds(request);
  const capability = getProjectChannelRegistrationCapability(db);
  assertProjectChannelRegistrationIdentity(request, capability);
  const accepted = sourceAcceptedReceipt(db, request);
  if (!accepted) throw new Error("accepted project channel registration receipt is required.");
  validateProjectChannelRegistrationInverse(request, capability, accepted);
  if (readChannelById(db, accepted.target_id!)) {
    throw new Error("project channel registration inverse verification found the target.");
  }
  const inverse = acceptedForStep(db, capability, request);
  if (
    !inverse
    || inverse.outcome !== "accepted"
    || inverse.accepted_receipt_id !== accepted.receipt_id
  ) {
    throw new Error("accepted project channel registration inverse receipt is missing.");
  }
  const verification: ProjectChannelRegistrationInverseVerification = {
    target_id: accepted.target_id!,
    accepted_receipt_id: accepted.receipt_id,
    absent: true,
    digest: projectChannelRegistrationDigest({
      target_id: accepted.target_id,
      absent: true,
    }),
  };
  projectChannelRegistrationResponseControl(verification, request, startedAt);
  return verification;
}

async function activeAuthorityStore(
  explicit?: ProjectChannelRegistrationAuthorityStore,
): Promise<ProjectChannelRegistrationAuthorityStore> {
  if (explicit) return explicit;
  const { getStore } = await import("./store/index.js");
  return getStore();
}

export function createProjectChannelRegistrationAuthority(
  store?: ProjectChannelRegistrationAuthorityStore,
): ProjectChannelRegistrationAuthority {
  return {
    authority: "conversations",
    async capability() {
      return (await activeAuthorityStore(store)).projectChannelRegistrationCapability();
    },
    async create(request) {
      return (await activeAuthorityStore(store)).registerProjectChannel(request);
    },
    async readExact(request) {
      return (await activeAuthorityStore(store)).readProjectChannelRegistrationExact(request);
    },
    async lookupReceipt(request) {
      return (await activeAuthorityStore(store)).lookupProjectChannelRegistrationReceipt(request);
    },
    async compensate(request) {
      return (await activeAuthorityStore(store)).compensateProjectChannelRegistration(request);
    },
    async verifyInverse(request) {
      return (await activeAuthorityStore(store)).verifyProjectChannelRegistrationInverse(request);
    },
  };
}
