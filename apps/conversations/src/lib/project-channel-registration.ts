import { createHash } from "crypto";
import { version as packageVersion } from "../../package.json";
import { normalizeChannelName } from "./channel-names.js";
import { newChannelId } from "./channel-id.js";
import { getDb, type ConversationsDatabase } from "./db.js";
import {
  MESSAGE_SNAPSHOT_COLUMNS,
  projectMessageLinkageHashes,
  type ProjectMessageLinkageRow,
} from "./project-message-linkage.js";

export const PROJECT_CHANNEL_REGISTRATION_ROUTE = "/v1/project-registration/channels";
export const PROJECT_CHANNEL_REGISTRATION_CREATOR = "project-registration";

export type ProjectChannelRegistrationDirection = "forward" | "inverse";
export type ProjectChannelRegistrationOperationIntent = "create" | "bind_existing";
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
  conditional_bind_existing: true;
  immutable_receipts: true;
  exact_terminal_lookup: true;
  exact_readback: true;
  conditional_inverse: true;
  ambiguous_outcome_reconciliation: true;
}

export interface ProjectChannelRegistrationPriorState {
  target_id: string;
  project_id: string | null;
  bound_project_id: string;
  revision: string;
  digest: string;
  message_project_digest: string;
  message_transition: ProjectChannelRegistrationMessageTransition;
}

export interface ProjectChannelRegistrationMessageTransition {
  source_project_id: string | null;
  target_project_id: string;
  message_count: number;
  first_message_id: number | null;
  last_message_id: number | null;
  message_ids_digest: string;
  before_digest: string;
  after_digest: string;
  preserved_digest: string;
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
  prior_state: ProjectChannelRegistrationPriorState | null;
  created_at: string;
}

export interface ProjectChannelRegistrationRecord {
  target_id: string;
  revision: string;
  digest: string;
}

export interface ProjectChannelRegistrationRequest extends ProjectChannelRegistrationBounds {
  operation_intent?: ProjectChannelRegistrationOperationIntent;
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
  bind_existing?: {
    target_id: string;
    expected_project_id: string | null;
    expected_revision: string;
    expected_digest: string;
  };
  target: ProjectChannelRegistrationPathHandle;
  accepted_receipt?: ProjectChannelRegistrationReceipt;
}

export interface ProjectChannelRegistrationReadRequest extends ProjectChannelRegistrationBounds {
  resource_kind: ProjectChannelRegistrationResourceKind;
  target_id: string;
  target_selector?: string;
  target: ProjectChannelRegistrationPathHandle;
}

export interface ProjectChannelCollectionRequest extends ProjectChannelRegistrationBounds {
  project_id: string;
  cursor?: string;
  max_items: number;
}

export interface ProjectChannelCollectionItem extends ProjectChannelRegistrationRecord {
  authority: "conversations";
  resource_kind: "channel";
  scope: "collection";
  project_id: string;
  channel: string;
}

export interface ProjectChannelCollectionPage {
  authority: "conversations";
  resource_kind: "channel";
  scope: "collection";
  project_id: string;
  items: ProjectChannelCollectionItem[];
  cursor: string | null;
  next_cursor: string | null;
  cursor_semantics: "exclusive_stable_id";
  max_items: number;
  item_count: number;
  has_more: boolean;
  complete: boolean;
  truncated: boolean;
  response_bytes: number;
  elapsed_ms: number;
}

export interface ProjectChannelMessageCollectionRequest extends ProjectChannelRegistrationBounds {
  project_id: string;
  target_id: string;
  cursor?: number;
  max_items: number;
}

export interface ProjectChannelMessageCollectionItem {
  authority: "conversations";
  resource_kind: "message";
  scope: "resource";
  target_id: string;
  local_id: number;
  channel_id: string;
  channel: string;
  project_id: string;
  reply_to_target_id: string | null;
  revision: string;
  digest: string;
}

export interface ProjectChannelMessageCollectionPage {
  authority: "conversations";
  resource_kind: "message";
  scope: "collection";
  project_id: string;
  channel_id: string;
  channel: string;
  items: ProjectChannelMessageCollectionItem[];
  cursor: number | null;
  next_cursor: number | null;
  cursor_semantics: "exclusive_local_id";
  max_items: number;
  item_count: number;
  has_more: boolean;
  complete: boolean;
  truncated: boolean;
  response_bytes: number;
  elapsed_ms: number;
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
  request_digest: string;
  precondition_digest: string;
  precondition_kind?: "absent" | "bind_existing";
  target_id?: string;
  max_items: 1;
}

export interface ProjectChannelRegistrationLookupResult {
  receipt: ProjectChannelRegistrationReceipt;
  response_control: ProjectChannelRegistrationResponseControl;
}

export interface ProjectChannelRegistrationCreateInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: true;
  digest: string;
}

export interface ProjectChannelRegistrationBindingInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: false;
  restored: true;
  project_id: string | null;
  revision: string;
  digest: string;
}

