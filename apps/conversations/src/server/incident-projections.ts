import { randomUUID } from "crypto";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { parseMessage } from "../lib/messages.js";
import {
  buildIncidentProjectionDisplay,
  IncidentProjectionConflictError,
  validateIncidentProjection,
} from "../lib/incident-projection-contract.js";
import type {
  IncidentProjectionRecord,
  IncidentProjectionRequestV1,
  IncidentProjectorContext,
  Message,
} from "../types.js";

type Row = Record<string, unknown>;

// One transaction-scoped identity fence covers both existing and not-yet-
// created channel names. Projectors take the shared form; channel create/rename
// take the exclusive form. This deliberately favors a small correctness fence
// over per-name gap-lock complexity for an infrequent control-plane operation.
export const CHANNEL_IDENTITY_ADVISORY_LOCK = 0x434f4e56;

async function resolveLockedProjectionChannel(
  client: TypedQueryClient,
  configuredChannel: string,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const before = await client.get<{ current_channel: string }>(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1",
      [configuredChannel],
    );
    const candidate = before?.current_channel ?? configuredChannel;
    // This row-identity lock serializes projector writes with renameChannelServer.
    // If a rename committed while this SELECT waited, the row disappears and
    // the alias re-read below moves the projector to the new current channel.
    await client.get("SELECT name FROM channels WHERE name = $1 FOR SHARE", [candidate]);
    const after = await client.get<{ current_channel: string }>(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1",
      [configuredChannel],
    );
    const resolved = after?.current_channel ?? configuredChannel;
    if (resolved === candidate) return resolved;
  }
  throw new IncidentProjectionConflictError(
    `Channel routing for #${configuredChannel} changed repeatedly; retry the projection`,
  );
}

async function loadRecord(
  client: TypedQueryClient,
  row: Row,
  replayed: boolean,
): Promise<IncidentProjectionRecord> {
  const messageRow = await client.get<Row>("SELECT * FROM messages WHERE id = $1", [Number(row.message_id)]);
  if (!messageRow) throw new Error(`Incident projection ${String(row.event_id)} has no display message`);
  return {
    id: Number(row.id),
    event_id: String(row.event_id),
    projection_key: String(row.projection_key),
    message_id: Number(row.message_id),
    schema_version: 1,
    source: "todos",
    tenant_id: String(row.tenant_id),
    authority_id: String(row.authority_id),
    incident_id: String(row.incident_id),
    transition_id: String(row.transition_id),
    incident_version: Number(row.incident_version),
    occurred_at: new Date(String(row.occurred_at)).toISOString(),
    status: row.status as IncidentProjectionRecord["status"],
    severity: row.severity as IncidentProjectionRecord["severity"],
    blocking: Boolean(row.blocking),
    supersedes_transition_id: row.supersedes_transition_id == null ? null : String(row.supersedes_transition_id),
    supersedes_incident_id: row.supersedes_incident_id == null ? null : String(row.supersedes_incident_id),
    superseded_by_incident_id: row.superseded_by_incident_id == null ? null : String(row.superseded_by_incident_id),
    canonical_payload: String(row.canonical_payload),
    payload_hash: String(row.payload_hash),
    created_at: new Date(String(row.created_at)).toISOString(),
    message: parseMessage(messageRow) as Message,
    replayed,
  };
}

