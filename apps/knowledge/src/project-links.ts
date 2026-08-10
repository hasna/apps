import { createHash } from 'node:crypto';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { ensureParentDir } from './workspace.js';
import type { ItemStore } from './item-store.js';
import type { KnowledgeItem } from './store.js';
import type { PoolQueryClient, TypedQueryClient } from './generated/storage-kit/index.js';
import { guardedFetch } from './net-guard.js';

export const KNOWLEDGE_PROJECT_REGISTRATION_ROUTE = 'knowledge.project-registration.v1' as const;
export const KNOWLEDGE_PROJECT_RESOURCES_ROUTE = 'knowledge.project-resources.v1' as const;
export const KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION = 1 as const;
export const KNOWLEDGE_PROJECT_MEMBERSHIP_RULE = 'explicit_collection_binding' as const;

export type KnowledgeProjectResourceKind = 'project' | 'collection' | 'item' | 'taxonomy';
export type KnowledgeProjectRegistrationDirection = 'forward' | 'inverse';
export type KnowledgeProjectReceiptAction = 'register_collection' | 'bind_item';
export type KnowledgeProjectReceiptOutcome = 'accepted' | 'terminal_nonacceptance';

export interface KnowledgeProjectAuthorityIdentity {
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
}

export interface KnowledgeProjectRegistrationCapability extends KnowledgeProjectAuthorityIdentity {
  authority: 'knowledge';
  route: typeof KNOWLEDGE_PROJECT_REGISTRATION_ROUTE;
  resource_route: typeof KNOWLEDGE_PROJECT_RESOURCES_ROUTE;
  package_version: string;
  schema_version: typeof KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION;
  registration_resource: 'collection';
  supported_resources: ['project', 'collection', 'item', 'taxonomy'];
  stable_project_ids: true;
  stable_collection_ids: true;
  explicit_membership: true;
  membership_rule: typeof KNOWLEDGE_PROJECT_MEMBERSHIP_RULE;
  later_child_binding_required: true;
  bind_existing_items: true;
  immutable_receipts: true;
  exact_terminal_lookup: true;
  exact_readback: true;
  conditional_inverse: true;
  complete_keyset_pagination: true;
  revision_bound_cursors: true;
}

export interface KnowledgeProjectRegistrationRequest extends KnowledgeProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  resource_kind: 'collection';
  direction: KnowledgeProjectRegistrationDirection;
  authority_route: string;
  package_version: string;
  target_selector: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  desired: {
    collection_slug?: string;
    collection_name?: string;
  };
}

export interface KnowledgeProjectItemBindingRequest extends KnowledgeProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  direction: KnowledgeProjectRegistrationDirection;
  authority_route: string;
  package_version: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  collection_id: string;
  item_id: string;
}

export interface KnowledgeProjectInverseRequest extends KnowledgeProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  authority_route: string;
  package_version: string;
  idempotency_key: string;
  accepted_receipt_id: string;
}

export interface KnowledgeProjectReceiptLookupRequest extends KnowledgeProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  action: KnowledgeProjectReceiptAction;
  direction: KnowledgeProjectRegistrationDirection;
  idempotency_key: string;
  max_items: 1;
}

export interface KnowledgeProjectRegistrationReceipt extends KnowledgeProjectAuthorityIdentity {
  receipt_id: string;
  authority: 'knowledge';
  route: typeof KNOWLEDGE_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  operation_id: string;
  step_id: string;
  action: KnowledgeProjectReceiptAction;
  resource_kind: 'collection' | 'item';
  direction: KnowledgeProjectRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: KnowledgeProjectReceiptOutcome;
  reason: string | null;
  source_project_id: string | null;
  project_id: string | null;
  collection_id: string | null;
  item_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  created_at: string;
}

export interface KnowledgeProjectCollectionRecord {
  source_project_id: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  collection_id: string;
  collection_slug: string;
  collection_name: string;
  membership_rule: typeof KNOWLEDGE_PROJECT_MEMBERSHIP_RULE;
  revision: string;
  digest: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeProjectItemBindingRecord {
  collection_id: string;
  item_id: string;
  revision: string;
  digest: string;
  bound_at: string;
}

export interface KnowledgeProjectInverseVerification {
  accepted_receipt_id: string;
  target_id: string;
  absent: true;
  digest: string;
}

export interface KnowledgeProjectResource {
  key: string;
  kind: KnowledgeProjectResourceKind;
  id: string;
  project_id: string;
  source_project_id: string;
  collection_id: string;
  revision: string;
  digest: string;
  title: string;
  locator: {
    kind: 'external_uuid' | 'canonical_uri';
    value: string;
  };
  metadata: Record<string, unknown>;
}

export interface KnowledgeProjectResourcePage {
  schema: 'knowledge.project-resources.page.v1';
  authority: 'knowledge';
  route: typeof KNOWLEDGE_PROJECT_RESOURCES_ROUTE;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  project_id: string;
  source_project_id: string;
  collection_id: string;
  collection_revision: string;
  population_digest: string;
  resource_kinds: KnowledgeProjectResourceKind[];
  resources: KnowledgeProjectResource[];
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  complete: boolean;
  truncated: false;
}

export interface KnowledgeProjectResourceListOptions {
  limit?: number;
  cursor?: string | null;
  kinds?: KnowledgeProjectResourceKind[];
}

export interface KnowledgeProjectLinksAuthority {
  capability(): Promise<KnowledgeProjectRegistrationCapability>;
  registerCollection(request: KnowledgeProjectRegistrationRequest): Promise<KnowledgeProjectRegistrationReceipt>;
  readCollection(collectionId: string): Promise<KnowledgeProjectCollectionRecord>;
  lookupReceipt(request: KnowledgeProjectReceiptLookupRequest): Promise<KnowledgeProjectRegistrationReceipt>;
  compensateRegistration(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
  verifyRegistrationInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
  bindItem(request: KnowledgeProjectItemBindingRequest): Promise<KnowledgeProjectRegistrationReceipt>;
  readItemBinding(collectionId: string, itemId: string): Promise<KnowledgeProjectItemBindingRecord>;
  compensateItemBinding(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
  verifyItemBindingInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
  listProjectResources(
    projectId: string,
    options?: KnowledgeProjectResourceListOptions,
  ): Promise<KnowledgeProjectResourcePage>;
  readProjectResource(
    projectId: string,
    kind: KnowledgeProjectResourceKind,
    resourceId: string,
  ): Promise<KnowledgeProjectResource>;
  readAllProjectResources(
    projectId: string,
    options?: Omit<KnowledgeProjectResourceListOptions, 'cursor'>,
  ): Promise<KnowledgeProjectResource[]>;
}

export type KnowledgeProjectLinksErrorCode =
  | 'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT'
  | 'KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH'
  | 'KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH'
  | 'KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH'
  | 'KNOWLEDGE_PROJECT_LINKS_CONFLICT'
  | 'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND'
  | 'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE'
  | 'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION';

export class KnowledgeProjectLinksError extends Error {
  constructor(
    readonly code: KnowledgeProjectLinksErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'KnowledgeProjectLinksError';
  }
}

export interface KnowledgeProjectLinksAuthorityOptions {
  authorityId: string;
  tenantId: string;
  corpusId: string;
  packageVersion: string;
  now?: () => string;
}

interface AggregateRow {
  source_project_id: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  collection_id: string;
  collection_slug: string;
  collection_name: string;
  membership_rule: string;
  revision: number | string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  collection_id: string;
  item_id: string;
  bound_receipt_id: string;
  created_by_operation: number | string;
  bound_at: string;
}

interface ReceiptRow {
  receipt_id: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  package_version: string;
  operation_id: string;
  step_id: string;
  action: KnowledgeProjectReceiptAction;
  resource_kind: 'collection' | 'item';
  direction: KnowledgeProjectRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: KnowledgeProjectReceiptOutcome;
  reason: string | null;
  source_project_id: string | null;
  project_id: string | null;
  collection_id: string | null;
  item_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: number | string;
  created_at: string;
}

interface SqlRunResult {
  changes: number;
}

interface ProjectLinksSql {
  get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  many<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  run(sql: string, params?: readonly unknown[]): Promise<SqlRunResult>;
  transaction<T>(fn: (tx: ProjectLinksSql) => Promise<T>): Promise<T>;
}

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class PostgresProjectLinksSql implements ProjectLinksSql {
  constructor(
    private readonly client: TypedQueryClient,
    private readonly transactionClient?: PoolQueryClient,
  ) {}

  async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    return this.client.get<T>(postgresSql(sql), params);
  }

  async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.client.many<T>(postgresSql(sql), params);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<SqlRunResult> {
    const result = await this.client.query<Record<string, unknown>>(postgresSql(sql), params);
    return { changes: result.rowCount };
  }

  async transaction<T>(fn: (tx: ProjectLinksSql) => Promise<T>): Promise<T> {
    if (!this.transactionClient) return fn(this);
    return this.transactionClient.transaction(
      (tx) => fn(new PostgresProjectLinksSql(tx)),
    );
  }
}

class SqliteProjectLinksSql implements ProjectLinksSql {
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly db: Database) {}

