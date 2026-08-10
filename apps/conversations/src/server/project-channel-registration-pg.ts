import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { newChannelId } from "../lib/channel-id.js";
import {
  PROJECT_CHANNEL_REGISTRATION_CREATOR,
  assertProjectChannelRegistrationIdentity,
  buildProjectChannelRegistrationCapability,
  buildProjectChannelCollectionPage,
  buildProjectChannelMessageCollectionPage,
  buildProjectChannelRegistrationReceipt,
  exactProjectChannelRegistrationReplay,
  projectChannelRegistrationChannelRecord,
  projectChannelRegistrationDigest,
  projectChannelRegistrationResponseControl,
  sameProjectChannelRegistrationReceipt,
  validateProjectChannelRegistrationForward,
  validateProjectChannelRegistrationInverse,
  validateProjectChannelRegistrationInverseEnvelope,
  validateProjectChannelRegistrationLookup,
  validateProjectChannelCollectionRequest,
  validateProjectChannelMessageCollectionRequest,
  type ProjectChannelRegistrationCapability,
  type ProjectChannelCollectionPage,
  type ProjectChannelCollectionRequest,
  type ProjectChannelRegistrationFaultOptions,
  type ProjectChannelRegistrationInverseVerification,
  type ProjectChannelRegistrationLookupRequest,
  type ProjectChannelRegistrationLookupResult,
  type ProjectChannelRegistrationPriorState,
  type ProjectChannelRegistrationReadRequest,
  type ProjectChannelRegistrationReceipt,
  type ProjectChannelRegistrationRecord,
  type ProjectChannelRegistrationRequest,
  type ProjectChannelMessageCollectionPage,
  type ProjectChannelMessageCollectionRequest,
  type ProjectChannelMessageCollectionRow,
} from "../lib/project-channel-registration.js";

type PgReceiptRow = Omit<ProjectChannelRegistrationReceipt, "created_at" | "prior_state"> & {
  created_at: string | Date;
  prior_state: ProjectChannelRegistrationPriorState | string | null;
};

type PgChannelRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string | Date;
  archived_at: string | null;
  metadata: string | null;
  tags: string | null;
};

function timestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function parseReceipt(row: PgReceiptRow): ProjectChannelRegistrationReceipt {
  const priorState = typeof row.prior_state === "string"
    ? JSON.parse(row.prior_state) as ProjectChannelRegistrationPriorState
    : row.prior_state;
  return {
    ...row,
    authority: "conversations",
    resource_kind: "channel",
    created_by_operation: row.created_by_operation === true,
    prior_state: priorState ?? null,
    created_at: timestamp(row.created_at),
  };
}

function parseChannel(row: PgChannelRow): Parameters<typeof projectChannelRegistrationChannelRecord>[0] {
  return {
    ...row,
    created_at: timestamp(row.created_at),
  };
}

function assertBounds(input: {
  response_byte_limit: number;
  time_budget_ms: number;
  call_limit?: 1;
}): void {
  if (!Number.isInteger(input.response_byte_limit) || input.response_byte_limit <= 0) {
    throw new Error("response_byte_limit must be a positive integer.");
  }
  if (!Number.isInteger(input.time_budget_ms) || input.time_budget_ms <= 0) {
    throw new Error("time_budget_ms must be a positive integer.");
  }
  if (input.call_limit !== undefined && input.call_limit !== 1) {
    throw new Error("call_limit must be exactly 1.");
  }
}

function assertTime(startedAt: number, budget: number): void {
  const elapsed = Math.max(0, Math.ceil(performance.now() - startedAt));
  if (elapsed > budget) {
    throw new Error(`project channel registration exceeded time_budget_ms (${elapsed} > ${budget}).`);
  }
}

async function capability(
  client: TypedQueryClient,
  lock = false,
): Promise<ProjectChannelRegistrationCapability> {
  const row = await client.get<{ corpus_id: string }>(
    `SELECT corpus_id
     FROM project_channel_registration_identity
     WHERE singleton = TRUE${lock ? " FOR UPDATE" : ""}`,
  );
  if (!row?.corpus_id) throw new Error("project channel registration corpus identity is missing.");
  return buildProjectChannelRegistrationCapability(row.corpus_id);
}