export type ProjectChannelRegistrationInverseVerification =
  | ProjectChannelRegistrationCreateInverseVerification
  | ProjectChannelRegistrationBindingInverseVerification;

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
  faultInjector?: (point:
    | "after_channel_insert"
    | "after_channel_bind"
    | "after_message_bind"
    | "after_channel_delete"
    | "after_message_restore"
    | "after_channel_restore"
  ) => void;
}

type ReceiptRow = Omit<ProjectChannelRegistrationReceipt, "created_by_operation" | "prior_state"> & {
  created_by_operation: number | boolean;
  prior_state: string | ProjectChannelRegistrationPriorState | null;
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

export type ProjectChannelMessageCollectionRow = Record<string, unknown> & {
  local_id: number;
  target_id: string;
  channel_id: string;
  channel: string;
  project_id: string;
  reply_to_target_id: string | null;
  session_id: string;
  from_agent: string;
  to_agent: string;
  content: string;
  priority: string;
  created_at: string;
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

function assertCollectionBounds(
  input: ProjectChannelCollectionRequest | ProjectChannelMessageCollectionRequest,
): void {
  assertBounds(input);
  assertRequiredText("project_id", input.project_id);
  if (!/^wks_[A-Za-z0-9_-]{8,}$/.test(input.project_id)) {
    throw new Error("project_id must be the full immutable Projects workspace id.");
  }
  if (!Number.isInteger(input.max_items) || input.max_items <= 0 || input.max_items > 1000) {
    throw new Error("max_items must be an integer between 1 and 1000.");
  }
}

export function validateProjectChannelCollectionRequest(
  input: ProjectChannelCollectionRequest,
): void {
  assertCollectionBounds(input);
  if (input.cursor !== undefined && !/^chn_[0-9a-f]{32}$/.test(input.cursor)) {
    throw new Error("cursor must be a stable chn_ channel id.");
  }
}

export function validateProjectChannelMessageCollectionRequest(
  input: ProjectChannelMessageCollectionRequest,
): void {
  assertCollectionBounds(input);
  if (!/^chn_[0-9a-f]{32}$/.test(input.target_id)) {
    throw new Error("target_id must be a stable chn_ channel id.");
  }
  if (input.cursor !== undefined && (!Number.isInteger(input.cursor) || input.cursor < 0)) {
    throw new Error("cursor must be a non-negative integer message id.");
  }
}

function finalizeCollectionPage<T extends { response_bytes: number; elapsed_ms: number }>(
  page: T,
  bounds: ProjectChannelRegistrationBounds,
  startedAt: number,
): T {
  page.elapsed_ms = elapsedMs(startedAt);
  for (let index = 0; index < 16; index++) {
    const actualBytes = Buffer.byteLength(JSON.stringify(page), "utf8");
    if (page.response_bytes === actualBytes) break;
    page.response_bytes = actualBytes;
  }
  const exactBytes = Buffer.byteLength(JSON.stringify(page), "utf8");
  if (page.response_bytes !== exactBytes) {
    throw new Error("project channel collection response_bytes did not converge.");
  }
  if (page.response_bytes > bounds.response_byte_limit) {
    throw new Error(
      `project channel collection exceeded response_byte_limit (${page.response_bytes} > ${bounds.response_byte_limit}).`,
    );
  }
  if (page.elapsed_ms > bounds.time_budget_ms) {
    throw new Error(
      `project channel collection exceeded time_budget_ms (${page.elapsed_ms} > ${bounds.time_budget_ms}).`,
    );
  }
  return page;
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

export function buildProjectChannelCollectionPage(
  request: ProjectChannelCollectionRequest,
  rows: ChannelRow[],
  startedAt: number,
): ProjectChannelCollectionPage {
  validateProjectChannelCollectionRequest(request);
  for (const row of rows) {
    if (!/^chn_[0-9a-f]{32}$/.test(row.id)) {
      throw new Error(`channel ${row.name} does not have a stable chn_ id.`);
    }
    if (row.project_id !== request.project_id) {
      throw new Error(`channel ${row.name} conflicts with requested project ${request.project_id}.`);
    }
  }
  const hasMore = rows.length > request.max_items;
  const pageRows = hasMore ? rows.slice(0, request.max_items) : rows;
  const items = pageRows.map((row): ProjectChannelCollectionItem => ({
    authority: "conversations",
    resource_kind: "channel",
    scope: "collection",
    project_id: request.project_id,
    channel: row.name,
    ...projectChannelRegistrationChannelRecord(row),
  }));
  return finalizeCollectionPage({
    authority: "conversations",
    resource_kind: "channel",
    scope: "collection",
    project_id: request.project_id,
    items,
    cursor: request.cursor ?? null,
    next_cursor: hasMore ? items[items.length - 1]?.target_id ?? null : null,
    cursor_semantics: "exclusive_stable_id",
    max_items: request.max_items,
    item_count: items.length,
    has_more: hasMore,
    complete: !hasMore,
    truncated: hasMore,
    response_bytes: 0,
    elapsed_ms: 0,
  }, request, startedAt);
}

export function projectChannelMessageCollectionItem(
  row: ProjectChannelMessageCollectionRow,
): ProjectChannelMessageCollectionItem {
  const snapshot = {
    target_id: row.target_id,
    local_id: Number(row.local_id),
    channel_id: row.channel_id,
    channel: row.channel,
    project_id: row.project_id,
    reply_to_target_id: row.reply_to_target_id ?? null,
    session_id: row.session_id,
    from_agent: row.from_agent,
    to_agent: row.to_agent,
    content: row.content,
    priority: row.priority,
    created_at: row.created_at,
  };
  return {
    authority: "conversations",
    resource_kind: "message",
    scope: "resource",
    target_id: row.target_id,
    local_id: Number(row.local_id),
    channel_id: row.channel_id,
    channel: row.channel,
    project_id: row.project_id,
    reply_to_target_id: row.reply_to_target_id ?? null,
    revision: projectChannelRegistrationDigest({
      target_id: row.target_id,
      local_id: Number(row.local_id),
      channel_id: row.channel_id,
      project_id: row.project_id,
    }),
    digest: projectChannelRegistrationDigest(snapshot),
  };
}

export function buildProjectChannelMessageCollectionPage(
  request: ProjectChannelMessageCollectionRequest,
  channel: Pick<ChannelRow, "id" | "name" | "project_id">,
  rows: ProjectChannelMessageCollectionRow[],
  startedAt: number,
): ProjectChannelMessageCollectionPage {
  validateProjectChannelMessageCollectionRequest(request);
  if (channel.id !== request.target_id) {
    throw new Error("project channel collection target id mismatch.");
  }
  if (channel.project_id !== request.project_id) {
    throw new Error(
      `Project ${request.project_id} conflicts with channel project ${channel.project_id ?? "(unlinked)"}.`,
    );
  }
  for (const row of rows) {
    if (
      row.channel_id !== channel.id
      || row.channel !== channel.name
      || row.project_id !== request.project_id
    ) {
      throw new Error(`message ${row.target_id} conflicts with channel collection membership.`);
    }
  }
  const hasMore = rows.length > request.max_items;
  const pageRows = hasMore ? rows.slice(0, request.max_items) : rows;
  const items = pageRows.map(projectChannelMessageCollectionItem);
  return finalizeCollectionPage({
    authority: "conversations",
    resource_kind: "message",
    scope: "collection",
    project_id: request.project_id,
    channel_id: channel.id,
    channel: channel.name,
    items,
    cursor: request.cursor ?? null,
    next_cursor: hasMore ? items[items.length - 1]?.local_id ?? null : null,
    cursor_semantics: "exclusive_local_id",
    max_items: request.max_items,
    item_count: items.length,
    has_more: hasMore,
    complete: !hasMore,
    truncated: hasMore,
    response_bytes: 0,
    elapsed_ms: 0,
  }, request, startedAt);
}

export function listProjectChannelRegistrationPage(
  request: ProjectChannelCollectionRequest,
  db: ConversationsDatabase = getDb(),
): ProjectChannelCollectionPage {
  const startedAt = performance.now();
  validateProjectChannelCollectionRequest(request);
  const rows = db.prepare(`
    SELECT *
    FROM channels
    WHERE project_id = ? AND (? IS NULL OR id > ?)
    ORDER BY id ASC
    LIMIT ?
  `).all(
    request.project_id,
    request.cursor ?? null,
    request.cursor ?? null,
    request.max_items + 1,
  ) as ChannelRow[];
  return buildProjectChannelCollectionPage(request, rows, startedAt);
}

export function listProjectChannelMessagePage(
  request: ProjectChannelMessageCollectionRequest,
  db: ConversationsDatabase = getDb(),
): ProjectChannelMessageCollectionPage {
  const startedAt = performance.now();
  validateProjectChannelMessageCollectionRequest(request);
  const channel = readChannelById(db, request.target_id);
  if (!channel) {
    throw new Error(`project channel registration target not found: ${request.target_id}`);
  }
  if (channel.project_id !== request.project_id) {
    throw new Error(
      `Project ${request.project_id} conflicts with channel project ${channel.project_id ?? "(unlinked)"}.`,
    );
  }
  const inconsistent = db.prepare(`
    SELECT COUNT(*) AS count
    FROM messages
    WHERE channel = ? AND (project_id IS NULL OR project_id <> ?)
  `).get(channel.name, request.project_id) as { count: number };
  if (Number(inconsistent.count) > 0) {
    throw new Error(
      `Channel ${channel.name} has ${inconsistent.count} message(s) outside project ${request.project_id}; apply guarded project-message linkage before collection readback.`,
    );
  }
  const rows = db.prepare(`
    SELECT
      m.id AS local_id,
      m.uuid AS target_id,
      c.id AS channel_id,
      m.channel AS channel,
      m.project_id AS project_id,
      parent.uuid AS reply_to_target_id,
      m.session_id,
      m.from_agent,
      m.to_agent,
      m.content,
      m.priority,
      m.created_at
    FROM messages m
    JOIN channels c ON c.name = m.channel
    LEFT JOIN messages parent
      ON parent.id = m.reply_to
     AND parent.channel = m.channel
     AND parent.session_id = m.session_id
    WHERE c.id = ? AND m.project_id = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(
    request.target_id,
    request.project_id,
    request.cursor ?? 0,
    request.max_items + 1,
  ) as ProjectChannelMessageCollectionRow[];
  return buildProjectChannelMessageCollectionPage(request, channel, rows, startedAt);
}

function parseReceipt(row: ReceiptRow): ProjectChannelRegistrationReceipt {
  const priorState = typeof row.prior_state === "string"
    ? parseJsonObject(row.prior_state) as unknown as ProjectChannelRegistrationPriorState | null
    : row.prior_state;
  return {
    ...row,
    authority: "conversations",
    resource_kind: "channel",
    created_by_operation: row.created_by_operation === true || Number(row.created_by_operation) === 1,
    prior_state: priorState ?? null,
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
    conditional_bind_existing: true,
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

export function assertProjectChannelRegistrationOperationIntent(
  request: Pick<
    ProjectChannelRegistrationRequest,
    | "operation_intent"
    | "bind_existing"
    | "desired"
    | "precondition_digest"
    | "target_selector"
  >,
  expected: ProjectChannelRegistrationOperationIntent,
): void {
  const desiredBind = request.desired.registration_mode === "bind_existing";
  const bindShape = request.bind_existing !== undefined || desiredBind;
  if (
    expected === "create"
    && request.operation_intent === undefined
    && bindShape
  ) {
    throw new Error("project channel registration create surface rejects bind-existing intent.");
  }
  const legacyExpectedAbsentCreate = expected === "create"
    && request.operation_intent === undefined
    && !bindShape
    && request.precondition_digest === projectChannelRegistrationDigest({
      target_selector: request.target_selector,
      expected: "absent",
    });
  if (request.operation_intent !== expected && !legacyExpectedAbsentCreate) {
    throw new Error(
      `project channel registration ${expected} surface requires operation_intent=${expected}.`,
    );
  }
  if (expected === "create" && bindShape) {
    throw new Error("project channel registration create surface rejects bind-existing intent.");
  }
  if (expected === "bind_existing" && (!request.bind_existing || !desiredBind)) {
    throw new Error("project channel registration bind-existing surface requires bind-existing intent.");
  }
}

export function validateProjectChannelRegistrationForward(
  request: ProjectChannelRegistrationRequest,
  capability: ProjectChannelRegistrationCapability,
): {
  channel: string;
  retired: boolean;
  binding: ProjectChannelRegistrationRequest["bind_existing"] | null;
} {
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
  const binding = request.bind_existing ?? null;
  if (
    request.operation_intent !== undefined
    && request.operation_intent !== "create"
    && request.operation_intent !== "bind_existing"
  ) {
    throw new Error("operation_intent must be create or bind_existing.");
  }
  assertProjectChannelRegistrationOperationIntent(
    request,
    request.operation_intent ?? "create",
  );
  if (!binding && request.desired.registration_mode === "bind_existing") {
    throw new Error("bind-existing registration requires bind_existing preconditions.");
  }
  if (binding) {
    assertRequiredText("bind_existing.target_id", binding.target_id);
    assertRequiredText("bind_existing.expected_revision", binding.expected_revision);
    assertRequiredText("bind_existing.expected_digest", binding.expected_digest);
    if (!/^chn_[0-9a-f]{32}$/.test(binding.target_id)) {
      throw new Error("bind_existing.target_id must be a stable chn_ id.");
    }
    if (
      binding.expected_project_id !== null
      && (typeof binding.expected_project_id !== "string" || !binding.expected_project_id.trim())
    ) {
      throw new Error("bind_existing.expected_project_id must be null or a non-empty string.");
    }
    if (binding.expected_project_id === request.project_id) {
      throw new Error("bind_existing must change project ownership.");
    }
    if (
      request.desired.registration_mode !== "bind_existing"
      || request.desired.target_id !== binding.target_id
      || request.desired.expected_project_id !== binding.expected_project_id
    ) {
      throw new Error("desired bind-existing identity does not match the request.");
    }
  }
  if (request.request_digest !== projectChannelRegistrationDigest(request.desired)) {
    throw new Error("request_digest does not match desired.");
  }
  const expectedPrecondition = binding
    ? projectChannelRegistrationDigest({
        target_id: binding.target_id,
        target_selector: channel,
        expected_project_id: binding.expected_project_id,
        expected_revision: binding.expected_revision,
        expected_digest: binding.expected_digest,
        desired_project_id: request.project_id,
      })
    : projectChannelRegistrationDigest({
        target_selector: channel,
        expected: "absent",
      });
  if (request.precondition_digest !== expectedPrecondition) {
    throw new Error(binding
      ? "precondition_digest does not describe the exact bind-existing transition."
      : "precondition_digest does not describe expected-absent.");
  }
  return { channel, retired: retiredPrefix(channel), binding };
}

function receiptId(input: {
  capability: ProjectChannelRegistrationCapability;
  request: ProjectChannelRegistrationRequest;
  outcome: ProjectChannelRegistrationOutcome;
  reason: string | null;
  targetId: string | null;
  duplicateOf: string | null;
  acceptedReceiptId: string | null;
  priorState: ProjectChannelRegistrationPriorState | null;
}): string {
  const identity: { [key: string]: ProjectChannelRegistrationJson } = {
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
  };
  // Preserve the pre-bind receipt identity for ordinary create/inverse
  // receipts. Only binding receipts add the new prior-state dimension.
  if (input.priorState !== null) {
    identity.prior_state = {
      target_id: input.priorState.target_id,
      project_id: input.priorState.project_id,
      bound_project_id: input.priorState.bound_project_id,
      revision: input.priorState.revision,
      digest: input.priorState.digest,
      message_project_digest: input.priorState.message_project_digest,
      message_transition: {
        source_project_id: input.priorState.message_transition.source_project_id,
        target_project_id: input.priorState.message_transition.target_project_id,
        message_count: input.priorState.message_transition.message_count,
        first_message_id: input.priorState.message_transition.first_message_id,
        last_message_id: input.priorState.message_transition.last_message_id,
        message_ids_digest: input.priorState.message_transition.message_ids_digest,
        before_digest: input.priorState.message_transition.before_digest,
        after_digest: input.priorState.message_transition.after_digest,
        preserved_digest: input.priorState.message_transition.preserved_digest,
      },
    };
  }
  return `pcr_${projectChannelRegistrationDigest(identity).slice(0, 32)}`;
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
  priorState?: ProjectChannelRegistrationPriorState | null;
}): ProjectChannelRegistrationReceipt {
  const reason = input.reason ?? null;
  const targetId = input.targetId ?? null;
  const duplicateOf = input.duplicateOf ?? null;
  const acceptedReceiptId = input.acceptedReceiptId ?? null;
  const priorState = input.priorState ?? null;
  return {
    receipt_id: receiptId({
      capability: input.capability,
      request: input.request,
      outcome: input.outcome,
      reason,
      targetId,
      duplicateOf,
      acceptedReceiptId,
      priorState,
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
    prior_state: priorState,
    created_at: nowIso(),
  };
}

export function sameProjectChannelRegistrationReceipt(left: ProjectChannelRegistrationReceipt, right: ProjectChannelRegistrationReceipt): boolean {
  const { created_at: _leftCreated, ...leftStable } = left;
  const { created_at: _rightCreated, ...rightStable } = right;
  return projectChannelRegistrationDigest({
    ...leftStable,
    prior_state: left.prior_state ?? null,
  }) === projectChannelRegistrationDigest({
    ...rightStable,
    prior_state: right.prior_state ?? null,
  });
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
      accepted_receipt_id, created_by_operation, prior_state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    receipt.prior_state === null ? null : JSON.stringify(receipt.prior_state),
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
    priorState: accepted.prior_state,
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
    priorState: accepted.prior_state,
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

function messageProjectDigest(db: ConversationsDatabase, channel: string): string {
  const rows = db.prepare(`
    SELECT id, uuid, project_id
    FROM messages
    WHERE channel = ?
    ORDER BY id ASC
  `).all(channel) as Array<{
    id: number;
    uuid: string;
    project_id: string | null;
  }>;
  return projectChannelRegistrationDigest(rows.map((row) => ({
    id: Number(row.id),
    uuid: row.uuid,
    project_id: row.project_id ?? null,
  })));
}

function readMessageOwnershipRows(
  db: ConversationsDatabase,
  channel: string,
): ProjectMessageLinkageRow[] {
  return db.prepare(
    `SELECT ${MESSAGE_SNAPSHOT_COLUMNS.join(", ")}
     FROM messages
     WHERE channel = ?
     ORDER BY id ASC`,
  ).all(channel) as ProjectMessageLinkageRow[];
}

function messageOwnershipSnapshot(rows: ProjectMessageLinkageRow[]): {
  message_count: number;
  first_message_id: number | null;
  last_message_id: number | null;
  message_ids_digest: string;
  digest: string;
  preserved_digest: string;
} {
  const ordered = rows.slice().sort((left, right) => Number(left.id) - Number(right.id));
  const hashes = projectMessageLinkageHashes(ordered);
  return {
    message_count: ordered.length,
    first_message_id: ordered.length > 0 ? Number(ordered[0].id) : null,
    last_message_id: ordered.length > 0 ? Number(ordered[ordered.length - 1].id) : null,
    message_ids_digest: projectChannelRegistrationDigest(
      ordered.map((row) => ({ id: Number(row.id), uuid: String(row.uuid) })),
    ),
    digest: projectChannelRegistrationDigest(
      hashes.map((entry) => ({ id: entry.id, uuid: entry.uuid, hash: entry.hash })),
    ),
    preserved_digest: projectChannelRegistrationDigest(
      hashes.map((entry) => ({
        id: entry.id,
        uuid: entry.uuid,
        preserved_hash: entry.preserved_hash,
      })),
    ),
  };
}

export function buildProjectChannelRegistrationMessageTransition(
  beforeRows: ProjectMessageLinkageRow[],
  afterRows: ProjectMessageLinkageRow[],
  sourceProjectId: string | null,
  targetProjectId: string,
): ProjectChannelRegistrationMessageTransition {
  if (beforeRows.some((row) => (row.project_id ?? null) !== sourceProjectId)) {
    throw new Error("project channel registration messages do not match the validated prior owner.");
  }
  if (afterRows.some((row) => row.project_id !== targetProjectId)) {
    throw new Error("project channel registration message ownership transition did not reach the target owner.");
  }
  const before = messageOwnershipSnapshot(beforeRows);
  const after = messageOwnershipSnapshot(afterRows);
  if (
    before.message_count !== after.message_count
    || before.first_message_id !== after.first_message_id
    || before.last_message_id !== after.last_message_id
    || before.message_ids_digest !== after.message_ids_digest
    || before.preserved_digest !== after.preserved_digest
  ) {
    throw new Error("project channel registration messages changed outside project_id.");
  }
  return {
    source_project_id: sourceProjectId,
    target_project_id: targetProjectId,
    message_count: before.message_count,
    first_message_id: before.first_message_id,
    last_message_id: before.last_message_id,
    message_ids_digest: before.message_ids_digest,
    before_digest: before.digest,
    after_digest: after.digest,
    preserved_digest: before.preserved_digest,
  };
}

export function projectChannelRegistrationMessageOwnershipMatches(
  rows: ProjectMessageLinkageRow[],
  transition: ProjectChannelRegistrationMessageTransition,
  expected: "before" | "after",
): boolean {
  const projectId = expected === "before"
    ? transition.source_project_id
    : transition.target_project_id;
  if (rows.some((row) => (row.project_id ?? null) !== projectId)) return false;
  const snapshot = messageOwnershipSnapshot(rows);
  return snapshot.message_count === transition.message_count
    && snapshot.first_message_id === transition.first_message_id
    && snapshot.last_message_id === transition.last_message_id
    && snapshot.message_ids_digest === transition.message_ids_digest
    && snapshot.preserved_digest === transition.preserved_digest
    && snapshot.digest === (expected === "before"
      ? transition.before_digest
      : transition.after_digest);
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
    if (validated.binding) {
      if (!preexisting) {
        const receipt = insertReceipt(db, buildProjectChannelRegistrationReceipt({
          capability,
          request,
          outcome: "terminal_nonacceptance",
          reason: "bind_target_missing",
        }));
        assertTimeBudget(startedAt, request.time_budget_ms);
        return receipt;
      }
      const priorRecord = projectChannelRegistrationChannelRecord(preexisting);
      if (
        preexisting.id !== validated.binding.target_id
        || preexisting.project_id !== validated.binding.expected_project_id
        || priorRecord.revision !== validated.binding.expected_revision
        || priorRecord.digest !== validated.binding.expected_digest
      ) {
        const receipt = insertReceipt(db, buildProjectChannelRegistrationReceipt({
          capability,
          request,
          outcome: "terminal_nonacceptance",
          reason: "bind_precondition_conflict",
          targetId: preexisting.id,
          resultRevision: priorRecord.revision,
          resultDigest: priorRecord.digest,
          createdByOperation: false,
        }));
        assertTimeBudget(startedAt, request.time_budget_ms);
        return receipt;
      }
      const beforeMessages = readMessageOwnershipRows(db, preexisting.name);
      if (beforeMessages.some(
        (message) => (message.project_id ?? null) !== validated.binding!.expected_project_id,
      )) {
        const receipt = insertReceipt(db, buildProjectChannelRegistrationReceipt({
          capability,
          request,
          outcome: "terminal_nonacceptance",
          reason: "bind_message_owner_conflict",
          targetId: preexisting.id,
          resultRevision: priorRecord.revision,
          resultDigest: priorRecord.digest,
          createdByOperation: false,
        }));
        assertTimeBudget(startedAt, request.time_budget_ms);
        return receipt;
      }
      const beforeMessageProjectDigest = messageProjectDigest(db, preexisting.name);
      const bound = db.prepare(`
        UPDATE channels
        SET project_id = ?
        WHERE id = ? AND name = ? AND project_id IS ?
        RETURNING *
      `).get(
        request.project_id,
        preexisting.id,
        preexisting.name,
        validated.binding.expected_project_id,
      ) as ChannelRow | null;
      if (!bound) {
        throw new Error("project channel registration bind target changed during update.");
      }
      options.faultInjector?.("after_channel_bind");
      const messageUpdate = db.prepare(`
        UPDATE messages
        SET project_id = ?
        WHERE channel = ? AND project_id IS ?
      `).run(
        request.project_id,
        preexisting.name,
        validated.binding.expected_project_id,
      );
      if (messageUpdate.changes !== beforeMessages.length) {
        throw new Error("project channel registration messages changed during ownership transition.");
      }
      const afterMessages = readMessageOwnershipRows(db, preexisting.name);
      const messageTransition = buildProjectChannelRegistrationMessageTransition(
        beforeMessages,
        afterMessages,
        validated.binding.expected_project_id,
        request.project_id,
      );
      options.faultInjector?.("after_message_bind");
      const priorState: ProjectChannelRegistrationPriorState = {
        target_id: preexisting.id,
        project_id: preexisting.project_id,
        bound_project_id: request.project_id,
        revision: priorRecord.revision,
        digest: priorRecord.digest,
        message_project_digest: beforeMessageProjectDigest,
        message_transition: messageTransition,
      };
      const record = projectChannelRegistrationChannelRecord(bound);
      const receipt = buildProjectChannelRegistrationReceipt({
        capability,
        request,
        outcome: "accepted",
        targetId: bound.id,
        resultRevision: record.revision,
        resultDigest: record.digest,
        createdByOperation: false,
        priorState,
      });
      assertTimeBudget(startedAt, request.time_budget_ms);
      return insertReceipt(db, receipt);
    }
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
  const capability = getProjectChannelRegistrationCapability(db);
  const exactTargetId = validateProjectChannelRegistrationLookup(request, capability);
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
    request.request_digest,
    request.precondition_digest,
  ];
  const targetClause = exactTargetId === undefined ? "" : " AND target_id = ?";
  if (exactTargetId !== undefined) params.push(exactTargetId);
  const rows = db.prepare(`
    SELECT * FROM project_channel_registration_receipts
    WHERE authority = ? AND route = ? AND package_version = ?
      AND authority_id = ? AND tenant_id = ? AND corpus_id = ?
      AND operation_id = ? AND step_id = ? AND resource_kind = 'channel'
      AND direction = ? AND idempotency_key = ?
      AND request_digest = ? AND precondition_digest = ?
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

export function validateProjectChannelRegistrationLookup(
  request: ProjectChannelRegistrationLookupRequest,
  capability: ProjectChannelRegistrationCapability,
): string | undefined {
  assertBounds(request);
  if (request.max_items !== 1) throw new Error("max_items must be exactly 1.");
  if (request.authority !== "conversations") {
    throw new Error("project channel registration lookup authority mismatch.");
  }
  for (const [name, value] of [
    ["authority_route", request.authority_route],
    ["package_version", request.package_version],
    ["authority_id", request.authority_id],
    ["tenant_id", request.tenant_id],
    ["corpus_id", request.corpus_id],
  ] as const) {
    assertRequiredText(name, value);
  }
  // A terminal lookup may intentionally target immutable evidence written by
  // an older package/route/authority/corpus identity. Those historical fields
  // remain exact SQL predicates below; only the tenant stays bound to today's
  // advertised capability so one tenant cannot substitute another's receipt.
  if (request.tenant_id !== capability.tenant_id) {
    throw new Error("project channel registration authority identity mismatch.");
  }
  if (request.resource_kind !== "channel") throw new Error("resource_kind must be channel.");
  if (request.direction !== "forward" && request.direction !== "inverse") {
    throw new Error("direction must be forward or inverse.");
  }
  for (const [name, value] of [
    ["operation_id", request.operation_id],
    ["step_id", request.step_id],
    ["target_selector", request.target_selector],
    ["idempotency_key", request.idempotency_key],
    ["request_digest", request.request_digest],
    ["precondition_digest", request.precondition_digest],
  ] as const) {
    assertRequiredText(name, value);
  }
  if (
    request.precondition_kind !== undefined
    && request.precondition_kind !== "absent"
    && request.precondition_kind !== "bind_existing"
  ) {
    throw new Error("precondition_kind must be absent or bind_existing.");
  }
  if (request.direction === "forward") {
    if (request.precondition_kind === "bind_existing") {
      if (request.target_id === undefined) {
        throw new Error("bind-existing receipt lookup requires the exact target_id.");
      }
    } else if (request.precondition_digest !== projectChannelRegistrationDigest({
      target_selector: request.target_selector,
      expected: "absent",
    })) {
      throw new Error("lookup precondition_digest does not bind target_selector.");
    }
  }
  if (
    request.direction === "inverse"
    && request.target_id !== undefined
    && request.target_id !== request.target_selector
  ) {
    throw new Error("inverse lookup target_id must equal target_selector.");
  }
  return request.target_id
    ?? (request.direction === "inverse" ? request.target_selector : undefined);
}

function sourceAcceptedReceipt(
  db: ConversationsDatabase,
  request: ProjectChannelRegistrationRequest,
): ProjectChannelRegistrationReceipt | null {
  const supplied = request.accepted_receipt;
  const acceptedCreate = supplied?.created_by_operation === true
    && supplied.prior_state == null;
  const acceptedBinding = supplied?.created_by_operation === false
    && supplied.prior_state != null;
  if (
    !supplied
    || supplied.outcome !== "accepted"
    || supplied.direction !== "forward"
    || (!acceptedCreate && !acceptedBinding)
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
  validateProjectChannelRegistrationInverseEnvelope(request, capability);
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
  if (
    accepted.prior_state
    && (
      accepted.prior_state.target_id !== accepted.target_id
      || accepted.prior_state.bound_project_id !== request.project_id
    )
  ) {
    throw new Error("inverse request does not match the accepted bind-existing ownership.");
  }
  const expectedIntent: ProjectChannelRegistrationOperationIntent = accepted.prior_state
    ? "bind_existing"
    : "create";
  if (
    request.operation_intent !== undefined
    && request.operation_intent !== expectedIntent
  ) {
    throw new Error(`inverse operation_intent must be ${expectedIntent}.`);
  }
}

export function validateProjectChannelRegistrationInverseEnvelope(
  request: ProjectChannelRegistrationRequest,
  capability: ProjectChannelRegistrationCapability,
): void {
  assertBounds(request);
  assertProjectChannelRegistrationIdentity(request, capability);
  if (request.resource_kind !== "channel") throw new Error("resource_kind must be channel.");
  if (request.direction !== "inverse") throw new Error("direction must be inverse.");
  for (const [name, value] of [
    ["operation_id", request.operation_id],
    ["step_id", request.step_id],
    ["target_selector", request.target_selector],
    ["idempotency_key", request.idempotency_key],
    ["request_digest", request.request_digest],
    ["precondition_digest", request.precondition_digest],
  ] as const) {
    assertRequiredText(name, value);
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
    priorState: accepted?.prior_state ?? null,
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
  validateProjectChannelRegistrationInverseEnvelope(request, capability);

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
    if (accepted.prior_state) {
      const prior = accepted.prior_state;
      const currentMessages = readMessageOwnershipRows(db, row.name);
      if (
        row.project_id !== prior.bound_project_id
        || !projectChannelRegistrationMessageOwnershipMatches(
          currentMessages,
          prior.message_transition,
          "after",
        )
      ) {
        const receipt = terminalInverseReceipt(
          db,
          capability,
          request,
          "message_ownership_drifted",
          accepted,
          current,
        );
        assertTimeBudget(startedAt, request.time_budget_ms);
        return receipt;
      }
      const messageRestore = db.prepare(`
        UPDATE messages
        SET project_id = ?
        WHERE channel = ? AND project_id = ?
      `).run(
        prior.project_id,
        row.name,
        prior.bound_project_id,
      );
      if (messageRestore.changes !== prior.message_transition.message_count) {
        throw new Error("project channel registration messages changed during inverse.");
      }
      const restoredMessages = readMessageOwnershipRows(db, row.name);
      if (!projectChannelRegistrationMessageOwnershipMatches(
        restoredMessages,
        prior.message_transition,
        "before",
      )) {
        throw new Error("project channel registration message ownership inverse did not restore the prior state.");
      }
      options.faultInjector?.("after_message_restore");
      const restored = db.prepare(`
        UPDATE channels
        SET project_id = ?
        WHERE id = ? AND name = ? AND project_id = ?
        RETURNING *
      `).get(
        prior.project_id,
        row.id,
        row.name,
        prior.bound_project_id,
      ) as ChannelRow | null;
      if (!restored) {
        throw new Error("project channel registration bind target changed during inverse.");
      }
      options.faultInjector?.("after_channel_restore");
      const restoredRecord = projectChannelRegistrationChannelRecord(restored);
      if (
        restoredRecord.revision !== prior.revision
        || restoredRecord.digest !== prior.digest
      ) {
        throw new Error("project channel registration bind inverse did not restore the prior state.");
      }
      const receipt = buildProjectChannelRegistrationReceipt({
        capability,
        request,
        outcome: "accepted",
        targetId: accepted.target_id,
        resultRevision: restoredRecord.revision,
        resultDigest: restoredRecord.digest,
        acceptedReceiptId: accepted.receipt_id,
        createdByOperation: false,
        priorState: prior,
      });
      assertTimeBudget(startedAt, request.time_budget_ms);
      return insertReceipt(db, receipt);
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
  const target = readChannelById(db, accepted.target_id!);
  if (accepted.prior_state) {
    if (!target) {
      throw new Error("project channel registration inverse verification did not find the restored target.");
    }
    const record = projectChannelRegistrationChannelRecord(target);
    if (
      target.project_id !== accepted.prior_state.project_id
      || record.revision !== accepted.prior_state.revision
      || record.digest !== accepted.prior_state.digest
      || !projectChannelRegistrationMessageOwnershipMatches(
        readMessageOwnershipRows(db, target.name),
        accepted.prior_state.message_transition,
        "before",
      )
    ) {
      throw new Error("project channel registration inverse verification found a non-restored target.");
    }
  } else if (target) {
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
  const verification: ProjectChannelRegistrationInverseVerification = accepted.prior_state
    ? {
        target_id: accepted.target_id!,
        accepted_receipt_id: accepted.receipt_id,
        absent: false,
        restored: true,
        project_id: accepted.prior_state.project_id,
        revision: accepted.prior_state.revision,
        digest: accepted.prior_state.digest,
      }
    : {
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