  async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    return (this.db.query(sql).get(...params as SQLQueryBindings[]) as T | null) ?? null;
  }

  async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.query(sql).all(...params as SQLQueryBindings[]) as T[];
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<SqlRunResult> {
    const result = this.db.query(sql).run(...params as SQLQueryBindings[]);
    return { changes: Number(result.changes) };
  }

  transaction<T>(fn: (tx: ProjectLinksSql) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function sqliteKnowledgeProjectLinksSchemaSql(): string {
  return `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS knowledge_projects (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, project_id),
      UNIQUE(authority_id, tenant_id, corpus_id, source_project_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_collections (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      membership_rule TEXT NOT NULL CHECK(membership_rule = 'explicit_collection_binding'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id),
      UNIQUE(authority_id, tenant_id, corpus_id, project_id, collection_slug),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, project_id)
        REFERENCES knowledge_projects(authority_id, tenant_id, corpus_id, project_id)
        ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_collection_memberships (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      bound_receipt_id TEXT NOT NULL,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      bound_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id, item_id),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, collection_id)
        REFERENCES knowledge_project_collections(authority_id, tenant_id, corpus_id, collection_id)
        ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_link_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'knowledge'),
      route TEXT NOT NULL CHECK(route = 'knowledge.project-registration.v1'),
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('register_collection', 'bind_item')),
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('collection', 'item')),
      direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'terminal_nonacceptance')),
      reason TEXT,
      source_project_id TEXT,
      project_id TEXT,
      collection_id TEXT,
      item_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE(authority_id, tenant_id, corpus_id, operation_id, step_id, action, direction)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_receipts_lookup
      ON knowledge_project_link_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        action, direction, idempotency_key
      );
    CREATE TRIGGER IF NOT EXISTS knowledge_project_link_receipts_immutable_update
      BEFORE UPDATE ON knowledge_project_link_receipts
      BEGIN
        SELECT RAISE(ABORT, 'knowledge project link receipts are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS knowledge_project_link_receipts_immutable_delete
      BEFORE DELETE ON knowledge_project_link_receipts
      BEGIN
        SELECT RAISE(ABORT, 'knowledge project link receipts are immutable');
      END;
  `;
}

export function postgresKnowledgeProjectLinksSchemaStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS knowledge_projects (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, project_id),
      UNIQUE(authority_id, tenant_id, corpus_id, source_project_id)
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_collections (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      membership_rule TEXT NOT NULL CHECK(membership_rule = 'explicit_collection_binding'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id),
      UNIQUE(authority_id, tenant_id, corpus_id, project_id, collection_slug),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, project_id)
        REFERENCES knowledge_projects(authority_id, tenant_id, corpus_id, project_id)
        ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_collection_memberships (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      bound_receipt_id TEXT NOT NULL,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      bound_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id, item_id),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, collection_id)
        REFERENCES knowledge_project_collections(authority_id, tenant_id, corpus_id, collection_id)
        ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_link_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'knowledge'),
      route TEXT NOT NULL CHECK(route = 'knowledge.project-registration.v1'),
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('register_collection', 'bind_item')),
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('collection', 'item')),
      direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'terminal_nonacceptance')),
      reason TEXT,
      source_project_id TEXT,
      project_id TEXT,
      collection_id TEXT,
      item_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE(authority_id, tenant_id, corpus_id, operation_id, step_id, action, direction)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_receipts_lookup
      ON knowledge_project_link_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        action, direction, idempotency_key
      )`,
    `CREATE OR REPLACE FUNCTION knowledge_project_link_receipts_immutable()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'knowledge project link receipts are immutable';
      END;
      $$`,
    `DROP TRIGGER IF EXISTS knowledge_project_link_receipts_immutable
      ON knowledge_project_link_receipts`,
    `CREATE TRIGGER knowledge_project_link_receipts_immutable
      BEFORE UPDATE OR DELETE ON knowledge_project_link_receipts
      FOR EACH ROW EXECUTE FUNCTION knowledge_project_link_receipts_immutable()`,
  ];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalKnowledgeProjectLinksJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestKnowledgeProjectLinksValue(value: unknown): string {
  return createHash('sha256').update(canonicalKnowledgeProjectLinksJson(value)).digest('hex');
}

function stableUuid(namespace: string): string {
  const hex = createHash('sha256').update(namespace).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new KnowledgeProjectLinksError(
      'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
      `${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function boundedLimit(value: number | undefined): number {
  const resolved = value ?? 100;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 200) {
    throw new KnowledgeProjectLinksError(
      'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
      'limit must be an integer between 1 and 200.',
    );
  }
  return resolved;
}

function normalizeKinds(kinds?: KnowledgeProjectResourceKind[]): KnowledgeProjectResourceKind[] {
  const supported: KnowledgeProjectResourceKind[] = ['project', 'collection', 'item', 'taxonomy'];
  if (!kinds || kinds.length === 0) return supported;
  const unique = [...new Set(kinds)];
  for (const kind of unique) {
    if (!supported.includes(kind)) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
        `unsupported project resource kind: ${kind}`,
      );
    }
  }
  return unique.sort((left, right) => supported.indexOf(left) - supported.indexOf(right));
}