export async function projectChannelRegistrationPgCapability(
  client: TypedQueryClient,
): Promise<ProjectChannelRegistrationCapability> {
  return capability(client);
}

async function insertReceipt(
  client: TypedQueryClient,
  receipt: ProjectChannelRegistrationReceipt,
): Promise<ProjectChannelRegistrationReceipt> {
  const inserted = await client.get<PgReceiptRow>(`
    INSERT INTO project_channel_registration_receipts (
      receipt_id, authority, route, package_version, authority_id, tenant_id,
      corpus_id, operation_id, step_id, resource_kind, direction,
      idempotency_key, request_digest, precondition_digest, outcome, reason,
      target_id, result_revision, result_digest, duplicate_of_receipt_id,
      accepted_receipt_id, created_by_operation, prior_state, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24
    )
    ON CONFLICT (receipt_id) DO NOTHING
    RETURNING *
  `, [
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
    receipt.created_by_operation,
    receipt.prior_state,
    receipt.created_at,
  ]);
  if (inserted) return parseReceipt(inserted);
  const existing = await client.get<PgReceiptRow>(
    "SELECT * FROM project_channel_registration_receipts WHERE receipt_id = $1",
    [receipt.receipt_id],
  );
  if (!existing) throw new Error("project channel registration receipt insert was lost.");
  const parsed = parseReceipt(existing);
  if (!sameProjectChannelRegistrationReceipt(parsed, receipt)) {
    throw new Error(`project channel registration receipt id collision: ${receipt.receipt_id}`);
  }
  return parsed;
}

async function acceptedForStep(
  client: TypedQueryClient,
  cap: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
): Promise<ProjectChannelRegistrationReceipt | null> {
  const rows = await client.many<PgReceiptRow>(`
    SELECT * FROM project_channel_registration_receipts
    WHERE authority = $1 AND route = $2 AND package_version = $3
      AND authority_id = $4 AND tenant_id = $5 AND corpus_id = $6
      AND operation_id = $7 AND step_id = $8 AND resource_kind = 'channel'
      AND direction = $9 AND outcome = 'accepted'
    ORDER BY created_at DESC, receipt_id DESC
    LIMIT 2
  `, [
    cap.authority,
    cap.route,
    cap.package_version,
    cap.authority_id,
    cap.tenant_id,
    cap.corpus_id,
    request.operation_id,
    request.step_id,
    request.direction,
  ]);
  if (rows.length > 1) {
    throw new Error("ambiguous project channel registration: multiple accepted receipts for one step.");
  }
  return rows[0] ? parseReceipt(rows[0]) : null;
}