/** PG implementation of the projector. All display, ledger, and scope writes commit together. */
export async function appendIncidentProjectionPg(
  client: PoolQueryClient,
  raw: IncidentProjectionRequestV1,
  context: IncidentProjectorContext,
): Promise<IncidentProjectionRecord> {
  const validated = validateIncidentProjection(raw, context);
  const { request } = validated;
  const display = buildIncidentProjectionDisplay(request, context);

  try {
    return await client.transaction(async (tx) => {
      await tx.get(
        "SELECT pg_advisory_xact_lock_shared($1::bigint) AS channel_identity_locked",
        [CHANNEL_IDENTITY_ADVISORY_LOCK],
      );
    const existing = await tx.get<Row>(
      "SELECT * FROM incident_projections WHERE tenant_id = $1 AND event_id = $2",
      [context.tenant_id, request.event_id],
    );
    if (existing) {
      if (String(existing.payload_hash) !== validated.payload_hash) {
        throw new IncidentProjectionConflictError(
          `Event ${request.event_id} already exists with a different canonical payload`,
        );
      }
      return loadRecord(tx, existing, true);
    }

    const latest = await tx.get<Row>(
      `SELECT * FROM incident_projections
       WHERE tenant_id = $1 AND authority_id = $2 AND incident_id = $3
       ORDER BY incident_version DESC LIMIT 1 FOR UPDATE`,
      [context.tenant_id, context.authority_id, request.incident_id],
    );
    if (request.incident_version === 1) {
      if (latest) {
        throw new IncidentProjectionConflictError(
          `Incident ${request.incident_id} already has projection version ${String(latest.incident_version)}`,
        );
      }
    } else {
      if (!latest || Number(latest.incident_version) !== request.incident_version - 1 ||
          String(latest.transition_id) !== validated.supersedes_transition_id) {
        throw new IncidentProjectionConflictError(
          `Incident ${request.incident_id} requires canonical predecessor version ${request.incident_version - 1}`,
        );
      }
      if (Date.parse(request.occurred_at) < Date.parse(String(latest.occurred_at))) {
        throw new IncidentProjectionConflictError("Incident projection occurred_at cannot move backwards");
      }
    }

    const assertSupersededSource = async (id: string | null): Promise<void> => {
      if (!id) return;
      const target = await tx.get<Row>(
        `SELECT * FROM incident_projections
         WHERE tenant_id = $1 AND authority_id = $2 AND incident_id = $3
         ORDER BY incident_version DESC LIMIT 1`,
        [context.tenant_id, context.authority_id, id],
      );
      if (!target) {
        throw new IncidentProjectionConflictError("incident.supersedes_id references an incident outside this tenant/authority or not yet projected");
      }
      if (target.status !== "superseded" || target.superseded_by_incident_id !== request.incident_id) {
        throw new IncidentProjectionConflictError(
          "incident.supersedes_id must reciprocate a superseded incident whose superseded_by_id is this incident",
        );
      }
    };
    await assertSupersededSource(request.incident.supersedes_id);

    let channel = display.channel
      ? await resolveLockedProjectionChannel(tx, display.channel)
      : null;
    let projectId = display.project_id ?? null;
    let sessionId = channel
      ? `channel:${channel}`
      : display.session_id ?? `incident:${context.authority_id}:${request.incident_id}`;
    let toAgent = channel ?? display.to;
    let replyTo: number | null = null;
    if (request.incident_version > 1) {
      const root = await tx.get<Row>(
        `SELECT m.id, m.session_id, m.channel, m.project_id, m.to_agent
         FROM incident_projections p JOIN messages m ON m.id = p.message_id
         WHERE p.tenant_id = $1 AND p.authority_id = $2 AND p.incident_id = $3 AND p.incident_version = 1`,
        [context.tenant_id, context.authority_id, request.incident_id],
      );
      if (!root) throw new IncidentProjectionConflictError("Incident projection root is missing");
      sessionId = String(root.session_id);
      channel = root.channel == null ? null : String(root.channel);
      projectId = root.project_id == null ? null : String(root.project_id);
      toAgent = String(root.to_agent);
      replyTo = Number(root.id);
    }

    const pointer = JSON.stringify({
      canonical_incident_projection: {
        schema_version: 1,
        source: "todos",
        authority_id: context.authority_id,
        incident_id: request.incident_id,
        incident_version: request.incident_version,
        transition_id: request.transition_id,
        event_id: request.event_id,
        projection_key: request.projection_key,
      },
    });
    const messageRow = await tx.get<Row>(
      `INSERT INTO messages (
         uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
         working_dir, repository, branch, metadata, blocking, reply_to
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        randomUUID().replace(/-/g, ""),
        sessionId,
        display.from,
        toAgent,
        channel,
        projectId,
        display.content,
        display.priority ?? "normal",
        display.working_dir ?? null,
        display.repository ?? null,
        display.branch ?? null,
        pointer,
        validated.blocking,
        replyTo,
      ],
    );
    if (!messageRow) throw new Error("Failed to create incident projection display message");

    const incident = request.incident;
    const projectionRow = await tx.get<Row>(
      `INSERT INTO incident_projections (
         event_id, projection_key, message_id, schema_version, source, tenant_id, authority_id,
         incident_id, transition_id, incident_version, occurred_at, status, severity, blocking,
         affected_scopes, blocked_scopes, supersedes_transition_id, supersedes_incident_id,
         superseded_by_incident_id, canonical_payload, payload_hash
       ) VALUES ($1,$2,$3,1,'todos',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (tenant_id, event_id) DO NOTHING
       RETURNING *`,
      [
        request.event_id,
        request.projection_key,
        Number(messageRow.id),
        context.tenant_id,
        context.authority_id,
        request.incident_id,
        request.transition_id,
        request.incident_version,
        request.occurred_at,
        incident.status,
        incident.severity,
        validated.blocking,
        JSON.stringify(incident.affected_scopes),
        JSON.stringify(incident.blocked_scopes),
        validated.supersedes_transition_id,
        incident.supersedes_id,
        incident.superseded_by_id,
        validated.canonical_payload,
        validated.payload_hash,
      ],
    );

    if (!projectionRow) {
      // A concurrent identical event won the unique insert. Candidate display
      // remains unlinked and can be removed inside this same transaction.
      await tx.query("DELETE FROM messages WHERE id = $1", [Number(messageRow.id)]);
      const winner = await tx.get<Row>(
        "SELECT * FROM incident_projections WHERE tenant_id = $1 AND event_id = $2",
        [context.tenant_id, request.event_id],
      );
      if (!winner) throw new IncidentProjectionConflictError("Concurrent incident projection winner is unavailable");
      if (String(winner.payload_hash) !== validated.payload_hash) {
        throw new IncidentProjectionConflictError(
          `Event ${request.event_id} already exists with a different canonical payload`,
        );
      }
      return loadRecord(tx, winner, true);
    }

    for (const scope of incident.affected_scopes) {
      await tx.query(
        "INSERT INTO incident_projection_scopes (projection_id, scope_type, scope) VALUES ($1, 'affected', $2)",
        [Number(projectionRow.id), scope],
      );
    }
    for (const scope of incident.blocked_scopes) {
      await tx.query(
        "INSERT INTO incident_projection_scopes (projection_id, scope_type, scope) VALUES ($1, 'blocked', $2)",
        [Number(projectionRow.id), scope],
      );
    }

      return loadRecord(tx, projectionRow, false);
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "23505") throw error;
    const winner = await client.get<Row>(
      `SELECT * FROM incident_projections
       WHERE tenant_id = $1 AND authority_id = $2
         AND (event_id = $3 OR (incident_id = $4 AND incident_version = $5))
       ORDER BY CASE WHEN event_id = $3 THEN 0 ELSE 1 END LIMIT 1`,
      [context.tenant_id, context.authority_id, request.event_id, request.incident_id, request.incident_version],
    );
    if (winner && winner.event_id === request.event_id && winner.projection_key === request.projection_key &&
        winner.payload_hash === validated.payload_hash) {
      return loadRecord(client, winner, true);
    }
    throw new IncidentProjectionConflictError(
      `Incident ${request.incident_id} version ${request.incident_version} already has a different canonical projection`,
    );
  }
}

export async function getIncidentProjectionPg(
  client: TypedQueryClient,
  eventId: string,
  context: IncidentProjectorContext,
): Promise<IncidentProjectionRecord | null> {
  const row = await client.get<Row>(
    "SELECT * FROM incident_projections WHERE tenant_id = $1 AND authority_id = $2 AND event_id = $3",
    [context.tenant_id, context.authority_id, eventId],
  );
  return row ? loadRecord(client, row, false) : null;
}