function toReceipt(row: ReceiptRow): KnowledgeProjectRegistrationReceipt {
  return {
    receipt_id: row.receipt_id,
    authority: 'knowledge',
    route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: row.package_version,
    authority_id: row.authority_id,
    tenant_id: row.tenant_id,
    corpus_id: row.corpus_id,
    operation_id: row.operation_id,
    step_id: row.step_id,
    action: row.action,
    resource_kind: row.resource_kind,
    direction: row.direction,
    idempotency_key: row.idempotency_key,
    request_digest: row.request_digest,
    precondition_digest: row.precondition_digest,
    outcome: row.outcome,
    reason: row.reason,
    source_project_id: row.source_project_id,
    project_id: row.project_id,
    collection_id: row.collection_id,
    item_id: row.item_id,
    result_revision: row.result_revision,
    result_digest: row.result_digest,
    accepted_receipt_id: row.accepted_receipt_id,
    created_by_operation: Number(row.created_by_operation) === 1,
    created_at: row.created_at,
  };
}

function aggregateRecord(row: AggregateRow): KnowledgeProjectCollectionRecord {
  const record = {
    source_project_id: row.source_project_id,
    project_id: row.project_id,
    project_slug: row.project_slug,
    project_name: row.project_name,
    collection_id: row.collection_id,
    collection_slug: row.collection_slug,
    collection_name: row.collection_name,
    membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
    revision: `r${Number(row.revision)}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return { ...record, digest: digestKnowledgeProjectLinksValue(record) };
}

function receiptInsertParams(receipt: KnowledgeProjectRegistrationReceipt): unknown[] {
  return [
    receipt.receipt_id,
    receipt.authority,
    receipt.route,
    receipt.package_version,
    receipt.authority_id,
    receipt.tenant_id,
    receipt.corpus_id,
    receipt.operation_id,
    receipt.step_id,
    receipt.action,
    receipt.resource_kind,
    receipt.direction,
    receipt.idempotency_key,
    receipt.request_digest,
    receipt.precondition_digest,
    receipt.outcome,
    receipt.reason,
    receipt.source_project_id,
    receipt.project_id,
    receipt.collection_id,
    receipt.item_id,
    receipt.result_revision,
    receipt.result_digest,
    receipt.accepted_receipt_id,
    receipt.created_by_operation ? 1 : 0,
    receipt.created_at,
  ];
}

const RECEIPT_INSERT_SQL = `INSERT INTO knowledge_project_link_receipts (
  receipt_id, authority, route, package_version, authority_id, tenant_id, corpus_id,
  operation_id, step_id, action, resource_kind, direction, idempotency_key,
  request_digest, precondition_digest, outcome, reason, source_project_id,
  project_id, collection_id, item_id, result_revision, result_digest,
  accepted_receipt_id, created_by_operation, created_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

class PackageOwnedKnowledgeProjectLinksAuthority implements KnowledgeProjectLinksAuthority {
  private readonly identity: KnowledgeProjectAuthorityIdentity;
  private readonly now: () => string;

  constructor(
    private readonly sql: ProjectLinksSql,
    private readonly itemResolver: (id: string) => Promise<KnowledgeItem | null>,
    private readonly options: KnowledgeProjectLinksAuthorityOptions,
  ) {
    this.identity = {
      authority_id: requiredString(options.authorityId, 'authority_id'),
      tenant_id: requiredString(options.tenantId, 'tenant_id'),
      corpus_id: requiredString(options.corpusId, 'corpus_id'),
    };
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private capabilityValue(): KnowledgeProjectRegistrationCapability {
    return {
      authority: 'knowledge',
      route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
      resource_route: KNOWLEDGE_PROJECT_RESOURCES_ROUTE,
      package_version: this.options.packageVersion,
      schema_version: KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION,
      ...this.identity,
      registration_resource: 'collection',
      supported_resources: ['project', 'collection', 'item', 'taxonomy'],
      stable_project_ids: true,
      stable_collection_ids: true,
      explicit_membership: true,
      membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
      later_child_binding_required: true,
      bind_existing_items: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      complete_keyset_pagination: true,
      revision_bound_cursors: true,
    };
  }

  async capability(): Promise<KnowledgeProjectRegistrationCapability> {
    return this.capabilityValue();
  }

  private assertIdentity(request: KnowledgeProjectAuthorityIdentity & {
    authority_route: string;
    package_version: string;
  }): void {
    const capability = this.capabilityValue();
    if (
      request.authority_route !== capability.route
      || request.package_version !== capability.package_version
      || request.authority_id !== capability.authority_id
      || request.tenant_id !== capability.tenant_id
      || request.corpus_id !== capability.corpus_id
    ) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH',
        'request does not match the current Knowledge project-registration capability identity.',
      );
    }
  }

  private stableProjectId(sourceProjectId: string): string {
    return stableUuid(
      `${this.identity.authority_id}\0${this.identity.tenant_id}\0${this.identity.corpus_id}\0project\0${sourceProjectId}`,
    );
  }

  private stableCollectionId(sourceProjectId: string, collectionSlug: string): string {
    return stableUuid(
      `${this.identity.authority_id}\0${this.identity.tenant_id}\0${this.identity.corpus_id}\0collection\0${sourceProjectId}\0${collectionSlug}`,
    );
  }

  private stableReceiptId(
    operationId: string,
    stepId: string,
    action: KnowledgeProjectReceiptAction,
    direction: KnowledgeProjectRegistrationDirection,
  ): string {
    return stableUuid(
      `${this.identity.authority_id}\0${this.identity.tenant_id}\0${this.identity.corpus_id}\0receipt\0${operationId}\0${stepId}\0${action}\0${direction}`,
    );
  }

  private async getAggregateBySource(sql: ProjectLinksSql, sourceProjectId: string): Promise<AggregateRow | null> {
    return sql.get<AggregateRow & Record<string, unknown>>(
      `SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE p.authority_id = ? AND p.tenant_id = ? AND p.corpus_id = ?
          AND p.source_project_id = ?`,
      [this.identity.authority_id, this.identity.tenant_id, this.identity.corpus_id, sourceProjectId],
    ) as Promise<AggregateRow | null>;
  }

  private async getAggregateByCollection(sql: ProjectLinksSql, collectionId: string): Promise<AggregateRow | null> {
    return sql.get<AggregateRow & Record<string, unknown>>(
      `SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE c.authority_id = ? AND c.tenant_id = ? AND c.corpus_id = ?
          AND c.collection_id = ?`,
      [this.identity.authority_id, this.identity.tenant_id, this.identity.corpus_id, collectionId],
    ) as Promise<AggregateRow | null>;
  }

  private async getAggregateByProject(sql: ProjectLinksSql, projectId: string): Promise<AggregateRow | null> {
    return sql.get<AggregateRow & Record<string, unknown>>(
      `SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE p.authority_id = ? AND p.tenant_id = ? AND p.corpus_id = ?
          AND (p.source_project_id = ? OR p.project_id = ?)`,
      [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        projectId,
        projectId,
      ],
    ) as Promise<AggregateRow | null>;
  }

  private async getReceiptByAttempt(
    sql: ProjectLinksSql,
    input: {
      operation_id: string;
      step_id: string;
      action: KnowledgeProjectReceiptAction;
      direction: KnowledgeProjectRegistrationDirection;
    },
  ): Promise<KnowledgeProjectRegistrationReceipt | null> {
    const row = await sql.get<ReceiptRow & Record<string, unknown>>(
      `SELECT * FROM knowledge_project_link_receipts
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND operation_id = ? AND step_id = ? AND action = ? AND direction = ?`,
      [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        input.operation_id,
        input.step_id,
        input.action,
        input.direction,
      ],
    );
    return row ? toReceipt(row) : null;
  }

  private assertIdempotent(existing: KnowledgeProjectRegistrationReceipt, input: {
    idempotency_key: string;
    request_digest?: string;
    precondition_digest?: string;
  }): void {
    if (
      existing.idempotency_key !== input.idempotency_key
      || (input.request_digest !== undefined && existing.request_digest !== input.request_digest)
      || (input.precondition_digest !== undefined && existing.precondition_digest !== input.precondition_digest)
    ) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH',
        'operation and step identity are already bound to a different Knowledge project-link request.',
        { receipt_id: existing.receipt_id },
      );
    }
  }

  async registerCollection(
    request: KnowledgeProjectRegistrationRequest,
  ): Promise<KnowledgeProjectRegistrationReceipt> {
    this.assertIdentity(request);
    if (request.resource_kind !== 'collection' || request.direction !== 'forward') {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
        'collection registration requires resource_kind=collection and direction=forward.',
      );
    }
    const sourceProjectId = requiredString(request.project_id, 'project_id');
    const projectSlug = requiredString(request.project_slug, 'project_slug');
    const projectName = requiredString(request.project_name, 'project_name');
    const targetSelector = requiredString(request.target_selector, 'target_selector');
    if (targetSelector !== sourceProjectId) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
        'target_selector must equal the exact source project id.',
      );
    }
    const collectionSlug = requiredString(
      request.desired.collection_slug ?? `${projectSlug}-knowledge`,
      'desired.collection_slug',
    );
    const collectionName = requiredString(
      request.desired.collection_name ?? `${projectName} Knowledge`,
      'desired.collection_name',
    );
    const expectedRequestDigest = digestKnowledgeProjectLinksValue({
      action: 'register_collection',
      source_project_id: sourceProjectId,
      project_slug: projectSlug,
      project_name: projectName,
      collection_slug: collectionSlug,
      collection_name: collectionName,
      membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
    });
    if (request.request_digest !== expectedRequestDigest) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH',
        'request_digest does not bind the normalized collection-registration request.',
        { expected_request_digest: expectedRequestDigest },
      );
    }

    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'register_collection',
        direction: 'forward',
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }

      let aggregate = await this.getAggregateBySource(tx, sourceProjectId);
      const createdByOperation = aggregate === null;
      if (!aggregate) {
        const now = this.now();
        const projectId = this.stableProjectId(sourceProjectId);
        const collectionId = this.stableCollectionId(sourceProjectId, collectionSlug);
        await tx.run(
          `INSERT INTO knowledge_projects (
            authority_id, tenant_id, corpus_id, source_project_id, project_id,
            project_slug, project_name, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            sourceProjectId,
            projectId,
            projectSlug,
            projectName,
            now,
            now,
          ],
        );
        await tx.run(
          `INSERT INTO knowledge_project_collections (
            authority_id, tenant_id, corpus_id, collection_id, project_id,
            collection_slug, collection_name, membership_rule, revision,
            created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            collectionId,
            projectId,
            collectionSlug,
            collectionName,
            KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
            1,
            now,
            now,
          ],
        );
        aggregate = await this.getAggregateByCollection(tx, collectionId);
      } else if (
        aggregate.project_slug !== projectSlug
        || aggregate.project_name !== projectName
        || aggregate.collection_slug !== collectionSlug
        || aggregate.collection_name !== collectionName
        || aggregate.membership_rule !== KNOWLEDGE_PROJECT_MEMBERSHIP_RULE
      ) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_CONFLICT',
          'the source project is already bound to a different Knowledge collection aggregate.',
          {
            source_project_id: sourceProjectId,
            collection_id: aggregate.collection_id,
          },
        );
      }
      if (!aggregate) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
          'collection registration committed but exact aggregate readback was unavailable.',
        );
      }
      const record = aggregateRecord(aggregate);
      const receipt: KnowledgeProjectRegistrationReceipt = {
        receipt_id: this.stableReceiptId(
          request.operation_id,
          request.step_id,
          'register_collection',
          'forward',
        ),
        authority: 'knowledge',
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'register_collection',
        resource_kind: 'collection',
        direction: 'forward',
        idempotency_key: requiredString(request.idempotency_key, 'idempotency_key'),
        request_digest: request.request_digest,
        precondition_digest: requiredString(request.precondition_digest, 'precondition_digest'),
        outcome: 'accepted',
        reason: createdByOperation ? null : 'adopted_existing_collection',
        source_project_id: record.source_project_id,
        project_id: record.project_id,
        collection_id: record.collection_id,
        item_id: null,
        result_revision: record.revision,
        result_digest: record.digest,
        accepted_receipt_id: null,
        created_by_operation: createdByOperation,
        created_at: this.now(),
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }

  async readCollection(collectionId: string): Promise<KnowledgeProjectCollectionRecord> {
    const aggregate = await this.getAggregateByCollection(this.sql, requiredString(collectionId, 'collection_id'));
    if (!aggregate) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'Knowledge collection was not found by exact id.',
      );
    }
    return aggregateRecord(aggregate);
  }

  async lookupReceipt(
    request: KnowledgeProjectReceiptLookupRequest,
  ): Promise<KnowledgeProjectRegistrationReceipt> {
    if (request.max_items !== 1) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
        'exact terminal receipt lookup requires max_items=1.',
      );
    }
    if (
      request.authority_id !== this.identity.authority_id
      || request.tenant_id !== this.identity.tenant_id
      || request.corpus_id !== this.identity.corpus_id
    ) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH',
        'receipt lookup does not match this authority identity.',
      );
    }
    const receipt = await this.getReceiptByAttempt(this.sql, request);
    if (!receipt || receipt.idempotency_key !== request.idempotency_key) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'exact Knowledge project-link receipt was not found.',
      );
    }
    return receipt;
  }

  private async receiptById(sql: ProjectLinksSql, receiptId: string): Promise<KnowledgeProjectRegistrationReceipt | null> {
    const row = await sql.get<ReceiptRow & Record<string, unknown>>(
      `SELECT * FROM knowledge_project_link_receipts
        WHERE receipt_id = ? AND authority_id = ? AND tenant_id = ? AND corpus_id = ?`,
      [
        receiptId,
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
      ],
    );
    return row ? toReceipt(row) : null;
  }

  private assertInverseIdentity(request: KnowledgeProjectInverseRequest): void {
    this.assertIdentity(request);
    requiredString(request.accepted_receipt_id, 'accepted_receipt_id');
    requiredString(request.idempotency_key, 'idempotency_key');
  }

  async compensateRegistration(
    request: KnowledgeProjectInverseRequest,
  ): Promise<KnowledgeProjectRegistrationReceipt> {
    this.assertInverseIdentity(request);
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'register_collection',
        direction: 'inverse',
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      const accepted = await this.receiptById(tx, request.accepted_receipt_id);
      if (!accepted || accepted.action !== 'register_collection' || accepted.direction !== 'forward' || accepted.outcome !== 'accepted') {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
          'accepted collection-registration receipt was not found.',
        );
      }
      const aggregate = accepted.collection_id
        ? await this.getAggregateByCollection(tx, accepted.collection_id)
        : null;
      let outcome: KnowledgeProjectReceiptOutcome = 'accepted';
      let reason: string | null = null;
      if (!accepted.created_by_operation) {
        outcome = 'terminal_nonacceptance';
        reason = 'adopted_collection_is_not_inverse_owned';
      } else if (!aggregate) {
        outcome = 'terminal_nonacceptance';
        reason = 'accepted_collection_is_already_absent';
      } else {
        const membership = await tx.get<{ count: number | string }>(
          `SELECT COUNT(*) AS count
             FROM knowledge_project_collection_memberships
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`,
          [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            aggregate.collection_id,
          ],
        );
        if (Number(membership?.count ?? 0) > 0) {
          outcome = 'terminal_nonacceptance';
          reason = 'collection_has_bound_items';
        } else {
          await tx.run(
            `DELETE FROM knowledge_project_collections
              WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`,
            [
              this.identity.authority_id,
              this.identity.tenant_id,
              this.identity.corpus_id,
              aggregate.collection_id,
            ],
          );
          await tx.run(
            `DELETE FROM knowledge_projects
              WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND project_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM knowledge_project_collections c
                   WHERE c.authority_id = knowledge_projects.authority_id
                     AND c.tenant_id = knowledge_projects.tenant_id
                     AND c.corpus_id = knowledge_projects.corpus_id
                     AND c.project_id = knowledge_projects.project_id
                )`,
            [
              this.identity.authority_id,
              this.identity.tenant_id,
              this.identity.corpus_id,
              aggregate.project_id,
            ],
          );
        }
      }
      const absent = {
        accepted_receipt_id: accepted.receipt_id,
        collection_id: accepted.collection_id,
        absent: outcome === 'accepted',
      };
      const receipt: KnowledgeProjectRegistrationReceipt = {
        receipt_id: this.stableReceiptId(
          request.operation_id,
          request.step_id,
          'register_collection',
          'inverse',
        ),
        authority: 'knowledge',
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'register_collection',
        resource_kind: 'collection',
        direction: 'inverse',
        idempotency_key: request.idempotency_key,
        request_digest: digestKnowledgeProjectLinksValue({
          accepted_receipt_id: accepted.receipt_id,
          collection_id: accepted.collection_id,
        }),
        precondition_digest: accepted.result_digest ?? '',
        outcome,
        reason,
        source_project_id: accepted.source_project_id,
        project_id: accepted.project_id,
        collection_id: accepted.collection_id,
        item_id: null,
        result_revision: outcome === 'accepted' ? 'absent' : accepted.result_revision,
        result_digest: digestKnowledgeProjectLinksValue(absent),
        accepted_receipt_id: accepted.receipt_id,
        created_by_operation: false,
        created_at: this.now(),
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }

  async verifyRegistrationInverse(
    request: KnowledgeProjectInverseRequest,
  ): Promise<KnowledgeProjectInverseVerification> {
    this.assertInverseIdentity(request);
    const inverse = await this.getReceiptByAttempt(this.sql, {
      operation_id: request.operation_id,
      step_id: request.step_id,
      action: 'register_collection',
      direction: 'inverse',
    });
    if (!inverse || inverse.outcome !== 'accepted' || inverse.accepted_receipt_id !== request.accepted_receipt_id) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'accepted collection inverse receipt was not found.',
      );
    }
    const aggregate = inverse.collection_id
      ? await this.getAggregateByCollection(this.sql, inverse.collection_id)
      : null;
    if (aggregate) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_CONFLICT',
        'collection inverse verification found the target still present.',
      );
    }
    const verification = {
      accepted_receipt_id: request.accepted_receipt_id,
      target_id: inverse.collection_id!,
      absent: true as const,
      digest: inverse.result_digest!,
    };
    return verification;
  }

  async bindItem(
    request: KnowledgeProjectItemBindingRequest,
  ): Promise<KnowledgeProjectRegistrationReceipt> {
    this.assertIdentity(request);
    if (request.direction !== 'forward') {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
        'item binding requires direction=forward.',
      );
    }
    const collectionId = requiredString(request.collection_id, 'collection_id');
    const itemId = requiredString(request.item_id, 'item_id');
    const item = await this.itemResolver(itemId);
    if (!item || item.id !== itemId) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'bind-existing requires an exact existing Knowledge item id.',
        { item_id: itemId },
      );
    }
    const expectedRequestDigest = digestKnowledgeProjectLinksValue({
      action: 'bind_item',
      collection_id: collectionId,
      item_id: itemId,
    });
    if (request.request_digest !== expectedRequestDigest) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH',
        'request_digest does not bind the normalized item-membership request.',
        { expected_request_digest: expectedRequestDigest },
      );
    }

    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'bind_item',
        direction: 'forward',
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      const aggregate = await this.getAggregateByCollection(tx, collectionId);
      if (!aggregate) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
          'Knowledge collection was not found by exact id.',
        );
      }
      const existing = await tx.get<MembershipRow & Record<string, unknown>>(
        `SELECT * FROM knowledge_project_collection_memberships
          WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
            AND collection_id = ? AND item_id = ?`,
        [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          collectionId,
          itemId,
        ],
      );
      const createdByOperation = existing === null;
      const now = this.now();
      const receiptId = this.stableReceiptId(
        request.operation_id,
        request.step_id,
        'bind_item',
        'forward',
      );
      if (!existing) {
        await tx.run(
          `INSERT INTO knowledge_project_collection_memberships (
            authority_id, tenant_id, corpus_id, collection_id, item_id,
            bound_receipt_id, created_by_operation, bound_at
          ) VALUES (?,?,?,?,?,?,?,?)`,
          [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            collectionId,
            itemId,
            receiptId,
            1,
            now,
          ],
        );
        await tx.run(
          `UPDATE knowledge_project_collections
              SET revision = revision + 1, updated_at = ?
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`,
          [
            now,
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            collectionId,
          ],
        );
      }
      const current = await this.getAggregateByCollection(tx, collectionId);
      if (!current) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
          'item binding committed but collection readback was unavailable.',
        );
      }
      const binding = {
        collection_id: collectionId,
        item_id: itemId,
        collection_revision: `r${Number(current.revision)}`,
        item_revision: `v${item.version ?? 1}`,
      };
      const receipt: KnowledgeProjectRegistrationReceipt = {
        receipt_id: receiptId,
        authority: 'knowledge',
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'bind_item',
        resource_kind: 'item',
        direction: 'forward',
        idempotency_key: requiredString(request.idempotency_key, 'idempotency_key'),
        request_digest: request.request_digest,
        precondition_digest: requiredString(request.precondition_digest, 'precondition_digest'),
        outcome: 'accepted',
        reason: createdByOperation ? null : 'adopted_existing_membership',
        source_project_id: current.source_project_id,
        project_id: current.project_id,
        collection_id: collectionId,
        item_id: itemId,
        result_revision: binding.collection_revision,
        result_digest: digestKnowledgeProjectLinksValue(binding),
        accepted_receipt_id: null,
        created_by_operation: createdByOperation,
        created_at: now,
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }

  async readItemBinding(collectionId: string, itemId: string): Promise<KnowledgeProjectItemBindingRecord> {
    const membership = await this.sql.get<MembershipRow & Record<string, unknown>>(
      `SELECT * FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND collection_id = ? AND item_id = ?`,
      [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        requiredString(collectionId, 'collection_id'),
        requiredString(itemId, 'item_id'),
      ],
    );
    if (!membership) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'Knowledge collection membership was not found by exact ids.',
      );
    }
    const aggregate = await this.getAggregateByCollection(this.sql, collectionId);
    if (!aggregate) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
        'membership exists without its collection aggregate.',
      );
    }
    const record = {
      collection_id: collectionId,
      item_id: itemId,
      revision: `r${Number(aggregate.revision)}`,
      bound_at: membership.bound_at,
    };
    return { ...record, digest: digestKnowledgeProjectLinksValue(record) };
  }

  async compensateItemBinding(
    request: KnowledgeProjectInverseRequest,
  ): Promise<KnowledgeProjectRegistrationReceipt> {
    this.assertInverseIdentity(request);
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'bind_item',
        direction: 'inverse',
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      const accepted = await this.receiptById(tx, request.accepted_receipt_id);
      if (!accepted || accepted.action !== 'bind_item' || accepted.direction !== 'forward' || accepted.outcome !== 'accepted') {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
          'accepted item-binding receipt was not found.',
        );
      }
      let outcome: KnowledgeProjectReceiptOutcome = 'accepted';
      let reason: string | null = null;
      const membership = await tx.get<MembershipRow & Record<string, unknown>>(
        `SELECT * FROM knowledge_project_collection_memberships
          WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
            AND collection_id = ? AND item_id = ?`,
        [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          accepted.collection_id,
          accepted.item_id,
        ],
      );
      if (!accepted.created_by_operation) {
        outcome = 'terminal_nonacceptance';
        reason = 'adopted_membership_is_not_inverse_owned';
      } else if (!membership) {
        outcome = 'terminal_nonacceptance';
        reason = 'accepted_membership_is_already_absent';
      } else if (
        membership.bound_receipt_id !== accepted.receipt_id
        || Number(membership.created_by_operation) !== 1
      ) {
        outcome = 'terminal_nonacceptance';
        reason = 'membership_is_owned_by_a_different_receipt';
      } else {
        await tx.run(
          `DELETE FROM knowledge_project_collection_memberships
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
              AND collection_id = ? AND item_id = ? AND bound_receipt_id = ?`,
          [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            accepted.collection_id,
            accepted.item_id,
            accepted.receipt_id,
          ],
        );
        await tx.run(
          `UPDATE knowledge_project_collections
              SET revision = revision + 1, updated_at = ?
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`,
          [
            this.now(),
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            accepted.collection_id,
          ],
        );
      }
      const aggregate = accepted.collection_id
        ? await this.getAggregateByCollection(tx, accepted.collection_id)
        : null;
      const absent = {
        accepted_receipt_id: accepted.receipt_id,
        collection_id: accepted.collection_id,
        item_id: accepted.item_id,
        absent: outcome === 'accepted',
      };
      const receipt: KnowledgeProjectRegistrationReceipt = {
        receipt_id: this.stableReceiptId(
          request.operation_id,
          request.step_id,
          'bind_item',
          'inverse',
        ),
        authority: 'knowledge',
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: 'bind_item',
        resource_kind: 'item',
        direction: 'inverse',
        idempotency_key: request.idempotency_key,
        request_digest: digestKnowledgeProjectLinksValue({
          accepted_receipt_id: accepted.receipt_id,
          collection_id: accepted.collection_id,
          item_id: accepted.item_id,
        }),
        precondition_digest: accepted.result_digest ?? '',
        outcome,
        reason,
        source_project_id: accepted.source_project_id,
        project_id: accepted.project_id,
        collection_id: accepted.collection_id,
        item_id: accepted.item_id,
        result_revision: outcome === 'accepted' && aggregate ? `r${Number(aggregate.revision)}` : accepted.result_revision,
        result_digest: digestKnowledgeProjectLinksValue(absent),
        accepted_receipt_id: accepted.receipt_id,
        created_by_operation: false,
        created_at: this.now(),
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }

  async verifyItemBindingInverse(
    request: KnowledgeProjectInverseRequest,
  ): Promise<KnowledgeProjectInverseVerification> {
    this.assertInverseIdentity(request);
    const inverse = await this.getReceiptByAttempt(this.sql, {
      operation_id: request.operation_id,
      step_id: request.step_id,
      action: 'bind_item',
      direction: 'inverse',
    });
    if (!inverse || inverse.outcome !== 'accepted' || inverse.accepted_receipt_id !== request.accepted_receipt_id) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'accepted item-binding inverse receipt was not found.',
      );
    }
    const membership = await this.sql.get<{ item_id: string }>(
      `SELECT item_id FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND collection_id = ? AND item_id = ?`,
      [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        inverse.collection_id,
        inverse.item_id,
      ],
    );
    if (membership) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_CONFLICT',
        'item-binding inverse verification found the membership still present.',
      );
    }
    return {
      accepted_receipt_id: request.accepted_receipt_id,
      target_id: inverse.item_id!,
      absent: true,
      digest: inverse.result_digest!,
    };
  }

  private async buildResources(projectId: string): Promise<{
    aggregate: AggregateRow;
    resources: KnowledgeProjectResource[];
  }> {
    const aggregate = await this.getAggregateByProject(this.sql, requiredString(projectId, 'project_id'));
    if (!aggregate) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'Knowledge project aggregate was not found by source or stable project id.',
      );
    }
    const memberships = await this.sql.many<MembershipRow & Record<string, unknown>>(
      `SELECT * FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?
        ORDER BY item_id ASC`,
      [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        aggregate.collection_id,
      ],
    );
    const items = await Promise.all(memberships.map(async (membership) => {
      const item = await this.itemResolver(membership.item_id);
      if (!item || item.id !== membership.item_id) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
          'collection membership points at a missing Knowledge item; refusing a partial resource population.',
          { collection_id: aggregate.collection_id, item_id: membership.item_id },
        );
      }
      return item;
    }));
    const revision = `r${Number(aggregate.revision)}`;
    const base = {
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      revision,
    };
    const resources: KnowledgeProjectResource[] = [];
    const projectBody = {
      ...base,
      kind: 'project' as const,
      id: aggregate.project_id,
      title: aggregate.project_name,
      locator: { kind: 'canonical_uri' as const, value: `knowledge:project:${aggregate.project_id}` },
      metadata: {
        source_project_id: aggregate.source_project_id,
        slug: aggregate.project_slug,
        collection_count: 1,
      },
    };
    resources.push({
      ...projectBody,
      key: `project:${aggregate.project_id}`,
      digest: digestKnowledgeProjectLinksValue(projectBody),
    });
    const collectionBody = {
      ...base,
      kind: 'collection' as const,
      id: aggregate.collection_id,
      title: aggregate.collection_name,
      locator: { kind: 'external_uuid' as const, value: aggregate.collection_id },
      metadata: {
        slug: aggregate.collection_slug,
        membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
        member_count: items.length,
      },
    };
    resources.push({
      ...collectionBody,
      key: `collection:${aggregate.collection_id}`,
      digest: digestKnowledgeProjectLinksValue(collectionBody),
    });
    for (const item of items) {
      const itemBody = {
        ...base,
        kind: 'item' as const,
        id: item.id,
        revision: `v${item.version ?? 1}`,
        title: item.title,
        locator: { kind: 'canonical_uri' as const, value: `knowledge:item:${encodeURIComponent(item.id)}` },
        metadata: {
          tags: [...(item.tags ?? [])],
          archived: item.archived === true,
          updated_at: item.updated_at,
        },
      };
      resources.push({
        ...itemBody,
        key: `item:${item.id}`,
        digest: digestKnowledgeProjectLinksValue(itemBody),
      });
    }
    const taxonomy = new Map<string, { label: string; itemIds: string[] }>();
    for (const item of items) {
      for (const rawTag of item.tags ?? []) {
        const normalized = rawTag.trim().toLowerCase();
        if (!normalized) continue;
        const entry = taxonomy.get(normalized) ?? { label: rawTag.trim(), itemIds: [] };
        entry.itemIds.push(item.id);
        taxonomy.set(normalized, entry);
      }
    }
    for (const [normalized, entry] of [...taxonomy.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const taxonomyId = stableUuid(`${aggregate.collection_id}\0taxonomy\0${normalized}`);
      const taxonomyBody = {
        ...base,
        kind: 'taxonomy' as const,
        id: taxonomyId,
        title: entry.label,
        locator: { kind: 'external_uuid' as const, value: taxonomyId },
        metadata: {
          tag: entry.label,
          normalized_tag: normalized,
          item_count: entry.itemIds.length,
          member_digest: digestKnowledgeProjectLinksValue([...entry.itemIds].sort()),
        },
      };
      resources.push({
        ...taxonomyBody,
        key: `taxonomy:${taxonomyId}`,
        digest: digestKnowledgeProjectLinksValue(taxonomyBody),
      });
    }
    resources.sort((left, right) => left.key.localeCompare(right.key));
    return { aggregate, resources };
  }

  async listProjectResources(
    projectId: string,
    options: KnowledgeProjectResourceListOptions = {},
  ): Promise<KnowledgeProjectResourcePage> {
    const limit = boundedLimit(options.limit);
    const kinds = normalizeKinds(options.kinds);
    const { aggregate, resources } = await this.buildResources(projectId);
    const revision = `r${Number(aggregate.revision)}`;
    const population = resources.filter((resource) => kinds.includes(resource.kind));
    const populationDigest = digestKnowledgeProjectLinksValue(
      population.map((resource) => ({ key: resource.key, digest: resource.digest })),
    );
    let after = '';
    if (options.cursor) {
      let decoded: {
        version?: number;
        project_id?: string;
        collection_id?: string;
        collection_revision?: string;
        population_digest?: string;
        kinds?: KnowledgeProjectResourceKind[];
        after?: string;
      };
      try {
        decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as typeof decoded;
      } catch {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT',
          'cursor is not a valid Knowledge project-resources cursor.',
        );
      }
      if (
        decoded.version !== 1
        || decoded.project_id !== aggregate.project_id
        || decoded.collection_id !== aggregate.collection_id
        || decoded.collection_revision !== revision
        || decoded.population_digest !== populationDigest
        || canonicalKnowledgeProjectLinksJson(decoded.kinds) !== canonicalKnowledgeProjectLinksJson(kinds)
        || typeof decoded.after !== 'string'
      ) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE',
          'project resources changed or the cursor belongs to a different project/kind selection; restart from the first page.',
        );
      }
      after = decoded.after;
    }
    const remaining = after ? population.filter((resource) => resource.key > after) : population;
    const pageResources = remaining.slice(0, limit);
    const hasMore = remaining.length > pageResources.length;
    const nextCursor = hasMore && pageResources.length > 0
      ? Buffer.from(JSON.stringify({
        version: 1,
        project_id: aggregate.project_id,
        collection_id: aggregate.collection_id,
        collection_revision: revision,
        population_digest: populationDigest,
        kinds,
        after: pageResources.at(-1)!.key,
      })).toString('base64url')
      : null;
    return {
      schema: 'knowledge.project-resources.page.v1',
      authority: 'knowledge',
      route: KNOWLEDGE_PROJECT_RESOURCES_ROUTE,
      ...this.identity,
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      collection_revision: revision,
      population_digest: populationDigest,
      resource_kinds: kinds,
      resources: pageResources,
      count: pageResources.length,
      total: population.length,
      limit,
      cursor: options.cursor ?? null,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete: !hasMore,
      truncated: false,
    };
  }

  async readProjectResource(
    projectId: string,
    kind: KnowledgeProjectResourceKind,
    resourceId: string,
  ): Promise<KnowledgeProjectResource> {
    const { resources } = await this.buildResources(projectId);
    const resource = resources.find((candidate) => candidate.kind === kind && candidate.id === resourceId);
    if (!resource) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND',
        'Knowledge project resource was not found by exact kind and id.',
      );
    }
    return resource;
  }

  async readAllProjectResources(
    projectId: string,
    options: Omit<KnowledgeProjectResourceListOptions, 'cursor'> = {},
  ): Promise<KnowledgeProjectResource[]> {
    const resources: KnowledgeProjectResource[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let expected: {
      project_id: string;
      collection_id: string;
      collection_revision: string;
      population_digest: string;
      total: number;
      kinds: string;
    } | null = null;
    do {
      const page = await this.listProjectResources(projectId, { ...options, cursor });
      const identity = {
        project_id: page.project_id,
        collection_id: page.collection_id,
        collection_revision: page.collection_revision,
        population_digest: page.population_digest,
        total: page.total,
        kinds: canonicalKnowledgeProjectLinksJson(page.resource_kinds),
      };
      if (expected && canonicalKnowledgeProjectLinksJson(expected) !== canonicalKnowledgeProjectLinksJson(identity)) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE',
          'project resources changed while the complete population was being read.',
        );
      }
      expected ??= identity;
      for (const resource of page.resources) {
        if (seen.has(resource.key)) {
          throw new KnowledgeProjectLinksError(
            'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
            'project resource pagination returned a duplicate stable resource key.',
            { key: resource.key },
          );
        }
        seen.add(resource.key);
        resources.push(resource);
      }
      if (page.has_more && !page.next_cursor) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
          'project resource page claims more data without a continuation cursor.',
        );
      }
      cursor = page.next_cursor;
    } while (cursor);
    if (!expected || resources.length !== expected.total) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
        'complete project resource enumeration did not match the producer total.',
        { expected_total: expected?.total ?? null, received: resources.length },
      );
    }
    return resources;
  }
}