async function duplicateReceipt(
  client: TypedQueryClient,
  cap: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  accepted: ProjectChannelRegistrationReceipt,
): Promise<ProjectChannelRegistrationReceipt> {
  return insertReceipt(client, buildProjectChannelRegistrationReceipt({
    capability: cap,
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

async function changedReceipt(
  client: TypedQueryClient,
  cap: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  accepted: ProjectChannelRegistrationReceipt,
): Promise<ProjectChannelRegistrationReceipt> {
  return insertReceipt(client, buildProjectChannelRegistrationReceipt({
    capability: cap,
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

async function lockKey(client: TypedQueryClient, key: string): Promise<void> {
  await client.get<{ locked: unknown }>(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
    [key],
  );
}

async function lockRegistration(
  client: TypedQueryClient,
  cap: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  selector: string,
): Promise<void> {
  const stepKey = projectChannelRegistrationDigest({
    authority: cap.authority,
    route: cap.route,
    package_version: cap.package_version,
    authority_id: cap.authority_id,
    tenant_id: cap.tenant_id,
    corpus_id: cap.corpus_id,
    operation_id: request.operation_id,
    step_id: request.step_id,
    resource_kind: request.resource_kind,
    direction: request.direction,
  });
  // Every call takes locks in the same order: the receipt identity first,
  // then the target. The first lock serializes changed requests for one step;
  // the second preserves create-if-absent across different steps.
  await lockKey(client, `project-channel-registration:step:${stepKey}`);
  await lockKey(client, `project-channel-registration:selector:${selector}`);
}

function preexistingEquivalent(
  row: Parameters<typeof projectChannelRegistrationChannelRecord>[0],
  request: ProjectChannelRegistrationRequest,
): boolean {
  const metadata = typeof row.metadata === "string" && row.metadata ? JSON.parse(row.metadata) : null;
  const tags = typeof row.tags === "string" && row.tags ? JSON.parse(row.tags) : [];
  return row.name === request.project_slug
    && (row.project_id === null || row.project_id === request.project_id)
    && row.description === null
    && row.topic === null
    && row.archived_at === null
    && metadata === null
    && Array.isArray(tags)
    && tags.length === 0;
}

async function messageProjectDigest(
  client: TypedQueryClient,
  channel: string,
): Promise<string> {
  const rows = await client.many<{
    id: number;
    uuid: string;
    project_id: string | null;
  }>(`
    SELECT id, uuid, project_id
    FROM messages
    WHERE channel = $1
    ORDER BY id ASC
  `, [channel]);
  return projectChannelRegistrationDigest(rows.map((row) => ({
    id: Number(row.id),
    uuid: row.uuid,
    project_id: row.project_id ?? null,
  })));
}

export async function registerProjectChannelPg(
  client: PoolQueryClient,
  request: ProjectChannelRegistrationRequest,
  options: ProjectChannelRegistrationFaultOptions = {},
): Promise<ProjectChannelRegistrationReceipt> {
  const startedAt = performance.now();
  const initialCapability = await capability(client);
  const validated = validateProjectChannelRegistrationForward(request, initialCapability);

  return client.transaction(async (tx) => {
    const cap = await capability(tx, true);
    assertProjectChannelRegistrationIdentity(request, cap);
    await lockRegistration(tx, cap, request, validated.channel);

    const accepted = await acceptedForStep(tx, cap, request);
    if (accepted) {
      const receipt = exactProjectChannelRegistrationReplay(accepted, request)
        ? await duplicateReceipt(tx, cap, request, accepted)
        : await changedReceipt(tx, cap, request, accepted);
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }

    if (validated.retired) {
      const receipt = await insertReceipt(tx, buildProjectChannelRegistrationReceipt({
        capability: cap,
        request,
        outcome: "terminal_nonacceptance",
        reason: "retired_project_prefix",
      }));
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }

    const preexistingRaw = await tx.get<PgChannelRow>(
      "SELECT * FROM channels WHERE name = $1 FOR UPDATE",
      [validated.channel],
    );
    if (validated.binding) {
      if (!preexistingRaw) {
        const receipt = await insertReceipt(tx, buildProjectChannelRegistrationReceipt({
          capability: cap,
          request,
          outcome: "terminal_nonacceptance",
          reason: "bind_target_missing",
        }));
        assertTime(startedAt, request.time_budget_ms);
        return receipt;
      }
      const preexisting = parseChannel(preexistingRaw);
      const priorRecord = projectChannelRegistrationChannelRecord(preexisting);
      if (
        preexisting.id !== validated.binding.target_id
        || preexisting.project_id !== validated.binding.expected_project_id
        || priorRecord.revision !== validated.binding.expected_revision
        || priorRecord.digest !== validated.binding.expected_digest
      ) {
        const receipt = await insertReceipt(tx, buildProjectChannelRegistrationReceipt({
          capability: cap,
          request,
          outcome: "terminal_nonacceptance",
          reason: "bind_precondition_conflict",
          targetId: preexisting.id,
          resultRevision: priorRecord.revision,
          resultDigest: priorRecord.digest,
          createdByOperation: false,
        }));
        assertTime(startedAt, request.time_budget_ms);
        return receipt;
      }
      const priorState: ProjectChannelRegistrationPriorState = {
        target_id: preexisting.id,
        project_id: preexisting.project_id,
        bound_project_id: request.project_id,
        revision: priorRecord.revision,
        digest: priorRecord.digest,
        message_project_digest: await messageProjectDigest(tx, preexisting.name),
      };
      const boundRaw = await tx.get<PgChannelRow>(`
        UPDATE channels
        SET project_id = $1
        WHERE id = $2 AND name = $3 AND project_id IS NOT DISTINCT FROM $4
        RETURNING *
      `, [
        request.project_id,
        preexisting.id,
        preexisting.name,
        validated.binding.expected_project_id,
      ]);
      if (!boundRaw) {
        throw new Error("project channel registration bind target changed during update.");
      }
      options.faultInjector?.("after_channel_bind");
      const bound = parseChannel(boundRaw);
      const record = projectChannelRegistrationChannelRecord(bound);
      const receipt = buildProjectChannelRegistrationReceipt({
        capability: cap,
        request,
        outcome: "accepted",
        targetId: bound.id,
        resultRevision: record.revision,
        resultDigest: record.digest,
        createdByOperation: false,
        priorState,
      });
      assertTime(startedAt, request.time_budget_ms);
      return insertReceipt(tx, receipt);
    }
    if (preexistingRaw) {
      const preexisting = parseChannel(preexistingRaw);
      const record = projectChannelRegistrationChannelRecord(preexisting);
      const receipt = await insertReceipt(tx, buildProjectChannelRegistrationReceipt({
        capability: cap,
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
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }

    const targetId = newChannelId();
    const inserted = await tx.one<PgChannelRow>(`
      INSERT INTO channels (
        id, name, description, topic, project_id, created_by, metadata, tags
      ) VALUES ($1, $2, NULL, NULL, $3, $4, NULL, NULL)
      RETURNING *
    `, [
      targetId,
      validated.channel,
      request.project_id,
      PROJECT_CHANNEL_REGISTRATION_CREATOR,
    ]);
    await tx.execute(
      "INSERT INTO channel_members (channel, agent) VALUES ($1, $2)",
      [validated.channel, PROJECT_CHANNEL_REGISTRATION_CREATOR],
    );
    options.faultInjector?.("after_channel_insert");
    const record = projectChannelRegistrationChannelRecord(parseChannel(inserted));
    const receipt = buildProjectChannelRegistrationReceipt({
      capability: cap,
      request,
      outcome: "accepted",
      targetId,
      resultRevision: record.revision,
      resultDigest: record.digest,
      createdByOperation: true,
    });
    assertTime(startedAt, request.time_budget_ms);
    return insertReceipt(tx, receipt);
  });
}

export async function readProjectChannelRegistrationExactPg(
  client: TypedQueryClient,
  request: ProjectChannelRegistrationReadRequest,
): Promise<ProjectChannelRegistrationRecord> {
  const startedAt = performance.now();
  assertBounds(request);
  const row = await client.get<PgChannelRow>(
    "SELECT * FROM channels WHERE id = $1",
    [request.target_id],
  );
  if (!row) throw new Error(`project channel registration target not found: ${request.target_id}`);
  const parsed = parseChannel(row);
  if (request.target_selector !== undefined && parsed.name !== request.target_selector) {
    throw new Error("project channel registration target id/channel mismatch.");
  }
  const record = projectChannelRegistrationChannelRecord(parsed);
  projectChannelRegistrationResponseControl(record, request, startedAt);
  return record;
}

export async function listProjectChannelRegistrationPagePg(
  client: TypedQueryClient,
  request: ProjectChannelCollectionRequest,
): Promise<ProjectChannelCollectionPage> {
  const startedAt = performance.now();
  validateProjectChannelCollectionRequest(request);
  const rows = await client.many<PgChannelRow>(`
    SELECT *
    FROM channels
    WHERE project_id = $1 AND ($2::text IS NULL OR id > $2)
    ORDER BY id ASC
    LIMIT $3
  `, [
    request.project_id,
    request.cursor ?? null,
    request.max_items + 1,
  ]);
  return buildProjectChannelCollectionPage(
    request,
    rows.map(parseChannel),
    startedAt,
  );
}

export async function listProjectChannelMessagePagePg(
  client: TypedQueryClient,
  request: ProjectChannelMessageCollectionRequest,
): Promise<ProjectChannelMessageCollectionPage> {
  const startedAt = performance.now();
  validateProjectChannelMessageCollectionRequest(request);
  const rawChannel = await client.get<PgChannelRow>(
    "SELECT * FROM channels WHERE id = $1",
    [request.target_id],
  );
  if (!rawChannel) {
    throw new Error(`project channel registration target not found: ${request.target_id}`);
  }
  const channel = parseChannel(rawChannel);
  if (channel.project_id !== request.project_id) {
    throw new Error(
      `Project ${request.project_id} conflicts with channel project ${channel.project_id ?? "(unlinked)"}.`,
    );
  }
  const inconsistent = await client.get<{ count: string | number }>(`
    SELECT COUNT(*)::bigint AS count
    FROM messages
    WHERE channel = $1 AND (project_id IS NULL OR project_id <> $2)
  `, [channel.name, request.project_id]);
  const inconsistentCount = Number(inconsistent?.count ?? 0);
  if (inconsistentCount > 0) {
    throw new Error(
      `Channel ${channel.name} has ${inconsistentCount} message(s) outside project ${request.project_id}; apply guarded project-message linkage before collection readback.`,
    );
  }
  const rows = await client.many<ProjectChannelMessageCollectionRow & { created_at: string | Date }>(`
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
    WHERE c.id = $1 AND m.project_id = $2 AND m.id > $3
    ORDER BY m.id ASC
    LIMIT $4
  `, [
    request.target_id,
    request.project_id,
    request.cursor ?? 0,
    request.max_items + 1,
  ]);
  return buildProjectChannelMessageCollectionPage(
    request,
    channel,
    rows.map((row) => ({ ...row, created_at: timestamp(row.created_at) })),
    startedAt,
  );
}

export async function lookupProjectChannelRegistrationReceiptPg(
  client: TypedQueryClient,
  request: ProjectChannelRegistrationLookupRequest,
): Promise<ProjectChannelRegistrationLookupResult> {
  const startedAt = performance.now();
  const cap = await capability(client);
  const exactTargetId = validateProjectChannelRegistrationLookup(request, cap);
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
  const targetClause = exactTargetId === undefined ? "" : " AND target_id = $13";
  if (exactTargetId !== undefined) params.push(exactTargetId);
  const rows = await client.many<PgReceiptRow>(`
    SELECT * FROM project_channel_registration_receipts
    WHERE authority = $1 AND route = $2 AND package_version = $3
      AND authority_id = $4 AND tenant_id = $5 AND corpus_id = $6
      AND operation_id = $7 AND step_id = $8 AND resource_kind = 'channel'
      AND direction = $9 AND idempotency_key = $10
      AND request_digest = $11 AND precondition_digest = $12
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
  `, params);
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
  return {
    receipt,
    response_control: projectChannelRegistrationResponseControl(
      { receipt },
      request,
      startedAt,
    ),
  };
}

async function sourceReceipt(
  client: TypedQueryClient,
  request: ProjectChannelRegistrationRequest,
): Promise<ProjectChannelRegistrationReceipt | null> {
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
  const row = await client.get<PgReceiptRow>(
    "SELECT * FROM project_channel_registration_receipts WHERE receipt_id = $1",
    [supplied.receipt_id],
  );
  if (!row) return null;
  const parsed = parseReceipt(row);
  return sameProjectChannelRegistrationReceipt(parsed, supplied) ? parsed : null;
}

async function terminalInverse(
  client: TypedQueryClient,
  cap: ProjectChannelRegistrationCapability,
  request: ProjectChannelRegistrationRequest,
  reason: string,
  accepted: ProjectChannelRegistrationReceipt | null,
  current?: ProjectChannelRegistrationRecord | null,
): Promise<ProjectChannelRegistrationReceipt> {
  return insertReceipt(client, buildProjectChannelRegistrationReceipt({
    capability: cap,
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

async function hasReferences(client: TypedQueryClient, row: PgChannelRow): Promise<boolean> {
  const members = await client.many<{ agent: string }>(
    "SELECT agent FROM channel_members WHERE channel = $1 ORDER BY agent",
    [row.name],
  );
  if (
    members.length !== 1
    || members[0].agent !== PROJECT_CHANNEL_REGISTRATION_CREATOR
  ) {
    return true;
  }
  const checks: Array<[string, readonly unknown[]]> = [
    ["SELECT 1 AS present FROM channel_subscriptions WHERE channel = $1 LIMIT 1", [row.name]],
    ["SELECT 1 AS present FROM messages WHERE channel = $1 LIMIT 1", [row.name]],
    ["SELECT 1 AS present FROM message_mentions WHERE channel = $1 LIMIT 1", [row.name]],
    ["SELECT 1 AS present FROM tasks WHERE channel = $1 LIMIT 1", [row.name]],
    [
      "SELECT 1 AS present FROM graph_edges WHERE (from_type = 'channel' AND from_id = $1) OR (to_type = 'channel' AND to_id = $1) LIMIT 1",
      [row.name],
    ],
    [
      "SELECT 1 AS present FROM resource_locks WHERE resource_type = 'channel' AND resource_id = $1 LIMIT 1",
      [row.name],
    ],
  ];
  for (const [sql, params] of checks) {
    if (await client.get<{ present: number }>(sql, params)) return true;
  }
  return false;
}

export async function compensateProjectChannelRegistrationPg(
  client: PoolQueryClient,
  request: ProjectChannelRegistrationRequest,
  options: ProjectChannelRegistrationFaultOptions = {},
): Promise<ProjectChannelRegistrationReceipt> {
  const startedAt = performance.now();
  assertBounds(request);
  const initialCapability = await capability(client);
  assertProjectChannelRegistrationIdentity(request, initialCapability);
  validateProjectChannelRegistrationInverseEnvelope(request, initialCapability);

  return client.transaction(async (tx) => {
    const cap = await capability(tx, true);
    const accepted = await sourceReceipt(tx, request);
    if (!accepted) {
      const receipt = await terminalInverse(
        tx,
        cap,
        request,
        "accepted_receipt_required",
        null,
      );
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }
    validateProjectChannelRegistrationInverse(request, cap, accepted);
    await lockRegistration(tx, cap, request, accepted.target_id!);

    const priorInverse = await acceptedForStep(tx, cap, request);
    if (priorInverse) {
      const receipt = exactProjectChannelRegistrationReplay(priorInverse, request)
        ? await duplicateReceipt(tx, cap, request, priorInverse)
        : await changedReceipt(tx, cap, request, priorInverse);
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }

    const row = await tx.get<PgChannelRow>(
      "SELECT * FROM channels WHERE id = $1 FOR UPDATE",
      [accepted.target_id],
    );
    if (!row) {
      const receipt = await terminalInverse(
        tx,
        cap,
        request,
        "target_missing_without_inverse_receipt",
        accepted,
      );
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }
    const current = projectChannelRegistrationChannelRecord(parseChannel(row));
    if (
      current.revision !== accepted.result_revision
      || current.digest !== accepted.result_digest
    ) {
      const receipt = await terminalInverse(
        tx,
        cap,
        request,
        "target_drifted",
        accepted,
        current,
      );
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }
    if (accepted.prior_state) {
      const prior = accepted.prior_state;
      if (
        row.project_id !== prior.bound_project_id
        || await messageProjectDigest(tx, row.name) !== prior.message_project_digest
      ) {
        const receipt = await terminalInverse(
          tx,
          cap,
          request,
          "target_referenced",
          accepted,
          current,
        );
        assertTime(startedAt, request.time_budget_ms);
        return receipt;
      }
      const restoredRaw = await tx.get<PgChannelRow>(`
        UPDATE channels
        SET project_id = $1
        WHERE id = $2 AND name = $3 AND project_id = $4
        RETURNING *
      `, [
        prior.project_id,
        row.id,
        row.name,
        prior.bound_project_id,
      ]);
      if (!restoredRaw) {
        throw new Error("project channel registration bind target changed during inverse.");
      }
      options.faultInjector?.("after_channel_restore");
      const restored = projectChannelRegistrationChannelRecord(parseChannel(restoredRaw));
      if (
        restored.revision !== prior.revision
        || restored.digest !== prior.digest
      ) {
        throw new Error("project channel registration bind inverse did not restore the prior state.");
      }
      const receipt = buildProjectChannelRegistrationReceipt({
        capability: cap,
        request,
        outcome: "accepted",
        targetId: accepted.target_id,
        resultRevision: restored.revision,
        resultDigest: restored.digest,
        acceptedReceiptId: accepted.receipt_id,
        createdByOperation: false,
        priorState: prior,
      });
      assertTime(startedAt, request.time_budget_ms);
      return insertReceipt(tx, receipt);
    }
    if (await hasReferences(tx, row)) {
      const receipt = await terminalInverse(
        tx,
        cap,
        request,
        "target_referenced",
        accepted,
        current,
      );
      assertTime(startedAt, request.time_budget_ms);
      return receipt;
    }

    await tx.execute(
      "DELETE FROM channel_members WHERE channel = $1 AND agent = $2",
      [row.name, PROJECT_CHANNEL_REGISTRATION_CREATOR],
    );
    const deleted = await tx.query<{ id: string }>(
      "DELETE FROM channels WHERE id = $1 AND name = $2 RETURNING id",
      [row.id, row.name],
    );
    if (deleted.rowCount !== 1) {
      throw new Error("project channel registration target changed during inverse.");
    }
    options.faultInjector?.("after_channel_delete");

    const absenceDigest = projectChannelRegistrationDigest({
      target_id: accepted.target_id,
      absent: true,
    });
    const receipt = buildProjectChannelRegistrationReceipt({
      capability: cap,
      request,
      outcome: "accepted",
      targetId: accepted.target_id,
      resultRevision: "absent",
      resultDigest: absenceDigest,
      acceptedReceiptId: accepted.receipt_id,
      createdByOperation: true,
    });
    assertTime(startedAt, request.time_budget_ms);
    return insertReceipt(tx, receipt);
  });
}

export async function verifyProjectChannelRegistrationInversePg(
  client: TypedQueryClient,
  request: ProjectChannelRegistrationRequest,
): Promise<ProjectChannelRegistrationInverseVerification> {
  const startedAt = performance.now();
  assertBounds(request);
  const cap = await capability(client);
  assertProjectChannelRegistrationIdentity(request, cap);
  const accepted = await sourceReceipt(client, request);
  if (!accepted) throw new Error("accepted project channel registration receipt is required.");
  validateProjectChannelRegistrationInverse(request, cap, accepted);
  const target = await client.get<PgChannelRow>(
    "SELECT * FROM channels WHERE id = $1",
    [accepted.target_id],
  );
  if (accepted.prior_state) {
    if (!target) {
      throw new Error("project channel registration inverse verification did not find the restored target.");
    }
    const parsed = parseChannel(target);
    const record = projectChannelRegistrationChannelRecord(parsed);
    if (
      parsed.project_id !== accepted.prior_state.project_id
      || record.revision !== accepted.prior_state.revision
      || record.digest !== accepted.prior_state.digest
      || await messageProjectDigest(client, parsed.name) !== accepted.prior_state.message_project_digest
    ) {
      throw new Error("project channel registration inverse verification found a non-restored target.");
    }
  } else if (target) {
    throw new Error("project channel registration inverse verification found the target.");
  }
  const inverse = await acceptedForStep(client, cap, request);
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
