import { randomUUID } from "node:crypto";
import type { TodosPostgresQueryClient } from "../storage/postgres-sync.js";
import { redactEvidenceText } from "../lib/redaction.js";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_BLOCKED_SCOPE_PATTERNS,
  applyIncidentTransition,
  buildIncidentProjectionEvent,
  createInitialIncident,
  normalizeIncidentAuthorityId,
  stableIncidentFingerprint,
  supersedeIncident,
  type IncidentProjectionEvent,
  type IncidentSeverity,
  type IncidentState,
  type IncidentStatus,
  type IncidentTransition,
  type NormalizedIncidentCreateInput,
  type NormalizedIncidentTransitionInput,
} from "./contracts.js";

export const DEFAULT_INCIDENTS_TABLE = "todos_incidents";
export const DEFAULT_INCIDENT_TRANSITIONS_TABLE = "todos_incident_transitions";
export const DEFAULT_INCIDENT_OUTBOX_TABLE = "todos_incident_projection_outbox";
export const DEFAULT_INCIDENT_OUTBOX_RECOVERIES_TABLE = "todos_incident_outbox_recoveries";

export interface IncidentAuthorityContext {
  authorityId: string;
  actorId: string;
  effectiveActorId?: string;
  actorKeyId: string | null;
  actorActAs?: boolean;
}

export interface IncidentListFilter {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  owner?: string;
  scope?: string;
  activeOnly?: boolean;
  limit?: number;
  before?: { updated_at: string; id: string };
}

export interface IncidentMutationResult {
  incident: IncidentState;
  transitions: IncidentTransition[];
  events: IncidentProjectionEvent[];
  replayed: boolean;
}