export function createLocalKnowledgeProjectLinksAuthority(input: {
  databasePath: string;
  itemStore: ItemStore;
  options: KnowledgeProjectLinksAuthorityOptions;
}): KnowledgeProjectLinksAuthority {
  if (input.databasePath !== ':memory:') {
    ensureParentDir(input.databasePath);
  }
  const db = new Database(input.databasePath, { create: true });
  db.exec(sqliteKnowledgeProjectLinksSchemaSql());
  return new PackageOwnedKnowledgeProjectLinksAuthority(
    new SqliteProjectLinksSql(db),
    (id) => input.itemStore.get(id),
    input.options,
  );
}

export function createPostgresKnowledgeProjectLinksAuthority(input: {
  client: PoolQueryClient;
  itemResolver: (id: string) => Promise<KnowledgeItem | null>;
  options: KnowledgeProjectLinksAuthorityOptions;
}): KnowledgeProjectLinksAuthority {
  return new PackageOwnedKnowledgeProjectLinksAuthority(
    new PostgresProjectLinksSql(input.client, input.client),
    input.itemResolver,
    input.options,
  );
}

function wireErrorStatus(error: KnowledgeProjectLinksError): number {
  if (error.code === 'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND') return 404;
  if (
    error.code === 'KNOWLEDGE_PROJECT_LINKS_CONFLICT'
    || error.code === 'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE'
    || error.code === 'KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH'
  ) return 409;
  if (error.code === 'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION') return 503;
  return 400;
}

export function knowledgeProjectLinksErrorResponse(error: unknown): Response {
  if (error instanceof KnowledgeProjectLinksError) {
    return Response.json(
      { error: error.code, message: error.message, details: error.details },
      { status: wireErrorStatus(error) },
    );
  }
  throw error;
}

export interface KnowledgeProjectLinksHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
}

export class KnowledgeProjectLinksHttpClient implements KnowledgeProjectLinksAuthority {
  private readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly root: string;

  constructor(private readonly options: KnowledgeProjectLinksHttpClientOptions) {
    this.fetchImpl = options.fetch ?? guardedFetch;
    this.root = options.baseUrl.replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers(this.options.headers);
    headers.set('accept', 'application/json');
    if (this.options.apiKey) headers.set('x-api-key', this.options.apiKey);
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.root}${path}`, {
      ...init,
      headers: this.headers(init.body ? { 'content-type': 'application/json' } : {}),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new KnowledgeProjectLinksError(
        typeof body.error === 'string'
          ? body.error as KnowledgeProjectLinksErrorCode
          : 'KNOWLEDGE_PROJECT_LINKS_CONFLICT',
        typeof body.message === 'string' ? body.message : `Knowledge project-links HTTP ${response.status}`,
        body.details && typeof body.details === 'object' ? body.details as Record<string, unknown> : {},
      );
    }
    return body as T;
  }

  async capability(): Promise<KnowledgeProjectRegistrationCapability> {
    const body = await this.request<{ capability: KnowledgeProjectRegistrationCapability }>(
      '/v1/project-registration/capability',
    );
    return body.capability;
  }

  async registerCollection(request: KnowledgeProjectRegistrationRequest): Promise<KnowledgeProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: KnowledgeProjectRegistrationReceipt }>(
      '/v1/project-registration/create',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.receipt;
  }

  async readCollection(collectionId: string): Promise<KnowledgeProjectCollectionRecord> {
    const body = await this.request<{ record: KnowledgeProjectCollectionRecord }>(
      '/v1/project-registration/read-exact',
      { method: 'POST', body: JSON.stringify({ collection_id: collectionId }) },
    );
    return body.record;
  }

  async lookupReceipt(request: KnowledgeProjectReceiptLookupRequest): Promise<KnowledgeProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: KnowledgeProjectRegistrationReceipt }>(
      '/v1/project-registration/receipts/lookup',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.receipt;
  }

  async compensateRegistration(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: KnowledgeProjectRegistrationReceipt }>(
      '/v1/project-registration/compensate',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.receipt;
  }

  async verifyRegistrationInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification> {
    const body = await this.request<{ verification: KnowledgeProjectInverseVerification }>(
      '/v1/project-registration/verify-inverse',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.verification;
  }

  async bindItem(request: KnowledgeProjectItemBindingRequest): Promise<KnowledgeProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: KnowledgeProjectRegistrationReceipt }>(
      '/v1/project-registration/items/bind',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.receipt;
  }

  async readItemBinding(collectionId: string, itemId: string): Promise<KnowledgeProjectItemBindingRecord> {
    const body = await this.request<{ record: KnowledgeProjectItemBindingRecord }>(
      '/v1/project-registration/items/read-exact',
      { method: 'POST', body: JSON.stringify({ collection_id: collectionId, item_id: itemId }) },
    );
    return body.record;
  }

  async compensateItemBinding(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: KnowledgeProjectRegistrationReceipt }>(
      '/v1/project-registration/items/compensate',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.receipt;
  }

  async verifyItemBindingInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification> {
    const body = await this.request<{ verification: KnowledgeProjectInverseVerification }>(
      '/v1/project-registration/items/verify-inverse',
      { method: 'POST', body: JSON.stringify(request) },
    );
    return body.verification;
  }

  async listProjectResources(
    projectId: string,
    options: KnowledgeProjectResourceListOptions = {},
  ): Promise<KnowledgeProjectResourcePage> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    for (const kind of options.kinds ?? []) query.append('kind', kind);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request<KnowledgeProjectResourcePage>(
      `/v1/projects/${encodeURIComponent(projectId)}/resources${suffix}`,
    );
  }

  async readProjectResource(
    projectId: string,
    kind: KnowledgeProjectResourceKind,
    resourceId: string,
  ): Promise<KnowledgeProjectResource> {
    const body = await this.request<{ resource: KnowledgeProjectResource }>(
      `/v1/projects/${encodeURIComponent(projectId)}/resources/${kind}/${encodeURIComponent(resourceId)}`,
    );
    return body.resource;
  }

  async readAllProjectResources(
    projectId: string,
    options: Omit<KnowledgeProjectResourceListOptions, 'cursor'> = {},
  ): Promise<KnowledgeProjectResource[]> {
    const resources: KnowledgeProjectResource[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let expectedTotal: number | null = null;
    let expectedRevision: string | null = null;
    let expectedPopulationDigest: string | null = null;
    do {
      const page = await this.listProjectResources(projectId, { ...options, cursor });
      expectedTotal ??= page.total;
      expectedRevision ??= page.collection_revision;
      expectedPopulationDigest ??= page.population_digest;
      if (
        page.total !== expectedTotal
        || page.collection_revision !== expectedRevision
        || page.population_digest !== expectedPopulationDigest
      ) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE',
          'project resources changed while the complete HTTP population was being read.',
        );
      }
      for (const resource of page.resources) {
        if (seen.has(resource.key)) {
          throw new KnowledgeProjectLinksError(
            'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
            'project resources HTTP pagination returned a duplicate stable key.',
          );
        }
        seen.add(resource.key);
        resources.push(resource);
      }
      if (page.has_more && !page.next_cursor) {
        throw new KnowledgeProjectLinksError(
          'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
          'project resources HTTP page claims more data without a cursor.',
        );
      }
      cursor = page.next_cursor;
    } while (cursor);
    if (expectedTotal === null || resources.length !== expectedTotal) {
      throw new KnowledgeProjectLinksError(
        'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION',
        'complete HTTP resource enumeration did not match the producer total.',
      );
    }
    return resources;
  }
}

export function createKnowledgeProjectLinksHttpClient(
  options: KnowledgeProjectLinksHttpClientOptions,
): KnowledgeProjectLinksAuthority {
  return new KnowledgeProjectLinksHttpClient(options);
}