export interface IncidentOutboxRecord {
  event_id: string;
  projection_key: string;
  incident_id: string;
  incident_version: number;
  depends_on_event_id: string | null;
  payload: IncidentProjectionEvent;
  status: "pending" | "leased" | "acked" | "dead";
  attempts: number;
  next_attempt_at: string;
  lease_token: string | null;
  leased_by: string | null;
  lease_expires_at: string | null;
  delivery_id: string | null;
  acked_at: string | null;
  last_error: string | null;
  failure_code: string | null;
  failure_fingerprint: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface IncidentOutboxClaimOptions {
  limit?: number;
  leaseSeconds?: number;
}

export interface IncidentDeadOutboxListOptions {
  limit?: number;
  before?: { created_at: string; event_id: string };
}

export interface IncidentOutboxStatus {
  pending: number;
  leased: number;
  acked: number;
  dead: number;
  total: number;
}

export interface IncidentOutboxRequeueInput {
  expectedAttempts: number;
  idempotencyKey: string;
  reason: string;
}

export interface TodosIncidentStore {
  create(input: NormalizedIncidentCreateInput, authority: IncidentAuthorityContext): Promise<IncidentMutationResult>;
  get(id: string, authorityId: string): Promise<IncidentState | null>;
  list(filter: IncidentListFilter, authorityId: string): Promise<IncidentState[]>;
  listActiveBlockers(filter: Pick<IncidentListFilter, "scope" | "severity" | "owner" | "limit" | "before">, authorityId: string): Promise<IncidentState[]>;
  transition(id: string, input: NormalizedIncidentTransitionInput, authority: IncidentAuthorityContext): Promise<IncidentMutationResult>;
  listTransitions(id: string, authorityId: string): Promise<IncidentTransition[]>;
  getDeadOutbox(eventId: string, authorityId: string): Promise<IncidentOutboxRecord | null>;
  listDeadOutbox(options: IncidentDeadOutboxListOptions, authorityId: string): Promise<IncidentOutboxRecord[]>;
  getOutboxStatus(authorityId: string): Promise<IncidentOutboxStatus>;
  claimOutbox(authority: IncidentAuthorityContext, options?: IncidentOutboxClaimOptions): Promise<IncidentOutboxRecord[]>;
  ackOutbox(eventId: string, leaseToken: string, deliveryId: string, authority: IncidentAuthorityContext): Promise<IncidentOutboxRecord>;
  failOutbox(eventId: string, leaseToken: string, failureCode: string, failure: string, authority: IncidentAuthorityContext): Promise<IncidentOutboxRecord>;
  requeueOutbox(eventId: string, input: IncidentOutboxRequeueInput, authority: IncidentAuthorityContext): Promise<IncidentOutboxRecord>;
}

export class IncidentNotFoundError extends Error {
  constructor(public readonly incidentId: string) {
    super(`Incident not found: ${incidentId}`);
    this.name = "IncidentNotFoundError";
  }
}

export class IncidentVersionConflictError extends Error {
  constructor(public readonly incidentId: string, public readonly expected: number, public readonly actual: number) {
    super(`Incident ${incidentId} version conflict: expected ${expected}, current ${actual}`);
    this.name = "IncidentVersionConflictError";
  }
}

export class IncidentIdempotencyConflictError extends Error {
  constructor() {
    super("Incident idempotency key was already used for a different command");
    this.name = "IncidentIdempotencyConflictError";
  }
}

export class IncidentLeaseConflictError extends Error {
  constructor() {
    super("Incident projection lease is missing, expired, or owned by another worker");
    this.name = "IncidentLeaseConflictError";
  }
}

export class IncidentOutboxRecoveryConflictError extends Error {
  constructor() {
    super("Incident projection recovery no longer matches the exact dead event state");
    this.name = "IncidentOutboxRecoveryConflictError";
  }
}

export interface CreatePostgresIncidentStoreOptions {
  service?: string;
  incidentsTable?: string;
  transitionsTable?: string;
  outboxTable?: string;
  outboxRecoveriesTable?: string;
  now?: () => string;
  leaseToken?: () => string;
  maxDeliveryAttempts?: number;
  maxConsecutiveFailures?: number;
}

export function postgresIncidentSchemaSql(options: CreatePostgresIncidentStoreOptions = {}): string[] {
  const incidents = safeIdentifier(options.incidentsTable ?? DEFAULT_INCIDENTS_TABLE);
  const transitions = safeIdentifier(options.transitionsTable ?? DEFAULT_INCIDENT_TRANSITIONS_TABLE);
  const outbox = safeIdentifier(options.outboxTable ?? DEFAULT_INCIDENT_OUTBOX_TABLE);
  const recoveries = safeIdentifier(options.outboxRecoveriesTable ?? DEFAULT_INCIDENT_OUTBOX_RECOVERIES_TABLE);
  const immutableFunction = incidentTransitionImmutableFunction(transitions);
  const immutableTrigger = `${immutableFunction}_trigger`;
  return [
    `CREATE TABLE IF NOT EXISTS ${incidents} (
      service text NOT NULL,
      authority_id text NOT NULL,
      incident_id text NOT NULL,
      idempotency_key text NOT NULL,
      request_fingerprint text NOT NULL,
      title text NOT NULL,
      severity text NOT NULL,
      status text NOT NULL,
      owner text NOT NULL,
      affected_scopes jsonb NOT NULL,
      blocked_scopes jsonb NOT NULL,
      containment text,
      next_action text,
      deadline timestamptz,
      closure_evidence jsonb NOT NULL,
      supersedes_id text,
      superseded_by_id text,
      resolved_at timestamptz,
      version integer NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (service, authority_id, incident_id),
      UNIQUE (service, authority_id, idempotency_key),
      CHECK (severity IN ('info','low','medium','high','critical')),
      CHECK (status IN ('open','investigating','contained','monitoring','resolved','superseded')),
      CHECK (jsonb_typeof(affected_scopes) = 'array' AND jsonb_array_length(affected_scopes) > 0),
      CHECK (jsonb_typeof(blocked_scopes) = 'array'),
      CHECK (jsonb_typeof(closure_evidence) = 'array'),
      CHECK (version > 0),
      CHECK (supersedes_id IS NULL OR supersedes_id <> incident_id),
      CHECK (
        (status IN ('open','investigating','contained','monitoring') AND next_action IS NOT NULL AND btrim(next_action) <> '' AND resolved_at IS NULL AND superseded_by_id IS NULL)
        OR (status = 'resolved' AND next_action IS NULL AND resolved_at IS NOT NULL AND jsonb_array_length(blocked_scopes) = 0 AND jsonb_array_length(closure_evidence) > 0)
        OR (status = 'superseded' AND next_action IS NULL AND resolved_at IS NOT NULL AND superseded_by_id IS NOT NULL)
      ),
      CHECK (status NOT IN ('contained','monitoring') OR (containment IS NOT NULL AND btrim(containment) <> ''))
    )`,
    `CREATE INDEX IF NOT EXISTS ${incidents}_active_idx ON ${incidents} (service, authority_id, updated_at DESC, incident_id DESC)
      WHERE status NOT IN ('resolved','superseded')`,
    `CREATE INDEX IF NOT EXISTS ${incidents}_affected_scopes_gin ON ${incidents} USING gin (affected_scopes)`,
    `CREATE INDEX IF NOT EXISTS ${incidents}_blocked_scopes_gin ON ${incidents} USING gin (blocked_scopes)`,
    `CREATE TABLE IF NOT EXISTS ${transitions} (
      service text NOT NULL,
      authority_id text NOT NULL,
      transition_id text NOT NULL,
      incident_id text NOT NULL,
      incident_version integer NOT NULL,
      idempotency_key text NOT NULL,
      request_fingerprint text NOT NULL,
      action text NOT NULL,
      actor_id text NOT NULL,
      effective_actor_id text NOT NULL,
      actor_key_id text,
      actor_act_as boolean NOT NULL DEFAULT false,
      reason text NOT NULL,
      before_state jsonb,
      after_state jsonb NOT NULL,
      command_result jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (service, authority_id, transition_id),
      UNIQUE (service, authority_id, incident_id, incident_version),
      UNIQUE (service, authority_id, incident_id, idempotency_key),
      FOREIGN KEY (service, authority_id, incident_id) REFERENCES ${incidents} (service, authority_id, incident_id),
      CHECK (action IN ('created','updated','resolved','superseded')),
      CHECK (incident_version > 0),
      CHECK (after_state->>'id' = incident_id),
      CHECK ((after_state->>'version')::integer = incident_version),
      CHECK (after_state->>'severity' IN ('info','low','medium','high','critical')),
      CHECK (after_state->>'status' IN ('open','investigating','contained','monitoring','resolved','superseded')),
      CHECK (jsonb_typeof(after_state->'affected_scopes') = 'array'),
      CHECK (jsonb_typeof(after_state->'blocked_scopes') = 'array')
    )`,
    `CREATE OR REPLACE FUNCTION ${immutableFunction}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'incident transition history is immutable';
      END;
    $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS ${immutableTrigger} ON ${transitions}`,
    `CREATE TRIGGER ${immutableTrigger} BEFORE UPDATE OR DELETE ON ${transitions}
      FOR EACH ROW EXECUTE FUNCTION ${immutableFunction}()`,
    `CREATE TABLE IF NOT EXISTS ${outbox} (
      service text NOT NULL,
      authority_id text NOT NULL,
      event_id text NOT NULL,
      projection_key text NOT NULL,
      transition_id text NOT NULL,
      incident_id text NOT NULL,
      incident_version integer NOT NULL,
      depends_on_event_id text,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL,
      lease_token text,
      leased_by text,
      lease_expires_at timestamptz,
      delivery_id text,
      acked_at timestamptz,
      last_error text,
      failure_code text,
      failure_fingerprint text,
      consecutive_failures integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (service, authority_id, event_id),
      UNIQUE (service, authority_id, projection_key),
      UNIQUE (service, authority_id, incident_id, incident_version),
      FOREIGN KEY (service, authority_id, transition_id) REFERENCES ${transitions} (service, authority_id, transition_id),
      FOREIGN KEY (service, authority_id, depends_on_event_id) REFERENCES ${outbox} (service, authority_id, event_id),
      CHECK (status IN ('pending','leased','acked','dead')),
      CHECK (attempts >= 0),
      CHECK (consecutive_failures >= 0),
      CHECK (payload->>'source' = 'todos'),
      CHECK ((payload->>'schema_version')::integer = 1),
      CHECK (payload->>'event_id' = event_id),
      CHECK (payload->>'projection_key' = projection_key),
      CHECK (payload->>'authority_id' = authority_id),
      CHECK (payload->>'incident_id' = incident_id),
      CHECK (payload->>'transition_id' = transition_id),
      CHECK ((payload->>'incident_version')::integer = incident_version),
      CHECK (depends_on_event_id IS NULL OR depends_on_event_id <> event_id),
      CHECK (jsonb_typeof(payload->'incident'->'affected_scopes') = 'array'),
      CHECK (jsonb_typeof(payload->'incident'->'blocked_scopes') = 'array'),
      CHECK (
        (status = 'pending' AND lease_token IS NULL AND leased_by IS NULL AND lease_expires_at IS NULL AND acked_at IS NULL)
        OR (status = 'leased' AND lease_token IS NOT NULL AND leased_by IS NOT NULL AND lease_expires_at IS NOT NULL AND acked_at IS NULL)
        OR (status = 'acked' AND lease_token IS NULL AND leased_by IS NULL AND lease_expires_at IS NULL AND delivery_id IS NOT NULL AND acked_at IS NOT NULL)
        OR (status = 'dead' AND lease_token IS NULL AND leased_by IS NULL AND lease_expires_at IS NULL AND acked_at IS NULL)
      )
    )`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS failure_code text`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS failure_fingerprint text`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0`,
    `CREATE INDEX IF NOT EXISTS ${outbox}_claim_idx ON ${outbox} (service, authority_id, next_attempt_at, created_at)
      WHERE status IN ('pending','leased')`,
    `CREATE TABLE IF NOT EXISTS ${recoveries} (
      service text NOT NULL,
      authority_id text NOT NULL,
      recovery_id text NOT NULL,
      event_id text NOT NULL,
      expected_attempts integer NOT NULL,
      idempotency_key text NOT NULL,
      request_fingerprint text NOT NULL,
      actor_id text NOT NULL,
      effective_actor_id text NOT NULL,
      actor_key_id text,
      actor_act_as boolean NOT NULL DEFAULT false,
      reason text NOT NULL,
      before_state jsonb NOT NULL,
      after_state jsonb NOT NULL,
      command_result jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (service, authority_id, recovery_id),
      UNIQUE (service, authority_id, event_id, idempotency_key),
      FOREIGN KEY (service, authority_id, event_id) REFERENCES ${outbox} (service, authority_id, event_id),
      CHECK (expected_attempts > 0),
      CHECK (before_state->>'status' = 'dead'),
      CHECK (after_state->>'status' = 'pending'),
      CHECK ((before_state->>'attempts')::integer = expected_attempts),
      CHECK ((after_state->>'attempts')::integer = 0)
    )`,
    `CREATE OR REPLACE FUNCTION ${recoveries}_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'incident outbox recovery history is immutable';
      END;
    $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS ${recoveries}_immutable_trigger ON ${recoveries}`,
    `CREATE TRIGGER ${recoveries}_immutable_trigger BEFORE UPDATE OR DELETE ON ${recoveries}
      FOR EACH ROW EXECUTE FUNCTION ${recoveries}_immutable()`,
  ];
}

export function postgresIncidentRollbackSql(options: CreatePostgresIncidentStoreOptions = {}): string[] {
  const incidents = safeIdentifier(options.incidentsTable ?? DEFAULT_INCIDENTS_TABLE);
  const transitions = safeIdentifier(options.transitionsTable ?? DEFAULT_INCIDENT_TRANSITIONS_TABLE);
  const outbox = safeIdentifier(options.outboxTable ?? DEFAULT_INCIDENT_OUTBOX_TABLE);
  const recoveries = safeIdentifier(options.outboxRecoveriesTable ?? DEFAULT_INCIDENT_OUTBOX_RECOVERIES_TABLE);
  return [
    `DROP TABLE IF EXISTS ${recoveries}`,
    `DROP TABLE IF EXISTS ${outbox}`,
    `DROP TABLE IF EXISTS ${transitions}`,
    `DROP TABLE IF EXISTS ${incidents}`,
    `DROP FUNCTION IF EXISTS ${incidentTransitionImmutableFunction(transitions)}()`,
    `DROP FUNCTION IF EXISTS ${recoveries}_immutable()`,
  ];
}

export function createPostgresIncidentStore(
  client: TodosPostgresQueryClient,
  options: CreatePostgresIncidentStoreOptions = {},
): TodosIncidentStore {
  const service = bounded(options.service ?? "todos", "service", 128);
  const incidents = safeIdentifier(options.incidentsTable ?? DEFAULT_INCIDENTS_TABLE);
  const transitions = safeIdentifier(options.transitionsTable ?? DEFAULT_INCIDENT_TRANSITIONS_TABLE);
  const outbox = safeIdentifier(options.outboxTable ?? DEFAULT_INCIDENT_OUTBOX_TABLE);
  const recoveries = safeIdentifier(options.outboxRecoveriesTable ?? DEFAULT_INCIDENT_OUTBOX_RECOVERIES_TABLE);
  const currentTime = options.now ?? (() => new Date().toISOString());
  const newLeaseToken = options.leaseToken ?? randomUUID;
  const maxDeliveryAttempts = integerInRange(options.maxDeliveryAttempts ?? 12, "maxDeliveryAttempts", 1, 100);
  const maxConsecutiveFailures = integerInRange(options.maxConsecutiveFailures ?? 3, "maxConsecutiveFailures", 1, 100);

  const readCreateReplay = async (input: NormalizedIncidentCreateInput, authorityId: string) => {
    return client.query<ReplayRow>(`/* todos:incident-create-replay */
      SELECT request_fingerprint, command_result AS result
      FROM ${transitions}
      WHERE service = $1 AND authority_id = $2 AND incident_id = $3
        AND idempotency_key = $4 AND action = 'created'
      LIMIT 1`, [service, authorityId, input.id, input.idempotency_key]);
  };

  const readTransitionReplay = async (id: string, input: NormalizedIncidentTransitionInput, authorityId: string) => {
    return client.query<ReplayRow>(`/* todos:incident-transition-replay */
      SELECT request_fingerprint, command_result AS result
      FROM ${transitions}
      WHERE service = $1 AND authority_id = $2 AND incident_id = $3 AND idempotency_key = $4
      LIMIT 1`, [service, authorityId, id, input.idempotency_key]);
  };

  const get = async (id: string, authorityIdValue: string): Promise<IncidentState | null> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const result = await client.query<IncidentRow>(`/* todos:incident-get */
      SELECT jsonb_build_object(
        'id', incident_id, 'title', title, 'severity', severity, 'status', status, 'owner', owner,
        'affected_scopes', affected_scopes, 'blocked_scopes', blocked_scopes, 'containment', containment,
        'next_action', next_action, 'deadline', to_jsonb(deadline), 'closure_evidence', closure_evidence,
        'supersedes_id', supersedes_id, 'superseded_by_id', superseded_by_id, 'resolved_at', to_jsonb(resolved_at),
        'version', version, 'created_at', to_jsonb(created_at), 'updated_at', to_jsonb(updated_at)
      ) AS incident
      FROM ${incidents}
      WHERE service = $1 AND authority_id = $2 AND incident_id = $3`, [service, authorityId, id]);
    return result.rows[0] ? parseIncidentState(result.rows[0].incident) : null;
  };

  const create = async (input: NormalizedIncidentCreateInput, authorityValue: IncidentAuthorityContext): Promise<IncidentMutationResult> => {
    const authority = normalizeAuthority(authorityValue);
    const fingerprint = stableIncidentFingerprint(input);
    const replay = await readCreateReplay(input, authority.authorityId);
    if (replay.rows[0]) return resolveReplay(replay.rows[0], fingerprint);

    const now = currentTime();
    const initial = createInitialIncident(
      input,
      authority.authorityId,
      authority.actorId,
      now,
      authority.actorKeyId,
      authority.effectiveActorId,
      authority.actorActAs,
    );
    let replacement: ReturnType<typeof supersedeIncident> | null = null;
    if (input.supersedes_id !== null && input.supersedes_expected_version !== null) {
      const current = await get(input.supersedes_id, authority.authorityId);
      if (!current) throw new IncidentNotFoundError(input.supersedes_id);
      if (current.version !== input.supersedes_expected_version) {
        throw new IncidentVersionConflictError(current.id, input.supersedes_expected_version, current.version);
      }
      replacement = supersedeIncident(
        current,
        input.id,
        input.supersedes_expected_version,
        authority.authorityId,
        authority.actorId,
        now,
        input.idempotency_key,
        authority.actorKeyId,
        authority.effectiveActorId,
        authority.actorActAs,
      );
    }
    const orderedTransitions = replacement ? [replacement.transition, initial.transition] : [initial.transition];
    const events = orderedTransitions.map((transition) => buildIncidentProjectionEvent(authority.authorityId, transition));
    const envelope: Omit<IncidentMutationResult, "replayed"> = {
      incident: initial.incident,
      transitions: orderedTransitions,
      events,
    };
    const values = [
      service,
      authority.authorityId,
      jsonbParam(initial.incident),
      input.idempotency_key,
      fingerprint,
      jsonbParam(initial.transition),
      jsonbParam(events.at(-1)!),
      jsonbParam(envelope),
      input.supersedes_id,
      input.supersedes_expected_version,
      replacement ? jsonbParam(replacement.incident) : null,
      replacement ? jsonbParam(replacement.transition) : null,
      replacement ? jsonbParam(events[0]!) : null,
    ] as const;
    try {
      const mutation = await client.query<MutationRow>(createIncidentAtomicSql(incidents, transitions, outbox), values);
      if (mutation.rows[0]) return { ...parseMutationResult(mutation.rows[0].result), replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const afterConflict = await readCreateReplay(input, authority.authorityId);
      if (afterConflict.rows[0]) return resolveReplay(afterConflict.rows[0], fingerprint);
      throw new IncidentIdempotencyConflictError();
    }
    // A concurrent identical supersession can lose the replacement CAS without
    // raising a unique violation. The winner's immutable command row is the
    // authority: replay it before classifying the stale version.
    const afterEmptyMutation = await readCreateReplay(input, authority.authorityId);
    if (afterEmptyMutation.rows[0]) return resolveReplay(afterEmptyMutation.rows[0], fingerprint);
    if (input.supersedes_id !== null && input.supersedes_expected_version !== null) {
      const current = await get(input.supersedes_id, authority.authorityId);
      if (!current) throw new IncidentNotFoundError(input.supersedes_id);
      throw new IncidentVersionConflictError(current.id, input.supersedes_expected_version, current.version);
    }
    throw new IncidentIdempotencyConflictError();
  };

  const transition = async (
    id: string,
    input: NormalizedIncidentTransitionInput,
    authorityValue: IncidentAuthorityContext,
  ): Promise<IncidentMutationResult> => {
    const authority = normalizeAuthority(authorityValue);
    const fingerprint = stableIncidentFingerprint({
      incident_id: id,
      expected_version: input.expected_version,
      idempotency_key: input.idempotency_key,
      reason: input.reason,
      patch: input.patch,
    });
    const replay = await readTransitionReplay(id, input, authority.authorityId);
    if (replay.rows[0]) return resolveReplay(replay.rows[0], fingerprint);
    const current = await get(id, authority.authorityId);
    if (!current) throw new IncidentNotFoundError(id);
    if (current.version !== input.expected_version) {
      throw new IncidentVersionConflictError(id, input.expected_version, current.version);
    }
    const applied = applyIncidentTransition(
      current,
      input,
      authority.actorId,
      currentTime(),
      authority.authorityId,
      authority.actorKeyId,
      authority.effectiveActorId,
      authority.actorActAs,
    );
    const event = buildIncidentProjectionEvent(authority.authorityId, applied.transition);
    const envelope: Omit<IncidentMutationResult, "replayed"> = {
      incident: applied.incident,
      transitions: [applied.transition],
      events: [event],
    };
    try {
      const mutation = await client.query<MutationRow>(transitionIncidentAtomicSql(incidents, transitions, outbox), [
        service,
        authority.authorityId,
        id,
        input.expected_version,
        jsonbParam(applied.incident),
        jsonbParam(applied.transition),
        jsonbParam(event),
        jsonbParam(envelope),
      ]);
      if (mutation.rows[0]) return { ...parseMutationResult(mutation.rows[0].result), replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const afterConflict = await readTransitionReplay(id, input, authority.authorityId);
      if (afterConflict.rows[0]) return resolveReplay(afterConflict.rows[0], fingerprint);
      throw new IncidentIdempotencyConflictError();
    }
    // CAS loss is also the normal race shape for an identical transition. The
    // immutable idempotency row distinguishes a safe replay from a true stale
    // version without turning a retry into a false 409.
    const afterEmptyMutation = await readTransitionReplay(id, input, authority.authorityId);
    if (afterEmptyMutation.rows[0]) return resolveReplay(afterEmptyMutation.rows[0], fingerprint);
    const latest = await get(id, authority.authorityId);
    if (!latest) throw new IncidentNotFoundError(id);
    throw new IncidentVersionConflictError(id, input.expected_version, latest.version);
  };

  const list = async (filter: IncidentListFilter, authorityIdValue: string): Promise<IncidentState[]> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const conditions = ["service = $1", "authority_id = $2"];
    const values: unknown[] = [service, authorityId];
    if (filter.status) {
      assertEnum(filter.status, INCIDENT_STATUSES, "status");
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter.severity) {
      assertEnum(filter.severity, INCIDENT_SEVERITIES, "severity");
      values.push(filter.severity);
      conditions.push(`severity = $${values.length}`);
    }
    if (filter.owner) {
      values.push(bounded(filter.owner, "owner", 128));
      conditions.push(`owner = $${values.length}`);
    }
    if (filter.scope) {
      values.push(bounded(filter.scope, "scope", 256));
      conditions.push(`(affected_scopes ? $${values.length} OR blocked_scopes ? $${values.length})`);
    }
    if (filter.activeOnly) conditions.push("status NOT IN ('resolved','superseded')");
    if (filter.before) {
      values.push(filter.before.updated_at, filter.before.id);
      conditions.push(`(updated_at, incident_id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(integerInRange(filter.limit ?? 100, "limit", 1, 1_000));
    const result = await client.query<IncidentRow>(`/* todos:incident-list */
      SELECT ${incidentJsonSql()} AS incident
      FROM ${incidents}
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC, incident_id DESC
      LIMIT $${values.length}`, values);
    return result.rows.map((row) => parseIncidentState(row.incident));
  };

  const listActiveBlockers = async (
    filter: Pick<IncidentListFilter, "scope" | "severity" | "owner" | "limit" | "before">,
    authorityIdValue: string,
  ): Promise<IncidentState[]> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const conditions = [
      "service = $1",
      "authority_id = $2",
      "status NOT IN ('resolved','superseded')",
      "jsonb_array_length(blocked_scopes) > 0",
    ];
    const values: unknown[] = [service, authorityId];
    if (filter.scope) {
      values.push(bounded(filter.scope, "scope", 256));
      conditions.push(`blocked_scopes ? $${values.length}`);
    }
    if (filter.severity) {
      assertEnum(filter.severity, INCIDENT_SEVERITIES, "severity");
      values.push(filter.severity);
      conditions.push(`severity = $${values.length}`);
    }
    if (filter.owner) {
      values.push(bounded(filter.owner, "owner", 128));
      conditions.push(`owner = $${values.length}`);
    }
    if (filter.before) {
      values.push(filter.before.updated_at, filter.before.id);
      conditions.push(`(updated_at, incident_id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(integerInRange(filter.limit ?? 100, "limit", 1, 1_000));
    const result = await client.query<IncidentRow>(`/* todos:incident-active-blockers */
      SELECT ${incidentJsonSql()} AS incident
      FROM ${incidents}
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC, incident_id DESC
      LIMIT $${values.length}`, values);
    return result.rows.map((row) => parseIncidentState(row.incident));
  };

  const listTransitions = async (id: string, authorityIdValue: string): Promise<IncidentTransition[]> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const result = await client.query<TransitionRow>(`/* todos:incident-transition-list */
      SELECT jsonb_build_object(
        'id', transition_id, 'authority_id', authority_id, 'incident_id', incident_id,
        'incident_version', incident_version, 'idempotency_key', idempotency_key,
        'request_fingerprint', request_fingerprint, 'action', action, 'actor_id', actor_id,
        'effective_actor_id', effective_actor_id, 'actor_key_id', actor_key_id, 'actor_act_as', actor_act_as,
        'reason', reason, 'before', before_state,
        'after', after_state, 'created_at', to_jsonb(created_at)
      ) AS transition
      FROM ${transitions}
      WHERE service = $1 AND authority_id = $2 AND incident_id = $3
      ORDER BY incident_version ASC`, [service, authorityId, id]);
    return result.rows.map((row) => parseTransition(row.transition));
  };

  const getDeadOutbox = async (eventIdValue: string, authorityIdValue: string): Promise<IncidentOutboxRecord | null> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const eventId = bounded(eventIdValue, "event_id", 128);
    const result = await client.query<OutboxRow>(`/* todos:incident-outbox-dead-get */
      SELECT ${outboxJsonSql("record")} AS outbox
      FROM ${outbox} record
      WHERE record.service = $1 AND record.authority_id = $2
        AND record.event_id = $3 AND record.status = 'dead'
      LIMIT 1`, [service, authorityId, eventId]);
    return result.rows[0] ? parseDeadOutbox(result.rows[0].outbox) : null;
  };

  const listDeadOutbox = async (
    listOptions: IncidentDeadOutboxListOptions,
    authorityIdValue: string,
  ): Promise<IncidentOutboxRecord[]> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const values: unknown[] = [service, authorityId];
    const conditions = ["record.service = $1", "record.authority_id = $2", "record.status = 'dead'"];
    if (listOptions.before) {
      values.push(listOptions.before.created_at, bounded(listOptions.before.event_id, "before event_id", 128));
      conditions.push(`(record.created_at, record.event_id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(integerInRange(listOptions.limit ?? 100, "limit", 1, 1_000));
    const result = await client.query<OutboxRow>(`/* todos:incident-outbox-dead-list */
      SELECT ${outboxJsonSql("record")} AS outbox
      FROM ${outbox} record
      WHERE ${conditions.join(" AND ")}
      ORDER BY record.created_at DESC, record.event_id DESC
      LIMIT $${values.length}`, values);
    return result.rows.map((row) => parseDeadOutbox(row.outbox));
  };

  const getOutboxStatus = async (authorityIdValue: string): Promise<IncidentOutboxStatus> => {
    const authorityId = normalizeIncidentAuthorityId(authorityIdValue);
    const result = await client.query<OutboxStatusRow>(`/* todos:incident-outbox-status */
      SELECT status, count(*)::integer AS count
      FROM ${outbox}
      WHERE service = $1 AND authority_id = $2
      GROUP BY status`, [service, authorityId]);
    const status: IncidentOutboxStatus = { pending: 0, leased: 0, acked: 0, dead: 0, total: 0 };
    for (const row of result.rows) {
      if (!Object.prototype.hasOwnProperty.call(status, row.status)) {
        throw new Error("Invalid incident outbox status aggregate");
      }
      const count = Number(row.count);
      if (!Number.isInteger(count) || count < 0) throw new Error("Invalid incident outbox status count");
      status[row.status] = count;
      status.total += count;
    }
    return status;
  };

  const claimOutbox = async (
    authorityValue: IncidentAuthorityContext,
    claimOptions: IncidentOutboxClaimOptions = {},
  ): Promise<IncidentOutboxRecord[]> => {
    const authority = normalizeAuthority(authorityValue);
    const limit = integerInRange(claimOptions.limit ?? 25, "limit", 1, 100);
    const leaseSeconds = integerInRange(claimOptions.leaseSeconds ?? 60, "leaseSeconds", 5, 3_600);
    const token = bounded(newLeaseToken(), "lease token", 256);
    const leaseExpiredCode = "LEASE_EXPIRED_NO_ACK";
    const leaseExpiredMessage = "delivery lease expired without acknowledgment";
    const leaseExpiredFingerprint = stableIncidentFingerprint({ failure_code: leaseExpiredCode });
    const result = await client.query<OutboxRow>(`/* todos:incident-outbox-claim */
      WITH expired AS (
        UPDATE ${outbox} expired
        SET status = CASE
              WHEN expired.attempts >= $8 OR
                (CASE WHEN expired.failure_fingerprint = $10
                  THEN expired.consecutive_failures + 1 ELSE 1 END) >= $11
              THEN 'dead' ELSE 'pending' END,
          next_attempt_at = $3::timestamptz,
          lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
          delivery_id = NULL, acked_at = NULL, last_error = $12,
          failure_code = $9, failure_fingerprint = $10,
          consecutive_failures = CASE WHEN expired.failure_fingerprint = $10
            THEN expired.consecutive_failures + 1 ELSE 1 END,
          updated_at = $3::timestamptz
        WHERE expired.service = $1 AND expired.authority_id = $2
          AND expired.status = 'leased' AND expired.lease_expires_at <= $3::timestamptz
        RETURNING expired.service, expired.authority_id, expired.event_id, expired.status
      ), candidate AS (
        SELECT candidate.service, candidate.authority_id, candidate.event_id
        FROM ${outbox} candidate
        WHERE candidate.service = $1 AND candidate.authority_id = $2
          AND candidate.attempts < $8
          AND candidate.consecutive_failures < $11
          AND candidate.next_attempt_at <= $3::timestamptz
          AND candidate.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM expired
            WHERE expired.service = candidate.service AND expired.authority_id = candidate.authority_id
              AND expired.event_id = candidate.event_id
          )
          AND (candidate.depends_on_event_id IS NULL OR EXISTS (
            SELECT 1 FROM ${outbox} dependency
            WHERE dependency.service = candidate.service AND dependency.authority_id = candidate.authority_id
              AND dependency.event_id = candidate.depends_on_event_id AND dependency.status = 'acked'
          ))
          AND NOT EXISTS (
            SELECT 1 FROM ${outbox} older
            WHERE older.service = candidate.service AND older.authority_id = candidate.authority_id
              AND older.incident_id = candidate.incident_id
              AND older.incident_version < candidate.incident_version
              AND older.status <> 'acked'
          )
        ORDER BY candidate.created_at ASC, candidate.event_id ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE ${outbox} target
        SET status = 'leased', attempts = target.attempts + 1, lease_token = $5,
          leased_by = $6, lease_expires_at = $3::timestamptz + ($7::integer * interval '1 second'),
          delivery_id = NULL, acked_at = NULL, updated_at = $3::timestamptz
        FROM candidate
        WHERE target.service = candidate.service AND target.authority_id = candidate.authority_id
          AND target.event_id = candidate.event_id
        RETURNING target.*
      ) SELECT ${outboxJsonSql("claimed")} AS outbox FROM claimed
      ORDER BY claimed.created_at ASC, claimed.event_id ASC`, [
      service, authority.authorityId, currentTime(), limit, token, authority.actorId, leaseSeconds,
      maxDeliveryAttempts, leaseExpiredCode, leaseExpiredFingerprint, maxConsecutiveFailures, leaseExpiredMessage,
    ]);
    return result.rows.map((row) => parseOutbox(row.outbox));
  };

  const ackOutbox = async (
    eventIdValue: string,
    leaseTokenValue: string,
    deliveryIdValue: string,
    authorityValue: IncidentAuthorityContext,
  ): Promise<IncidentOutboxRecord> => {
    const authority = normalizeAuthority(authorityValue);
    const eventId = bounded(eventIdValue, "event_id", 128);
    const leaseToken = bounded(leaseTokenValue, "lease_token", 256);
    const deliveryId = bounded(deliveryIdValue, "delivery_id", 256);
    const result = await client.query<OutboxRow>(`/* todos:incident-outbox-ack */
      WITH acked AS (
        UPDATE ${outbox}
        SET status = 'acked', lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
          delivery_id = $6, acked_at = $3::timestamptz, last_error = NULL, updated_at = $3::timestamptz
        WHERE service = $1 AND authority_id = $2 AND event_id = $4
          AND status = 'leased' AND lease_token = $5 AND lease_expires_at > $3::timestamptz
        RETURNING *
      ), replay AS (
        SELECT * FROM ${outbox}
        WHERE service = $1 AND authority_id = $2 AND event_id = $4
          AND status = 'acked' AND delivery_id = $6 AND NOT EXISTS (SELECT 1 FROM acked)
      ) SELECT ${outboxJsonSql("combined")} AS outbox
        FROM (SELECT * FROM acked UNION ALL SELECT * FROM replay) combined`, [
      service, authority.authorityId, currentTime(), eventId, leaseToken, deliveryId,
    ]);
    if (!result.rows[0]) throw new IncidentLeaseConflictError();
    return parseOutbox(result.rows[0].outbox);
  };

  const failOutbox = async (
    eventIdValue: string,
    leaseTokenValue: string,
    failureCodeValue: string,
    failureValue: string,
    authorityValue: IncidentAuthorityContext,
  ): Promise<IncidentOutboxRecord> => {
    const authority = normalizeAuthority(authorityValue);
    const eventId = bounded(eventIdValue, "event_id", 128);
    const leaseToken = bounded(leaseTokenValue, "lease_token", 256);
    const failureCode = incidentFailureCode(failureCodeValue);
    const failure = redactEvidenceText(bounded(failureValue, "failure", 4_000));
    const failureFingerprint = stableIncidentFingerprint({ failure_code: failureCode });
    const result = await client.query<OutboxRow>(`/* todos:incident-outbox-fail */
      WITH failed AS (
        UPDATE ${outbox}
        SET status = CASE WHEN attempts >= $6 OR
              (CASE WHEN failure_fingerprint = $9 THEN consecutive_failures + 1 ELSE 1 END) >= $10
            THEN 'dead' ELSE 'pending' END,
          next_attempt_at = CASE WHEN attempts >= $6 OR
              (CASE WHEN failure_fingerprint = $9 THEN consecutive_failures + 1 ELSE 1 END) >= $10
            THEN next_attempt_at
            ELSE $3::timestamptz + (LEAST(3600, (power(2, LEAST(attempts, 12))::integer * 5)) * interval '1 second') END,
          lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
          delivery_id = NULL, acked_at = NULL, last_error = $7,
          failure_code = $8, failure_fingerprint = $9,
          consecutive_failures = CASE WHEN failure_fingerprint = $9 THEN consecutive_failures + 1 ELSE 1 END,
          updated_at = $3::timestamptz
        WHERE service = $1 AND authority_id = $2 AND event_id = $4
          AND status = 'leased' AND lease_token = $5 AND lease_expires_at > $3::timestamptz
        RETURNING *
      ) SELECT ${outboxJsonSql("failed")} AS outbox FROM failed`, [
      service, authority.authorityId, currentTime(), eventId, leaseToken, maxDeliveryAttempts, failure,
      failureCode, failureFingerprint, maxConsecutiveFailures,
    ]);
    if (!result.rows[0]) throw new IncidentLeaseConflictError();
    return parseOutbox(result.rows[0].outbox);
  };

  const requeueOutbox = async (
    eventIdValue: string,
    input: IncidentOutboxRequeueInput,
    authorityValue: IncidentAuthorityContext,
  ): Promise<IncidentOutboxRecord> => {
    const authority = normalizeAuthority(authorityValue);
    const eventId = bounded(eventIdValue, "event_id", 128);
    const expectedAttempts = integerInRange(input.expectedAttempts, "expectedAttempts", 1, 1_000_000);
    const idempotencyKey = commandKey(input.idempotencyKey);
    const reason = bounded(input.reason, "reason", 2_000);
    const fingerprint = stableIncidentFingerprint({
      event_id: eventId,
      expected_attempts: expectedAttempts,
      idempotency_key: idempotencyKey,
      reason,
    });
    const readReplay = () => client.query<RecoveryReplayRow>(`/* todos:incident-outbox-requeue-replay */
      SELECT request_fingerprint, command_result AS outbox
      FROM ${recoveries}
      WHERE service = $1 AND authority_id = $2 AND event_id = $3 AND idempotency_key = $4
      LIMIT 1`, [service, authority.authorityId, eventId, idempotencyKey]);
    const replay = await readReplay();
    if (replay.rows[0]) return resolveOutboxRecoveryReplay(replay.rows[0], fingerprint);
    const recoveryId = `ior_${stableIncidentFingerprint([authority.authorityId, eventId, idempotencyKey]).slice(0, 32)}`;
    try {
      const result = await client.query<OutboxRow>(`/* todos:incident-outbox-requeue-atomic */
        WITH target AS (
          SELECT *, ${outboxJsonSql("source")} AS before_state
          FROM ${outbox} source
          WHERE service = $1 AND authority_id = $2 AND event_id = $3
            AND status = 'dead' AND attempts = $4
          FOR UPDATE
        ), changed AS (
          UPDATE ${outbox} destination
          SET status = 'pending', attempts = 0, next_attempt_at = $5::timestamptz,
            lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
            delivery_id = NULL, acked_at = NULL, last_error = NULL,
            failure_code = NULL, failure_fingerprint = NULL, consecutive_failures = 0, updated_at = $5::timestamptz
          FROM target
          WHERE destination.service = target.service AND destination.authority_id = target.authority_id
            AND destination.event_id = target.event_id
          RETURNING destination.*
        ), written_recovery AS (
          INSERT INTO ${recoveries} (
            service, authority_id, recovery_id, event_id, expected_attempts, idempotency_key,
            request_fingerprint, actor_id, effective_actor_id, actor_key_id, actor_act_as,
            reason, before_state, after_state, command_result, created_at
          ) SELECT $1, $2, $6, $3, $4, $7, $8, $9, $12, $10, $13, $11,
            target.before_state, ${outboxJsonSql("changed")}, ${outboxJsonSql("changed")}, $5::timestamptz
          FROM target JOIN changed ON changed.service = target.service AND changed.authority_id = target.authority_id
            AND changed.event_id = target.event_id
          RETURNING command_result AS outbox
        ) SELECT outbox FROM written_recovery`, [
        service,
        authority.authorityId,
        eventId,
        expectedAttempts,
        currentTime(),
        recoveryId,
        idempotencyKey,
        fingerprint,
        authority.actorId,
        authority.actorKeyId,
        reason,
        authority.effectiveActorId,
        authority.actorActAs,
      ]);
      if (result.rows[0]) return parseOutbox(result.rows[0].outbox);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const afterConflict = await readReplay();
      if (afterConflict.rows[0]) return resolveOutboxRecoveryReplay(afterConflict.rows[0], fingerprint);
      throw new IncidentIdempotencyConflictError();
    }
    const afterEmptyMutation = await readReplay();
    if (afterEmptyMutation.rows[0]) return resolveOutboxRecoveryReplay(afterEmptyMutation.rows[0], fingerprint);
    throw new IncidentOutboxRecoveryConflictError();
  };

  return {
    create,
    get,
    list,
    listActiveBlockers,
    transition,
    listTransitions,
    getDeadOutbox,
    listDeadOutbox,
    getOutboxStatus,
    claimOutbox,
    ackOutbox,
    failOutbox,
    requeueOutbox,
  };
}

interface ReplayRow { request_fingerprint: string; result: unknown }
interface MutationRow { result: unknown }
interface IncidentRow { incident: unknown }
interface TransitionRow { transition: unknown }
interface OutboxRow { outbox: unknown }
interface OutboxStatusRow { status: Exclude<keyof IncidentOutboxStatus, "total">; count: number | string }
interface RecoveryReplayRow { request_fingerprint: string; outbox: unknown }

function createIncidentAtomicSql(incidents: string, transitions: string, outbox: string): string {
  return `/* todos:incident-create-atomic; supersedes_expected_version = $10 */
    WITH replacement AS (
      UPDATE ${incidents}
      SET title = $11::jsonb->>'title', severity = $11::jsonb->>'severity', status = $11::jsonb->>'status',
        owner = $11::jsonb->>'owner', affected_scopes = $11::jsonb->'affected_scopes', blocked_scopes = $11::jsonb->'blocked_scopes',
        containment = $11::jsonb->>'containment', next_action = $11::jsonb->>'next_action',
        deadline = ($11::jsonb->>'deadline')::timestamptz, closure_evidence = $11::jsonb->'closure_evidence',
        supersedes_id = $11::jsonb->>'supersedes_id', superseded_by_id = $11::jsonb->>'superseded_by_id',
        resolved_at = ($11::jsonb->>'resolved_at')::timestamptz, version = ($11::jsonb->>'version')::integer,
        updated_at = ($11::jsonb->>'updated_at')::timestamptz
      WHERE service = $1 AND authority_id = $2 AND incident_id = $9
        AND $9::text IS NOT NULL AND version = $10 AND status NOT IN ('resolved','superseded')
      RETURNING incident_id
    ), gate AS (
      SELECT 1 AS ok WHERE $9::text IS NULL OR EXISTS (SELECT 1 FROM replacement)
    ), created AS (
      INSERT INTO ${incidents} (
        service, authority_id, incident_id, idempotency_key, request_fingerprint,
        title, severity, status, owner, affected_scopes, blocked_scopes, containment,
        next_action, deadline, closure_evidence, supersedes_id, superseded_by_id,
        resolved_at, version, created_at, updated_at
      ) SELECT
        $1, $2, $3::jsonb->>'id', $4, $5,
        $3::jsonb->>'title', $3::jsonb->>'severity', $3::jsonb->>'status', $3::jsonb->>'owner',
        $3::jsonb->'affected_scopes', $3::jsonb->'blocked_scopes', $3::jsonb->>'containment',
        $3::jsonb->>'next_action', ($3::jsonb->>'deadline')::timestamptz, $3::jsonb->'closure_evidence',
        $3::jsonb->>'supersedes_id', $3::jsonb->>'superseded_by_id', ($3::jsonb->>'resolved_at')::timestamptz,
        ($3::jsonb->>'version')::integer, ($3::jsonb->>'created_at')::timestamptz, ($3::jsonb->>'updated_at')::timestamptz
      FROM gate
      RETURNING incident_id
    ), replacement_transition AS (
      INSERT INTO ${transitions} (
        service, authority_id, transition_id, incident_id, incident_version, idempotency_key,
        request_fingerprint, action, actor_id, effective_actor_id, actor_key_id, actor_act_as,
        reason, before_state, after_state, command_result, created_at
      ) SELECT $1, $2, $12::jsonb->>'id', $12::jsonb->>'incident_id', ($12::jsonb->>'incident_version')::integer,
        $12::jsonb->>'idempotency_key', $12::jsonb->>'request_fingerprint', $12::jsonb->>'action',
        $12::jsonb->>'actor_id', $12::jsonb->>'effective_actor_id', $12::jsonb->>'actor_key_id',
        ($12::jsonb->>'actor_act_as')::boolean, $12::jsonb->>'reason',
        $12::jsonb->'before', $12::jsonb->'after', $8::jsonb, ($12::jsonb->>'created_at')::timestamptz
      FROM replacement WHERE $12::jsonb IS NOT NULL
      RETURNING transition_id
    ), created_transition AS (
      INSERT INTO ${transitions} (
        service, authority_id, transition_id, incident_id, incident_version, idempotency_key,
        request_fingerprint, action, actor_id, effective_actor_id, actor_key_id, actor_act_as,
        reason, before_state, after_state, command_result, created_at
      ) SELECT $1, $2, $6::jsonb->>'id', $6::jsonb->>'incident_id', ($6::jsonb->>'incident_version')::integer,
        $6::jsonb->>'idempotency_key', $6::jsonb->>'request_fingerprint', $6::jsonb->>'action',
        $6::jsonb->>'actor_id', $6::jsonb->>'effective_actor_id', $6::jsonb->>'actor_key_id',
        ($6::jsonb->>'actor_act_as')::boolean, $6::jsonb->>'reason',
        $6::jsonb->'before', $6::jsonb->'after', $8::jsonb, ($6::jsonb->>'created_at')::timestamptz
      FROM created
      RETURNING transition_id
    ), replacement_outbox AS (
      INSERT INTO ${outbox} (
        service, authority_id, event_id, projection_key, transition_id, incident_id, incident_version, depends_on_event_id,
        payload, status, attempts, next_attempt_at, created_at, updated_at
      ) SELECT $1, $2, $13::jsonb->>'event_id', $13::jsonb->>'projection_key', $13::jsonb->>'transition_id',
        $13::jsonb->>'incident_id', ($13::jsonb->>'incident_version')::integer, NULL, $13::jsonb,
        'pending', 0, ($13::jsonb->>'occurred_at')::timestamptz,
        ($13::jsonb->>'occurred_at')::timestamptz, ($13::jsonb->>'occurred_at')::timestamptz
      FROM replacement_transition WHERE $13::jsonb IS NOT NULL
      RETURNING event_id
    ), created_outbox AS (
      INSERT INTO ${outbox} (
        service, authority_id, event_id, projection_key, transition_id, incident_id, incident_version, depends_on_event_id,
        payload, status, attempts, next_attempt_at, created_at, updated_at
      ) SELECT $1, $2, $7::jsonb->>'event_id', $7::jsonb->>'projection_key', $7::jsonb->>'transition_id',
        $7::jsonb->>'incident_id', ($7::jsonb->>'incident_version')::integer,
        CASE WHEN $9::text IS NULL THEN NULL ELSE $13::jsonb->>'event_id' END, $7::jsonb,
        'pending', 0, ($7::jsonb->>'occurred_at')::timestamptz,
        ($7::jsonb->>'occurred_at')::timestamptz, ($7::jsonb->>'occurred_at')::timestamptz
      FROM created_transition
      RETURNING event_id
    ) SELECT $8::jsonb AS result FROM created
      WHERE EXISTS (SELECT 1 FROM created_transition) AND EXISTS (SELECT 1 FROM created_outbox)
        AND ($9::text IS NULL OR (EXISTS (SELECT 1 FROM replacement_transition) AND EXISTS (SELECT 1 FROM replacement_outbox)))`;
}

function transitionIncidentAtomicSql(incidents: string, transitions: string, outbox: string): string {
  return `/* todos:incident-transition-atomic */
    WITH changed AS (
      UPDATE ${incidents}
      SET title = $5::jsonb->>'title', severity = $5::jsonb->>'severity', status = $5::jsonb->>'status',
        owner = $5::jsonb->>'owner', affected_scopes = $5::jsonb->'affected_scopes', blocked_scopes = $5::jsonb->'blocked_scopes',
        containment = $5::jsonb->>'containment', next_action = $5::jsonb->>'next_action',
        deadline = ($5::jsonb->>'deadline')::timestamptz, closure_evidence = $5::jsonb->'closure_evidence',
        supersedes_id = $5::jsonb->>'supersedes_id', superseded_by_id = $5::jsonb->>'superseded_by_id',
        resolved_at = ($5::jsonb->>'resolved_at')::timestamptz, version = ($5::jsonb->>'version')::integer,
        updated_at = ($5::jsonb->>'updated_at')::timestamptz
      WHERE service = $1 AND authority_id = $2 AND incident_id = $3
        AND version = $4 AND status NOT IN ('resolved','superseded')
      RETURNING incident_id
    ), written_transition AS (
      INSERT INTO ${transitions} (
        service, authority_id, transition_id, incident_id, incident_version, idempotency_key,
        request_fingerprint, action, actor_id, effective_actor_id, actor_key_id, actor_act_as,
        reason, before_state, after_state, command_result, created_at
      ) SELECT $1, $2, $6::jsonb->>'id', $6::jsonb->>'incident_id', ($6::jsonb->>'incident_version')::integer,
        $6::jsonb->>'idempotency_key', $6::jsonb->>'request_fingerprint', $6::jsonb->>'action',
        $6::jsonb->>'actor_id', $6::jsonb->>'effective_actor_id', $6::jsonb->>'actor_key_id',
        ($6::jsonb->>'actor_act_as')::boolean, $6::jsonb->>'reason',
        $6::jsonb->'before', $6::jsonb->'after', $8::jsonb, ($6::jsonb->>'created_at')::timestamptz
      FROM changed
      RETURNING transition_id
    ), written_outbox AS (
      INSERT INTO ${outbox} (
        service, authority_id, event_id, projection_key, transition_id, incident_id, incident_version, depends_on_event_id,
        payload, status, attempts, next_attempt_at, created_at, updated_at
      ) SELECT $1, $2, $7::jsonb->>'event_id', $7::jsonb->>'projection_key', $7::jsonb->>'transition_id',
        $7::jsonb->>'incident_id', ($7::jsonb->>'incident_version')::integer, NULL, $7::jsonb,
        'pending', 0, ($7::jsonb->>'occurred_at')::timestamptz,
        ($7::jsonb->>'occurred_at')::timestamptz, ($7::jsonb->>'occurred_at')::timestamptz
      FROM written_transition
      RETURNING event_id
    ) SELECT $8::jsonb AS result FROM changed
      WHERE EXISTS (SELECT 1 FROM written_transition) AND EXISTS (SELECT 1 FROM written_outbox)`;
}

function incidentJsonSql(): string {
  return `jsonb_build_object(
    'id', incident_id, 'title', title, 'severity', severity, 'status', status, 'owner', owner,
    'affected_scopes', affected_scopes, 'blocked_scopes', blocked_scopes, 'containment', containment,
    'next_action', next_action, 'deadline', to_jsonb(deadline), 'closure_evidence', closure_evidence,
    'supersedes_id', supersedes_id, 'superseded_by_id', superseded_by_id, 'resolved_at', to_jsonb(resolved_at),
    'version', version, 'created_at', to_jsonb(created_at), 'updated_at', to_jsonb(updated_at)
  )`;
}

function outboxJsonSql(alias: string): string {
  return `jsonb_build_object(
    'event_id', ${alias}.event_id, 'projection_key', ${alias}.projection_key,
    'incident_id', ${alias}.incident_id, 'incident_version', ${alias}.incident_version,
    'depends_on_event_id', ${alias}.depends_on_event_id,
    'payload', ${alias}.payload, 'status', ${alias}.status, 'attempts', ${alias}.attempts,
    'next_attempt_at', to_jsonb(${alias}.next_attempt_at), 'lease_token', ${alias}.lease_token,
    'leased_by', ${alias}.leased_by, 'lease_expires_at', to_jsonb(${alias}.lease_expires_at),
    'delivery_id', ${alias}.delivery_id, 'acked_at', to_jsonb(${alias}.acked_at),
    'last_error', ${alias}.last_error, 'failure_code', ${alias}.failure_code,
    'failure_fingerprint', ${alias}.failure_fingerprint,
    'consecutive_failures', ${alias}.consecutive_failures, 'created_at', to_jsonb(${alias}.created_at),
    'updated_at', to_jsonb(${alias}.updated_at)
  )`;
}

function normalizeAuthority(value: IncidentAuthorityContext): IncidentAuthorityContext {
  const actorId = bounded(value.actorId, "authenticated actor", 256);
  return {
    authorityId: normalizeIncidentAuthorityId(value.authorityId),
    actorId,
    effectiveActorId: bounded(value.effectiveActorId ?? actorId, "effective actor", 256),
    actorKeyId: value.actorKeyId === null ? null : bounded(value.actorKeyId, "actor key id", 256),
    actorActAs: value.actorActAs === true,
  };
}

function resolveReplay(row: ReplayRow, expectedFingerprint: string): IncidentMutationResult {
  if (row.request_fingerprint !== expectedFingerprint) throw new IncidentIdempotencyConflictError();
  return { ...parseMutationResult(row.result), replayed: true };
}

function resolveOutboxRecoveryReplay(row: RecoveryReplayRow, expectedFingerprint: string): IncidentOutboxRecord {
  if (row.request_fingerprint !== expectedFingerprint) throw new IncidentIdempotencyConflictError();
  return parseOutbox(row.outbox);
}

function parseMutationResult(value: unknown): Omit<IncidentMutationResult, "replayed"> {
  const record = object(value, "incident mutation result");
  if (!Array.isArray(record.transitions) || !Array.isArray(record.events)) {
    throw new Error("Invalid incident mutation result arrays");
  }
  return {
    incident: parseIncidentState(record.incident),
    transitions: record.transitions.map(parseTransition),
    events: record.events.map(parseProjectionEvent),
  };
}

function parseIncidentState(value: unknown): IncidentState {
  const row = object(value, "incident state");
  assertEnum(row.severity, INCIDENT_SEVERITIES, "severity");
  assertEnum(row.status, INCIDENT_STATUSES, "status");
  if (!Array.isArray(row.affected_scopes) || !Array.isArray(row.blocked_scopes) || !Array.isArray(row.closure_evidence)) {
    throw new Error("Invalid incident state arrays");
  }
  if ([...row.affected_scopes, ...row.blocked_scopes, ...row.closure_evidence].some((item) => typeof item !== "string")) {
    throw new Error("Invalid incident state array item");
  }
  if (row.blocked_scopes.some((scope) =>
    scope.length > 128 || !Object.values(INCIDENT_BLOCKED_SCOPE_PATTERNS).some((pattern) => pattern.test(scope)))) {
    throw new Error("Invalid incident blocked scope contract");
  }
  if (typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) {
    throw new Error("Invalid incident version");
  }
  return row as unknown as IncidentState;
}

function parseTransition(value: unknown): IncidentTransition {
  const row = object(value, "incident transition");
  if (typeof row.id !== "string" || typeof row.authority_id !== "string" || typeof row.incident_id !== "string") {
    throw new Error("Invalid incident transition identity");
  }
  if (typeof row.incident_version !== "number" || !Number.isInteger(row.incident_version)) {
    throw new Error("Invalid incident transition version");
  }
  parseIncidentState(row.after);
  if (row.before !== null) parseIncidentState(row.before);
  return row as unknown as IncidentTransition;
}

function parseProjectionEvent(value: unknown): IncidentProjectionEvent {
  const row = object(value, "incident projection event");
  if (row.schema_version !== 1 || row.source !== "todos") throw new Error("Invalid incident projection event contract");
  parseIncidentState(row.incident);
  return row as unknown as IncidentProjectionEvent;
}

function parseOutbox(value: unknown): IncidentOutboxRecord {
  const row = object(value, "incident outbox record");
  parseProjectionEvent(row.payload);
  for (const field of ["event_id", "projection_key", "incident_id"] as const) {
    if (typeof row[field] !== "string" || !row[field]) throw new Error(`Invalid incident outbox ${field}`);
  }
  if (row.depends_on_event_id !== null && typeof row.depends_on_event_id !== "string") {
    throw new Error("Invalid incident outbox dependency");
  }
  if (!["pending", "leased", "acked", "dead"].includes(String(row.status))) {
    throw new Error("Invalid incident outbox status");
  }
  if (typeof row.attempts !== "number" || !Number.isInteger(row.attempts) || row.attempts < 0 ||
      typeof row.consecutive_failures !== "number" || !Number.isInteger(row.consecutive_failures) || row.consecutive_failures < 0) {
    throw new Error("Invalid incident outbox attempt counters");
  }
  if (row.failure_code !== null && (typeof row.failure_code !== "string" || !/^[A-Z][A-Z0-9_:-]{1,63}$/.test(row.failure_code))) {
    throw new Error("Invalid incident outbox failure code");
  }
  if (row.failure_fingerprint !== null &&
      (typeof row.failure_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.failure_fingerprint))) {
    throw new Error("Invalid incident outbox failure fingerprint");
  }
  return row as unknown as IncidentOutboxRecord;
}

function parseDeadOutbox(value: unknown): IncidentOutboxRecord {
  const record = parseOutbox(value);
  if (record.status !== "dead") throw new Error("Invalid dead incident outbox record");
  if (record.lease_token !== null || record.leased_by !== null || record.lease_expires_at !== null) {
    throw new Error("Dead incident outbox record retained lease credentials");
  }
  return record;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function commandKey(value: unknown): string {
  const key = bounded(value, "idempotency key", 128);
  if (key.length < 8 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new Error("Invalid idempotency key");
  return key;
}

function incidentFailureCode(value: unknown): string {
  const code = bounded(value, "failure code", 64);
  if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(code)) throw new Error("Invalid failure code");
  return code;
}

function integerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
}

function assertEnum<T extends string>(value: unknown, choices: readonly T[], label: string): asserts value is T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) throw new Error(`Invalid ${label}`);
}

function safeIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return value;
}

function incidentTransitionImmutableFunction(transitionsTable: string): string {
  return `${transitionsTable.endsWith("s") ? transitionsTable.slice(0, -1) : transitionsTable}_immutable`;
}

// Bun.SQL and node-pg serialize JS objects/arrays for `$::jsonb` parameters.
// Pre-encoding with JSON.stringify would persist a jsonb string scalar, making
// every `->>` field extraction in the atomic CTE resolve to NULL.
function jsonbParam(value: unknown): unknown {
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const postgresError = error as { code?: unknown; errno?: unknown };
  // node-pg exposes the SQLSTATE as `code`; Bun.SQL keeps its runtime code in
  // `code` and exposes the PostgreSQL SQLSTATE as `errno`.
  return postgresError.code === "23505" || postgresError.errno === "23505";
}
